import { apiGet } from "@/lib/api";
import type { DeviceLiveStatus, GateEventRecord, GateStatus } from "@/types";

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

export async function fetchGateEvents(
  limit = 50,
): Promise<GateEventRecord[]> {
  const response = await apiGet<
    Array<{
      id: string;
      event: string;
      timestamp: string;
      relayedAt: string | null;
      receiverConfirmedAt: string | null;
    }>
  >(`/gate/events?limit=${limit}`);

  return response.map((record) => ({
    id: record.id,
    event: record.event === "on" ? "on" : "off",
    timestamp: record.timestamp,
    relayedAt: record.relayedAt,
    receiverConfirmedAt: record.receiverConfirmedAt,
  }));
}
