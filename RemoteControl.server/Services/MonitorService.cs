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

    public bool SetValue(string monitor, string vcpCode, int value)
        => Run(monitor, "/SetValue", vcpCode, value.ToString()) == 0;

    public bool TurnOn(string monitor) => Run(monitor, "/TurnOn") == 0;
    public bool TurnOff(string monitor) => Run(monitor, "/TurnOff") == 0;
    public bool SwitchOffOn(string monitor) => Run(monitor, "/SwitchOffOn") == 0;

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
