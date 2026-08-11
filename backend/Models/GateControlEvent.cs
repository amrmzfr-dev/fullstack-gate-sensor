namespace GateSensor.Api.Models;

// One row per user "session" of gate-button presses: repeated presses by the
// same user within a 5-minute window collapse into a single row instead of
// spamming the recent-events list.
public class GateControlEvent
{
    public Guid Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public DateTime FirstPressedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastPressedAt { get; set; } = DateTime.UtcNow;
    public int PressCount { get; set; } = 1;
}
