using System.Text.Json;
using GateSensor.Api.Data;
using GateSensor.Api.Models;
using GateSensor.Api.Mqtt;
using GateSensor.Api.Services;
using Microsoft.EntityFrameworkCore;
using MQTTnet;
using MQTTnet.Protocol;

namespace GateSensor.Api.Mqtt;

public sealed class MqttRelayHostedService(
    IServiceScopeFactory scopeFactory,
    IConfiguration configuration,
    IWebHostEnvironment webHostEnvironment,
    ILogger<MqttRelayHostedService> logger) : BackgroundService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var mqttFactory = new MqttClientFactory();
        using var mqttClient = mqttFactory.CreateMqttClient();

        mqttClient.ApplicationMessageReceivedAsync += async args =>
        {
            try
            {
                var payloadText = args.ApplicationMessage.ConvertPayloadToString();
                if (payloadText is null)
                {
                    return;
                }

                var topic = args.ApplicationMessage.Topic;

                if (string.Equals(topic, MqttTopics.Trigger, StringComparison.Ordinal))
                {
                    await HandleTriggerMessageAsync(payloadText, mqttClient, stoppingToken);
                }
                else if (string.Equals(topic, MqttTopics.ReceiverAck, StringComparison.Ordinal))
                {
                    await HandleReceiverAckAsync(payloadText, stoppingToken);
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to process MQTT message");
            }
        };

        var host = configuration["Mqtt:Host"] ?? "localhost";
        var port = configuration.GetValue("Mqtt:Port", 1883);
        var clientId = configuration["Mqtt:ClientId"] ?? "gate-sensor-backend";
        var username = configuration["Mqtt:Username"];
        var password = configuration["Mqtt:Password"];

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!mqttClient.IsConnected)
                {
                    var optionsBuilder = new MqttClientOptionsBuilder()
                        .WithTcpServer(host, port)
                        .WithClientId(clientId)
                        .WithCleanSession(false);

                    if (!string.IsNullOrWhiteSpace(username))
                    {
                        optionsBuilder.WithCredentials(username, password);
                    }

                    var options = optionsBuilder.Build();

                    await mqttClient.ConnectAsync(options, stoppingToken);

                    var subscribeOptions = mqttFactory.CreateSubscribeOptionsBuilder()
                        .WithTopicFilter(filter => filter
                            .WithTopic(MqttTopics.Trigger)
                            .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce))
                        .WithTopicFilter(filter => filter
                            .WithTopic(MqttTopics.ReceiverAck)
                            .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce))
                        .Build();

                    await mqttClient.SubscribeAsync(subscribeOptions, stoppingToken);
                    logger.LogInformation(
                        "MQTT relay connected and subscribed to {TriggerTopic} and {AckTopic}",
                        MqttTopics.Trigger,
                        MqttTopics.ReceiverAck);

                    await PublishFirmwareManifestsAsync(mqttClient, stoppingToken);
                }

                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "MQTT relay connection failed; retrying in 5 seconds");
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }

        if (mqttClient.IsConnected)
        {
            await mqttClient.DisconnectAsync(new MqttClientDisconnectOptions(), stoppingToken);
        }
    }

    private async Task HandleTriggerMessageAsync(
        string payloadText,
        IMqttClient mqttClient,
        CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Deserialize<TriggerPayload>(payloadText, JsonOptions);

        if (payload?.Event is not ("on" or "off"))
        {
            logger.LogWarning("Ignoring trigger payload with unknown event");
            return;
        }

        using var scope = scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var alertState = scope.ServiceProvider.GetRequiredService<IGateAlertState>();

        var gateEvent = new GateEvent
        {
            Id = Guid.NewGuid(),
            Event = payload.Event,
            Timestamp = DateTime.UtcNow,
        };
        dbContext.GateEvents.Add(gateEvent);
        await dbContext.SaveChangesAsync(cancellationToken);

        var alertActive = payload.Event == "on";
        await alertState.SetAlertAsync(alertActive, cancellationToken);

        var buzzerPayload = JsonSerializer.Serialize(new BuzzerPayload(alertActive, gateEvent.Id));
        var buzzerMessage = new MqttApplicationMessageBuilder()
            .WithTopic(MqttTopics.Buzzer)
            .WithPayload(buzzerPayload)
            .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce)
            .WithRetainFlag(true)
            .Build();

        await mqttClient.PublishAsync(buzzerMessage, cancellationToken);

        gateEvent.RelayedAt = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "Relayed trigger event {Event} (eventId={EventId}) to {Topic}",
            payload.Event,
            gateEvent.Id,
            MqttTopics.Buzzer);
    }

    private async Task HandleReceiverAckAsync(string payloadText, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Deserialize<ReceiverAckPayload>(payloadText, JsonOptions);

        if (payload is null || payload.EventId == Guid.Empty)
        {
            logger.LogWarning("Ignoring receiver ack with missing eventId");
            return;
        }

        using var scope = scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var gateEvent = await dbContext.GateEvents
            .FirstOrDefaultAsync(e => e.Id == payload.EventId, cancellationToken);

        if (gateEvent is null)
        {
            logger.LogWarning("Receiver ack referenced unknown eventId {EventId}", payload.EventId);
            return;
        }

        gateEvent.ReceiverConfirmedAt = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "Receiver confirmed event {EventId} (on={On})",
            payload.EventId,
            payload.On);
    }

    // Devices subscribe to firmware/{device}/latest once at boot. Publishing
    // retained means a device gets the current manifest immediately on
    // connect (no polling), and a live push the moment a new manifest lands
    // here and the backend reconnects/restarts.
    private async Task PublishFirmwareManifestsAsync(IMqttClient mqttClient, CancellationToken cancellationToken)
    {
        var webRoot = webHostEnvironment.WebRootPath;
        if (string.IsNullOrEmpty(webRoot))
        {
            return;
        }

        foreach (var device in MqttTopics.OtaDevices)
        {
            var manifestPath = Path.Combine(webRoot, "firmware", device, "manifest.json");
            if (!File.Exists(manifestPath))
            {
                continue;
            }

            var manifestJson = await File.ReadAllTextAsync(manifestPath, cancellationToken);

            var message = new MqttApplicationMessageBuilder()
                .WithTopic(MqttTopics.FirmwareLatest(device))
                .WithPayload(manifestJson)
                .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce)
                .WithRetainFlag(true)
                .Build();

            await mqttClient.PublishAsync(message, cancellationToken);
            logger.LogInformation("Published firmware manifest for {Device}", device);
        }
    }
}
