using GateSensor.Api.Models;

namespace GateSensor.Api.Services;

public interface IGatePositionStore
{
    Task SetAsync(
        int rawAngle,
        int cumulativeTicks,
        int percentOpen,
        bool positionKnown,
        bool magnetOk,
        CancellationToken cancellationToken);

    Task<GatePositionSnapshot> GetAsync(CancellationToken cancellationToken);
}
