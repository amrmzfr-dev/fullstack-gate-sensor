export type Theme = "light" | "dark";

export interface ApiError {
  message: string;
  status: number;
}

export interface Gate {
  id: string;
  name: string;
  status: "open" | "closed" | "unknown";
}

export interface Sensor {
  id: string;
  gateId: string;
  type: string;
  lastReading: number | null;
}

export interface Device {
  id: string;
  name: string;
  firmwareVersion: string;
  online: boolean;
}

export interface GateStatus {
  alertActive: boolean;
  updatedAt: string | null;
}

export interface DeviceLiveStatus {
  device: string;
  online: boolean;
  lastSeenAt: string | null;
  firmwareVersion: string | null;
  ipAddress: string | null;
}

export interface ReceiverConfig {
  beepOnMs: number;
  beepGapMs: number;
  pauseMs: number;
  beepsPerCycle: number;
  alertWindowMs: number;
  acknowledgeCooldownMs: number;
}

export interface TransmitterConfig {
  pingIntervalMs: number;
  debounceMs: number;
}

export interface DeviceConfig {
  receiver: ReceiverConfig;
  transmitter: TransmitterConfig;
}

export interface GateEventRecord {
  id: string;
  event: "on" | "off";
  timestamp: string;
  relayedAt: string | null;
  receiverConfirmedAt: string | null;
}

export type FirmwareDevice = "transmitter" | "receiver";

export interface FirmwareManifest {
  version: string;
  url: string;
  md5: string;
}

export interface DeviceFirmwareStatus {
  device: FirmwareDevice;
  manifest: FirmwareManifest | null;
}
