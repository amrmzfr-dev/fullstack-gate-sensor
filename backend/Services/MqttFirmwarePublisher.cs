using GateSensor.Api.Mqtt;
using MQTTnet;
using MQTTnet.Protocol;

namespace GateSensor.Api.Services;

// Separate from MqttRelayHostedService's long-lived connection — this opens a
// short-lived connection just to publish one retained message on demand
// (right after a firmware upload), instead of waiting for the relay's next
// reconnect cycle to pick up the new manifest.
public sealed class MqttFirmwarePublisher(
    IConfiguration configuration,
    IWebHostEnvironment webHostEnvironment,
    ILogger<MqttFirmwarePublisher> logger) : IFirmwarePublisher
{
    public async Task PublishManifestAsync(string device, CancellationToken cancellationToken)
    {
        var manifestPath = Path.Combine(webHostEnvironment.WebRootPath, "firmware", device, "manifest.json");
        if (!File.Exists(manifestPath))
        {
            logger.LogWarning("No manifest found for device {Device}; skipping publish", device);
            return;
        }

        var manifestJson = await File.ReadAllTextAsync(manifestPath, cancellationToken);

        var host = configuration["Mqtt:Host"] ?? "localhost";
        var port = configuration.GetValue("Mqtt:Port", 1883);
        var username = configuration["Mqtt:Username"];
        var password = configuration["Mqtt:Password"];

        var mqttFactory = new MqttClientFactory();
        using var mqttClient = mqttFactory.CreateMqttClient();

        var optionsBuilder = new MqttClientOptionsBuilder()
            .WithTcpServer(host, port)
            .WithClientId($"gate-sensor-backend-ota-{Guid.NewGuid():N}")
            .WithCleanSession(true);

        if (!string.IsNullOrWhiteSpace(username))
        {
            optionsBuilder.WithCredentials(username, password);
        }

        await mqttClient.ConnectAsync(optionsBuilder.Build(), cancellationToken);

        var message = new MqttApplicationMessageBuilder()
            .WithTopic(MqttTopics.FirmwareLatest(device))
            .WithPayload(manifestJson)
            .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce)
            .WithRetainFlag(true)
            .Build();

        await mqttClient.PublishAsync(message, cancellationToken);
        await mqttClient.DisconnectAsync(new MqttClientDisconnectOptions(), cancellationToken);

        logger.LogInformation("Published firmware manifest for {Device} on demand", device);
    }
}
