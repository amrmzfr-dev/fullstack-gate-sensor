using System.Text.Json.Serialization;

namespace GateSensor.Api.Mqtt;

public static class MqttTopics
{
    public const string Trigger = "gate/trigger";
    public const string Buzzer = "gate/buzzer";
    public const string ReceiverAck = "gate/receiver/ack";

    // Devices publish retained liveness to gate/{device}/status (and a Last Will
    // "offline" that the broker sends on ungraceful disconnect). The backend
    // watches all of them via the single-level wildcard.
    public const string DeviceStatusWildcard = "gate/+/status";

    // One-shot command channel for the receiver (e.g. acknowledge/silence).
    public const string ReceiverCommand = "gate/receiver/command";

    // One-shot command channel for the transmitter (gate relay pulse).
    public const string TransmitterCommand = "gate/transmitter/command";

    public static readonly string[] OtaDevices = ["transmitter", "receiver"];

    public static string FirmwareLatest(string device) => $"firmware/{device}/latest";

    // Retained per-device runtime settings the firmware applies live.
    public static string DeviceConfig(string device) => $"gate/{device}/config";

    public static string DeviceStatus(string device) => $"gate/{device}/status";

    // Extracts "{device}" from "gate/{device}/status", or null if it doesn't match.
    public static string? DeviceFromStatusTopic(string topic)
    {
        var parts = topic.Split('/');
        return parts is ["gate", var device, "status"] && device.Length > 0 ? device : null;
    }
}

public sealed record TriggerPayload(
    [property: JsonPropertyName("event")] string Event);

public sealed record BuzzerPayload(
    [property: JsonPropertyName("on")] bool On,
    [property: JsonPropertyName("eventId")] Guid EventId);

public sealed record ReceiverAckPayload(
    [property: JsonPropertyName("on")] bool On,
    [property: JsonPropertyName("eventId")] Guid EventId);

public sealed record DeviceStatusPayload(
    [property: JsonPropertyName("online")] bool Online,
    [property: JsonPropertyName("version")] string? Version,
    [property: JsonPropertyName("ip")] string? Ip);
