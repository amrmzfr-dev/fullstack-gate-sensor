using GateSensor.Api.Models;
using GateSensor.Api.Mqtt;
using StackExchange.Redis;

namespace GateSensor.Api.Services;

// Tracks each device's last reported liveness in Redis. A device is considered
// online only if its last status said "online" AND its most recent heartbeat is
// still fresh — so a unit that drops off WiFi without a clean Last Will still
// flips to offline once its heartbeats stop arriving.
public sealed class RedisDeviceStatusStore(IConnectionMultiplexer redis) : IDeviceStatusStore
{
    // Heartbeat is 30s on the firmware; allow ~3 misses before calling it dead.
    private static readonly TimeSpan StaleAfter = TimeSpan.FromSeconds(95);

    private IDatabase Database => redis.GetDatabase();

    private static string KeyFor(string device) => $"gate:device:{device}:status";

    public async Task SetStatusAsync(
        string device,
        bool online,
        string? firmwareVersion,
        string? ipAddress,
        CancellationToken cancellationToken)
    {
        var entries = new List<HashEntry>
        {
            new("online", online ? "true" : "false"),
            new("lastSeen", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString()),
        };

        if (!string.IsNullOrWhiteSpace(firmwareVersion))
        {
            entries.Add(new HashEntry("version", firmwareVersion));
        }

        if (!string.IsNullOrWhiteSpace(ipAddress))
        {
            entries.Add(new HashEntry("ip", ipAddress));
        }

        await Database.HashSetAsync(KeyFor(device), entries.ToArray());
    }

    public async Task<IReadOnlyList<DeviceStatusSnapshot>> GetAllAsync(CancellationToken cancellationToken)
    {
        var snapshots = new List<DeviceStatusSnapshot>(MqttTopics.OtaDevices.Length);

        foreach (var device in MqttTopics.OtaDevices)
        {
            var entries = await Database.HashGetAllAsync(KeyFor(device));
            if (entries.Length == 0)
            {
                snapshots.Add(new DeviceStatusSnapshot { Device = device, Online = false });
                continue;
            }

            var map = entries.ToDictionary(e => e.Name.ToString(), e => e.Value);

            var reportedOnline = map.TryGetValue("online", out var onlineValue)
                && onlineValue.ToString() == "true";

            DateTimeOffset? lastSeen = null;
            if (map.TryGetValue("lastSeen", out var lastSeenValue)
                && long.TryParse(lastSeenValue.ToString(), out var unixSeconds))
            {
                lastSeen = DateTimeOffset.FromUnixTimeSeconds(unixSeconds);
            }

            var fresh = lastSeen is not null
                && DateTimeOffset.UtcNow - lastSeen.Value < StaleAfter;

            snapshots.Add(new DeviceStatusSnapshot
            {
                Device = device,
                Online = reportedOnline && fresh,
                LastSeenAt = lastSeen,
                FirmwareVersion = map.TryGetValue("version", out var v) ? v.ToString() : null,
                IpAddress = map.TryGetValue("ip", out var ip) ? ip.ToString() : null,
            });
        }

        return snapshots;
    }
}
