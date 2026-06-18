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

export interface GateEventRecord {
  id: string;
  event: "on" | "off";
  timestamp: string;
  relayedAt: string | null;
  receiverConfirmedAt: string | null;
}
