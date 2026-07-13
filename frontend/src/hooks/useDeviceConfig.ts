import { useCallback, useEffect, useState } from "react";

import { HttpError } from "@/lib/api";
import {
  acknowledgeReceiver,
  fetchDeviceConfig,
  pulseGateRelay,
  testReceiverBuzzer,
  updateReceiverConfig,
  updateTransmitterConfig,
} from "@/lib/config";
import type { DeviceConfig, ReceiverConfig, TransmitterConfig } from "@/types";

type SaveTarget = "receiver" | "transmitter" | null;

interface UseDeviceConfigResult {
  config: DeviceConfig | null;
  loading: boolean;
  error: string | null;
  saving: SaveTarget;
  acknowledging: boolean;
  // Resolve to an error message, or null on success.
  saveReceiver: (config: ReceiverConfig) => Promise<string | null>;
  saveTransmitter: (config: TransmitterConfig) => Promise<string | null>;
  acknowledge: (cooldownMs?: number) => Promise<void>;
  testBuzzer: () => Promise<void>;
  pulseGate: () => Promise<void>;
  pulsingGate: boolean;
  refresh: () => Promise<void>;
}

function describeError(err: unknown): string {
  if (err instanceof HttpError) {
    return err.message || `Backend error (${err.status})`;
  }
  return "Unable to reach backend";
}

export function useDeviceConfig(): UseDeviceConfigResult {
  const [config, setConfig] = useState<DeviceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<SaveTarget>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const [pulsingGate, setPulsingGate] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchDeviceConfig();
      setConfig(next);
      setError(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveReceiver = useCallback(
    async (next: ReceiverConfig): Promise<string | null> => {
      setSaving("receiver");
      try {
        const saved = await updateReceiverConfig(next);
        setConfig((prev) => (prev ? { ...prev, receiver: saved } : prev));
        return null;
      } catch (err) {
        return describeError(err);
      } finally {
        setSaving(null);
      }
    },
    [],
  );

  const saveTransmitter = useCallback(
    async (next: TransmitterConfig): Promise<string | null> => {
      setSaving("transmitter");
      try {
        const saved = await updateTransmitterConfig(next);
        setConfig((prev) => (prev ? { ...prev, transmitter: saved } : prev));
        return null;
      } catch (err) {
        return describeError(err);
      } finally {
        setSaving(null);
      }
    },
    [],
  );

  const acknowledge = useCallback(async (cooldownMs?: number) => {
    setAcknowledging(true);
    try {
      await acknowledgeReceiver(cooldownMs);
    } finally {
      setAcknowledging(false);
    }
  }, []);

  const testBuzzer = useCallback(async () => {
    await testReceiverBuzzer();
  }, []);

  const pulseGate = useCallback(async () => {
    setPulsingGate(true);
    try {
      await pulseGateRelay();
    } finally {
      setPulsingGate(false);
    }
  }, []);

  return {
    config,
    loading,
    error,
    saving,
    acknowledging,
    saveReceiver,
    saveTransmitter,
    acknowledge,
    testBuzzer,
    pulseGate,
    pulsingGate,
    refresh,
  };
}
