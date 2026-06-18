using System.Text.Json.Serialization;

namespace GateSensor.Api.Mqtt;

public static class MqttTopics
{
    public const string Trigger = "gate/trigger";
    public const string Buzzer = "gate/buzzer";
}

public sealed record TriggerPayload(
    [property: JsonPropertyName("event")] string Event);

public sealed record BuzzerPayload(
    [property: JsonPropertyName("on")] bool On);
