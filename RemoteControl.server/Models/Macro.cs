namespace RemoteControl.Server.Models;

public class Macro
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "";
    public string Category { get; set; } = "Macros";
    public List<MacroStep> Steps { get; set; } = new();
}

public class MacroStep
{
    public string Type { get; set; } = "key";  // "key" or "delay"
    public string? Key { get; set; }
    public string? Action { get; set; }  // "press", "down", "up"
    public int Ms { get; set; }
}