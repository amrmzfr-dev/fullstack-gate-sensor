import { apiGet } from "@/lib/api";
import type { GateEventRecord, GateStatus } from "@/types";

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

export async function fetchGateEvents(
  limit = 50,
): Promise<GateEventRecord[]> {
  const response = await apiGet<
    Array<{
      id: string;
      event: string;
      timestamp: string;
    }>
  >(`/gate/events?limit=${limit}`);

  return response.map((record) => ({
    id: record.id,
    event: record.event === "on" ? "on" : "off",
    timestamp: record.timestamp,
  }));
}
