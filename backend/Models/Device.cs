namespace GateSensor.Api.Models;

public class Device
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string FirmwareVersion { get; set; } = "0.0.0";
    public bool Online { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
