namespace GateSensor.Api.Services;

public interface IGateAlertState
{
    Task SetAlertAsync(bool active, CancellationToken cancellationToken);
    Task<bool> GetAlertAsync(CancellationToken cancellationToken);
    Task<DateTimeOffset?> GetUpdatedAtAsync(CancellationToken cancellationToken);
}
