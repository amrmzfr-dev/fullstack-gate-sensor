namespace GateSensor.Api.Models;

// Calibration + poll rate for the AS5600 gate-position sensor. Serialized
// camelCase to gate/position/config (retained) and applied live by the
// firmware. RawClosed/RawOpen are AS5600 raw single-turn readings (0-4095)
// captured at each hard limit; OpenTicksSpan is the signed cumulative-tick
// distance from closed to open (see DeviceController's calibrate endpoints).
// OpenTicksSpan of 0 means "not calibrated yet" — both device and backend
// treat that as an uncalibrated/unknown position.
public sealed class PositionConfig
{
    public int RawClosed { get; init; } = -1;
    public int RawOpen { get; init; } = -1;
    public int OpenTicksSpan { get; init; }
    public int PollIntervalMs { get; init; } = 250;

    // Backend-only bookkeeping: the device's cumulativeTicks reading at the
    // moment "record closed" was called. Needed to compute OpenTicksSpan once
    // "record open" is called (see DeviceController), since that's a relative
    // delta between two readings — it only stays valid if both calibration
    // steps happen in the same device uptime session (i.e. don't let the
    // position sensor reboot between them; its own cumulativeTicks resets to
    // 0 on every boot). Rides along in the retained MQTT config payload
    // harmlessly — the firmware ignores unrecognized JSON keys.
    public int? ClosedCumulativeTicksAtCalibration { get; init; }
}
