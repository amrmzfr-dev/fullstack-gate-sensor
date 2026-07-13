import { useState } from "react";
import {
  AlertTriangle,
  BellOff,
  HardDriveUpload,
  History,
  Home,
  Loader2,
  RefreshCw,
  Settings,
  VolumeX,
} from "lucide-react";

import { DeviceStatusCard } from "@/components/DeviceStatusCard";
import { EventPipeline } from "@/components/EventPipeline";
import {
  ReceiverSettings,
  TransmitterSettings,
} from "@/components/DeviceSettingsPanel";
import { FirmwarePanel } from "@/components/FirmwarePanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useDeviceConfig } from "@/hooks/useDeviceConfig";
import { useGateMonitor } from "@/hooks/useGateMonitor";
import { formatTimestamp } from "@/lib/format";

type MobileTab = "home" | "events" | "settings" | "firmware";

const TABS: ReadonlyArray<{ id: MobileTab; label: string; icon: typeof Home }> = [
  { id: "home", label: "Home", icon: Home },
  { id: "events", label: "Events", icon: History },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "firmware", label: "Firmware", icon: HardDriveUpload },
];

export function MobileDashboardPage() {
  const { status, events, devices, loading, error, refresh } = useGateMonitor();
  const {
    config,
    saving,
    acknowledging,
    saveReceiver,
    saveTransmitter,
    acknowledge,
    testBuzzer,
  } = useDeviceConfig();

  const [tab, setTab] = useState<MobileTab>("home");
  const [ackMessage, setAckMessage] = useState<string | null>(null);

  const alertActive = status?.alertActive ?? false;
  const cooldownMs = config?.receiver.acknowledgeCooldownMs ?? 30000;
  const cooldownSeconds = Math.round(cooldownMs / 1000);

  const handleAcknowledge = async () => {
    try {
      await acknowledge();
      setAckMessage(`Silenced — buzzer stays quiet for ${cooldownSeconds}s`);
    } catch {
      setAckMessage("Couldn't reach the receiver to silence it");
    }
    window.setTimeout(() => setAckMessage(null), 5000);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-block size-2.5 rounded-full ${
                alertActive
                  ? "animate-pulse bg-destructive"
                  : "bg-emerald-500 dark:bg-emerald-400"
              }`}
              aria-hidden
            />
            <h1 className="text-base font-semibold tracking-tight">Gate Sensor</h1>
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
          </div>
        </div>
      </header>

      {/* Inactive tabs stay mounted (hidden) so unsaved settings edits survive tab switches. */}
      <main className="flex-1 overflow-y-auto px-4 py-4 pb-24">
        <div className={tab === "home" ? "space-y-4" : "hidden"}>
            <section
              className={`rounded-xl border p-5 ${
                alertActive
                  ? "border-destructive/40 bg-destructive/10"
                  : "border-border bg-card"
              }`}
            >
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div
                  className={`flex size-20 items-center justify-center rounded-full ${
                    alertActive
                      ? "bg-destructive/20 text-destructive"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {alertActive ? (
                    <AlertTriangle className="size-9" />
                  ) : (
                    <BellOff className="size-9" />
                  )}
                </div>
                <div className="space-y-1">
                  <h2 className="text-2xl font-semibold">
                    {alertActive ? "Gate Alert Active" : "Gate Clear"}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {loading && !status
                      ? "Loading current alert state..."
                      : alertActive
                        ? "IR beam blocked — buzzer relay engaged"
                        : "No active alert — sensor beam clear"}
                  </p>
                  {status?.updatedAt && (
                    <p className="text-xs text-muted-foreground">
                      Last update: {formatTimestamp(status.updatedAt)}
                    </p>
                  )}
                </div>
              </div>

              <Button
                className="h-14 w-full text-base"
                variant={alertActive ? "default" : "outline"}
                disabled={acknowledging}
                onClick={() => {
                  void handleAcknowledge();
                }}
              >
                {acknowledging ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <VolumeX className="size-5" />
                )}
                Acknowledge &amp; silence ({cooldownSeconds}s)
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {ackMessage ?? "Quiets the buzzer once you're aware of the alert"}
              </p>
              {error && (
                <p className="mt-3 text-center text-sm text-destructive">{error}</p>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="px-1 text-sm font-medium">Devices</h2>
              {devices.length === 0 ? (
                <p className="px-1 text-sm text-muted-foreground">
                  {loading ? "Loading device status..." : "No devices reporting yet"}
                </p>
              ) : (
                devices.map((device) => (
                  <DeviceStatusCard key={device.device} device={device} />
                ))
              )}
            </section>
        </div>

        <section className={tab === "events" ? "space-y-3" : "hidden"}>
            <div className="px-1">
              <h2 className="text-sm font-medium">Recent Events</h2>
              <p className="text-xs text-muted-foreground">
                Trigger history from the gate sensor
              </p>
            </div>
            {events.length === 0 ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                {loading ? "Loading events..." : "No trigger events recorded yet"}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {events.map((event) => (
                  <li key={event.id} className="space-y-1.5 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span
                        className={
                          event.event === "on"
                            ? "font-medium text-destructive"
                            : "text-muted-foreground"
                        }
                      >
                        {event.event === "on" ? "Trigger ON" : "Trigger OFF"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatTimestamp(event.timestamp)}
                      </span>
                    </div>
                    <EventPipeline event={event} showTimestamps={false} />
                  </li>
                ))}
              </ul>
            )}
        </section>

        <section className={tab === "settings" ? "space-y-4" : "hidden"}>
            <div className="px-1">
              <h2 className="text-sm font-medium">Behaviour settings</h2>
              <p className="text-xs text-muted-foreground">
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
        </section>

        <div className={tab === "firmware" ? "" : "hidden"}>
          <FirmwarePanel />
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-4">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                  active ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <span className="relative">
                  <Icon className="size-5" />
                  {id === "home" && alertActive && (
                    <span className="absolute -right-1 -top-1 size-2 rounded-full bg-destructive" />
                  )}
                </span>
                {label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
