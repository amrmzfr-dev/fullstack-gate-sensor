using GateSensor.Api.Data;
using GateSensor.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace GateSensor.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class SensorController(AppDbContext dbContext) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<Sensor>>> GetAllAsync(CancellationToken cancellationToken)
    {
        var sensors = await dbContext.Sensors
            .AsNoTracking()
            .OrderBy(s => s.Type)
            .ToListAsync(cancellationToken);

        return Ok(sensors);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<Sensor>> GetByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        var sensor = await dbContext.Sensors
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == id, cancellationToken);

        if (sensor is null)
        {
            return NotFound();
        }

        return Ok(sensor);
    }
}
