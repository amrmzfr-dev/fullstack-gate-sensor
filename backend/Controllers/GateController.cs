using System.IdentityModel.Tokens.Jwt;
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
    // Deleting press-log entries is restricted to this one account — not a
    // role or permission, just a hardcoded allowlist, by design (see the
    // frontend's log rendering, which hides the delete control for anyone
    // else too).
    private const string LogDeleteUsername = "amir";

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

    // Who pressed the gate open/stop/close button, grouped into one row per
    // user per 5-minute burst of presses (see DeviceController.RecordControlEventAsync).
    [HttpGet("control-events")]
    public async Task<ActionResult<IEnumerable<GateControlEvent>>> GetControlEventsAsync(
        [FromQuery] int limit = 50,
        CancellationToken cancellationToken = default)
    {
        var boundedLimit = Math.Clamp(limit, 1, 200);

        var events = await dbContext.GateControlEvents
            .AsNoTracking()
            .OrderByDescending(e => e.LastPressedAt)
            .Take(boundedLimit)
            .ToListAsync(cancellationToken);

        return Ok(events);
    }

    [HttpDelete("control-events/{id:guid}")]
    public async Task<IActionResult> DeleteControlEventAsync(Guid id, CancellationToken cancellationToken)
    {
        var username = User.FindFirst(JwtRegisteredClaimNames.UniqueName)?.Value;
        if (!string.Equals(username, LogDeleteUsername, StringComparison.OrdinalIgnoreCase))
        {
            return Forbid();
        }

        var deleted = await dbContext.GateControlEvents
            .Where(e => e.Id == id)
            .ExecuteDeleteAsync(cancellationToken);

        return deleted == 0 ? NotFound() : NoContent();
    }
}
