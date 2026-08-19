namespace GateSensor.Api.Models;

public sealed class DeviceConfigResponse
{
    public required ReceiverConfig Receiver { get; init; }
    public required TransmitterConfig Transmitter { get; init; }
    public required PositionConfig Position { get; init; }
}
