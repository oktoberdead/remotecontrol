using NAudio.CoreAudioApi;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

namespace RemoteControl.Server.Services;

public class AudioService : IDisposable
{
    private readonly ILogger<AudioService> _logger;
    private MMDeviceEnumerator? _enumerator;
    private MMDevice? _device;

    public AudioService(ILogger<AudioService> logger)
    {
        _logger = logger;
        Initialize();
    }

    private void Initialize()
    {
        try
        {
            _enumerator = new MMDeviceEnumerator();
            _device = _enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            _logger.LogInformation("AudioService initialized. Volume: {Vol}%", GetVolume());
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to initialize AudioService");
        }
    }

    public int GetVolume()
    {
        try
        {
            return (int)Math.Round((_device?.AudioEndpointVolume.MasterVolumeLevelScalar ?? 0) * 100);
        }
        catch { return -1; }
    }

    public void SetVolume(int level)
    {
        try
        {
            if (_device != null)
            {
                _device.AudioEndpointVolume.MasterVolumeLevelScalar = Math.Clamp(level, 0, 100) / 100f;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to set volume");
        }
    }

    public bool IsMuted()
    {
        try { return _device?.AudioEndpointVolume.Mute ?? false; }
        catch { return false; }
    }

    public void ToggleMute()
    {
        try
        {
            if (_device != null)
                _device.AudioEndpointVolume.Mute = !_device.AudioEndpointVolume.Mute;
        }
        catch { }
    }

    public List<AudioDeviceInfo> GetOutputDevices()
    {
        var devices = new List<AudioDeviceInfo>();
        try
        {
            if (_enumerator == null) return devices;

            var endpoints = _enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active);
            var defaultId = _device?.ID ?? "";

            foreach (var device in endpoints)
            {
                devices.Add(new AudioDeviceInfo
                {
                    Id = device.ID,
                    Name = device.FriendlyName,
                    IsDefault = device.ID == defaultId
                });
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to enumerate audio devices");
        }
        return devices;
    }

    public bool SetOutputDevice(string deviceName)
    {
        try
        {
            _logger.LogInformation("Switching audio to: {Name}", deviceName);

            if (_enumerator == null) return false;

            // Найти устройство по имени
            var endpoints = _enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active);
            MMDevice? targetDevice = null;

            foreach (var device in endpoints)
            {
                if (device.FriendlyName == deviceName)
                {
                    targetDevice = device;
                    break;
                }
            }

            if (targetDevice == null)
            {
                _logger.LogWarning("Device not found: {Name}", deviceName);
                return false;
            }

            // Используем PolicyConfig COM API
            var result = SetDefaultAudioPlaybackDevice(targetDevice.ID);

            if (result)
            {
                // Обновляем текущее устройство
                Thread.Sleep(300);
                _device?.Dispose();
                _device = _enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
                _logger.LogInformation("Switched to: {Name}", _device?.FriendlyName);
            }

            return result;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to set output device");
            return false;
        }
    }

    // ========== PolicyConfig COM API ==========

    private static bool SetDefaultAudioPlaybackDevice(string deviceId)
    {
        try
        {
            var client = new PolicyConfigClient();
            client.SetDefaultEndpoint(deviceId, ERole.eConsole);
            client.SetDefaultEndpoint(deviceId, ERole.eMultimedia);
            client.SetDefaultEndpoint(deviceId, ERole.eCommunications);
            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"PolicyConfig error: {ex.Message}");
            return false;
        }
    }

    public void Dispose()
    {
        _device?.Dispose();
        _enumerator?.Dispose();
    }
}

public class AudioDeviceInfo
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public bool IsDefault { get; set; }
}

// ========== COM Interop для PolicyConfig ==========

internal enum ERole
{
    eConsole = 0,
    eMultimedia = 1,
    eCommunications = 2
}

internal enum EDataFlow
{
    eRender = 0,
    eCapture = 1,
    eAll = 2
}

[ComImport]
[Guid("F8679F50-850A-41CF-9C72-430F290290C8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPolicyConfig
{
    int GetMixFormat(string pszDeviceName, out IntPtr ppFormat);
    int GetDeviceFormat(string pszDeviceName, bool bDefault, out IntPtr ppFormat);
    int ResetDeviceFormat(string pszDeviceName);
    int SetDeviceFormat(string pszDeviceName, IntPtr pEndpointFormat, IntPtr mixFormat);
    int GetProcessingPeriod(string pszDeviceName, bool bDefault, out long pmftDefaultPeriod, out long pmftMinimumPeriod);
    int SetProcessingPeriod(string pszDeviceName, ref long pmftPeriod);
    int GetShareMode(string pszDeviceName, out int pMode);
    int SetShareMode(string pszDeviceName, int mode);
    int GetPropertyValue(string pszDeviceName, bool bFxStore, ref PropertyKey key, out PropVariant pv);
    int SetPropertyValue(string pszDeviceName, bool bFxStore, ref PropertyKey key, ref PropVariant pv);
    int SetDefaultEndpoint(string pszDeviceName, ERole role);
    int SetEndpointVisibility(string pszDeviceName, bool bVisible);
}

// Заглушки для структур, которые нужны интерфейсу, но не используются нами
[StructLayout(LayoutKind.Sequential)]
internal struct PropertyKey { public Guid fmtid; public uint pid; }
[StructLayout(LayoutKind.Sequential)]
internal struct PropVariant { public ushort vt; public ushort wReserved1; public ushort wReserved2; public ushort wReserved3; public IntPtr p1; public IntPtr p2; }

[ComImport]
[Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
internal class _PolicyConfigClient { }

internal class PolicyConfigClient
{
    private readonly IPolicyConfig _policyConfig;

    public PolicyConfigClient()
    {
        // Создаем экземпляр через GUID и приводим к интерфейсу
        _policyConfig = (IPolicyConfig)new _PolicyConfigClient();
    }

    public void SetDefaultEndpoint(string deviceId, ERole role)
    {
        _policyConfig.SetDefaultEndpoint(deviceId, role);
    }
}