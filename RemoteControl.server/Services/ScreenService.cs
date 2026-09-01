using System.Drawing;
using System.Drawing.Imaging;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Threading.Channels;

namespace RemoteControl.Server.Services;

public class ScreenService
{

    private readonly ILogger<ScreenService> _logger;

    private DateTime _lastInput = DateTime.UtcNow;
    private bool _isStreaming = false;

    // Zoom: 1.0 = весь экран, 2.0 = половина экрана, 4.0 = четверть
    private float _zoomLevel = 1.0f;
    // Offset в процентах (0.0 - 1.0)
    private float _panX = 0.5f;
    private float _panY = 0.5f;

    private int _targetFps = 60;
    private int _idleFps = 10;
    public void SetFps(int fps, int? idleFps = null)
    {
        _targetFps = Math.Clamp(fps, 1, 120);
        if (idleFps.HasValue)
        {
            _idleFps = Math.Clamp(idleFps.Value, 1, _targetFps);
        }
        _logger.LogInformation("FPS set to {Fps} (idle: {IdleFps})", _targetFps, _idleFps);
    }

    public (int fps, int idleFps) GetFps() => (_targetFps, _idleFps);

    // Качество: масштаб выходного разрешения (от BASE_OUTPUT) + фикс. JPEG-качество (0 = авто по зуму)
    private int _qualityPct = 100;
    private int _qualityJpeg = 0;

    public void SetQuality(int percent, int jpeg)
    {
        _qualityPct = Math.Clamp(percent, 25, 100);
        _qualityJpeg = jpeg > 0 ? Math.Clamp(jpeg, 10, 95) : 0;
        _logger.LogInformation("Quality set to {Pct}% (jpeg: {Jpeg})", _qualityPct, _qualityJpeg);
    }

    public (int percent, int jpeg) GetQuality() => (_qualityPct, _qualityJpeg);




    private const int IDLE_TIMEOUT_SECONDS = 20;

    // Базовые параметры качества
    private const int BASE_OUTPUT_WIDTH = 1024;
    private const int BASE_OUTPUT_HEIGHT = 576;
    private const int MIN_JPEG_QUALITY = 35;
    private const int MAX_JPEG_QUALITY = 75;

    // Cursor
    [DllImport("user32.dll")]
    private static extern bool GetCursorInfo(ref CURSORINFO pci);
    [DllImport("user32.dll")]
    private static extern bool DrawIcon(IntPtr hDC, int x, int y, IntPtr hIcon);
    [DllImport("user32.dll")]
    private static extern bool GetIconInfo(IntPtr hIcon, out ICONINFO piconinfo);
    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    [StructLayout(LayoutKind.Sequential)]
    private struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT ptScreenPos; }
    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)]
    private struct ICONINFO { public bool fIcon; public int xHotspot; public int yHotspot; public IntPtr hbmMask; public IntPtr hbmColor; }

    public ScreenService(ILogger<ScreenService> logger)
    {
        _logger = logger;
    }

    public void NotifyInput() => _lastInput = DateTime.UtcNow;

    // ========== ZOOM & PAN ==========

    public float GetZoom() => _zoomLevel;

    public void SetZoom(float level)
    {
        _zoomLevel = Math.Clamp(level, 1.0f, 8.0f);
        ClampPan();
    }

    public void ZoomIn() => SetZoom(_zoomLevel * 1.5f);
    public void ZoomOut() => SetZoom(_zoomLevel / 1.5f);
    public void ResetZoom() { _zoomLevel = 1.0f; _panX = 0.5f; _panY = 0.5f; }

    public void Pan(float deltaX, float deltaY)
    {
        float visibleFraction = 1.0f / _zoomLevel;
        _panX += deltaX * visibleFraction;
        _panY += deltaY * visibleFraction;
        ClampPan();
    }

    public void SetPan(float x, float y)
    {
        _panX = x;
        _panY = y;
        ClampPan();
    }

    private void ClampPan()
    {
        float halfVisible = 0.5f / _zoomLevel;
        _panX = Math.Clamp(_panX, halfVisible, 1.0f - halfVisible);
        _panY = Math.Clamp(_panY, halfVisible, 1.0f - halfVisible);
    }

    public (float zoom, float panX, float panY) GetState() => (_zoomLevel, _panX, _panY);

    // ========== CAPTURE WITH ADAPTIVE QUALITY ==========

    public byte[] CaptureScreen()
    {
        try
        {
            var screenBounds = GetScreenBounds();
            int screenW = screenBounds.Width;
            int screenH = screenBounds.Height;

            // Область захвата уменьшается при зуме
            int captureW = (int)(screenW / _zoomLevel);
            int captureH = (int)(screenH / _zoomLevel);

            // Центр захвата
            int centerX = (int)(_panX * screenW);
            int centerY = (int)(_panY * screenH);

            // Левый верхний угол
            int captureX = centerX - captureW / 2;
            int captureY = centerY - captureH / 2;

            // Ограничиваем
            captureX = Math.Clamp(captureX, 0, screenW - captureW);
            captureY = Math.Clamp(captureY, 0, screenH - captureH);

            // Захватываем область
            using var bitmap = new Bitmap(captureW, captureH, PixelFormat.Format24bppRgb);
            using var graphics = Graphics.FromImage(bitmap);
            graphics.CopyFromScreen(captureX, captureY, 0, 0, new Size(captureW, captureH), CopyPixelOperation.SourceCopy);

            // Рисуем курсор
            DrawCursor(graphics, captureX, captureY);

            // ===== АДАПТИВНОЕ КАЧЕСТВО =====
            // При зуме 1x: выводим 960x540, quality 35
            // При зуме 2x: выводим 960x540 (но захвачено 960x540, так что 1:1), quality 50
            // При зуме 4x: выводим 960x540 (захвачено 480x270, масштабируем вверх), quality 65
            // При зуме 8x: выводим 960x540 (захвачено 240x135, масштабируем вверх), quality 75

            // Вычисляем выходной размер - держим постоянным для стабильности
            int outW = BASE_OUTPUT_WIDTH * _qualityPct / 100;
            int outH = BASE_OUTPUT_HEIGHT * _qualityPct / 100;

            // Если захваченная область меньше выходной - не масштабируем вверх слишком сильно
            // Максимум 2x upscale
            if (captureW < outW / 2)
            {
                outW = captureW * 2;
                outH = captureH * 2;
            }
            else if (captureW < outW)
            {
                // Захвачено меньше чем выход - используем 1:1
                outW = captureW;
                outH = captureH;
            }

            // Минимальный размер
            outW = Math.Max(outW, 480);
            outH = Math.Max(outH, 270);

            // JPEG quality: фиксированное (если задано) или растёт с зумом
            // zoom 1 -> 35, zoom 2 -> 50, zoom 4 -> 65, zoom 8 -> 75
            int quality = _qualityJpeg > 0
                ? _qualityJpeg
                : (int)(MIN_JPEG_QUALITY + (MAX_JPEG_QUALITY - MIN_JPEG_QUALITY) * Math.Log2(_zoomLevel) / 3.0);
            quality = Math.Clamp(quality, MIN_JPEG_QUALITY, MAX_JPEG_QUALITY);

            // Масштабирование
            using var output = new Bitmap(outW, outH);
            using var outGraphics = Graphics.FromImage(output);

            // При upscale используем лучшую интерполяцию
            if (captureW <= outW)
            {
                outGraphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                outGraphics.CompositingQuality = System.Drawing.Drawing2D.CompositingQuality.HighQuality;
            }
            else
            {
                outGraphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.Low;
                outGraphics.CompositingQuality = System.Drawing.Drawing2D.CompositingQuality.HighSpeed;
            }

            outGraphics.DrawImage(bitmap, 0, 0, outW, outH);

            // JPEG
            using var ms = new MemoryStream();
            var encoder = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
            var encoderParams = new EncoderParameters(1);
            encoderParams.Param[0] = new EncoderParameter(Encoder.Quality, (long)quality);
            output.Save(ms, encoder, encoderParams);

            return ms.ToArray();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Capture failed");
            return Array.Empty<byte>();
        }
    }

    private void DrawCursor(Graphics g, int offsetX, int offsetY)
    {
        try
        {
            var ci = new CURSORINFO { cbSize = Marshal.SizeOf<CURSORINFO>() };
            if (GetCursorInfo(ref ci) && ci.flags == 1)
            {
                GetIconInfo(ci.hCursor, out var iconInfo);
                int x = ci.ptScreenPos.X - offsetX - iconInfo.xHotspot;
                int y = ci.ptScreenPos.Y - offsetY - iconInfo.yHotspot;

                IntPtr hdc = g.GetHdc();
                DrawIcon(hdc, x, y, ci.hCursor);
                g.ReleaseHdc(hdc);

                if (iconInfo.hbmColor != IntPtr.Zero) DeleteObject(iconInfo.hbmColor);
                if (iconInfo.hbmMask != IntPtr.Zero) DeleteObject(iconInfo.hbmMask);
            }
        }
        catch { }
    }

    // ========== STREAMING ==========
    // Один общий capture-loop на ВСЕХ клиентов (раньше каждый WS-коннект гонял
    // свой захват экрана — CPU умножался на число клиентов/вьюпортов).
    // Loop живёт только пока есть подписчики; зомби-клиенты (свёрнутый браузер
    // без close-handshake) отстреливаются вачдогом: нет heartbeat 20с — отписка.

    private readonly object _subLock = new();
    private readonly Dictionary<Guid, Channel<byte[]>> _subs = new();
    private CancellationTokenSource? _captureCts;
    private Task? _captureTask;

    public async Task StreamToWebSocket(WebSocket ws, CancellationToken ct)
    {
        var id = Guid.NewGuid();
        // ёмкость 1 + DropOldest: медленный клиент получает только свежий кадр
        var ch = Channel.CreateBounded<byte[]>(new BoundedChannelOptions(1)
        {
            FullMode = BoundedChannelFullMode.DropOldest
        });

        lock (_subLock)
        {
            _subs[id] = ch;
            _isStreaming = true;
            if (_captureTask == null)
            {
                _captureCts = new CancellationTokenSource();
                var token = _captureCts.Token;
                _captureTask = Task.Run(() => CaptureLoop(token), CancellationToken.None);
            }
        }
        _logger.LogInformation("Stream client connected ({Count} total)", _subs.Count);

        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);

        // receive-loop: ловим close-handshake и heartbeat; тишина 20с = зомби
        var recvTask = Task.Run(async () =>
        {
            var buf = new byte[1024];
            try
            {
                while (ws.State == WebSocketState.Open)
                {
                    using var rcts = CancellationTokenSource.CreateLinkedTokenSource(linked.Token);
                    rcts.CancelAfter(TimeSpan.FromSeconds(20));
                    var res = await ws.ReceiveAsync(new ArraySegment<byte>(buf), rcts.Token);
                    if (res.MessageType == WebSocketMessageType.Close) break;
                }
            }
            catch { }
            linked.Cancel(); // клиент умер/закрылся — рвём send-loop
        }, CancellationToken.None);

        try
        {
            while (!linked.Token.IsCancellationRequested && ws.State == WebSocketState.Open)
            {
                var frame = await ch.Reader.ReadAsync(linked.Token);
                // зависший send (мёртвый TCP) не должен держать подписку вечно
                using var scts = CancellationTokenSource.CreateLinkedTokenSource(linked.Token);
                scts.CancelAfter(TimeSpan.FromSeconds(10));
                await ws.SendAsync(new ArraySegment<byte>(frame), WebSocketMessageType.Binary, true, scts.Token);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Stream send error");
        }
        finally
        {
            linked.Cancel();
            lock (_subLock)
            {
                _subs.Remove(id);
                if (_subs.Count == 0)
                {
                    _captureCts?.Cancel();
                    _captureCts = null;
                    _captureTask = null;
                    _isStreaming = false;
                }
            }
            try { await recvTask; } catch { }
            try
            {
                if (ws.State == WebSocketState.Open || ws.State == WebSocketState.CloseReceived)
                {
                    using var closeCts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", closeCts.Token);
                }
            }
            catch { }
            _logger.LogInformation("Stream client disconnected ({Count} left)", _subs.Count);
        }
    }

    private async Task CaptureLoop(CancellationToken ct)
    {
        _logger.LogInformation("Capture loop started");
        var sw = Stopwatch.StartNew();
        try
        {
            while (!ct.IsCancellationRequested)
            {
                sw.Restart();

                var idle = (DateTime.UtcNow - _lastInput).TotalSeconds;
                int fps = idle > IDLE_TIMEOUT_SECONDS ? _idleFps : _targetFps;
                var frameDelayMs = 1000.0 / fps;

                var frame = CaptureScreen();
                if (frame.Length > 0)
                {
                    lock (_subLock)
                    {
                        foreach (var sub in _subs.Values) sub.Writer.TryWrite(frame);
                    }
                }

                var elapsed = sw.Elapsed.TotalMilliseconds;
                var sleep = frameDelayMs - elapsed;
                if (sleep > 0) await Task.Delay(TimeSpan.FromMilliseconds(sleep), ct);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Capture loop error");
        }
        finally
        {
            _logger.LogInformation("Capture loop stopped");
        }
    }

    public (int Width, int Height) GetScreenSize()
    {
        var b = GetScreenBounds();
        return (b.Width, b.Height);
    }

    private Rectangle GetScreenBounds()
    {
        return System.Windows.Forms.Screen.PrimaryScreen?.Bounds ?? new Rectangle(0, 0, 1920, 1080);
    }
}