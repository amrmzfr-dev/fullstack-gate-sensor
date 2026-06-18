namespace GateSensor.Api.Models;

public class GateEvent
{
    public Guid Id { get; set; }
    public string Event { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public DateTime? RelayedAt { get; set; }
    public DateTime? ReceiverConfirmedAt { get; set; }
}
