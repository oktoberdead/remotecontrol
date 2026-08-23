using System.Text.Json;
using RemoteControl.Server.Models;

namespace RemoteControl.Server.Services;

public class MacroService
{
    private readonly string _filePath;
    private readonly KeyboardService _keyboard;
    private List<Macro> _macros = new();



    public MacroService(KeyboardService keyboard, IConfiguration config)
    {
        _keyboard = keyboard;
        _filePath = AppPaths.MacrosFile(common: false); // per-user
        Load();
    }

    private void Load()
    {
        try
        {
            if (File.Exists(_filePath))
            {
                var json = File.ReadAllText(_filePath);
                _macros = JsonSerializer.Deserialize<List<Macro>>(json) ?? new();
            }
        }
        catch { _macros = new(); }
    }

    private void SaveToFile()
    {
        var json = JsonSerializer.Serialize(_macros, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(_filePath, json);
    }

    public List<Macro> GetAll() => _macros;

    public Macro? Get(string id) => _macros.FirstOrDefault(m => m.Id == id);

    public List<string> GetCategories() => _macros.Select(m => m.Category).Distinct().ToList();

    public void Save(Macro macro)
    {
        var idx = _macros.FindIndex(m => m.Id == macro.Id);
        if (idx >= 0)
            _macros[idx] = macro;
        else
            _macros.Add(macro);
        SaveToFile();
    }

    public void Delete(string id)
    {
        _macros.RemoveAll(m => m.Id == id);
        SaveToFile();
    }

    public void Execute(Macro macro)
    {
        foreach (var step in macro.Steps)
        {
            if (step.Type == "delay")
            {
                Thread.Sleep(step.Ms);
            }
            else if (step.Type == "key" && step.Key != null)
            {
                switch (step.Action)
                {
                    case "press":
                        _keyboard.PressKey(step.Key);
                        break;
                    case "down":
                        _keyboard.KeyDown(_keyboard.GetVirtualKey(step.Key));
                        break;
                    case "up":
                        _keyboard.KeyUp(_keyboard.GetVirtualKey(step.Key));
                        break;
                }
            }
        }
    }
}