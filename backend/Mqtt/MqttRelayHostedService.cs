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

                await HandleTriggerMessageAsync(
                    args.ApplicationMessage.Topic,
                    payloadText,
                    mqttClient,
                    stoppingToken);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to process MQTT trigger message");
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
                        .Build();

                    await mqttClient.SubscribeAsync(subscribeOptions, stoppingToken);
                    logger.LogInformation("MQTT relay connected and subscribed to {Topic}", MqttTopics.Trigger);
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
        string topic,
        string payloadText,
        IMqttClient mqttClient,
        CancellationToken cancellationToken)
    {
        if (!string.Equals(topic, MqttTopics.Trigger, StringComparison.Ordinal))
        {
            return;
        }

        var payload = JsonSerializer.Deserialize<TriggerPayload>(
            payloadText,
            JsonOptions);

        if (payload?.Event is not ("on" or "off"))
        {
            logger.LogWarning("Ignoring trigger payload with unknown event");
            return;
        }

        using var scope = scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var alertState = scope.ServiceProvider.GetRequiredService<IGateAlertState>();

        dbContext.GateEvents.Add(new GateEvent
        {
            Id = Guid.NewGuid(),
            Event = payload.Event,
            Timestamp = DateTime.UtcNow,
        });
        await dbContext.SaveChangesAsync(cancellationToken);

        var alertActive = payload.Event == "on";
        await alertState.SetAlertAsync(alertActive, cancellationToken);

        var buzzerPayload = JsonSerializer.Serialize(new BuzzerPayload(alertActive));
        var buzzerMessage = new MqttApplicationMessageBuilder()
            .WithTopic(MqttTopics.Buzzer)
            .WithPayload(buzzerPayload)
            .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce)
            .WithRetainFlag(true)
            .Build();

        await mqttClient.PublishAsync(buzzerMessage, cancellationToken);

        logger.LogInformation(
            "Relayed trigger event {Event} to {Topic}",
            payload.Event,
            MqttTopics.Buzzer);
    }
}
