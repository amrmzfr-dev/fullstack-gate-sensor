import { useState } from "react";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  Loader2,
  LogOut,
  RefreshCw,
  VolumeX,
} from "lucide-react";

import { ReceiverSettings, TransmitterSettings } from "@/components/DeviceSettingsPanel";
import { FirmwarePanel } from "@/components/FirmwarePanel";
import { Button } from "@/components/ui/button";
import { useDeviceConfig } from "@/hooks/useDeviceConfig";
import { useGateMonitor } from "@/hooks/useGateMonitor";
import { useHoldToConfirm } from "@/hooks/useHoldToConfirm";
import { useLongPress } from "@/hooks/useLongPress";
import { getMonthGrid, WEEKDAY_LABELS } from "@/lib/calendar";
import {
  capitalize,
  dateInputValue,
  dayKey,
  formatDateInputValue,
  formatDay,
  formatDeviceName,
  formatTime,
} from "@/lib/format";
import type { GateControlEventRecord } from "@/types";

// Only this one account can see/use the log's delete button — see
// GateController.DeleteControlEventAsync on the backend, which enforces the
// same restriction regardless of what the frontend shows.
const LOG_DELETE_USERNAME = "amir";

// How long the "Hold to confirm" button in the delete modal must be held
// before the delete actually fires.
const HOLD_CONFIRM_MS = 2000;

interface EventDayGroup {
  key: string;
  label: string;
  items: GateControlEventRecord[];
}

// `events` arrives newest-first (see useGateMonitor), so a single linear
// pass keeps that order and only starts a new group when the calendar day
// actually changes.
function groupEventsByDay(events: GateControlEventRecord[]): EventDayGroup[] {
  const groups: EventDayGroup[] = [];
  for (const event of events) {
    const key = dayKey(event.lastPressedAt);
    const current = groups[groups.length - 1];
    if (current && current.key === key) {
      current.items.push(event);
    } else {
      groups.push({ key, label: formatDay(event.lastPressedAt), items: [event] });
    }
  }
  return groups;
}

// Small dim uppercase eyebrow label, the same role mobile's <Label> plays
// above every card headline.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] font-medium tracking-[.14em] text-muted-foreground uppercase">
      {children}
    </span>
  );
}

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

function EventRow({
  event,
  canDelete,
  onRequestDelete,
}: {
  event: GateControlEventRecord;
  canDelete: boolean;
  onRequestDelete: (event: GateControlEventRecord) => void;
}) {
  const longPress = useLongPress(() => onRequestDelete(event));

  return (
    <div
      {...(canDelete ? longPress : {})}
      className={`flex items-center gap-3 rounded-[16px] border border-border bg-card p-3 ${canDelete ? "select-none" : ""}`}
    >
      <div className="flex size-10 flex-none items-center justify-center rounded-[11px] bg-secondary font-mono text-xs font-semibold text-secondary-foreground">
        {initials(event.username)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{capitalize(event.username)}</p>
        <p className="text-xs text-muted-foreground">
          {event.pressCount} press{event.pressCount === 1 ? "" : "es"}
        </p>
      </div>
      <div className="flex flex-none flex-col items-end gap-1">
        <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[9px] tracking-[.08em] text-secondary-foreground uppercase">
          Press
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">{formatTime(event.lastPressedAt)}</span>
      </div>
    </div>
  );
}

function ConfirmDeleteModal({
  event,
  deleting,
  onCancel,
  onConfirmed,
}: {
  event: GateControlEventRecord;
  deleting: boolean;
  onCancel: () => void;
  onConfirmed: () => void;
}) {
  const { progress, start, cancel } = useHoldToConfirm(HOLD_CONFIRM_MS, onConfirmed);

  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-4 rounded-[20px] border border-border bg-card p-5"
      >
        <div className="space-y-1">
          <h3 className="text-base font-extrabold tracking-tight">Delete this entry?</h3>
          <p className="text-sm text-muted-foreground">
            {capitalize(event.username)} · {event.pressCount} press{event.pressCount === 1 ? "" : "es"} ·{" "}
            {formatTime(event.lastPressedAt)}
          </p>
        </div>

        <button
          type="button"
          disabled={deleting}
          onPointerDown={start}
          onPointerUp={cancel}
          onPointerLeave={cancel}
          onPointerCancel={cancel}
          className="relative h-11 w-full select-none overflow-hidden rounded-[14px] bg-destructive/15 text-sm font-semibold"
        >
          <span
            className="absolute inset-0 origin-left bg-destructive"
            style={{ transform: `scaleX(${progress})`, transition: progress === 0 ? "transform .15s" : "none" }}
          />
          <span className="relative text-white">
            {deleting ? "Deleting…" : "Hold to confirm"}
          </span>
        </button>

        <Button variant="outline" className="w-full" disabled={deleting} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

const monthYearFormat = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

function DateFilterModal({
  value,
  onSelect,
  onClose,
}: {
  value: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const initial = value ? new Date(`${value}T00:00:00`) : new Date();
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());

  const weeks = getMonthGrid(viewYear, viewMonth);
  const today = dateInputValue(new Date());

  const goMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xs space-y-4 rounded-[20px] border border-border bg-card p-5"
      >
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={() => goMonth(-1)} aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm font-extrabold tracking-tight">{monthYearFormat.format(new Date(viewYear, viewMonth, 1))}</span>
          <Button variant="ghost" size="icon" onClick={() => goMonth(1)} aria-label="Next month">
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((label, i) => (
            <span key={i} className="text-center text-xs font-medium text-muted-foreground">
              {label}
            </span>
          ))}
          {weeks.flat().map((cell, i) => {
            const cellValue = dateInputValue(cell.date);
            const selected = cellValue === value;
            const isToday = cellValue === today;
            return (
              <button
                key={i}
                type="button"
                disabled={!cell.inMonth}
                onClick={() => {
                  onSelect(cellValue);
                  onClose();
                }}
                className={`h-8 rounded-md text-sm font-medium ${
                  !cell.inMonth
                    ? "text-transparent"
                    : selected
                      ? "bg-primary text-primary-foreground"
                      : isToday
                        ? "border border-primary text-foreground"
                        : "text-foreground hover:bg-muted"
                }`}
              >
                {cell.date.getDate()}
              </button>
            );
          })}
        </div>

        {value && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              onSelect("");
              onClose();
            }}
          >
            Clear filter
          </Button>
        )}
      </div>
    </div>
  );
}

// Same actual mechanic as GatePressButton's round cap — not just a shadow,
// but a static darker "base" plate sitting behind the button, with the
// button (the "cap") floating CAP_LIFT px above it at rest so a sliver of
// the base peeks out below. Pressing translates the cap down to fully cover
// that sliver, reading as it sinking flush into the base. Flattened onto a
// rectangle here, with no housing-well graphic or glass cover since these
// aren't the safety-critical single press the round button guards.
const CAP_LIFT = 16;

function PressCard({
  pressed,
  baseColor,
  buzzing = false,
  className,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
  ...buttonProps
}: {
  pressed: boolean;
  baseColor: string;
  buzzing?: boolean;
  className: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <div className={`relative ${buzzing ? "animate-buzz" : ""}`} style={{ paddingBottom: CAP_LIFT }}>
      {/* Same decorative outer/inner rings as GatePressButton's round stage —
          static, don't move with the press, just frame the button. */}
      <div className="pointer-events-none absolute rounded-[30px] border border-foreground/10" style={{ inset: -9 }} />
      <div className="pointer-events-none absolute rounded-[25px] border border-dashed border-foreground/15" style={{ inset: -4 }} />
      <div className="absolute inset-x-0 bottom-0 rounded-[22px]" style={{ top: CAP_LIFT, background: baseColor }} />
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onPointerCancel={onPointerCancel}
        style={{
          transform: pressed ? `translateY(${CAP_LIFT}px)` : "translateY(0)",
          transition: "transform .12s",
        }}
        className={`relative w-full select-none ${className}`}
        {...buttonProps}
      />
    </div>
  );
}

type Tab = "control" | "log" | "sound" | "firmware";

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "control", label: "Control" },
  { key: "log", label: "Log" },
  { key: "sound", label: "Sound" },
  { key: "firmware", label: "Firmware" },
];

interface DashboardPageProps {
  username: string | null;
  onLogout: () => void;
}

export function DashboardPage({ username, onLogout }: DashboardPageProps) {
  const { status, events, devices, loading, error, refresh, deleteEvent } = useGateMonitor();
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

  const [ackMessage, setAckMessage] = useState<string | null>(null);
  const [gateMessage, setGateMessage] = useState<string | null>(null);
  const [ackPressed, setAckPressed] = useState(false);
  const [gatePressed, setGatePressed] = useState(false);
  const [tab, setTab] = useState<Tab>("control");
  const [logError, setLogError] = useState<string | null>(null);
  const [confirmEvent, setConfirmEvent] = useState<GateControlEventRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [logDateFilter, setLogDateFilter] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const canDeleteLog = username?.toLowerCase() === LOG_DELETE_USERNAME;
  const filteredEvents = logDateFilter
    ? events.filter((event) => dateInputValue(event.lastPressedAt) === logDateFilter)
    : events;
  const eventDayGroups = groupEventsByDay(filteredEvents);

  const handleConfirmedDelete = async () => {
    if (!confirmEvent) return;
    setDeleting(true);
    try {
      await deleteEvent(confirmEvent.id);
      setConfirmEvent(null);
    } catch {
      setLogError("Couldn't delete that entry");
      window.setTimeout(() => setLogError(null), 4000);
    } finally {
      setDeleting(false);
    }
  };

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
            <img src="/logo.png" alt="" className="size-10 rounded-[12px]" />
            <div>
              <h1 className="text-xl font-extrabold tracking-tight uppercase">
                Gate Sensor
              </h1>
              <p className="font-mono text-xs text-muted-foreground">
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
            <Button
              variant="outline"
              size="icon"
              onClick={onLogout}
              aria-label="Sign out"
            >
              <LogOut />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex gap-2 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className={`relative rounded-full px-4 py-2 font-mono text-xs font-semibold tracking-[.08em] whitespace-nowrap uppercase transition-colors ${
                tab === t.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-muted"
              }`}
            >
              {t.label}
              {t.key === "control" && alertActive && tab !== "control" && (
                <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-destructive" />
              )}
            </button>
          ))}
        </div>

        <div className={tab === "control" ? "space-y-8" : "hidden"}>
        <section className="space-y-3">
          <div
            className={`flex items-center justify-between gap-4 rounded-[22px] p-5 transition-colors ${
              alertActive ? "bg-destructive text-white" : "bg-secondary text-secondary-foreground"
            }`}
          >
            <div className="space-y-1">
              <span className={`font-mono text-[10px] font-medium tracking-[.14em] uppercase ${alertActive ? "text-white/70" : "opacity-60"}`}>
                Controller
              </span>
              <h2 className="text-2xl font-extrabold tracking-tight uppercase">
                {loading && !status ? "Loading…" : alertActive ? "Beam blocked" : "Connected"}
              </h2>
            </div>
            <span className="rounded-full bg-black/10 px-2.5 py-1 font-mono text-[9px] tracking-[.1em] whitespace-nowrap uppercase">
              {status?.updatedAt ? `Last update ${formatTime(status.updatedAt)}` : "Connecting…"}
            </span>
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            {alertActive ? "IR beam blocked — buzzer relay engaged" : "No position sensor — reports beam state only"}
          </p>

          <div className="mx-auto grid max-w-2xl gap-10 sm:grid-cols-2" style={{ marginTop: 48 }}>
            <PressCard
              pressed={ackPressed}
              buzzing={alertActive}
              baseColor={
                alertActive
                  ? "color-mix(in oklab, #f4c33f, black 22%)"
                  : "color-mix(in oklab, #7c6bf5, black 22%)"
              }
              disabled={acknowledging}
              onClick={() => {
                void handleAcknowledge();
              }}
              onPointerDown={() => setAckPressed(true)}
              onPointerUp={() => setAckPressed(false)}
              onPointerLeave={() => setAckPressed(false)}
              onPointerCancel={() => setAckPressed(false)}
              className={`flex min-h-[150px] flex-col items-start justify-center gap-1.5 rounded-[22px] border border-border p-5 text-left disabled:cursor-default disabled:opacity-60 ${
                alertActive ? "bg-[#f4c33f] text-[#0c0c0c]" : "bg-[#7c6bf5] text-[#0c0c0c]"
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <span className="font-mono text-[10px] font-medium tracking-[.14em] text-black/60 uppercase">
                  Sensor buzzer
                </span>
                {acknowledging ? <Loader2 className="size-4 animate-spin" /> : <VolumeX className="size-4" />}
              </div>
              <span className="text-xl font-extrabold tracking-tight uppercase">
                {acknowledging ? "Silencing…" : "Acknowledge"}
              </span>
              <span className="text-xs text-black/60">
                {ackMessage ?? `Silences the buzzer for ${cooldownSeconds}s`}
              </span>
            </PressCard>

            <PressCard
              pressed={gatePressed}
              baseColor="color-mix(in oklab, var(--primary), black 22%)"
              disabled={pulsingGate}
              onClick={() => {
                void handleGatePress();
              }}
              onPointerDown={() => setGatePressed(true)}
              onPointerUp={() => setGatePressed(false)}
              onPointerLeave={() => setGatePressed(false)}
              onPointerCancel={() => setGatePressed(false)}
              className="flex min-h-[150px] flex-col items-start justify-center gap-1.5 rounded-[22px] bg-primary p-5 text-left text-primary-foreground disabled:cursor-default disabled:opacity-60"
            >
              <div className="flex w-full items-center justify-between">
                <span className="font-mono text-[10px] font-medium tracking-[.14em] uppercase opacity-70">Gate control</span>
                {pulsingGate ? <Loader2 className="size-4 animate-spin" /> : <DoorOpen className="size-4" />}
              </div>
              <span className="text-xl font-extrabold tracking-tight uppercase">
                {pulsingGate ? "Sending…" : "Open · Stop · Close"}
              </span>
              <span className="text-xs opacity-70">
                {gateMessage ?? "One press steps the gate — result depends on where it already is"}
              </span>
            </PressCard>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </section>

        <section className="space-y-3">
          <div>
            <SectionLabel>Devices</SectionLabel>
            <h2 className="text-sm font-bold tracking-tight uppercase">Live status</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {devices.length === 0 ? (
              <p className="text-sm text-muted-foreground sm:col-span-2">
                {loading ? "Loading device status..." : "No devices reporting yet"}
              </p>
            ) : (
              devices.map((device) => (
                <div key={device.device} className="flex flex-col gap-2 rounded-[18px] border border-border bg-card p-4">
                  <SectionLabel>{formatDeviceName(device.device)}</SectionLabel>
                  <div className="flex items-center gap-2">
                    <span className={`size-2.5 flex-none rounded-full ${device.online ? "bg-emerald-500" : "bg-destructive"}`} />
                    <span className="text-base font-extrabold tracking-tight uppercase">
                      {device.online ? "Online" : "Offline"}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
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
          </div>
        </section>
        </div>

        <div className={tab === "sound" ? "space-y-8" : "hidden"}>
        {config && (
          <section className="space-y-3">
            <div>
              <SectionLabel>Behaviour settings</SectionLabel>
              <h2 className="text-sm font-bold tracking-tight uppercase">Change how the devices behave</h2>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
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
            </div>
          </section>
        )}
        </div>

        <div className={tab === "log" ? "space-y-8" : "hidden"}>
        <section className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <SectionLabel>Recent events</SectionLabel>
              <h2 className="text-sm font-bold tracking-tight uppercase">Who pressed the gate button</h2>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setDatePickerOpen(true)}>
                <CalendarIcon className="size-3.5" />
                {logDateFilter ? formatDateInputValue(logDateFilter) : "All dates"}
              </Button>
              {logDateFilter && (
                <Button variant="outline" size="icon" onClick={() => setLogDateFilter("")} aria-label="Clear date filter">
                  ×
                </Button>
              )}
            </div>
          </div>
          {filteredEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {loading
                ? "Loading events..."
                : events.length === 0
                  ? "No gate presses recorded yet"
                  : "No presses on that date"}
            </p>
          ) : (
            <div className="max-h-96 space-y-4 overflow-y-auto">
              {eventDayGroups.map((group) => (
                <div key={group.key} className="space-y-2">
                  <p className="font-mono text-[10px] font-semibold tracking-[.12em] text-muted-foreground uppercase">
                    {group.label}
                  </p>
                  <div className="space-y-2">
                    {group.items.map((event) => (
                      <EventRow key={event.id} event={event} canDelete={canDeleteLog} onRequestDelete={setConfirmEvent} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {canDeleteLog && (
            <p className="text-xs text-muted-foreground">Hold an entry to delete it</p>
          )}
          {logError && <p className="text-xs text-destructive">{logError}</p>}
        </section>
        </div>

        <div className={tab === "firmware" ? "space-y-8" : "hidden"}>
        <section className="space-y-3">
          <div>
            <SectionLabel>Firmware</SectionLabel>
            <h2 className="text-sm font-bold tracking-tight uppercase">Upload a .bin to OTA-update a device</h2>
          </div>
          <FirmwarePanel username={username} />
        </section>
        </div>

        {confirmEvent && (
          <ConfirmDeleteModal
            event={confirmEvent}
            deleting={deleting}
            onCancel={() => setConfirmEvent(null)}
            onConfirmed={() => void handleConfirmedDelete()}
          />
        )}

        {datePickerOpen && (
          <DateFilterModal
            value={logDateFilter}
            onSelect={setLogDateFilter}
            onClose={() => setDatePickerOpen(false)}
          />
        )}
      </main>
    </div>
  );
}
