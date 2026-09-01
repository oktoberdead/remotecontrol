using System.Runtime.InteropServices;

namespace RemoteControl.Server.Services;

/// <summary>
/// Низкоуровневое управление монитором через WinAPI dxva2.dll (DDC/CI напрямую,
/// без ControlMyMonitor). Экспериментальный параллельный путь: старый
/// MonitorService не трогаем, состояние не разделяем — если что-то пойдёт не так,
/// этот сервис можно выпилить независимо.
///
/// API:
///   - EnumDisplayMonitors + GetPhysicalMonitorsFromHMONITOR — перечисление
///   - GetMonitorBrightness / SetMonitorBrightness — яркость (High-Level API)
///   - GetVCPFeatureAndVCPFeatureReply / SetVCPFeature — VCP-коды (0xD6 = Power Mode)
///
/// Power Mode (VCP 0xD6): 1 = on, 4 = standby, 5 = suspend, 0x04/0x05 — офф-состояния.
/// </summary>
public class MonitorDdcService
{
    private readonly ILogger<MonitorDdcService> _logger;

    // DDC/CI — одна шина; не гоняем запросы параллельно
    private readonly SemaphoreSlim _lock = new(1, 1);

    public MonitorDdcService(ILogger<MonitorDdcService> logger)
    {
        _logger = logger;
    }

    // ==================== P/INVOKE ====================

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PHYSICAL_MONITOR
    {
        public IntPtr hPhysicalMonitor;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szPhysicalMonitorDescription;
    }

    private delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, IntPtr lprcMonitor, IntPtr dwData);

    [DllImport("user32.dll")]
    private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr lprcClip, MonitorEnumProc lpfnEnum, IntPtr dwData);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, out uint count);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, uint count, [Out] PHYSICAL_MONITOR[] monitors);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool DestroyPhysicalMonitors(uint count, PHYSICAL_MONITOR[] monitors);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool GetMonitorBrightness(IntPtr hMonitor, out uint min, out uint current, out uint max);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool SetMonitorBrightness(IntPtr hMonitor, uint value);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool GetVCPFeatureAndVCPFeatureReply(IntPtr hMonitor, byte vcpCode, IntPtr pvct, out uint currentValue, out uint maximumValue);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool SetVCPFeature(IntPtr hMonitor, byte vcpCode, uint newValue);

    private const byte VCP_POWER_MODE = 0xD6;
    private const uint POWER_ON = 1;
    private const uint POWER_STANDBY = 4;

    // ==================== ENUMERATION ====================

    /// <summary>
    /// Выполняет action над физическим монитором с указанным индексом.
    /// Хэндлы открываются и закрываются на каждый вызов — так надёжнее
    /// переживаются power-циклы монитора (кэшированный хэндл после off/on протухает).
    /// </summary>
    private T? WithMonitor<T>(int index, Func<IntPtr, T?> action) where T : struct
    {
        T? result = null;
        var found = false;
        var current = 0;

        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (hMon, _, _, _) =>
        {
            if (found) return true;
            if (!GetNumberOfPhysicalMonitorsFromHMONITOR(hMon, out var count) || count == 0)
                return true;

            var phys = new PHYSICAL_MONITOR[count];
            if (!GetPhysicalMonitorsFromHMONITOR(hMon, count, phys))
                return true;

            try
            {
                for (var i = 0; i < count; i++)
                {
                    if (current == index)
                    {
                        found = true;
                        result = action(phys[i].hPhysicalMonitor);
                        return true;
                    }
                    current++;
                }
            }
            finally
            {
                DestroyPhysicalMonitors(count, phys);
            }
            return true;
        }, IntPtr.Zero);

        return result;
    }

    public List<(int Index, string Description)> ListMonitors()
    {
        var list = new List<(int, string)>();
        var idx = 0;

        try
        {
            EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (hMon, _, _, _) =>
            {
                if (!GetNumberOfPhysicalMonitorsFromHMONITOR(hMon, out var count) || count == 0)
                    return true;

                var phys = new PHYSICAL_MONITOR[count];
                if (!GetPhysicalMonitorsFromHMONITOR(hMon, count, phys))
                    return true;

                try
                {
                    for (var i = 0; i < count; i++)
                        list.Add((idx++, phys[i].szPhysicalMonitorDescription?.Trim() ?? $"Monitor {idx}"));
                }
                finally
                {
                    DestroyPhysicalMonitors(count, phys);
                }
                return true;
            }, IntPtr.Zero);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "DDC: monitor enumeration failed");
        }

        return list;
    }

    // ==================== BRIGHTNESS ====================

    public (uint Min, uint Current, uint Max)? GetBrightness(int index, int retries = 2)
    {
        _lock.Wait();
        try
        {
            for (var attempt = 0; attempt <= retries; attempt++)
            {
                var r = WithMonitor<(uint, uint, uint)>(index, h =>
                {
                    if (GetMonitorBrightness(h, out var min, out var cur, out var max))
                        return (min, cur, max);
                    return null;
                });
                if (r != null) return r;
                if (attempt < retries) Thread.Sleep(120);
            }
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "DDC: GetBrightness failed");
            return null;
        }
        finally { _lock.Release(); }
    }

    public bool SetBrightness(int index, uint value)
    {
        _lock.Wait();
        try
        {
            return WithMonitor<bool>(index, h => SetMonitorBrightness(h, value)) == true;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "DDC: SetBrightness failed");
            return false;
        }
        finally { _lock.Release(); }
    }

    // ==================== POWER (VCP 0xD6) ====================

    public uint? GetPowerMode(int index, int retries = 2)
    {
        _lock.Wait();
        try
        {
            for (var attempt = 0; attempt <= retries; attempt++)
            {
                var r = WithMonitor<uint>(index, h =>
                {
                    if (GetVCPFeatureAndVCPFeatureReply(h, VCP_POWER_MODE, IntPtr.Zero, out var cur, out _))
                        return cur;
                    return null;
                });
                if (r != null) return r;
                if (attempt < retries) Thread.Sleep(120);
            }
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "DDC: GetPowerMode failed");
            return null;
        }
        finally { _lock.Release(); }
    }

    public bool SetPowerMode(int index, uint mode)
    {
        _lock.Wait();
        try
        {
            return WithMonitor<bool>(index, h => SetVCPFeature(h, VCP_POWER_MODE, mode)) == true;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "DDC: SetPowerMode failed");
            return false;
        }
        finally { _lock.Release(); }
    }

    public bool Power(int index, string action)
    {
        switch (action)
        {
            case "on":
                return SetPowerMode(index, POWER_ON);
            case "off":
                return SetPowerMode(index, POWER_STANDBY);
            case "toggle":
                var cur = GetPowerMode(index);
                var target = (cur == POWER_ON) ? POWER_STANDBY : POWER_ON;
                return SetPowerMode(index, target);
            default:
                return false;
        }
    }
}
