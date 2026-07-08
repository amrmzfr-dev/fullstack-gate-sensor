import { useCallback, useEffect, useState } from "react";

import { HttpError } from "@/lib/api";
import {
  fetchDeviceStatuses,
  fetchGateEvents,
  fetchGateStatus,
} from "@/lib/gate";
import type { DeviceLiveStatus, GateEventRecord, GateStatus } from "@/types";

const DEFAULT_POLL_INTERVAL_MS = 2000;

interface UseGateMonitorResult {
  status: GateStatus | null;
  events: GateEventRecord[];
  devices: DeviceLiveStatus[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useGateMonitor(
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
): UseGateMonitorResult {
  const [status, setStatus] = useState<GateStatus | null>(null);
  const [events, setEvents] = useState<GateEventRecord[]>([]);
  const [devices, setDevices] = useState<DeviceLiveStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextEvents, nextDevices] = await Promise.all([
        fetchGateStatus(),
        fetchGateEvents(),
        fetchDeviceStatuses(),
      ]);
      setStatus(nextStatus);
      setEvents(nextEvents);
      setDevices(nextDevices);
      setError(null);
    } catch (err) {
      const message =
        err instanceof HttpError
          ? `Backend error (${err.status})`
          : "Unable to reach backend";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    const intervalId = window.setInterval(() => {
      void refresh();
    }, pollIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [pollIntervalMs, refresh]);

  return { status, events, devices, loading, error, refresh };
}
