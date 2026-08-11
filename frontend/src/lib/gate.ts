import { apiGet } from "@/lib/api";
import type { DeviceLiveStatus, GateControlEventRecord, GateStatus } from "@/types";

export async function fetchGateStatus(): Promise<GateStatus> {
  const response = await apiGet<{
    alertActive: boolean;
    updatedAt: string | null;
  }>("/gate/status");

  return {
    alertActive: response.alertActive,
    updatedAt: response.updatedAt,
  };
}

export async function fetchDeviceStatuses(): Promise<DeviceLiveStatus[]> {
  const response = await apiGet<
    Array<{
      device: string;
      online: boolean;
      lastSeenAt: string | null;
      firmwareVersion: string | null;
      ipAddress: string | null;
    }>
  >("/device/status");

  return response.map((record) => ({
    device: record.device,
    online: record.online,
    lastSeenAt: record.lastSeenAt,
    firmwareVersion: record.firmwareVersion,
    ipAddress: record.ipAddress,
  }));
}

// Who pressed the gate open/stop/close button, grouped into one entry per
// user per 5-minute burst of presses (grouping happens backend-side).
export async function fetchGateControlEvents(
  limit = 50,
): Promise<GateControlEventRecord[]> {
  return apiGet<GateControlEventRecord[]>(`/gate/control-events?limit=${limit}`);
}
