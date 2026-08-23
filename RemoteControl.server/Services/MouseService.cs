using System.Runtime.InteropServices;

namespace RemoteControl.Server.Services;

public class MouseService
{
    // ===== DllImport =====
    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    private static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);

    // ===== Structures =====
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public int mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HARDWAREINPUT
    {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct INPUTUNION
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public INPUTUNION u;
    }

    // ===== Constants =====
    private const uint INPUT_MOUSE = 0;
    private const uint INPUT_KEYBOARD = 1;

    private const uint MOUSEEVENTF_MOVE = 0x0001;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;
    private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

    // ===== Get Position =====
    public (int X, int Y) GetPosition()
    {
        GetCursorPos(out var point);
        return (point.X, point.Y);
    }

    // ===== Move (Hover работает, дрейфа нет) =====
    public void MoveTo(int x, int y)
    {
        // 1. Получаем текущую позицию
        GetCursorPos(out var point);

        // 2. Считаем разницу
        int dx = x - point.X;
        int dy = y - point.Y;

        // 3. Двигаем относительно текущей позиции через SendInput
        // Это заставляет Windows обновлять Hover эффекты
        SendRelativeMove(dx, dy);
    }

    public void MoveBy(int dx, int dy)
    {
        // Просто шлем относительное смещение
        SendRelativeMove(dx, dy);
    }

    private void SendRelativeMove(int dx, int dy)
    {
        var input = new INPUT
        {
            type = INPUT_MOUSE,
            u = new INPUTUNION
            {
                mi = new MOUSEINPUT
                {
                    dx = dx,
                    dy = dy,
                    mouseData = 0,
                    dwFlags = MOUSEEVENTF_MOVE, // БЕЗ флага ABSOLUTE
                    time = 0,
                    dwExtraInfo = IntPtr.Zero
                }
            }
        };

        SendInput(1, new[] { input }, Marshal.SizeOf<INPUT>());
    }

    // ===== Clicks =====
    public void LeftClick()
    {
        SendMouseEvent(MOUSEEVENTF_LEFTDOWN);
        Thread.Sleep(10);
        SendMouseEvent(MOUSEEVENTF_LEFTUP);
    }

    public void RightClick()
    {
        SendMouseEvent(MOUSEEVENTF_RIGHTDOWN);
        Thread.Sleep(10);
        SendMouseEvent(MOUSEEVENTF_RIGHTUP);
    }

    public void MiddleClick()
    {
        SendMouseEvent(MOUSEEVENTF_MIDDLEDOWN);
        Thread.Sleep(10);
        SendMouseEvent(MOUSEEVENTF_MIDDLEUP);
    }

    public void DoubleClick()
    {
        LeftClick();
        Thread.Sleep(50);
        LeftClick();
    }

    // ===== Down/Up =====
    public void LeftDown() => SendMouseEvent(MOUSEEVENTF_LEFTDOWN);
    public void LeftUp() => SendMouseEvent(MOUSEEVENTF_LEFTUP);
    public void RightDown() => SendMouseEvent(MOUSEEVENTF_RIGHTDOWN);
    public void RightUp() => SendMouseEvent(MOUSEEVENTF_RIGHTUP);
    public void MiddleDown() => SendMouseEvent(MOUSEEVENTF_MIDDLEDOWN);
    public void MiddleUp() => SendMouseEvent(MOUSEEVENTF_MIDDLEUP);

    // ===== Scroll =====
    public void Scroll(int delta)
    {
        var input = new INPUT
        {
            type = INPUT_MOUSE,
            u = new INPUTUNION
            {
                mi = new MOUSEINPUT
                {
                    dx = 0,
                    dy = 0,
                    mouseData = delta,
                    dwFlags = MOUSEEVENTF_WHEEL,
                    time = 0,
                    dwExtraInfo = IntPtr.Zero
                }
            }
        };

        SendInput(1, new[] { input }, Marshal.SizeOf<INPUT>());
    }

    // ===== Helper =====
    private void SendMouseEvent(uint flags)
    {
        var input = new INPUT
        {
            type = INPUT_MOUSE,
            u = new INPUTUNION
            {
                mi = new MOUSEINPUT
                {
                    dx = 0,
                    dy = 0,
                    mouseData = 0,
                    dwFlags = flags,
                    time = 0,
                    dwExtraInfo = IntPtr.Zero
                }
            }
        };

        SendInput(1, new[] { input }, Marshal.SizeOf<INPUT>());
    }
}