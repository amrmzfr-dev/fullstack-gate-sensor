using GateSensor.Api.Models;

namespace GateSensor.Api.Services;

public interface IDeviceConfigStore
{
    Task<ReceiverConfig> GetReceiverConfigAsync(CancellationToken cancellationToken);
    Task<TransmitterConfig> GetTransmitterConfigAsync(CancellationToken cancellationToken);
    Task SetReceiverConfigAsync(ReceiverConfig config, CancellationToken cancellationToken);
    Task SetTransmitterConfigAsync(TransmitterConfig config, CancellationToken cancellationToken);
}
