import { useCallback, useEffect, useRef, useState } from "react";

import { HttpError } from "@/lib/api";
import {
  deleteGateControlEvent,
  fetchDeviceStatuses,
  fetchGateControlEvents,
  fetchGateStatus,
} from "@/lib/gate";
import type { DeviceLiveStatus, GateControlEventRecord, GateStatus } from "@/types";

const DEFAULT_POLL_INTERVAL_MS = 2000;

// The log's date filter is client-side, so it needs more than the default
// 50 to have real history to filter across — this is the backend's max.
const CONTROL_EVENTS_LIMIT = 200;

interface UseGateMonitorResult {
  status: GateStatus | null;
  events: GateControlEventRecord[];
  devices: DeviceLiveStatus[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
}

export function useGateMonitor(
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
): UseGateMonitorResult {
  const [status, setStatus] = useState<GateStatus | null>(null);
  const [events, setEvents] = useState<GateControlEventRecord[]>([]);
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
        fetchGateControlEvents(CONTROL_EVENTS_LIMIT),
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

  const deleteEvent = useCallback(async (id: string) => {
    await deleteGateControlEvent(id);
    setEvents((current) => current.filter((event) => event.id !== id));
  }, []);

  return { status, events, devices, loading, error, refresh, deleteEvent };
}
