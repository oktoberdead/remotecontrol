using System.Text.Json;

namespace RemoteControl.Server.Services;

/// <summary>
/// Конфигурация UI: вкладки (видимость/дропдаун), глобальные настройки,
/// пользовательские элементы (виджеты) на вкладках. Хранится в ui.json
/// (LocalApplicationData\RemoteControl), как game layout.
/// </summary>
public class UiConfig
{
    public Dictionary<string, TabConfig> Tabs { get; set; } = new();
    public UiSettings Settings { get; set; } = new();
    public Dictionary<string, List<UiWidget>> Widgets { get; set; } = new();
}

public class TabConfig
{
    public bool Visible { get; set; } = true;
    public bool InDropdown { get; set; } = false;
}

public class UiSettings
{
    // Чувствительность тачпадов мыши/стрима (18 = как было, /10 = коэффициент)
    public int MouseSens { get; set; } = 18;
    public int StreamSens { get; set; } = 18;
    public bool EdgeEnabled { get; set; } = true;
    public int EdgeSize { get; set; } = 10;
    public int EdgeSpeed { get; set; } = 30;
}

public class UiWidget
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N").Substring(0, 8);
    // button | touchpad | sequence | slider | toggle | input
    public string Type { get; set; } = "button";
    public string Label { get; set; } = "";

    // Позиция в процентах внутри custom-area
    public int X { get; set; } = 5;
    public int Y { get; set; } = 5;
    public int W { get; set; } = 30;
    public int H { get; set; } = 15;

    // button: key / "ctrl+c" / "/api/..."
    public string Action { get; set; } = "";
    // click | hold | repeat
    public string PressMode { get; set; } = "click";
    public int RepeatCount { get; set; } = 3;
    public int RepeatInterval { get; set; } = 80;
    public string Color { get; set; } = "btn-primary";

    // touchpad: 1 = скролл, 2 = мышь; sens 0 = глобальная
    public int Axes { get; set; } = 2;
    public bool EdgeZone { get; set; } = true;
    public int Sensitivity { get; set; } = 0;

    // sequence
    public List<UiSequenceStep> Steps { get; set; } = new();

    // slider/toggle: volume | brightness | zoom | fps / power | wg
    public string Binding { get; set; } = "";
    public int Min { get; set; } = 0;
    public int Max { get; set; } = 100;
}

public class UiSequenceStep
{
    // key | combo | type | pause
    public string Kind { get; set; } = "key";
    public string Value { get; set; } = "";
    public int Delay { get; set; } = 50;
}

public class UiService
{
    private readonly ILogger<UiService> _logger;
    private readonly string _path;
    private readonly object _lock = new();

    // camelCase и в файле, и в API (клиент ждёт lowercase)
    public static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    public UiService(ILogger<UiService> logger)
    {
        _logger = logger;
        _path = Path.Combine(AppPaths.UserDataDir, "ui.json");
    }

    public UiConfig Load()
    {
        lock (_lock)
        {
            try
            {
                if (File.Exists(_path))
                {
                    var cfg = JsonSerializer.Deserialize<UiConfig>(File.ReadAllText(_path));
                    if (cfg != null) return cfg;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to load ui.json, using defaults");
            }
            return Defaults();
        }
    }

    public static UiConfig Defaults() => new()
    {
        Tabs = new Dictionary<string, TabConfig>
        {
            ["mouse"] = new() { InDropdown = true },
            ["settings"] = new() { InDropdown = true }
        },
        Settings = new UiSettings(),
        Widgets = new Dictionary<string, List<UiWidget>>
        {
            ["main"] = new(), ["monitor"] = new(), ["mouse"] = new(), ["keys"] = new()
        }
    };

    public bool Save(UiConfig cfg)
    {
        lock (_lock)
        {
            try
            {
                Directory.CreateDirectory(AppPaths.UserDataDir);
                File.WriteAllText(_path, JsonSerializer.Serialize(cfg, JsonOpts));
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to save ui.json");
                return false;
            }
        }
    }
}
