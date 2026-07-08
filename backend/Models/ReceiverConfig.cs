namespace GateSensor.Api.Models;

// Runtime buzzer behaviour for the receiver. Serialized camelCase to
// gate/receiver/config (retained) and applied live by the firmware. Defaults
// match the firmware's compiled-in fallback.
public sealed class ReceiverConfig
{
    public int BeepOnMs { get; init; } = 1000;
    public int BeepGapMs { get; init; } = 1000;
    public int PauseMs { get; init; } = 2000;
    public int BeepsPerCycle { get; init; } = 5;
    public int AlertWindowMs { get; init; } = 7000;

    // Default silence duration for the dashboard's acknowledge button. Stored
    // server-side (the firmware receives the concrete value in the command),
    // and ignored by the firmware if present in the config payload.
    public int AcknowledgeCooldownMs { get; init; } = 30000;
}
