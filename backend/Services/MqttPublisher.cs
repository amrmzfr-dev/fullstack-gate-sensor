using MQTTnet;
using MQTTnet.Protocol;

namespace GateSensor.Api.Services;

// Opens a short-lived connection to publish a single message on demand (config
// change, acknowledge command). Mirrors MqttFirmwarePublisher rather than
// sharing the relay's long-lived connection, so a controller action doesn't
// depend on the hosted service's connection state.
public sealed class MqttPublisher(
    IConfiguration configuration,
    ILogger<MqttPublisher> logger) : IMqttPublisher
{
    public async Task PublishAsync(string topic, string payload, bool retain, CancellationToken cancellationToken)
    {
        var host = configuration["Mqtt:Host"] ?? "localhost";
        var port = configuration.GetValue("Mqtt:Port", 1883);
        var username = configuration["Mqtt:Username"];
        var password = configuration["Mqtt:Password"];

        var mqttFactory = new MqttClientFactory();
        using var mqttClient = mqttFactory.CreateMqttClient();

        var optionsBuilder = new MqttClientOptionsBuilder()
            .WithTcpServer(host, port)
            .WithClientId($"gate-sensor-backend-pub-{Guid.NewGuid():N}")
            .WithCleanSession(true);

        if (!string.IsNullOrWhiteSpace(username))
        {
            optionsBuilder.WithCredentials(username, password);
        }

        await mqttClient.ConnectAsync(optionsBuilder.Build(), cancellationToken);

        var message = new MqttApplicationMessageBuilder()
            .WithTopic(topic)
            .WithPayload(payload)
            .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce)
            .WithRetainFlag(retain)
            .Build();

        await mqttClient.PublishAsync(message, cancellationToken);
        await mqttClient.DisconnectAsync(new MqttClientDisconnectOptions(), cancellationToken);

        logger.LogInformation("Published to {Topic} (retain={Retain})", topic, retain);
    }
}
