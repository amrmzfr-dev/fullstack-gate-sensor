import { useState } from "react";
import {
  AlertTriangle,
  Bell,
  BellOff,
  Clock,
  Loader2,
  RefreshCw,
  VolumeX,
} from "lucide-react";

import { DeviceSettingsPanel } from "@/components/DeviceSettingsPanel";
import { DeviceStatusCard } from "@/components/DeviceStatusCard";
import { EventPipeline } from "@/components/EventPipeline";
import { FirmwarePanel } from "@/components/FirmwarePanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useDeviceConfig } from "@/hooks/useDeviceConfig";
import { useGateMonitor } from "@/hooks/useGateMonitor";
import { formatTimestamp } from "@/lib/format";

export function DashboardPage() {
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
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="" className="size-10" />
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                Gate Sensor Dashboard
              </h1>
              <p className="text-sm text-muted-foreground">
                Live alert state via REST — MQTT handled by backend relay
              </p>
            </div>
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

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <section
          className={`rounded-lg border p-6 ${
            alertActive
              ? "border-destructive/40 bg-destructive/10"
              : "border-border bg-card"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {alertActive ? (
                  <AlertTriangle className="size-5 text-destructive" />
                ) : (
                  <BellOff className="size-5 text-muted-foreground" />
                )}
                <h2 className="text-lg font-semibold">
                  {alertActive ? "Gate Alert Active" : "Gate Clear"}
                </h2>
              </div>
              <p className="text-sm text-muted-foreground">
                {loading && !status
                  ? "Loading current alert state..."
                  : alertActive
                    ? "IR beam blocked — buzzer relay engaged"
                    : "No active alert — sensor beam clear"}
              </p>
              {status?.updatedAt && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="size-3.5" />
                  Last update: {formatTimestamp(status.updatedAt)}
                </p>
              )}
            </div>
            <div
              className={`flex size-12 items-center justify-center rounded-full ${
                alertActive
                  ? "bg-destructive/20 text-destructive"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {alertActive ? <Bell className="size-5" /> : <BellOff className="size-5" />}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
            <Button
              variant={alertActive ? "default" : "outline"}
              disabled={acknowledging}
              onClick={() => {
                void handleAcknowledge();
              }}
            >
              {acknowledging ? <Loader2 className="animate-spin" /> : <VolumeX />}
              Acknowledge &amp; silence ({cooldownSeconds}s)
            </Button>
            <span className="text-xs text-muted-foreground">
              {ackMessage ?? "Lets the client confirm they're aware and quiet the buzzer"}
            </span>
          </div>
          {error && (
            <p className="mt-4 text-sm text-destructive">{error}</p>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-sm font-medium">Devices</h2>
            <p className="text-xs text-muted-foreground">
              Live transmitter and receiver status via MQTT heartbeat
            </p>
          </div>
          <div className="grid gap-3 px-6 py-4 sm:grid-cols-2">
            {devices.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {loading ? "Loading device status..." : "No devices reporting yet"}
              </p>
            ) : (
              devices.map((device) => (
                <DeviceStatusCard key={device.device} device={device} />
              ))
            )}
          </div>
        </section>

        {config && (
          <DeviceSettingsPanel
            config={config}
            saving={saving}
            onSaveReceiver={saveReceiver}
            onSaveTransmitter={saveTransmitter}
            onTestReceiver={testBuzzer}
          />
        )}

        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-sm font-medium">Recent Events</h2>
            <p className="text-xs text-muted-foreground">
              Trigger history from Postgres via REST
            </p>
          </div>
          {events.length === 0 ? (
            <p className="px-6 py-8 text-sm text-muted-foreground">
              {loading ? "Loading events..." : "No trigger events recorded yet"}
            </p>
          ) : (
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
              {events.map((event) => (
                <li key={event.id} className="space-y-1.5 px-6 py-3 text-sm">
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
                  <EventPipeline event={event} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <FirmwarePanel />
      </main>
    </div>
  );
}
