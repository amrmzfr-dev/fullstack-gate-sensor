using System.Security.Cryptography;
using System.Text.Json;
using GateSensor.Api.Models;
using GateSensor.Api.Mqtt;
using GateSensor.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace GateSensor.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class FirmwareController(
    IWebHostEnvironment webHostEnvironment,
    IFirmwarePublisher firmwarePublisher,
    IConfiguration configuration) : ControllerBase
{
    private const long MaxFirmwareBytes = 4 * 1024 * 1024; // ESP32 app partitions are well under this

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    [HttpGet]
    public async Task<ActionResult<IEnumerable<DeviceFirmwareStatus>>> GetAllAsync(CancellationToken cancellationToken)
    {
        var statuses = new List<DeviceFirmwareStatus>();
        foreach (var device in MqttTopics.OtaDevices)
        {
            statuses.Add(new DeviceFirmwareStatus(device, await ReadManifestAsync(device, cancellationToken)));
        }

        return Ok(statuses);
    }

    [HttpGet("{device}")]
    public async Task<ActionResult<FirmwareManifest>> GetByDeviceAsync(string device, CancellationToken cancellationToken)
    {
        if (!MqttTopics.OtaDevices.Contains(device))
        {
            return NotFound($"Unknown device '{device}'.");
        }

        var manifest = await ReadManifestAsync(device, cancellationToken);
        return manifest is null ? NotFound() : Ok(manifest);
    }

    [HttpPost("{device}")]
    [RequestSizeLimit(MaxFirmwareBytes)]
    public async Task<ActionResult<FirmwareManifest>> UploadAsync(
        string device,
        [FromForm] FirmwareUploadRequest request,
        CancellationToken cancellationToken)
    {
        if (!MqttTopics.OtaDevices.Contains(device))
        {
            return BadRequest($"Unknown device '{device}'.");
        }

        if (request.File.Length == 0)
        {
            return BadRequest("Firmware file is empty.");
        }

        if (!string.Equals(Path.GetExtension(request.File.FileName), ".bin", StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest("Firmware file must be a .bin image.");
        }

        if (string.IsNullOrWhiteSpace(request.Version))
        {
            return BadRequest("Version is required.");
        }

        var baseUrl = configuration["Ota:PublicBaseUrl"]?.TrimEnd('/');
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            return StatusCode(StatusCodes.Status500InternalServerError, "Ota:PublicBaseUrl is not configured.");
        }

        var deviceDir = Path.Combine(webHostEnvironment.WebRootPath, "firmware", device);
        Directory.CreateDirectory(deviceDir);

        var binPath = Path.Combine(deviceDir, "firmware.bin");
        await using (var fileStream = new FileStream(binPath, FileMode.Create))
        {
            await request.File.CopyToAsync(fileStream, cancellationToken);
        }

        string md5Hex;
        await using (var readStream = System.IO.File.OpenRead(binPath))
        {
            var hash = await MD5.HashDataAsync(readStream, cancellationToken);
            md5Hex = Convert.ToHexString(hash).ToLowerInvariant();
        }

        var manifest = new FirmwareManifest(request.Version, $"{baseUrl}/firmware/{device}/firmware.bin", md5Hex);

        var manifestPath = Path.Combine(deviceDir, "manifest.json");
        await System.IO.File.WriteAllTextAsync(manifestPath, JsonSerializer.Serialize(manifest), cancellationToken);

        await firmwarePublisher.PublishManifestAsync(device, cancellationToken);

        return Ok(manifest);
    }

    private async Task<FirmwareManifest?> ReadManifestAsync(string device, CancellationToken cancellationToken)
    {
        var manifestPath = Path.Combine(webHostEnvironment.WebRootPath, "firmware", device, "manifest.json");
        if (!System.IO.File.Exists(manifestPath))
        {
            return null;
        }

        var json = await System.IO.File.ReadAllTextAsync(manifestPath, cancellationToken);
        return JsonSerializer.Deserialize<FirmwareManifest>(json, JsonOptions);
    }
}
