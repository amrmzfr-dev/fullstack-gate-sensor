namespace GateSensor.Api.Models;

public sealed class FirmwareUploadRequest
{
    public required IFormFile File { get; init; }
    public required string Version { get; init; }
}
