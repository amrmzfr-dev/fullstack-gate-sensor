namespace GateSensor.Api.Models;

// Live view of the gate's open percentage, assembled from the position
// sensor's most recent telemetry message.
public sealed class GatePositionSnapshot
{
    public required int PercentOpen { get; init; }
    public required bool PositionKnown { get; init; }
    public int? RawAngle { get; init; }
    public int? CumulativeTicks { get; init; }
    public bool? MagnetOk { get; init; }
    public DateTimeOffset? UpdatedAt { get; init; }
}
