using StackExchange.Redis;

namespace GateSensor.Api.Services;

public sealed class RedisGateAlertState(IConnectionMultiplexer redis) : IGateAlertState
{
    private const string AlertKey = "gate:alert:active";
    private const string UpdatedAtKey = "gate:alert:updated_at";

    private IDatabase Database => redis.GetDatabase();

    public async Task SetAlertAsync(bool active, CancellationToken cancellationToken)
    {
        var updatedAt = DateTimeOffset.UtcNow;
        var transaction = Database.CreateTransaction();

        _ = transaction.StringSetAsync(AlertKey, active ? "true" : "false");
        _ = transaction.StringSetAsync(UpdatedAtKey, updatedAt.ToUnixTimeSeconds().ToString());

        await transaction.ExecuteAsync();
    }

    public async Task<bool> GetAlertAsync(CancellationToken cancellationToken)
    {
        var value = await Database.StringGetAsync(AlertKey);
        return value.HasValue && value.ToString() == "true";
    }

    public async Task<DateTimeOffset?> GetUpdatedAtAsync(CancellationToken cancellationToken)
    {
        var value = await Database.StringGetAsync(UpdatedAtKey);
        if (!value.HasValue || !long.TryParse(value.ToString(), out var unixSeconds))
        {
            return null;
        }

        return DateTimeOffset.FromUnixTimeSeconds(unixSeconds);
    }
}
