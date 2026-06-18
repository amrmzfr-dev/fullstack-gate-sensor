using GateSensor.Api.Data;
using GateSensor.Api.Models;
using GateSensor.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace GateSensor.Api.Controllers;

[ApiController]
[Route("api/gate")]
public class GateController(
    AppDbContext dbContext,
    IGateAlertState alertState) : ControllerBase
{
    [HttpGet("status")]
    public async Task<ActionResult<GateStatusResponse>> GetStatusAsync(CancellationToken cancellationToken)
    {
        var alertActive = await alertState.GetAlertAsync(cancellationToken);
        var updatedAt = await alertState.GetUpdatedAtAsync(cancellationToken);

        return Ok(new GateStatusResponse
        {
            AlertActive = alertActive,
            UpdatedAt = updatedAt,
        });
    }

    [HttpGet("events")]
    public async Task<ActionResult<IEnumerable<GateEvent>>> GetEventsAsync(
        [FromQuery] int limit = 50,
        CancellationToken cancellationToken = default)
    {
        var boundedLimit = Math.Clamp(limit, 1, 200);

        var events = await dbContext.GateEvents
            .AsNoTracking()
            .OrderByDescending(e => e.Timestamp)
            .Take(boundedLimit)
            .ToListAsync(cancellationToken);

        return Ok(events);
    }
}
