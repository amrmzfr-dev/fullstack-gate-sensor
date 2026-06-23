using System.Text.Json.Serialization;

namespace GateSensor.Api.Mqtt;

public static class MqttTopics
{
    public const string Trigger = "gate/trigger";
    public const string Buzzer = "gate/buzzer";
    public const string ReceiverAck = "gate/receiver/ack";

    public static readonly string[] OtaDevices = ["transmitter", "receiver"];

    public static string FirmwareLatest(string device) => $"firmware/{device}/latest";
}

public sealed record TriggerPayload(
    [property: JsonPropertyName("event")] string Event);

public sealed record BuzzerPayload(
    [property: JsonPropertyName("on")] bool On,
    [property: JsonPropertyName("eventId")] Guid EventId);

public sealed record ReceiverAckPayload(
    [property: JsonPropertyName("on")] bool On,
    [property: JsonPropertyName("eventId")] Guid EventId);
