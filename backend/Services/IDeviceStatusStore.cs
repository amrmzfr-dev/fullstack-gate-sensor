using GateSensor.Api.Models;

namespace GateSensor.Api.Services;

public interface IDeviceStatusStore
{
    Task SetStatusAsync(
        string device,
        bool online,
        string? firmwareVersion,
        string? ipAddress,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<DeviceStatusSnapshot>> GetAllAsync(CancellationToken cancellationToken);
}
