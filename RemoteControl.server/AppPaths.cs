using System.Runtime.InteropServices;

namespace RemoteControl.Server;

public static class AppPaths
{
    public static string AppDir => AppContext.BaseDirectory;

    public static string UserDataDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RemoteControl");

    public static string CommonDataDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "RemoteControl");

    // Выбираем writable папку (по умолчанию per-user)
    public static string DataDir(bool common = false)
    {
        var dir = common ? CommonDataDir : UserDataDir;
        Directory.CreateDirectory(dir);
        return dir;
    }

    public static string MacrosFile(bool common = false) =>
        Path.Combine(DataDir(common), "macros.json");

    public static string SettingsFile(bool common = false) =>
        Path.Combine(DataDir(common), "settings.json");
}