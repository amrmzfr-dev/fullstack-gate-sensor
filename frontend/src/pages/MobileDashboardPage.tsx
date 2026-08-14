import { useState } from "react";
import {
  HardDriveUpload,
  History,
  Home,
  LogOut,
  RefreshCw,
  Settings,
  VolumeX,
} from "lucide-react";

import {
  ReceiverSettings,
  TransmitterSettings,
} from "@/components/DeviceSettingsPanel";
import { FirmwarePanel } from "@/components/FirmwarePanel";
import { GatePressButton } from "@/components/GatePressButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useDeviceConfig } from "@/hooks/useDeviceConfig";
import { useGateMonitor } from "@/hooks/useGateMonitor";
import {
  capitalize,
  formatDeviceName,
  formatTime,
} from "@/lib/format";

type MobileTab = "home" | "events" | "settings" | "firmware";

const TABS: ReadonlyArray<{
  id: MobileTab;
  label: string;
  icon: typeof Home;
  activeClass: string;
}> = [
  { id: "home", label: "Home", icon: Home, activeClass: "bg-tone-control text-tone-control-foreground" },
  { id: "events", label: "Events", icon: History, activeClass: "bg-tone-log text-tone-log-foreground" },
  { id: "settings", label: "Settings", icon: Settings, activeClass: "bg-tone-sound text-tone-sound-foreground" },
  { id: "firmware", label: "Firmware", icon: HardDriveUpload, activeClass: "bg-foreground text-background" },
];

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

interface MobileDashboardPageProps {
  username: string | null;
  onLogout: () => void;
}

export function MobileDashboardPage({ username, onLogout }: MobileDashboardPageProps) {
  const { status, events, devices, loading, error, refresh } = useGateMonitor();
  const {
    config,
    saving,
    acknowledging,
    saveReceiver,
    saveTransmitter,
    acknowledge,
    testBuzzer,
    pulseGate,
    pulsingGate,
  } = useDeviceConfig();

  const [tab, setTab] = useState<MobileTab>("home");
  const [ackMessage, setAckMessage] = useState<string | null>(null);
  const [gateMessage, setGateMessage] = useState<string | null>(null);

  const handleGatePress = async () => {
    try {
      await pulseGate();
      setGateMessage("Signal sent to the gate");
    } catch {
      setGateMessage("Couldn't reach the gate controller");
    }
    window.setTimeout(() => setGateMessage(null), 4000);
  };

  const alertActive = status?.alertActive ?? false;
  const cooldownMs = config?.receiver.acknowledgeCooldownMs ?? 30000;
  const cooldownSeconds = Math.round(cooldownMs / 1000);

  const handleAcknowledge = async () => {
    try {
      await acknowledge();
      setAckMessage(`Silenced — resumes in ${cooldownSeconds}s`);
    } catch {
      setAckMessage("Couldn't reach the receiver to silence it");
    }
    window.setTimeout(() => setAckMessage(null), 5000);
  };

  const latestEvent = events.reduce<typeof events[number] | null>((latest, event) => {
    if (!latest) return event;
    return new Date(event.lastPressedAt) > new Date(latest.lastPressedAt) ? event : latest;
  }, null);

  const totalPresses = events.reduce((sum, event) => sum + event.pressCount, 0);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <div>
              <h1 className="font-display text-lg font-black uppercase leading-none tracking-tight">
                Gate Sensor
              </h1>
              <span className="font-label text-[10px] uppercase tracking-widest text-muted-foreground">
                Front driveway
              </span>
            </div>
            <span
              className={`inline-block size-2 rounded-full ${
                alertActive ? "animate-pulse bg-destructive" : "bg-primary"
              }`}
              aria-hidden
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                void refresh();
              }}
              aria-label="Refresh gate status"
            >
              <RefreshCw />
            </Button>
            <ThemeToggle />
            {username && (
              <span className="flex size-9 items-center justify-center rounded-full border border-border bg-card font-label text-xs font-medium">
                {initials(username)}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Inactive tabs stay mounted (hidden) so unsaved settings edits survive tab switches. */}
      <main className="flex-1 overflow-y-auto px-4 py-4 pb-28">
        <div className={tab === "home" ? "flex min-h-full flex-col gap-3.5" : "hidden"}>
          <section
            className={`flex items-center justify-between gap-3 rounded-3xl px-5 py-4 transition-colors ${
              alertActive
                ? "bg-destructive text-white"
                : pulsingGate
                  ? "bg-tone-control text-tone-control-foreground"
                  : "border border-border bg-card"
            }`}
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span
                className={`font-label text-[10px] uppercase tracking-widest ${
                  alertActive || pulsingGate ? "opacity-70" : "text-muted-foreground"
                }`}
              >
                Controller
              </span>
              <span className="font-display text-xl font-extrabold uppercase leading-none tracking-tight">
                {loading && !status
                  ? "Loading…"
                  : alertActive
                    ? "Beam blocked"
                    : pulsingGate
                      ? "Signal sent"
                      : "Connected"}
              </span>
              <span
                className={`text-xs ${
                  alertActive || pulsingGate ? "opacity-80" : "text-muted-foreground"
                }`}
              >
                {alertActive
                  ? "IR beam blocked — buzzer relay engaged"
                  : "No position sensor — reports beam state only"}
              </span>
            </div>
            {status?.updatedAt && (
              <span
                className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 font-label text-[9px] uppercase tracking-widest ${
                  alertActive || pulsingGate ? "bg-black/15" : "bg-muted text-muted-foreground"
                }`}
              >
                {formatTime(status.updatedAt)}
              </span>
            )}
          </section>

          <section className="grid grid-cols-2 gap-2.5">
            {devices.length === 0 ? (
              <p className="col-span-2 px-1 text-sm text-muted-foreground">
                {loading ? "Loading device status..." : "No devices reporting yet"}
              </p>
            ) : (
              devices.map((device) => (
                <div
                  key={device.device}
                  className="flex flex-col gap-2 rounded-2xl border border-border bg-card px-3.5 py-3"
                >
                  <span className="font-label text-[9px] uppercase tracking-widest text-muted-foreground">
                    {formatDeviceName(device.device)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`size-2 shrink-0 rounded-full ${
                        device.online ? "bg-primary" : "bg-destructive"
                      }`}
                      aria-hidden
                    />
                    <span
                      className={`font-display text-base font-extrabold uppercase leading-none tracking-tight ${
                        device.online ? "" : "text-destructive"
                      }`}
                    >
                      {device.online ? "Online" : "Offline"}
                    </span>
                  </div>
                  <span className="text-[11px] leading-tight text-muted-foreground">
                    {device.online
                      ? device.firmwareVersion
                        ? `Firmware ${device.firmwareVersion}`
                        : "Reporting"
                      : device.lastSeenAt
                        ? `No reply · last seen ${formatTime(device.lastSeenAt)}`
                        : "No reply yet"}
                  </span>
                </div>
              ))
            )}
          </section>

          <section className="flex flex-col items-center gap-2 py-1">
            <GatePressButton pulsing={pulsingGate} onPress={handleGatePress} />
            <p className="text-xs text-muted-foreground">{gateMessage}</p>
          </section>

          {latestEvent && (
            <section className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 font-label text-[11px] font-semibold text-primary">
                {initials(latestEvent.username)}
              </span>
              <span className="flex-1 truncate font-display text-sm font-bold">
                {capitalize(latestEvent.username)}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">Last press</span>
              <span className="shrink-0 font-label text-[10px] text-muted-foreground">
                {formatTime(latestEvent.lastPressedAt)}
              </span>
            </section>
          )}

          <section
            className={`flex items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3.5 transition-colors ${
              alertActive ? "bg-tone-log/15" : "bg-card"
            }`}
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-label text-[10px] uppercase tracking-widest text-muted-foreground">
                Sensor buzzer
              </span>
              <span className="font-display text-base font-extrabold uppercase leading-none tracking-tight">
                {alertActive ? "Alert active" : "Armed"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {ackMessage ??
                  (alertActive
                    ? `Tap to silence for ${cooldownSeconds}s`
                    : "Chimes on beam trip")}
              </span>
            </div>
            <Button
              variant={alertActive ? "default" : "outline"}
              size="icon-lg"
              disabled={!alertActive || acknowledging}
              onClick={() => {
                void handleAcknowledge();
              }}
              aria-label="Silence buzzer"
              className="rounded-full"
            >
              <VolumeX className={acknowledging ? "animate-pulse" : ""} />
            </Button>
          </section>

          {error && <p className="px-1 text-sm text-destructive">{error}</p>}
        </div>

        <section className={tab === "events" ? "space-y-3.5" : "hidden"}>
          <div className="px-1">
            <h2 className="font-display text-2xl font-black uppercase leading-none tracking-tight">
              Press Log
            </h2>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Who sent a signal — the controller reports no gate position
            </p>
          </div>

          {events.length > 0 && (
            <div className="flex items-end justify-between gap-3 rounded-3xl bg-tone-log px-5 py-4 text-tone-log-foreground">
              <div className="flex flex-col gap-1">
                <span className="font-label text-[10px] uppercase tracking-widest opacity-70">
                  All-time
                </span>
                <span className="font-display text-3xl font-black leading-none">
                  {totalPresses} presses
                </span>
                <span className="text-xs opacity-80">
                  {events.length} {events.length === 1 ? "person" : "people"}
                </span>
              </div>
            </div>
          )}

          {events.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">
              {loading ? "Loading events..." : "No gate presses recorded yet"}
            </p>
          ) : (
            <ul className="space-y-2">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-tone-log/15 font-label text-xs font-semibold text-tone-log">
                    {initials(event.username)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-sm font-bold">
                      {capitalize(event.username)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {event.pressCount} press{event.pressCount === 1 ? "" : "es"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-full bg-tone-log px-2 py-0.5 font-label text-[9px] uppercase tracking-widest text-tone-log-foreground">
                      Press
                    </span>
                    <span className="font-label text-[10px] text-muted-foreground">
                      {formatTime(event.lastPressedAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={tab === "settings" ? "space-y-4" : "hidden"}>
          <div className="px-1">
            <h2 className="font-display text-2xl font-black uppercase leading-none tracking-tight">
              Sensor Sound
            </h2>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Applied live to the devices — no reflash needed
            </p>
          </div>
          {config ? (
            <>
              <ReceiverSettings
                initial={config.receiver}
                saving={saving === "receiver"}
                onSave={saveReceiver}
                onTest={testBuzzer}
              />
              <TransmitterSettings
                initial={config.transmitter}
                saving={saving === "transmitter"}
                onSave={saveTransmitter}
              />
            </>
          ) : (
            <p className="px-1 text-sm text-muted-foreground">
              Loading device settings...
            </p>
          )}

          <div className="space-y-2 border-t border-border pt-4">
            <h2 className="px-1 font-label text-[10px] uppercase tracking-widest text-muted-foreground">
              Account
            </h2>
            <Button
              variant="outline"
              className="h-11 w-full justify-center text-destructive"
              onClick={onLogout}
            >
              <LogOut />
              Sign out
            </Button>
          </div>
        </section>

        <div className={tab === "firmware" ? "space-y-3.5" : "hidden"}>
          <div className="px-1">
            <h2 className="font-display text-2xl font-black uppercase leading-none tracking-tight">
              Firmware
            </h2>
            <p className="mt-1.5 text-xs text-muted-foreground">
              OTA update over MQTT — restricted to the admin account
            </p>
          </div>
          <FirmwarePanel username={username} />
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-10 flex justify-center pb-[calc(env(safe-area-inset-bottom)+12px)]">
        <div className="flex items-center gap-1.5 rounded-3xl border border-border bg-card/95 p-1.5 shadow-lg backdrop-blur">
          {TABS.map(({ id, label, icon: Icon, activeClass }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-current={active ? "page" : undefined}
                aria-label={label}
                className={`relative flex size-12 items-center justify-center rounded-2xl transition-colors ${
                  active ? activeClass : "text-muted-foreground"
                }`}
              >
                <Icon className="size-5" />
                {id === "home" && alertActive && !active && (
                  <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-destructive" />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
