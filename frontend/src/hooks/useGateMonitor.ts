import { useCallback, useEffect, useRef, useState } from "react";

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
  // Polls run every ~2s; on phones a single request routinely drops during
  // brief signal dips. Only surface the error after several consecutive
  // failures so a one-off blip doesn't flash "unable to reach backend".
  const consecutiveFailures = useRef(0);

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
      consecutiveFailures.current = 0;
      setError(null);
    } catch (err) {
      consecutiveFailures.current += 1;
      if (consecutiveFailures.current >= 3) {
        setError(
          err instanceof HttpError
            ? `Backend error (${err.status})`
            : "Unable to reach backend",
        );
      }
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
