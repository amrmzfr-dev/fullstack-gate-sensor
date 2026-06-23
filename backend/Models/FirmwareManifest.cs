using System.Text.Json.Serialization;

namespace GateSensor.Api.Models;

public sealed record FirmwareManifest(
    [property: JsonPropertyName("version")] string Version,
    [property: JsonPropertyName("url")] string Url,
    [property: JsonPropertyName("md5")] string Md5);

public sealed record DeviceFirmwareStatus(
    [property: JsonPropertyName("device")] string Device,
    [property: JsonPropertyName("manifest")] FirmwareManifest? Manifest);
