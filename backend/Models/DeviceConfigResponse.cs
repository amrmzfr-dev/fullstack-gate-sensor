namespace GateSensor.Api.Models;

public sealed class DeviceConfigResponse
{
    public required ReceiverConfig Receiver { get; init; }
    public required TransmitterConfig Transmitter { get; init; }
}
