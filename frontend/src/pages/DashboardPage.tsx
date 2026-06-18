import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BellOff,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useGateMonitor } from "@/hooks/useGateMonitor";
import type { GateEventRecord } from "@/types";

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

interface PipelineStepProps {
  label: string;
  done: boolean;
  timestamp: string | null;
}

function PipelineStep({ label, done, timestamp }: PipelineStepProps) {
  return (
    <div className="flex items-center gap-1.5">
      {done ? (
        <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Loader2 className="size-3.5 animate-spin text-amber-500" />
      )}
      <span className={done ? "text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
      {timestamp && (
        <span className="text-muted-foreground">
          ({formatTimestamp(timestamp)})
        </span>
      )}
    </div>
  );
}

function EventPipeline({ event }: { event: GateEventRecord }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <PipelineStep
        label="Sensor triggered"
        done
        timestamp={event.timestamp}
      />
      <ArrowRight className="size-3 text-muted-foreground" />
      <PipelineStep
        label="Relayed to buzzer"
        done={event.relayedAt !== null}
        timestamp={event.relayedAt}
      />
      <ArrowRight className="size-3 text-muted-foreground" />
      <PipelineStep
        label="Receiver confirmed"
        done={event.receiverConfirmedAt !== null}
        timestamp={event.receiverConfirmedAt}
      />
    </div>
  );
}

export function DashboardPage() {
  const { status, events, loading, error, refresh } = useGateMonitor();

  const alertActive = status?.alertActive ?? false;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Gate Sensor Dashboard
            </h1>
            <p className="text-sm text-muted-foreground">
              Live alert state via REST — MQTT handled by backend relay
            </p>
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
          {error && (
            <p className="mt-4 text-sm text-destructive">{error}</p>
          )}
        </section>

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
            <ul className="divide-y divide-border">
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
      </main>
    </div>
  );
}
