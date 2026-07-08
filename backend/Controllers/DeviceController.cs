using System.Text.Json;
using GateSensor.Api.Data;
using GateSensor.Api.Models;
using GateSensor.Api.Mqtt;
using GateSensor.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace GateSensor.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class DeviceController(
    AppDbContext dbContext,
    IDeviceStatusStore deviceStatusStore,
    IDeviceConfigStore deviceConfigStore,
    IMqttPublisher mqttPublisher) : ControllerBase
{
    // The re-ping interval must land before the receiver's alert window lapses,
    // or the buzzer gaps between pings. Keep this margin between them.
    private const int PingWindowMarginMs = 500;

    private static readonly JsonSerializerOptions PayloadJson = new(JsonSerializerDefaults.Web);

    // Live liveness of the transmitter/receiver, derived from their retained
    // MQTT status plus a heartbeat-staleness check (see RedisDeviceStatusStore).
    [HttpGet("status")]
    public async Task<ActionResult<IEnumerable<DeviceStatusSnapshot>>> GetStatusAsync(
        CancellationToken cancellationToken)
    {
        var statuses = await deviceStatusStore.GetAllAsync(cancellationToken);
        return Ok(statuses);
    }

    [HttpGet("config")]
    public async Task<ActionResult<DeviceConfigResponse>> GetConfigAsync(CancellationToken cancellationToken)
    {
        return Ok(new DeviceConfigResponse
        {
            Receiver = await deviceConfigStore.GetReceiverConfigAsync(cancellationToken),
            Transmitter = await deviceConfigStore.GetTransmitterConfigAsync(cancellationToken),
        });
    }

    [HttpPut("receiver/config")]
    public async Task<ActionResult<ReceiverConfig>> UpdateReceiverConfigAsync(
        [FromBody] ReceiverConfig config,
        CancellationToken cancellationToken)
    {
        var rangeError = ValidateReceiver(config);
        if (rangeError is not null)
        {
            return BadRequest(rangeError);
        }

        var transmitter = await deviceConfigStore.GetTransmitterConfigAsync(cancellationToken);
        if (transmitter.PingIntervalMs + PingWindowMarginMs > config.AlertWindowMs)
        {
            return BadRequest(
                $"alertWindowMs must be at least {transmitter.PingIntervalMs + PingWindowMarginMs} " +
                $"to stay above the transmitter's {transmitter.PingIntervalMs}ms re-ping interval.");
        }

        await deviceConfigStore.SetReceiverConfigAsync(config, cancellationToken);
        await mqttPublisher.PublishAsync(
            MqttTopics.DeviceConfig("receiver"),
            JsonSerializer.Serialize(config, PayloadJson),
            retain: true,
            cancellationToken);

        return Ok(config);
    }

    [HttpPut("transmitter/config")]
    public async Task<ActionResult<TransmitterConfig>> UpdateTransmitterConfigAsync(
        [FromBody] TransmitterConfig config,
        CancellationToken cancellationToken)
    {
        var rangeError = ValidateTransmitter(config);
        if (rangeError is not null)
        {
            return BadRequest(rangeError);
        }

        var receiver = await deviceConfigStore.GetReceiverConfigAsync(cancellationToken);
        if (config.PingIntervalMs + PingWindowMarginMs > receiver.AlertWindowMs)
        {
            return BadRequest(
                $"pingIntervalMs must be at most {receiver.AlertWindowMs - PingWindowMarginMs} " +
                $"to stay under the receiver's {receiver.AlertWindowMs}ms alert window.");
        }

        await deviceConfigStore.SetTransmitterConfigAsync(config, cancellationToken);
        await mqttPublisher.PublishAsync(
            MqttTopics.DeviceConfig("transmitter"),
            JsonSerializer.Serialize(config, PayloadJson),
            retain: true,
            cancellationToken);

        return Ok(config);
    }

    // Acknowledge: silence the receiver and start a cooldown. Uses the supplied
    // cooldown, or the receiver's configured default when none is given.
    [HttpPost("receiver/acknowledge")]
    public async Task<IActionResult> AcknowledgeAsync(
        [FromBody] AcknowledgeRequest? request,
        CancellationToken cancellationToken)
    {
        var receiver = await deviceConfigStore.GetReceiverConfigAsync(cancellationToken);
        var cooldownMs = request?.CooldownMs ?? receiver.AcknowledgeCooldownMs;

        if (cooldownMs is < 0 or > 3600000)
        {
            return BadRequest("cooldownMs must be 0–3600000.");
        }

        var payload = JsonSerializer.Serialize(new { action = "silence", cooldownMs }, PayloadJson);
        await mqttPublisher.PublishAsync(MqttTopics.ReceiverCommand, payload, retain: false, cancellationToken);

        return Ok(new { cooldownMs });
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<Device>>> GetAllAsync(CancellationToken cancellationToken)
    {
        var devices = await dbContext.Devices
            .AsNoTracking()
            .OrderBy(d => d.Name)
            .ToListAsync(cancellationToken);

        return Ok(devices);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<Device>> GetByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        var device = await dbContext.Devices
            .AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == id, cancellationToken);

        if (device is null)
        {
            return NotFound();
        }

        return Ok(device);
    }

    private static string? ValidateReceiver(ReceiverConfig c)
    {
        if (c.BeepOnMs is < 50 or > 60000) return "beepOnMs must be between 50 and 60000.";
        if (c.BeepGapMs is < 0 or > 60000) return "beepGapMs must be between 0 and 60000.";
        if (c.PauseMs is < 0 or > 60000) return "pauseMs must be between 0 and 60000.";
        if (c.BeepsPerCycle is < 1 or > 50) return "beepsPerCycle must be between 1 and 50.";
        if (c.AlertWindowMs is < 1000 or > 600000) return "alertWindowMs must be between 1000 and 600000.";
        if (c.AcknowledgeCooldownMs is < 0 or > 3600000) return "acknowledgeCooldownMs must be between 0 and 3600000.";
        return null;
    }

    private static string? ValidateTransmitter(TransmitterConfig c)
    {
        if (c.PingIntervalMs is < 500 or > 6500) return "pingIntervalMs must be between 500 and 6500.";
        if (c.DebounceMs is < 0 or > 2000) return "debounceMs must be between 0 and 2000.";
        return null;
    }

    public sealed record AcknowledgeRequest(int? CooldownMs);
}
