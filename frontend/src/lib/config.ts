import { apiGet, apiPost, apiPut } from "@/lib/api";
import type { DeviceConfig, ReceiverConfig, TransmitterConfig } from "@/types";

export async function fetchDeviceConfig(): Promise<DeviceConfig> {
  return apiGet<DeviceConfig>("/device/config");
}

export async function updateReceiverConfig(
  config: ReceiverConfig,
): Promise<ReceiverConfig> {
  return apiPut<ReceiverConfig, ReceiverConfig>("/device/receiver/config", config);
}

export async function updateTransmitterConfig(
  config: TransmitterConfig,
): Promise<TransmitterConfig> {
  return apiPut<TransmitterConfig, TransmitterConfig>(
    "/device/transmitter/config",
    config,
  );
}

export async function acknowledgeReceiver(
  cooldownMs?: number,
): Promise<{ cooldownMs: number }> {
  return apiPost<{ cooldownMs: number }, { cooldownMs?: number }>(
    "/device/receiver/acknowledge",
    { cooldownMs },
  );
}

export async function testReceiverBuzzer(): Promise<{ tested: boolean }> {
  return apiPost<{ tested: boolean }, Record<string, never>>(
    "/device/receiver/test",
    {},
  );
}

// One stateless "press" of the gate button: the transmitter closes its relay
// briefly and the gate motor board cycles open -> stop -> close by itself.
export async function pulseGateRelay(): Promise<{ pulsed: boolean; pulseMs: number }> {
  return apiPost<{ pulsed: boolean; pulseMs: number }, Record<string, never>>(
    "/device/transmitter/relay",
    {},
  );
}
