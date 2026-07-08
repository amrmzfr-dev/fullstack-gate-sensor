namespace GateSensor.Api.Services;

public interface IMqttPublisher
{
    Task PublishAsync(string topic, string payload, bool retain, CancellationToken cancellationToken);
}
