import { apiGet, apiPostForm } from "@/lib/api";
import type { DeviceFirmwareStatus, FirmwareDevice, FirmwareManifest } from "@/types";

export async function fetchFirmwareStatuses(): Promise<DeviceFirmwareStatus[]> {
  return apiGet<DeviceFirmwareStatus[]>("/firmware");
}

export async function uploadFirmware(
  device: FirmwareDevice,
  file: File,
  version: string,
): Promise<FirmwareManifest> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("version", version);

  return apiPostForm<FirmwareManifest>(`/firmware/${device}`, formData);
}
