import { useCallback, useEffect, useState } from "react";

import { HttpError } from "@/lib/api";
import { fetchGateEvents, fetchGateStatus } from "@/lib/gate";
import type { GateEventRecord, GateStatus } from "@/types";

const DEFAULT_POLL_INTERVAL_MS = 2000;

interface UseGateMonitorResult {
  status: GateStatus | null;
  events: GateEventRecord[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useGateMonitor(
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
): UseGateMonitorResult {
  const [status, setStatus] = useState<GateStatus | null>(null);
  const [events, setEvents] = useState<GateEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextEvents] = await Promise.all([
        fetchGateStatus(),
        fetchGateEvents(),
      ]);
      setStatus(nextStatus);
      setEvents(nextEvents);
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

  return { status, events, loading, error, refresh };
}
