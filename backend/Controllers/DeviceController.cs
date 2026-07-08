using GateSensor.Api.Data;
using GateSensor.Api.Models;
using GateSensor.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace GateSensor.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class DeviceController(AppDbContext dbContext, IDeviceStatusStore deviceStatusStore) : ControllerBase
{
    // Live liveness of the transmitter/receiver, derived from their retained
    // MQTT status plus a heartbeat-staleness check (see RedisDeviceStatusStore).
    [HttpGet("status")]
    public async Task<ActionResult<IEnumerable<DeviceStatusSnapshot>>> GetStatusAsync(
        CancellationToken cancellationToken)
    {
        var statuses = await deviceStatusStore.GetAllAsync(cancellationToken);
        return Ok(statuses);
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
}
