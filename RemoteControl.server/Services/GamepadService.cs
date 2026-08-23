using Nefarius.ViGEm.Client;
using Nefarius.ViGEm.Client.Targets;
using Nefarius.ViGEm.Client.Targets.Xbox360;

namespace RemoteControl.Server.Services;

public sealed class GamepadService : IDisposable
{
    private readonly object _lock = new();

    private ViGEmClient? _client;
    private IXbox360Controller? _pad;

    public bool IsActive { get; private set; }

    public void Start()
    {
        lock (_lock)
        {
            if (IsActive) return;

            _client = new ViGEmClient();
            _pad = _client.CreateXbox360Controller();
            _pad.Connect();

            // neutral
            _pad.SetAxisValue(Xbox360Axis.LeftThumbX, 0);
            _pad.SetAxisValue(Xbox360Axis.LeftThumbY, 0);

            IsActive = true;
        }
    }

    public void Stop()
    {
        lock (_lock)
        {
            if (!IsActive) return;

            try
            {
                // neutral
                _pad?.SetAxisValue(Xbox360Axis.LeftThumbX, 0);
                _pad?.SetAxisValue(Xbox360Axis.LeftThumbY, 0);
            }
            catch { /* ignore */ }

            try { _pad?.Disconnect(); } catch { }
            _pad = null;

            _client?.Dispose();
            _client = null;

            IsActive = false;
        }
    }

    // x,y: [-1..1]
    public void SetLeftStick(float x, float y, float deadzone = 0.08f)
    {
        lock (_lock)
        {
            if (!IsActive || _pad == null) return;

            // deadzone + clamp
            x = ApplyDeadzoneClamp(x, deadzone);
            y = ApplyDeadzoneClamp(y, deadzone);

            short sx = FloatToShortAxis(x);
            short sy = FloatToShortAxis(y);

            _pad.SetAxisValue(Xbox360Axis.LeftThumbX, sx);
            _pad.SetAxisValue(Xbox360Axis.LeftThumbY, sy);
        }
    }

    private static float ApplyDeadzoneClamp(float v, float dz)
    {
        v = Math.Clamp(v, -1f, 1f);
        if (Math.Abs(v) < dz) return 0f;

        // re-scale after deadzone so it feels linear
        var sign = Math.Sign(v);
        var mag = (Math.Abs(v) - dz) / (1f - dz);
        return sign * Math.Clamp(mag, 0f, 1f);
    }

    private static short FloatToShortAxis(float v)
    {
        v = Math.Clamp(v, -1f, 1f);
        // Xbox axis is -32768..32767
        return v <= -1f ? (short)-32768 :
               v >= 1f ? (short)32767 :
               (short)Math.Round(v * 32767f);
    }

    public void Dispose() => Stop();
}