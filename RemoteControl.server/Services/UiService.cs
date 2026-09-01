using System.Text.Json;

namespace RemoteControl.Server.Services;

/// <summary>
/// Конфигурация UI. Хранится в ui.json (LocalApplicationData\RemoteControl)
/// как СЫРОЙ JSON: сервер не типизирует схему, чтобы клиентский конструктор
/// (вкладки, слои, профили Game, вьюпорты и т.д.) мог свободно эволюционировать
/// без правок бэка. Валидируем только то, что это корректный JSON-объект.
/// </summary>
public class UiService
{
    private readonly ILogger<UiService> _logger;
    private readonly string _path;
    private readonly object _lock = new();

    public static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    // Дефолт: то, что клиент ждёт при первом запуске (совместимо со старой схемой)
    private const string DefaultJson = """
    {
      "tabs": {
        "mouse": { "visible": true, "inDropdown": true },
        "settings": { "visible": true, "inDropdown": true }
      },
      "settings": {
        "mouseSens": 18,
        "streamSens": 18,
        "edgeEnabled": true,
        "edgeSize": 10,
        "edgeSpeed": 30
      },
      "widgets": { "main": [], "monitor": [], "mouse": [], "keys": [] }
    }
    """;

    public UiService(ILogger<UiService> logger)
    {
        _logger = logger;
        _path = Path.Combine(AppPaths.UserDataDir, "ui.json");
    }

    public JsonElement Load()
    {
        lock (_lock)
        {
            try
            {
                if (File.Exists(_path))
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(_path));
                    if (doc.RootElement.ValueKind == JsonValueKind.Object)
                        return doc.RootElement.Clone();
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to load ui.json, using defaults");
            }

            using var def = JsonDocument.Parse(DefaultJson);
            return def.RootElement.Clone();
        }
    }

    public bool Save(JsonElement cfg)
    {
        if (cfg.ValueKind != JsonValueKind.Object)
            return false;

        lock (_lock)
        {
            try
            {
                Directory.CreateDirectory(AppPaths.UserDataDir);

                // Пере-сериализация с отступами: файл остаётся читаемым руками
                var pretty = JsonSerializer.Serialize(cfg, JsonOpts);

                // Атомарная запись: сначала tmp, затем replace — конфиг не портится
                // при падении сервера посреди записи
                var tmp = _path + ".tmp";
                File.WriteAllText(tmp, pretty);
                File.Move(tmp, _path, overwrite: true);
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
