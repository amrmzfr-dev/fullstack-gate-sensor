namespace GateSensor.Api.Models;

// Runtime settings for the transmitter. Serialized camelCase to
// gate/transmitter/config (retained). PingIntervalMs must stay under the
// receiver's AlertWindowMs (the controller enforces the margin).
public sealed class TransmitterConfig
{
    public int PingIntervalMs { get; init; } = 5000;
    public int DebounceMs { get; init; } = 50;
}
