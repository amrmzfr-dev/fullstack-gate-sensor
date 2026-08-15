import { getUsername } from "@/lib/auth";
import type {
  DeviceConfig,
  DeviceFirmwareStatus,
  DeviceLiveStatus,
  FirmwareManifest,
  GateControlEventRecord,
  ReceiverConfig,
  TransmitterConfig,
} from "@/types";

// Local-only stand-in for the real backend, so the UI can be looked at
// without a .NET API or Postgres running. Wired in from api.ts only when
// VITE_USE_MOCKS=true (set in a gitignored .env.local) — never reachable
// in a real build.
export const MOCK_MODE = import.meta.env.VITE_USE_MOCKS === "true";

const now = () => new Date().toISOString();
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

let alertActive = false;

const receiverConfig: ReceiverConfig = {
  beepOnMs: 200,
  beepGapMs: 150,
  pauseMs: 4000,
  beepsPerCycle: 3,
  alertWindowMs: 30_000,
  acknowledgeCooldownMs: 60_000,
};

const transmitterConfig: TransmitterConfig = {
  pingIntervalMs: 15_000,
  debounceMs: 300,
};

const deviceStatuses: DeviceLiveStatus[] = [
  {
    device: "transmitter",
    online: true,
    lastSeenAt: minutesAgo(1),
    firmwareVersion: "1.4.0",
    ipAddress: "192.168.1.42",
  },
  {
    device: "receiver",
    online: true,
    lastSeenAt: minutesAgo(0),
    firmwareVersion: "1.4.0",
    ipAddress: "192.168.1.57",
  },
];

const firmwareStatuses: DeviceFirmwareStatus[] = [
  { device: "transmitter", manifest: { version: "1.4.0", url: "/firmware/transmitter.bin", md5: "a1b2c3d4" } },
  { device: "receiver", manifest: { version: "1.4.0", url: "/firmware/receiver.bin", md5: "e5f6a7b8" } },
];

const controlEvents: GateControlEventRecord[] = [
  {
    id: "evt-3",
    username: "amir",
    firstPressedAt: minutesAgo(12),
    lastPressedAt: minutesAgo(12),
    pressCount: 1,
  },
  {
    id: "evt-2",
    username: "amir",
    firstPressedAt: minutesAgo(95),
    lastPressedAt: minutesAgo(94),
    pressCount: 2,
  },
  {
    id: "evt-1",
    username: "guard",
    firstPressedAt: minutesAgo(400),
    lastPressedAt: minutesAgo(400),
    pressCount: 1,
  },
];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function readJsonBody<T>(init: RequestInit): Promise<T> {
  return JSON.parse((init.body as string) ?? "{}") as T;
}

export async function mockFetch(path: string, init: RequestInit): Promise<Response> {
  const method = init.method ?? "GET";
  const [pathname] = path.split("?");

  if (method === "POST" && pathname === "/auth/login") {
    const body = await readJsonBody<{ username: string }>(init);
    return json({ token: "mock-token", username: body.username || "dev" });
  }

  if (method === "GET" && pathname === "/gate/status") {
    return json({ alertActive, updatedAt: now() });
  }

  if (method === "GET" && pathname === "/device/status") {
    return json(deviceStatuses);
  }

  if (method === "GET" && pathname === "/gate/control-events") {
    return json(controlEvents);
  }

  if (method === "DELETE" && pathname.startsWith("/gate/control-events/")) {
    const id = pathname.split("/").pop();
    const index = controlEvents.findIndex((event) => event.id === id);
    if (index === -1) return json({ message: "Not found" }, 404);
    controlEvents.splice(index, 1);
    return new Response(null, { status: 204 });
  }

  if (method === "GET" && pathname === "/device/config") {
    const config: DeviceConfig = { receiver: receiverConfig, transmitter: transmitterConfig };
    return json(config);
  }

  if (method === "PUT" && pathname === "/device/receiver/config") {
    Object.assign(receiverConfig, await readJsonBody<ReceiverConfig>(init));
    return json(receiverConfig);
  }

  if (method === "PUT" && pathname === "/device/transmitter/config") {
    Object.assign(transmitterConfig, await readJsonBody<TransmitterConfig>(init));
    return json(transmitterConfig);
  }

  if (method === "POST" && pathname === "/device/receiver/acknowledge") {
    alertActive = false;
    return json({ cooldownMs: receiverConfig.acknowledgeCooldownMs });
  }

  if (method === "POST" && pathname === "/device/receiver/test") {
    return json({ tested: true });
  }

  if (method === "POST" && pathname === "/device/transmitter/relay") {
    alertActive = true;
    const username = getUsername() ?? "dev";
    const latest = controlEvents[0];
    if (latest && latest.username === username && Date.now() - Date.parse(latest.lastPressedAt) < 5 * 60_000) {
      latest.lastPressedAt = now();
      latest.pressCount += 1;
    } else {
      controlEvents.unshift({
        id: `evt-${controlEvents.length + 1}`,
        username,
        firstPressedAt: now(),
        lastPressedAt: now(),
        pressCount: 1,
      });
    }
    return json({ pulsed: true, pulseMs: 400 });
  }

  if (method === "GET" && pathname === "/firmware") {
    return json(firmwareStatuses);
  }

  if (method === "POST" && pathname.startsWith("/firmware/")) {
    const formData = init.body as FormData;
    const manifest: FirmwareManifest = {
      version: String(formData.get("version") ?? "0.0.0"),
      url: `/firmware/mock-${Date.now()}.bin`,
      md5: "mock0000",
    };
    return json(manifest);
  }

  return json({ message: `No mock handler for ${method} ${pathname}` }, 404);
}
