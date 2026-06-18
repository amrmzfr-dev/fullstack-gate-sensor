namespace GateSensor.Api.Models;

public class Sensor
{
    public Guid Id { get; set; }
    public Guid GateId { get; set; }
    public string Type { get; set; } = string.Empty;
    public double? LastReading { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Gate? Gate { get; set; }
}
