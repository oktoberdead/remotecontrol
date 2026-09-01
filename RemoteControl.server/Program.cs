using Microsoft.AspNetCore.Http.HttpResults;
using RemoteControl.Server;
using RemoteControl.Server.Models;
using RemoteControl.Server.Services;
using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;





var appDir = AppContext.BaseDirectory;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = appDir,
    WebRootPath = Path.Combine(appDir, "wwwroot")
});

builder.Host.UseContentRoot(appDir);
builder.WebHost.UseWebRoot(Path.Combine(appDir, "wwwroot"));

var enableConsole = args.Any(a => a.Equals("--console", StringComparison.OrdinalIgnoreCase));

builder.Logging.ClearProviders();

if (enableConsole)
{
    builder.Logging.AddSimpleConsole(o =>
    {
        o.SingleLine = true;
        o.TimestampFormat = "HH:mm:ss ";
    });
}


builder.Configuration
    .SetBasePath(appDir)
    .AddJsonFile("appsettings.json", optional: true, reloadOnChange: true);
// Services
builder.Services.AddSingleton<KeyboardService>();
builder.Services.AddSingleton<MouseService>();
builder.Services.AddSingleton<AudioService>();
builder.Services.AddSingleton<WireGuardService>();
builder.Services.AddSingleton<MacroService>();
builder.Services.AddSingleton<ScreenService>();
builder.Services.AddSingleton<GamepadService>();
builder.Services.AddSingleton<MonitorService>();
builder.Services.AddSingleton<UiService>();



builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));

var app = builder.Build();






// --- BOOT MODE GUARD (LOCAL vs REMOTE) ---
await BootModeGuardAsync(app.Services);

static async Task BootModeGuardAsync(IServiceProvider sp)
{
    // ВАЖНО: чтобы не логоффало всех пользователей подряд, ограничь проверку только автологон-юзером
    const string AutoLogonUser = "YOUR_AUTOLOGON_USER"; // <-- поменяй
    if (!string.Equals(Environment.UserName, AutoLogonUser, StringComparison.OrdinalIgnoreCase))
        return;

    const string RouterMarkerUrl = "http://192.168.1.1/boot_mode.txt";

    string mode;
    try
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        mode = (await http.GetStringAsync(RouterMarkerUrl)).Trim();
    }
    catch
    {
        // fail-open, чтобы не кирпичить систему если роутер недоступен
        return;
    }

    if (mode.Equals("REMOTE", StringComparison.OrdinalIgnoreCase))
        return;

    // LOCAL: ждём физическую активность мыши N секунд
    var mouse = sp.GetRequiredService<RemoteControl.Server.Services.MouseService>();

    var start = mouse.GetPosition();
    var deadline = DateTime.UtcNow.AddSeconds(20);

    while (DateTime.UtcNow < deadline)
    {
        await Task.Delay(200);
        var cur = mouse.GetPosition();

        if (Math.Abs(cur.X - start.X) > 5 || Math.Abs(cur.Y - start.Y) > 5)
            return; // мышь шевельнули — значит локальный вход руками, не логоффаем
    }

    // никого нет — выкидываем
    try
    {
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
        {
            FileName = "logoff.exe",
            UseShellExecute = true
        });
    }
    catch { }

    Environment.Exit(0);
}





app.UseCors();
app.UseWebSockets();
app.UseDefaultFiles();
app.UseStaticFiles();

// Debug endpoint
app.MapGet("/api/debug", (AudioService audio, WireGuardService wg, KeyboardService kb) =>
{
    var result = new
    {
        Volume = audio.GetVolume(),
        Muted = audio.IsMuted(),
        WgStatus = wg.GetStatus(),
        Layout = kb.GetCurrentLayout(),
        Devices = audio.GetOutputDevices()
    };
    Console.WriteLine($"DEBUG: Vol={result.Volume}, WG={result.WgStatus}, Layout={result.Layout}, Devices={result.Devices.Count}");
    return Results.Json(result);
});

// ==================== WEBSOCKET: SCREEN STREAM ====================
app.Map("/ws/screen", async (HttpContext ctx, ScreenService screen) =>
{
    if (!ctx.WebSockets.IsWebSocketRequest)
    {
        ctx.Response.StatusCode = 400;
        return;
    }

    using var ws = await ctx.WebSockets.AcceptWebSocketAsync();
    await screen.StreamToWebSocket(ws, ctx.RequestAborted);
});

// ==================== SYSTEM ====================
app.MapGet("/api/system/info", () =>
{
    var uptime = TimeSpan.FromMilliseconds(Environment.TickCount64);
    return Results.Json(new
    {
        Success = true,
        Uptime = $"{uptime.Days}d {uptime.Hours}h {uptime.Minutes}m",
        Machine = Environment.MachineName
    });
});

// ==================== SYSTEM: SHUTDOWN ====================
app.MapPost("/api/system/shutdown", async (HttpRequest req) =>
{
    var body = await req.ReadFromJsonAsync<SystemShutdownRequest>();
    int delay = body?.Instant == true ? 0 : Math.Clamp(body?.Delay ?? 30, 0, 300);

    try
    {
        using var p = Process.Start(new ProcessStartInfo("shutdown.exe", $"/s /t {delay}")
        {
            UseShellExecute = false,
            CreateNoWindow = true
        });
        Console.WriteLine($"Shutdown scheduled in {delay}s");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Shutdown failed: {ex.Message}");
        return Results.Json(new { success = false, error = ex.Message });
    }

    return Results.Json(new { success = true, delay });
});

app.MapPost("/api/system/shutdown/cancel", () =>
{
    try
    {
        using var p = Process.Start(new ProcessStartInfo("shutdown.exe", "/a")
        {
            UseShellExecute = false,
            CreateNoWindow = true
        });
    }
    catch { /* ничего не было запланировано */ }

    return Results.Json(new { success = true });
});

// ==================== SYSTEM: CONFIG & RESTART ====================
app.MapGet("/api/system/config", () =>
{
    var path = Path.Combine(AppContext.BaseDirectory, "appsettings.json");
    if (!File.Exists(path))
        return Results.Json(new { success = false, error = "appsettings.json not found" });
    return Results.Json(new { success = true, content = File.ReadAllText(path) });
});

app.MapPost("/api/system/config", async (HttpRequest req) =>
{
    var body = await req.ReadFromJsonAsync<ConfigSaveRequest>();
    if (string.IsNullOrWhiteSpace(body?.Content))
        return Results.Json(new { success = false, error = "empty content" });

    try
    {
        using var doc = JsonDocument.Parse(body.Content);
    }
    catch (JsonException ex)
    {
        return Results.Json(new { success = false, error = "Invalid JSON: " + ex.Message });
    }

    await File.WriteAllTextAsync(Path.Combine(AppContext.BaseDirectory, "appsettings.json"), body.Content);
    Console.WriteLine("appsettings.json updated");
    return Results.Json(new { success = true });
});

app.MapPost("/api/system/restart", () =>
{
    try
    {
        var exe = Environment.ProcessPath;
        if (exe == null)
            return Results.Json(new { success = false, error = "ProcessPath unavailable" });

        var args = string.Join(" ", Environment.GetCommandLineArgs().Skip(1));
        using var p = Process.Start(new ProcessStartInfo(exe, args + " --restart-delay 3000")
        {
            UseShellExecute = false,
            CreateNoWindow = true
        });
        Console.WriteLine("Server restart initiated");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Restart failed: {ex.Message}");
        return Results.Json(new { success = false, error = ex.Message });
    }

    _ = Task.Delay(500).ContinueWith(_ => Environment.Exit(0));
    return Results.Json(new { success = true });
});

// ==================== KEYBOARD ====================
app.MapPost("/api/key/{key}", (string key, KeyboardService kb, ScreenService screen) =>
{
    screen.NotifyInput();
    kb.PressKey(key);
    return Results.Json(new { Success = true, Key = key });
});

app.MapPost("/api/type", async (HttpRequest req, KeyboardService kb, ScreenService screen) =>
{
    screen.NotifyInput();
    var body = await req.ReadFromJsonAsync<TypeRequest>();
    if (!string.IsNullOrEmpty(body?.Text))
        kb.SendString(body.Text);
    return Results.Json(new { Success = true });
});

app.MapPost("/api/combo", async (HttpRequest req, KeyboardService kb, ScreenService screen) =>
{
    screen.NotifyInput();
    var body = await req.ReadFromJsonAsync<ComboRequest>();
    kb.PressCombo(body!.Keys, body.Delay);
    return Results.Json(new { Success = true });
});

app.MapGet("/api/keyboard/layout", (KeyboardService kb) =>
    Results.Json(new { Success = true, Layout = kb.GetCurrentLayout() }));

app.MapPost("/api/keyboard/layout/toggle", (KeyboardService kb) =>
{
    kb.ToggleLayout();
    Thread.Sleep(100);
    return Results.Json(new { Success = true, Layout = kb.GetCurrentLayout() });
});

// ==================== MOUSE ====================
app.MapGet("/api/mouse/position", (MouseService mouse) =>
{
    var pos = mouse.GetPosition();
    return Results.Json(new { Success = true, X = pos.X, Y = pos.Y });
});

app.MapPost("/api/mouse/move", async (HttpRequest req, MouseService mouse, ScreenService screen) =>
{
    screen.NotifyInput();
    var body = await req.ReadFromJsonAsync<MoveRequest>();
    if (body!.Absolute)
        mouse.MoveTo(body.X, body.Y);
    else
        mouse.MoveBy(body.X, body.Y);
    return Results.Json(new { Success = true });
});

app.MapPost("/api/mouse/click/{button}", (string button, MouseService mouse, ScreenService screen) =>
{
    screen.NotifyInput();
    switch (button.ToLower())
    {
        case "left": mouse.LeftClick(); break;
        case "right": mouse.RightClick(); break;
        case "middle": mouse.MiddleClick(); break;
        case "double": mouse.DoubleClick(); break;
    }
    return Results.Json(new { Success = true });
});

app.MapPost("/api/mouse/down/{button}", (string button, MouseService mouse, ScreenService screen) =>
{
    screen.NotifyInput();
    switch (button.ToLower())
    {
        case "left": mouse.LeftDown(); break;
        case "right": mouse.RightDown(); break;
        case "middle": mouse.MiddleDown(); break;
    }
    return Results.Json(new { success = true });
});

app.MapPost("/api/mouse/up/{button}", (string button, MouseService mouse, ScreenService screen) =>
{
    screen.NotifyInput();
    switch (button.ToLower())
    {
        case "left": mouse.LeftUp(); break;
        case "right": mouse.RightUp(); break;
        case "middle": mouse.MiddleUp(); break;
    }
    return Results.Json(new { success = true });
});

app.MapPost("/api/mouse/scroll", async (HttpRequest req, MouseService mouse, ScreenService screen) =>
{
    screen.NotifyInput();
    var body = await req.ReadFromJsonAsync<ScrollRequest>();
    mouse.Scroll(body!.Delta);
    return Results.Json(new { Success = true });
});

// ==================== AUDIO ====================
app.MapGet("/api/volume", (AudioService audio) =>
    Results.Json(new { Success = true, Volume = audio.GetVolume(), Muted = audio.IsMuted() }));

app.MapPost("/api/volume/set", async (HttpRequest req, AudioService audio) =>
{
    var body = await req.ReadFromJsonAsync<VolumeRequest>();
    audio.SetVolume(body!.Level);
    return Results.Json(new { Success = true, Volume = body.Level });
});

app.MapPost("/api/volume/mute", (AudioService audio) =>
{
    audio.ToggleMute();
    return Results.Json(new { Success = true, Muted = audio.IsMuted() });
});

app.MapGet("/api/audio/devices", (AudioService audio) =>
    Results.Json(new { Success = true, Devices = audio.GetOutputDevices() }));

app.MapPost("/api/audio/device", async (HttpRequest req, AudioService audio) =>
{
    var body = await req.ReadFromJsonAsync<DeviceRequest>();
    var ok = audio.SetOutputDevice(body!.Name);
    return Results.Json(new { Success = ok });
});

// ==================== SCREEN ====================
app.MapGet("/api/screen/state", (ScreenService screen) =>
{
    var state = screen.GetState();
    return Results.Json(new
    {
        success = true,
        zoom = state.zoom,
        panX = state.panX,
        panY = state.panY
    });
});

app.MapPost("/api/screen/zoom", async (HttpRequest req, ScreenService screen) =>
{
    var body = await req.ReadFromJsonAsync<ZoomRequest>();

    if (body?.Action == "in")
        screen.ZoomIn();
    else if (body?.Action == "out")
        screen.ZoomOut();
    else if (body?.Action == "reset")
        screen.ResetZoom();
    else if (body?.Action == "set" && body.Level.HasValue)
        screen.SetZoom(body.Level.Value);

    // zoom + абсолютный пан атомарно (коммит client-side view в конце жеста)
    if (body?.PanX.HasValue == true && body.PanY.HasValue == true)
        screen.SetPan(body.PanX.Value, body.PanY.Value);

    var state = screen.GetState();
    return Results.Json(new { success = true, zoom = state.zoom, panX = state.panX, panY = state.panY });
});

app.MapPost("/api/screen/pan", async (HttpRequest req, ScreenService screen) =>
{
    var body = await req.ReadFromJsonAsync<PanRequest>();

    if (body?.Absolute == true)
        screen.SetPan(body.X, body.Y);
    else
        screen.Pan(body?.X ?? 0, body?.Y ?? 0);

    var state = screen.GetState();
    return Results.Json(new { success = true, zoom = state.zoom, panX = state.panX, panY = state.panY });
});

// ==================== WIREGUARD ====================
app.MapGet("/api/wg/status", (WireGuardService wg) =>
    Results.Json(new { Success = true, Status = wg.GetStatus() }));

app.MapPost("/api/wg/toggle", (WireGuardService wg) =>
    Results.Json(new { Success = true, Status = wg.Toggle() }));

// ==================== MONITOR (ControlMyMonitor / DDC/CI) ====================
var monitorName = builder.Configuration.GetValue<string>("Monitor:Name") ?? "Primary";

app.MapGet("/api/monitor/state", (MonitorService mon) =>
{
    var s = mon.GetState(monitorName);

    return Results.Json(new
    {
        success = true,
        available = s.Available,
        monitor = s.MonitorName ?? monitorName,
        brightness = s.Brightness,
        brightnessMax = s.BrightnessMax,
        powerMode = s.PowerMode,
        // VESA VCP: 1 = on, 4 = standby, 5 = suspend
        powerOn = s.PowerMode == 1,
        powerKnown = s.PowerMode is 1 or 4 or 5
    });
});

app.MapPost("/api/monitor/brightness", async (HttpRequest req, MonitorService mon) =>
{
    if (!mon.IsAvailable())
        return Results.Json(new { success = false, error = "ControlMyMonitor.exe not found" });

    var body = await req.ReadFromJsonAsync<MonitorBrightnessRequest>();
    var (ok, value) = mon.SetBrightness(monitorName, body?.Level ?? 0);

    return Results.Json(new { success = ok, brightness = ok ? value : (int?)null, requested = value });
});

app.MapPost("/api/monitor/power", async (HttpRequest req, MonitorService mon) =>
{
    if (!mon.IsAvailable())
        return Results.Json(new { success = false, error = "ControlMyMonitor.exe not found" });

    var body = await req.ReadFromJsonAsync<MonitorPowerRequest>();
    var (ok, power) = mon.SetPower(monitorName, body?.Action?.ToLowerInvariant() ?? "");

    return Results.Json(new
    {
        success = ok,
        powerMode = power,
        powerOn = power == 1,
        powerKnown = power is 1 or 4 or 5
    });
});

// ==================== MACROS ====================
app.MapGet("/api/macros", (MacroService macros) =>
    Results.Json(new { Success = true, Macros = macros.GetAll() }));

app.MapPost("/api/macros", async (HttpRequest req, MacroService macros) =>
{
    var macro = await req.ReadFromJsonAsync<Macro>();
    macros.Save(macro!);
    return Results.Json(new { Success = true, Id = macro!.Id });
});

app.MapDelete("/api/macros/{id}", (string id, MacroService macros) =>
{
    macros.Delete(id);
    return Results.Json(new { Success = true });
});

app.MapPost("/api/macros/{id}/run", (string id, MacroService macros, ScreenService screen) =>
{
    screen.NotifyInput();
    var macro = macros.Get(id);
    if (macro == null)
        return Results.Json(new { Success = false, Error = "Not found" });
    macros.Execute(macro);
    return Results.Json(new { Success = true, Name = macro.Name });
});

app.MapGet("/api/screen/fps", (ScreenService screen) =>
{
    var fps = screen.GetFps();
    return Results.Json(new { success = true, fps = fps.fps, idleFps = fps.idleFps });
});

app.MapPost("/api/screen/fps", async (HttpRequest req, ScreenService screen) =>
{
    var body = await req.ReadFromJsonAsync<FpsRequest>();
    screen.SetFps(body?.Fps ?? 30, body?.IdleFps);
    var fps = screen.GetFps();
    return Results.Json(new { success = true, fps = fps.fps, idleFps = fps.idleFps });
});

app.MapPost("/api/screen/quality", async (HttpRequest req, ScreenService screen) =>
{
    var body = await req.ReadFromJsonAsync<QualityRequest>();
    screen.SetQuality(body?.Percent ?? 100, body?.Jpeg ?? 0);
    var q = screen.GetQuality();
    return Results.Json(new { success = true, percent = q.percent, jpeg = q.jpeg });
});

app.MapPost("/api/key/down/{key}", (string key, KeyboardService kb, ScreenService screen) =>
{
    screen.NotifyInput();
    var vk = kb.GetVirtualKey(key);
    if (vk != 0) kb.KeyDown(vk);
    return Results.Json(new { success = true });
});

app.MapPost("/api/key/up/{key}", (string key, KeyboardService kb, ScreenService screen) =>
{
    screen.NotifyInput();
    var vk = kb.GetVirtualKey(key);
    if (vk != 0) kb.KeyUp(vk);
    return Results.Json(new { success = true });
});


app.MapPost("/api/gamepad/start", (GamepadService gp) =>
{
    gp.Start();
    return Results.Json(new { success = true, active = gp.IsActive });
});

app.MapPost("/api/gamepad/stop", (GamepadService gp) =>
{
    gp.Stop();
    return Results.Json(new { success = true, active = gp.IsActive });
});





app.Map("/ws/gamepad", async (HttpContext ctx, GamepadService gp, ScreenService screen) =>
{
    if (!ctx.WebSockets.IsWebSocketRequest)
    {
        ctx.Response.StatusCode = 400;
        return;
    }

    gp.Start();

    using var ws = await ctx.WebSockets.AcceptWebSocketAsync();

    var buf = new byte[4096];

    while (ws.State == WebSocketState.Open && !ctx.RequestAborted.IsCancellationRequested)
    {
        var result = await ws.ReceiveAsync(buf, ctx.RequestAborted);
        if (result.MessageType == WebSocketMessageType.Close) break;

        if (result.MessageType != WebSocketMessageType.Text) continue;

        var json = Encoding.UTF8.GetString(buf, 0, result.Count);

        try
        {
            var msg = JsonSerializer.Deserialize<GamepadMsg>(json);
            if (msg == null) continue;

            screen.NotifyInput();

            // only left stick needed now
            if (msg.t == "ls")
            {
                gp.SetLeftStick(msg.x, msg.y);
            }
            else if (msg.t == "zero")
            {
                gp.SetLeftStick(0, 0);
            }
        }
        catch
        {
            // ignore bad packets
        }
    }

    // safety: neutral stick
    gp.SetLeftStick(0, 0);
});


// ==================== GAME LAYOUT ====================
app.MapGet("/api/game/layout", async () =>
{
    var path = AppPaths.SettingsFile(common: false);
    if (File.Exists(path))
    {
        var json = await File.ReadAllTextAsync(path);
        return Results.Content(json, "application/json");
    }
    return Results.Json(new { buttons = new object[] { } });
});

app.MapPost("/api/game/layout", async (HttpRequest req) =>
{
    var path = AppPaths.SettingsFile(common: false);
    using var reader = new StreamReader(req.Body);
    var json = await reader.ReadToEndAsync();
    await File.WriteAllTextAsync(path, json);
    return Results.Json(new { success = true });
});


// ==================== UI CONFIG ====================
app.MapGet("/api/ui", (UiService ui) =>
{
    var cfg = ui.Load();
    // JsonElement сохраняется как есть (camelCase из UiService.JsonOpts)
    var json = JsonSerializer.SerializeToElement(cfg, UiService.JsonOpts);
    return Results.Json(new { success = true, config = json });
});

app.MapPost("/api/ui", async (HttpRequest req, UiService ui) =>
{
    var body = await req.ReadFromJsonAsync<UiSaveRequest>();
    if (body?.Config == null)
        return Results.Json(new { success = false, error = "no config" });

    var ok = ui.Save(body.Config);
    return Results.Json(new { success = ok });
});

// ==================== FALLBACK ====================
app.MapFallbackToFile("index.html");

// --restart-delay: новая инстанция ждёт, пока старая отпустит порт
var restartDelayIdx = Array.FindIndex(args, a => a.Equals("--restart-delay", StringComparison.OrdinalIgnoreCase));
if (restartDelayIdx >= 0 && restartDelayIdx + 1 < args.Length && int.TryParse(args[restartDelayIdx + 1], out var restartDelayMs))
{
    Console.WriteLine($"Waiting {restartDelayMs}ms for previous instance to exit...");
    await Task.Delay(restartDelayMs);
}

var port = builder.Configuration.GetValue<int?>("Port") ?? 8086;
app.Run($"http://0.0.0.0:{port}");

// Request DTOs
record ComboRequest(string[] Keys, int Delay = 25);
record MoveRequest(int X, int Y, bool Absolute = false);
record ScrollRequest(int Delta);
record VolumeRequest(int Level);
record TypeRequest(string Text);
record DeviceRequest(string Name);
record ZoomRequest(string Action, float? Level = null, float? PanX = null, float? PanY = null);
record PanRequest(float X, float Y, bool Absolute = false);
record FpsRequest(int Fps, int? IdleFps = null);
record QualityRequest(int Percent = 100, int Jpeg = 0);
record MonitorBrightnessRequest(int Level, string? Monitor = null);
record MonitorPowerRequest(string Action, string? Monitor = null);
record SystemShutdownRequest(int Delay = 30, bool Instant = false);
record ConfigSaveRequest(string Content);
record UiSaveRequest(UiConfig Config);
file record GamepadMsg(string t, float x = 0, float y = 0);
