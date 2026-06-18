namespace GateSensor.Api.Models;

public sealed class GateStatusResponse
{
    public required bool AlertActive { get; init; }
    public DateTimeOffset? UpdatedAt { get; init; }
}
