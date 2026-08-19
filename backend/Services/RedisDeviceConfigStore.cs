using System.Text.Json;
using GateSensor.Api.Models;
using StackExchange.Redis;

namespace GateSensor.Api.Services;

// Persists device runtime config in Redis. Missing keys fall back to the model
// defaults, so a fresh install (or a wiped cache) behaves like the firmware's
// compiled-in defaults until the client changes something.
public sealed class RedisDeviceConfigStore(IConnectionMultiplexer redis) : IDeviceConfigStore
{
    private const string ReceiverKey = "gate:config:receiver";
    private const string TransmitterKey = "gate:config:transmitter";
    private const string PositionKey = "gate:config:position";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private IDatabase Database => redis.GetDatabase();

    public async Task<ReceiverConfig> GetReceiverConfigAsync(CancellationToken cancellationToken)
    {
        var value = await Database.StringGetAsync(ReceiverKey);
        if (!value.HasValue)
        {
            return new ReceiverConfig();
        }

        return JsonSerializer.Deserialize<ReceiverConfig>(value.ToString(), JsonOptions) ?? new ReceiverConfig();
    }

    public async Task<TransmitterConfig> GetTransmitterConfigAsync(CancellationToken cancellationToken)
    {
        var value = await Database.StringGetAsync(TransmitterKey);
        if (!value.HasValue)
        {
            return new TransmitterConfig();
        }

        return JsonSerializer.Deserialize<TransmitterConfig>(value.ToString(), JsonOptions) ?? new TransmitterConfig();
    }

    public async Task<PositionConfig> GetPositionConfigAsync(CancellationToken cancellationToken)
    {
        var value = await Database.StringGetAsync(PositionKey);
        if (!value.HasValue)
        {
            return new PositionConfig();
        }

        return JsonSerializer.Deserialize<PositionConfig>(value.ToString(), JsonOptions) ?? new PositionConfig();
    }

    public async Task SetReceiverConfigAsync(ReceiverConfig config, CancellationToken cancellationToken)
    {
        await Database.StringSetAsync(ReceiverKey, JsonSerializer.Serialize(config, JsonOptions));
    }

    public async Task SetTransmitterConfigAsync(TransmitterConfig config, CancellationToken cancellationToken)
    {
        await Database.StringSetAsync(TransmitterKey, JsonSerializer.Serialize(config, JsonOptions));
    }

    public async Task SetPositionConfigAsync(PositionConfig config, CancellationToken cancellationToken)
    {
        await Database.StringSetAsync(PositionKey, JsonSerializer.Serialize(config, JsonOptions));
    }
}
