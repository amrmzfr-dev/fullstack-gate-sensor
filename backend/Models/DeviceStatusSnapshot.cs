namespace GateSensor.Api.Models;

// Live liveness view of one device, assembled from its retained MQTT status
// plus a staleness check on the last heartbeat.
public sealed class DeviceStatusSnapshot
{
    public required string Device { get; init; }
    public required bool Online { get; init; }
    public DateTimeOffset? LastSeenAt { get; init; }
    public string? FirmwareVersion { get; init; }
    public string? IpAddress { get; init; }
}
