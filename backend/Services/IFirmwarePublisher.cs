namespace GateSensor.Api.Services;

public interface IFirmwarePublisher
{
    Task PublishManifestAsync(string device, CancellationToken cancellationToken);
}
