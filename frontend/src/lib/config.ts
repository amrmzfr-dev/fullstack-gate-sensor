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
