namespace GateSensor.Api.Models;

public class Gate
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Status { get; set; } = "unknown";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
