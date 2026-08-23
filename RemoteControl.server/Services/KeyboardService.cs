using System.Runtime.InteropServices;

namespace RemoteControl.Server.Services;

public class KeyboardService
{
    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern IntPtr GetKeyboardLayout(uint idThread);

    [DllImport("user32.dll")]
    private static extern bool OpenClipboard(IntPtr hWndNewOwner);

    [DllImport("user32.dll")]
    private static extern bool CloseClipboard();

    [DllImport("user32.dll")]
    private static extern bool EmptyClipboard();

    [DllImport("user32.dll")]
    private static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GlobalLock(IntPtr hMem);

    [DllImport("kernel32.dll")]
    private static extern bool GlobalUnlock(IntPtr hMem);

    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;
    private const int INPUT_KEYBOARD = 1;
    private const uint CF_UNICODETEXT = 13;
    private const uint GMEM_MOVEABLE = 0x0002;

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public int type;
        public INPUTUNION u;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct INPUTUNION
    {
        [FieldOffset(0)] public KEYBDINPUT ki;
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

    private static readonly Dictionary<string, byte> KeyCodes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ctrl"] = 0x11,
        ["alt"] = 0x12,
        ["shift"] = 0x10,
        ["win"] = 0x5B,
        ["enter"] = 0x0D,
        ["esc"] = 0x1B,
        ["escape"] = 0x1B,
        ["space"] = 0x20,
        ["spc"] = 0x20,
        ["tab"] = 0x09,
        ["backspace"] = 0x08,
        ["delete"] = 0x2E,
        ["up"] = 0x26,
        ["down"] = 0x28,
        ["left"] = 0x25,
        ["right"] = 0x27,
        ["f1"] = 0x70,
        ["f2"] = 0x71,
        ["f3"] = 0x72,
        ["f4"] = 0x73,
        ["f5"] = 0x74,
        ["f6"] = 0x75,
        ["f7"] = 0x76,
        ["f8"] = 0x77,
        ["f9"] = 0x78,
        ["f10"] = 0x79,
        ["f11"] = 0x7A,
        ["f12"] = 0x7B,
        ["playpause"] = 0xB3,
        ["play"] = 0xB3,
        ["pause"] = 0xB3,
        ["next"] = 0xB0,
        ["prev"] = 0xB1,
        ["stop"] = 0xB2,
        ["mute"] = 0xAD,
        ["volup"] = 0xAF,
        ["voldown"] = 0xAE,
        ["home"] = 0x24,
        ["end"] = 0x23,
        ["pageup"] = 0x21,
        ["pagedown"] = 0x22,
    };

    public void KeyDown(byte vk) => keybd_event(vk, 0, 0, UIntPtr.Zero);
    public void KeyUp(byte vk) => keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);

    public byte GetVirtualKey(string key)
    {
        if (KeyCodes.TryGetValue(key, out byte vk))
            return vk;

        if (key.Length == 1 && char.IsLetter(key[0]))
            return (byte)char.ToUpper(key[0]);

        if (key.Length == 1 && char.IsDigit(key[0]))
            return (byte)key[0];

        if (key.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            return Convert.ToByte(key, 16);

        return 0;
    }

    public void PressKey(string key)
    {
        // Named key
        if (KeyCodes.TryGetValue(key, out byte vkCode))
        {
            KeyDown(vkCode);
            Thread.Sleep(10);
            KeyUp(vkCode);
            return;
        }

        // Single character
        if (key.Length == 1)
        {
            char c = key[0];

            // ASCII letters and digits - use keybd_event
            if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'))
            {
                byte vk = (byte)char.ToUpper(c);
                bool needShift = char.IsUpper(c);

                if (needShift) KeyDown(0x10);
                KeyDown(vk);
                Thread.Sleep(10);
                KeyUp(vk);
                if (needShift) KeyUp(0x10);
                return;
            }

            // Non-ASCII or special chars - use SendInput Unicode
            SendUnicodeChar(c);
            return;
        }

        // Hex code
        if (key.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
        {
            byte vk = Convert.ToByte(key, 16);
            KeyDown(vk);
            Thread.Sleep(10);
            KeyUp(vk);
        }
    }

    private void SendUnicodeChar(char c)
    {
        var inputs = new INPUT[2];

        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].u.ki.wVk = 0;
        inputs[0].u.ki.wScan = c;
        inputs[0].u.ki.dwFlags = KEYEVENTF_UNICODE;

        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].u.ki.wVk = 0;
        inputs[1].u.ki.wScan = c;
        inputs[1].u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;

        SendInput(2, inputs, Marshal.SizeOf<INPUT>());
    }

    // Reliable Unicode input via clipboard
    // Более надёжная отправка строки
    public void SendString(string text)
    {
        if (string.IsNullOrEmpty(text)) return;

        try
        {
            // Сохраняем текущий clipboard
            string? oldClipboard = null;
            try
            {
                if (OpenClipboard(IntPtr.Zero))
                {
                    // Не будем сохранять, просто перезапишем
                    CloseClipboard();
                }
            }
            catch { }

            // Устанавливаем текст
            SetClipboardText(text);
            Thread.Sleep(30);

            // Ctrl+V
            KeyDown(0x11); // Ctrl
            Thread.Sleep(20);
            KeyDown(0x56); // V
            Thread.Sleep(20);
            KeyUp(0x56);
            Thread.Sleep(10);
            KeyUp(0x11);

            Thread.Sleep(50); // Даём приложению обработать
        }
        catch (Exception ex)
        {
            Console.WriteLine($"SendString error: {ex.Message}");
            // Fallback - посимвольно через SendInput
            foreach (char c in text)
            {
                SendUnicodeChar(c);
                Thread.Sleep(15);
            }
        }
    }

    private void SetClipboardText(string text)
    {
        if (!OpenClipboard(IntPtr.Zero))
            throw new Exception("Cannot open clipboard");

        try
        {
            EmptyClipboard();

            var bytes = (text.Length + 1) * 2;
            var hGlobal = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)bytes);
            if (hGlobal == IntPtr.Zero)
                throw new Exception("Cannot allocate memory");

            var target = GlobalLock(hGlobal);
            try
            {
                Marshal.Copy(text.ToCharArray(), 0, target, text.Length);
                Marshal.WriteInt16(target, text.Length * 2, 0); // null terminator
            }
            finally
            {
                GlobalUnlock(hGlobal);
            }

            SetClipboardData(CF_UNICODETEXT, hGlobal);
        }
        finally
        {
            CloseClipboard();
        }
    }

    public void PressCombo(string[] keys, int delay = 25)
    {
        var vks = new List<byte>();
        foreach (var key in keys)
        {
            var vk = GetVirtualKey(key);
            if (vk != 0) vks.Add(vk);
        }

        foreach (var vk in vks)
        {
            KeyDown(vk);
            if (delay > 0) Thread.Sleep(delay);
        }

        for (int i = vks.Count - 1; i >= 0; i--)
        {
            KeyUp(vks[i]);
            if (delay > 0 && i > 0) Thread.Sleep(delay);
        }
    }

    public string GetCurrentLayout()
    {
        try
        {
            var hwnd = GetForegroundWindow();
            var threadId = GetWindowThreadProcessId(hwnd, IntPtr.Zero);
            var layout = GetKeyboardLayout(threadId);
            var langId = (int)layout & 0xFFFF;

            return langId switch
            {
                0x0419 => "RU",
                0x0409 => "EN",
                0x0422 => "UA",
                0x0407 => "DE",
                0x040C => "FR",
                _ => $"{langId:X4}"
            };
        }
        catch { return "??"; }
    }

    public void ToggleLayout()
    {
        PressCombo(new[] { "alt", "shift" }, 10);
    }

    public void SetLayout(string layout)
    {
        // Switch until we get the right layout (max 5 attempts)
        for (int i = 0; i < 5; i++)
        {
            if (GetCurrentLayout().Equals(layout, StringComparison.OrdinalIgnoreCase))
                return;
            ToggleLayout();
            Thread.Sleep(100);
        }
    }
}