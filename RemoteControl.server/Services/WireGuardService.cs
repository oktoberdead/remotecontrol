using System.Diagnostics;

namespace RemoteControl.Server.Services;

public class WireGuardService
{
    private readonly string _serviceName;
    private readonly ILogger<WireGuardService> _logger;

    public WireGuardService(IConfiguration config, ILogger<WireGuardService> logger)
    {
        _serviceName = config.GetValue<string>("WireGuard:ServiceName")
                       ?? "WireGuardTunnel$SkyNet.890";
        _logger = logger;
    }

    public string GetStatus()
    {
        try
        {
            var result = RunPowerShell($"(Get-Service '{_serviceName}' -ErrorAction Stop).Status");
            var status = result.Trim();
            return string.IsNullOrEmpty(status) ? "Unknown" : status;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to get WireGuard status");
            return "Unknown";
        }
    }

    public string Toggle()
    {
        try
        {
            var status = GetStatus();
            _logger.LogInformation("Toggling WireGuard from {Status}", status);

            if (status == "Running")
            {
                RunPowerShell($"Stop-Service '{_serviceName}' -Force");
                Thread.Sleep(1000);
            }
            else
            {
                RunPowerShell($"Start-Service '{_serviceName}'");
                Thread.Sleep(1000);
            }

            var newStatus = GetStatus();
            _logger.LogInformation("WireGuard is now {Status}", newStatus);
            return newStatus;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to toggle WireGuard");
            return $"Error: {ex.Message}";
        }
    }

    private string RunPowerShell(string command)
    {
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -Command \"{command}\"",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };

        process.Start();
        var output = process.StandardOutput.ReadToEnd();
        process.WaitForExit();
        return output;
    }
}