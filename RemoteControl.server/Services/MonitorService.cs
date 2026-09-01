using System.Diagnostics;

namespace RemoteControl.Server.Services;

/// <summary>
/// Управление монитором через NirSoft ControlMyMonitor (DDC/CI).
/// Документация: https://www.nirsoft.net/utils/control_my_monitor.html
///
/// Используемые команды:
///   /GetValue  &lt;monitor&gt; &lt;VCP&gt;           - текущее значение, возвращается в exit code
///   /SetValue  &lt;monitor&gt; &lt;VCP&gt; &lt;value&gt;    - установить значение (exit 0 = успех)
///   /TurnOn    &lt;monitor&gt;                    - включить монитор
///   /TurnOff   &lt;monitor&gt;                    - выключить монитор
///   /SwitchOffOn &lt;monitor&gt;                  - переключить вкл/выкл
///   /stab "" &lt;monitor&gt;                      - дамп настроек в stdout (таб-разделитель)
///
/// VCP-коды: 10 = Brightness, D6 = Power Mode (1 = on, 4 = standby, 5 = suspend)
/// </summary>
public class MonitorService
{
    private readonly IConfiguration _config;
    private readonly ILogger<MonitorService> _logger;

    // DDC/CI — одна шина, чтобы не гонять процесс параллельно
    private readonly SemaphoreSlim _runLock = new(1, 1);

    public MonitorService(IConfiguration config, ILogger<MonitorService> logger)
    {
        _config = config;
        _logger = logger;
    }

    // ==================== TOOL RESOLUTION ====================

    /// <summary>
    /// Ищет ControlMyMonitor.exe: appsettings (Monitor:CmmPath) -> рядом с сервером -> null.
    /// </summary>
    public string? FindTool()
    {
        var configured = _config.GetValue<string>("Monitor:CmmPath");
        if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured))
            return configured;

        var local = Path.Combine(AppContext.BaseDirectory, "ControlMyMonitor.exe");
        if (File.Exists(local))
            return local;

        return null;
    }

    public bool IsAvailable() => FindTool() != null;

    // ==================== STATE ====================

    public class MonitorState
    {
        public bool Available { get; set; }
        public string? MonitorName { get; set; }
        public int? Brightness { get; set; }
        public int? BrightnessMax { get; set; }
        public int? PowerMode { get; set; }
    }

    // Кэш состояния: DDC-чтения медленные и flaky, не гоняем процесс на каждый поллинг
    private readonly object _stateLock = new();
    private static readonly TimeSpan STATE_TTL = TimeSpan.FromSeconds(1.5);
    private static readonly TimeSpan INFO_TTL = TimeSpan.FromSeconds(30);
    private DateTime _stateAt = DateTime.MinValue;
    private DateTime _infoAt = DateTime.MinValue;
    private DateTime _suppressReadUntil = DateTime.MinValue;
    private string? _cachedName;
    private int? _cachedMax;
    private int? _cachedBrightness;
    private int? _cachedPower;

    /// <summary>
    /// Текущее значение VCP-кода через exit code /GetValue. null = сбой/неподдерживается.
    /// </summary>
    public int? GetValue(string monitor, string vcpCode)
    {
        var exit = Run(monitor, "/GetValue", vcpCode);
        if (exit is >= 0 and <= 255)
            return exit;
        _logger.LogDebug("Monitor GetValue {Code} failed: {Exit}", vcpCode, exit);
        return null;
    }

    /// <summary>Чтение с ретраями — DDC/CI чтения часто падают с первой попытки.</summary>
    private int? GetValueRetry(string monitor, string vcpCode, int attempts = 2)
    {
        int? value = null;
        for (var i = 0; i < attempts; i++)
        {
            value = GetValue(monitor, vcpCode);
            if (value.HasValue) return value;
            Thread.Sleep(150);
        }
        return null;
    }

    public bool SetValue(string monitor, string vcpCode, int value)
        => Run(monitor, "/SetValue", vcpCode, value.ToString()) == 0;

    public bool TurnOn(string monitor) => Run(monitor, "/TurnOn") == 0;
    public bool TurnOff(string monitor) => Run(monitor, "/TurnOff") == 0;
    public bool SwitchOffOn(string monitor) => Run(monitor, "/SwitchOffOn") == 0;

    /// <summary>
    /// Собрать состояние (имя, max, яркость, питание) — кэшируется:
    /// состояние — STATE_TTL, имя/max — INFO_TTL, после power-операции — пауза.
    /// </summary>
    public MonitorState GetState(string monitor)
    {
        var state = new MonitorState { Available = IsAvailable() };
        if (!state.Available) return state;

        var now = DateTime.UtcNow;

        lock (_stateLock)
        {
            if (now - _infoAt > INFO_TTL && now >= _suppressReadUntil)
            {
                var (name, max) = GetMonitorInfo(monitor);
                _cachedName = name;
                _cachedMax = max;
                _infoAt = DateTime.UtcNow;
            }

            state.MonitorName = _cachedName;
            state.BrightnessMax = _cachedMax ?? 100;

            if (now - _stateAt < STATE_TTL || now < _suppressReadUntil)
            {
                state.Brightness = _cachedBrightness;
                state.PowerMode = _cachedPower;
                return state;
            }

            _cachedBrightness = GetValueRetry(monitor, "10");
            _cachedPower = GetValueRetry(monitor, "D6");
            _stateAt = DateTime.UtcNow;

            state.Brightness = _cachedBrightness;
            state.PowerMode = _cachedPower;
            return state;
        }
    }

    /// <summary>Установить яркость. Без чтения значения обратно — экономим запуск тула.</summary>
    public (bool Ok, int Value) SetBrightness(string monitor, int level)
    {
        level = Math.Clamp(level, 0, 100);
        var ok = SetValue(monitor, "10", level);
        if (ok)
        {
            lock (_stateLock) _cachedBrightness = level;
        }
        return (ok, level);
    }

    /// <summary>
    /// Вкл/выкл/переключить монитор. После успеха — пауза в чтениях:
    /// монитор в переходе, DDC может врать (в т.ч. "0" для яркости после wake).
    /// </summary>
    public (bool Ok, int? PowerMode) SetPower(string monitor, string action)
    {
        bool ok;
        int? power = null;

        switch (action)
        {
            case "on": ok = TurnOn(monitor); power = 1; break;
            case "off": ok = TurnOff(monitor); power = 4; break;
            case "toggle": ok = SwitchOffOn(monitor); break;
            default: return (false, null);
        }

        if (ok)
        {
            lock (_stateLock)
            {
                if (power.HasValue) _cachedPower = power;
                _suppressReadUntil = DateTime.UtcNow.AddSeconds(2);
            }
        }

        return (ok, power);
    }

    /// <summary>
    /// Имя монитора и максимум яркости (best effort): парсим дамп /stab.
    /// Если формат изменился — вернём null, на чтение через /GetValue это не влияет.
    /// </summary>
    public (string? Name, int? BrightnessMax) GetMonitorInfo(string monitor)
    {
        var tool = FindTool();
        if (tool == null) return (null, null);
        if (!_runLock.Wait(5000)) return (null, null);

        try
        {
            var (stdout, _, _, ok) = RunProcess(tool, $"/stab \"\" \"{monitor}\"", timeoutMs: 8000);
            if (!ok) return (null, null);

            var lines = stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries);

            // имя: первая строка дампа (до шапки таблицы VCP)
            string? name = null;
            foreach (var line in lines)
            {
                var t = line.Trim();
                if (t.Length == 0) continue;
                if (t.Contains("VCPCode", StringComparison.OrdinalIgnoreCase)) break;
                name = t;
                break;
            }

            // таблица: шапка с колонками VCPCode / Current Value / Maximum Value
            int? max = null;
            for (var i = 0; i < lines.Length; i++)
            {
                var cols = lines[i].Split('\t');
                var idx = Array.IndexOf(cols, "VCPCode");
                if (idx < 0) continue;

                var idxCurrent = Array.IndexOf(cols, "Current Value");
                var idxMax = Array.IndexOf(cols, "Maximum Value");
                if (idxCurrent < 0) break;

                for (var j = i + 1; j < lines.Length; j++)
                {
                    var row = lines[j].Split('\t');
                    if (row.Length <= idx || row[idx].Trim() != "10") continue;
                    if (idxCurrent < row.Length && int.TryParse(row[idxCurrent].Trim(), out _))
                    {
                        // нашли строку яркости
                        if (idxMax >= 0 && idxMax < row.Length &&
                            int.TryParse(row[idxMax].Trim(), out var mx) && mx > 0)
                            max = mx;
                        break;
                    }
                }
                break;
            }

            return (name, max);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Monitor /stab parse failed");
            return (null, null);
        }
        finally
        {
            _runLock.Release();
        }
    }

    // ==================== PROCESS ====================

    /// <summary>Запускает ControlMyMonitor, возвращает exit code (null = сбой/таймаут).</summary>
    private int? Run(string monitor, string option, params string[] rest)
    {
        var tool = FindTool();
        if (tool == null)
        {
            _logger.LogWarning("ControlMyMonitor.exe not found (put it next to server or set Monitor:CmmPath)");
            return null;
        }

        var args = new List<string> { option, $"\"{monitor}\"" };
        args.AddRange(rest.Select(a => $"\"{a}\""));

        if (!_runLock.Wait(5000)) return null;
        try
        {
            var (_, _, exitCode, ok) = RunProcess(tool, string.Join(" ", args), timeoutMs: 10000);
            return ok ? exitCode : null;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Monitor {Option} failed", option);
            return null;
        }
        finally
        {
            _runLock.Release();
        }
    }

    private (string Stdout, string Stderr, int ExitCode, bool Ok) RunProcess(
        string fileName, string arguments, int timeoutMs)
    {
        var psi = new ProcessStartInfo
        {
            FileName = fileName,
            Arguments = arguments,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var p = Process.Start(psi)!;

        // читаем асинхронно, чтобы не было deadlock'а
        var stdoutTask = p.StandardOutput.ReadToEndAsync();
        var stderrTask = p.StandardError.ReadToEndAsync();

        if (!p.WaitForExit(timeoutMs))
        {
            try { p.Kill(entireProcessTree: true); } catch { }
            p.WaitForExit();
            return ("", "timeout", -1, false);
        }

        var stdout = stdoutTask.GetAwaiter().GetResult();
        var stderr = stderrTask.GetAwaiter().GetResult();
        return (stdout, stderr, p.ExitCode, true);
    }
}
