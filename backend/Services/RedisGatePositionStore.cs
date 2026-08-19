using GateSensor.Api.Models;
using StackExchange.Redis;

namespace GateSensor.Api.Services;

// Tracks the gate's most recently reported open percentage in Redis. Updated
// on every gate/position/telemetry message (see MqttRelayHostedService); read
// back for GET /api/gate/position.
public sealed class RedisGatePositionStore(IConnectionMultiplexer redis) : IGatePositionStore
{
    private const string Key = "gate:position:live";

    private IDatabase Database => redis.GetDatabase();

    public async Task SetAsync(
        int rawAngle,
        int cumulativeTicks,
        int percentOpen,
        bool positionKnown,
        bool magnetOk,
        CancellationToken cancellationToken)
    {
        var entries = new[]
        {
            new HashEntry("rawAngle", rawAngle),
            new HashEntry("cumulativeTicks", cumulativeTicks),
            new HashEntry("percentOpen", percentOpen),
            new HashEntry("positionKnown", positionKnown ? "true" : "false"),
            new HashEntry("magnetOk", magnetOk ? "true" : "false"),
            new HashEntry("updatedAt", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString()),
        };

        await Database.HashSetAsync(Key, entries);
    }

    public async Task<GatePositionSnapshot> GetAsync(CancellationToken cancellationToken)
    {
        var entries = await Database.HashGetAllAsync(Key);
        if (entries.Length == 0)
        {
            return new GatePositionSnapshot { PercentOpen = -1, PositionKnown = false };
        }

        var map = entries.ToDictionary(e => e.Name.ToString(), e => e.Value);

        var percentOpen = map.TryGetValue("percentOpen", out var percentValue) && percentValue.TryParse(out int percent)
            ? percent
            : -1;

        var positionKnown = map.TryGetValue("positionKnown", out var knownValue) && knownValue.ToString() == "true";

        DateTimeOffset? updatedAt = null;
        if (map.TryGetValue("updatedAt", out var updatedAtValue)
            && long.TryParse(updatedAtValue.ToString(), out var unixSeconds))
        {
            updatedAt = DateTimeOffset.FromUnixTimeSeconds(unixSeconds);
        }

        return new GatePositionSnapshot
        {
            PercentOpen = percentOpen,
            PositionKnown = positionKnown,
            RawAngle = map.TryGetValue("rawAngle", out var rawValue) && rawValue.TryParse(out int raw) ? raw : null,
            CumulativeTicks = map.TryGetValue("cumulativeTicks", out var ticksValue) && ticksValue.TryParse(out int ticks)
                ? ticks
                : null,
            MagnetOk = map.TryGetValue("magnetOk", out var magnetValue) ? magnetValue.ToString() == "true" : null,
            UpdatedAt = updatedAt,
        };
    }
}
