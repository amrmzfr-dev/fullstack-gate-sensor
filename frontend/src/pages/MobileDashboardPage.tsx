import { type ReactNode, useEffect, useState } from "react";

import {
  ReceiverSettings,
  TransmitterSettings,
} from "@/components/DeviceSettingsPanel";
import { FirmwarePanel } from "@/components/FirmwarePanel";
import { GatePressButton } from "@/components/GatePressButton";
import { useDeviceConfig } from "@/hooks/useDeviceConfig";
import { useGateMonitor } from "@/hooks/useGateMonitor";
import { useHoldToConfirm } from "@/hooks/useHoldToConfirm";
import { useLongPress } from "@/hooks/useLongPress";
import { capitalize, dateInputValue, dayKey, formatDateInputValue, formatDay, formatDeviceName, formatTime } from "@/lib/format";
import { getMonthGrid, WEEKDAY_LABELS } from "@/lib/calendar";
import {
  GK_ACCENT,
  GK_CARD,
  GK_CREAM,
  GK_HAIR,
  GK_INK,
  GK_LIME,
  GK_MONO,
  GK_SANS,
  GK_VIOLET,
  GK_YELLOW,
} from "@/lib/gatekeepTheme";
import type { GateControlEventRecord } from "@/types";

type Tab = "control" | "log" | "sound" | "firmware";

// The actual API call often resolves in a few ms, which makes "Signal sent"
// flash too fast to read. Hold the sent state visible for a minimum stretch
// regardless of how quickly the request completes.
const SIGNAL_SENT_DISPLAY_MS = 1500;

// How long the "Hold to confirm" button in the delete modal must be held
// before the delete actually fires.
const HOLD_CONFIRM_MS = 2000;

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

// Only this one account can see/use the log's delete button — see
// GateController.DeleteControlEventAsync on the backend, which enforces the
// same restriction regardless of what the frontend shows.
const LOG_DELETE_USERNAME = "amir";

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
      style={{
        background: GK_CARD, border: `1px solid ${GK_HAIR}`, borderRadius: 18, padding: "13px 14px",
        display: "flex", alignItems: "center", gap: 12,
        touchAction: canDelete ? "pan-y" : undefined,
        WebkitUserSelect: canDelete ? "none" : undefined,
        userSelect: canDelete ? "none" : undefined,
      }}
    >
      <div style={{ width: 38, height: 38, borderRadius: 11, background: GK_CREAM, display: "flex", alignItems: "center", justifyContent: "center", font: `600 12px ${GK_MONO}`, color: GK_INK, flex: "none" }}>
        {initials(event.username)}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ font: `700 15px/1.1 ${GK_SANS}`, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {capitalize(event.username)}
        </span>
        <span style={{ font: `400 11px/1.2 ${GK_SANS}`, color: "rgba(255,255,255,.45)" }}>
          {event.pressCount} press{event.pressCount === 1 ? "" : "es"}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flex: "none" }}>
        <span style={{ padding: "4px 8px", borderRadius: 99, background: GK_CREAM, font: `500 9px ${GK_MONO}`, letterSpacing: ".08em", color: GK_INK }}>PRESS</span>
        <span style={{ font: `500 10px ${GK_MONO}`, color: "rgba(255,255,255,.4)" }}>{formatTime(event.lastPressedAt)}</span>
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
      style={{
        position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,.65)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 300, background: GK_CARD, border: `1px solid ${GK_HAIR}`,
          borderRadius: 20, padding: 20, display: "flex", flexDirection: "column", gap: 16,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ font: `800 17px ${GK_SANS}`, color: "#fff", letterSpacing: "-.02em" }}>
            Delete this entry?
          </span>
          <span style={{ font: `400 12px/1.4 ${GK_SANS}`, color: "rgba(255,255,255,.5)" }}>
            {capitalize(event.username)} · {event.pressCount} press{event.pressCount === 1 ? "" : "es"} · {formatTime(event.lastPressedAt)}
          </span>
        </div>

        <button
          type="button"
          disabled={deleting}
          onPointerDown={start}
          onPointerUp={cancel}
          onPointerLeave={cancel}
          onPointerCancel={cancel}
          style={{
            position: "relative", height: 46, borderRadius: 14, border: "none", overflow: "hidden",
            background: "rgba(255,91,65,.14)", cursor: deleting ? "default" : "pointer", userSelect: "none",
          }}
        >
          <div
            style={{
              position: "absolute", inset: 0, background: GK_ACCENT, transformOrigin: "left",
              transform: `scaleX(${progress})`, transition: progress === 0 ? "transform .15s" : "none",
            }}
          />
          <span style={{ position: "relative", font: `800 13px ${GK_SANS}`, letterSpacing: ".02em", textTransform: "uppercase", color: "#fff" }}>
            {deleting ? "Deleting…" : "Hold to confirm"}
          </span>
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={deleting}
          style={{
            height: 40, borderRadius: 14, border: `1px solid ${GK_HAIR}`, background: "transparent",
            color: "rgba(255,255,255,.6)", font: `600 12px ${GK_SANS}`, cursor: "pointer",
          }}
        >
          Cancel
        </button>
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
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,.65)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 300, background: GK_CARD, border: `1px solid ${GK_HAIR}`,
          borderRadius: 20, padding: 18, display: "flex", flexDirection: "column", gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            type="button"
            onClick={() => goMonth(-1)}
            aria-label="Previous month"
            style={{ width: 30, height: 30, borderRadius: 99, border: "none", background: "rgba(255,255,255,.06)", color: "#fff", cursor: "pointer" }}
          >
            ‹
          </button>
          <span style={{ font: `700 13px ${GK_SANS}`, color: "#fff", textTransform: "uppercase", letterSpacing: "-.01em" }}>
            {monthYearFormat.format(new Date(viewYear, viewMonth, 1))}
          </span>
          <button
            type="button"
            onClick={() => goMonth(1)}
            aria-label="Next month"
            style={{ width: 30, height: 30, borderRadius: 99, border: "none", background: "rgba(255,255,255,.06)", color: "#fff", cursor: "pointer" }}
          >
            ›
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {WEEKDAY_LABELS.map((label, i) => (
            <span key={i} style={{ textAlign: "center", font: `600 9px ${GK_MONO}`, color: "rgba(255,255,255,.32)", textTransform: "uppercase" }}>
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
                style={{
                  height: 32, borderRadius: 10,
                  border: isToday && !selected ? `1px solid ${GK_ACCENT}` : "1px solid transparent",
                  background: selected ? GK_ACCENT : "transparent",
                  color: !cell.inMonth ? "rgba(255,255,255,.15)" : selected ? GK_INK : "#fff",
                  font: `600 12px ${GK_SANS}`, cursor: cell.inMonth ? "pointer" : "default",
                }}
              >
                {cell.date.getDate()}
              </button>
            );
          })}
        </div>

        {value && (
          <button
            type="button"
            onClick={() => {
              onSelect("");
              onClose();
            }}
            style={{
              height: 38, borderRadius: 12, border: `1px solid ${GK_HAIR}`, background: "transparent",
              color: "rgba(255,255,255,.6)", font: `600 12px ${GK_SANS}`, cursor: "pointer",
            }}
          >
            Clear filter
          </button>
        )}
      </div>
    </div>
  );
}

// The dock floats fixed over content now (not a layout sibling reserving its
// own space), so every scrollable area needs real bottom clearance or its
// last bit of content would end up hidden behind the dock.
const DOCK_CLEARANCE = "calc(96px + env(safe-area-inset-bottom))";

const screenPad: React.CSSProperties = {
  padding: `calc(env(safe-area-inset-top) + 22px) 22px ${DOCK_CLEARANCE}`,
  display: "flex",
  flexDirection: "column",
  gap: 11,
  flex: 1,
  minHeight: 0,
};

function H2({ children }: { children: ReactNode }) {
  return (
    <h2 style={{ margin: 0, font: `800 31px/.92 ${GK_SANS}`, letterSpacing: "-.03em", color: "#fff", textTransform: "uppercase" }}>
      {children}
    </h2>
  );
}

function Label({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return (
    <span
      style={{
        font: `500 10px/1.4 ${GK_MONO}`, letterSpacing: ".14em", textTransform: "uppercase",
        color: dark ? "rgba(12,12,12,.7)" : "rgba(255,255,255,.4)", whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Switch({ on, track, knob }: { on: boolean; track: string; knob: string }) {
  return (
    <div
      style={{
        width: 56, height: 32, borderRadius: 99, background: on ? track : "#2A2A2A",
        padding: 3, boxSizing: "border-box", display: "flex",
        justifyContent: on ? "flex-end" : "flex-start", flex: "none", transition: "all .25s",
      }}
    >
      <div style={{ width: 26, height: 26, borderRadius: 99, background: on ? knob : "rgba(255,255,255,.5)" }} />
    </div>
  );
}

const TABS: ReadonlyArray<{ key: Tab; glyph: string; color: string }> = [
  { key: "control", glyph: "▣", color: GK_ACCENT },
  { key: "log", glyph: "≡", color: GK_VIOLET },
  { key: "sound", glyph: "◎", color: GK_YELLOW },
  { key: "firmware", glyph: "↥", color: GK_CREAM },
];

function Dock({ tab, onChange, alertActive }: { tab: Tab; onChange: (t: Tab) => void; alertActive: boolean }) {
  return (
    <div
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50,
        padding: "10px 22px calc(env(safe-area-inset-bottom) + 20px)",
        display: "flex", justifyContent: "center", pointerEvents: "none",
      }}
    >
      <div style={{ pointerEvents: "auto", display: "flex", gap: 6, background: "#1A1A1A", border: "1px solid rgba(255,255,255,.09)", borderRadius: 20, padding: 7 }}>
        {TABS.map((it) => {
          const on = tab === it.key;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => onChange(it.key)}
              aria-label={it.key}
              aria-current={on ? "page" : undefined}
              style={{
                position: "relative", width: 52, height: 44, borderRadius: 14, border: "none", cursor: "pointer",
                background: on ? it.color : "transparent",
                color: on ? GK_INK : "rgba(255,255,255,.4)", fontSize: 18,
              }}
            >
              {it.glyph}
              {it.key === "control" && alertActive && !on && (
                <span style={{ position: "absolute", right: 8, top: 6, width: 7, height: 7, borderRadius: 99, background: GK_ACCENT }} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface MobileDashboardPageProps {
  username: string | null;
  onLogout: () => void;
}

export function MobileDashboardPage({ username, onLogout }: MobileDashboardPageProps) {
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

  const [tab, setTab] = useState<Tab>("control");
  const [gateMessage, setGateMessage] = useState<string | null>(null);
  const [signalSentFlash, setSignalSentFlash] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [confirmEvent, setConfirmEvent] = useState<GateControlEventRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [logDateFilter, setLogDateFilter] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [silencedUntil, setSilencedUntil] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (silencedUntil === null) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [silencedUntil]);

  const handleGatePress = async () => {
    setSignalSentFlash(true);
    window.setTimeout(() => setSignalSentFlash(false), SIGNAL_SENT_DISPLAY_MS);
    try {
      await pulseGate();
      setGateMessage("Signal sent to the gate");
    } catch {
      setGateMessage("Couldn't reach the gate controller");
    }
    window.setTimeout(() => setGateMessage(null), 4000);
  };

  const sendingSignal = pulsingGate || signalSentFlash;
  const alertActive = status?.alertActive ?? false;
  const cooldownMs = config?.receiver.acknowledgeCooldownMs ?? 30000;
  const cooldownSeconds = Math.round(cooldownMs / 1000);
  const isSilenced = silencedUntil !== null && nowTick < silencedUntil;
  const silenceRemainingSec = isSilenced ? Math.max(0, Math.round((silencedUntil! - nowTick) / 1000)) : 0;

  const handleAcknowledge = async () => {
    if (!alertActive || isSilenced || acknowledging) return;
    try {
      await acknowledge();
      setSilencedUntil(Date.now() + cooldownMs);
      setNowTick(Date.now());
    } catch {
      setAckError("Couldn't reach the receiver to silence it");
      window.setTimeout(() => setAckError(null), 5000);
    }
  };

  const totalPresses = events.reduce((sum, event) => sum + event.pressCount, 0);
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

  const controllerBg = alertActive ? GK_ACCENT : sendingSignal ? GK_YELLOW : GK_CREAM;
  const controllerTitle = loading && !status ? "Loading…" : alertActive ? "Beam blocked" : sendingSignal ? "Signal sent" : "Connected";
  const controllerSub = alertActive ? "IR beam blocked — buzzer relay engaged" : "No position sensor — reports beam state only";

  const gateDevices = devices.map((d) => ({
    role: formatDeviceName(d.device),
    state: d.online ? "Online" : "Offline",
    dot: d.online ? GK_LIME : GK_ACCENT,
    fg: d.online ? "#fff" : GK_ACCENT,
    border: d.online ? "rgba(168,224,99,.35)" : "rgba(255,255,255,.14)",
    meta: d.online
      ? d.firmwareVersion
        ? `Firmware ${d.firmwareVersion}`
        : "Reporting"
      : d.lastSeenAt
        ? `No reply · last seen ${formatTime(d.lastSeenAt)}`
        : "No reply yet",
  }));

  const buzzerBg = isSilenced ? GK_VIOLET : alertActive ? GK_ACCENT : GK_CARD;
  const buzzerTitle = isSilenced ? "Silenced" : alertActive ? "Alert active" : "Armed";
  const buzzerHint = isSilenced
    ? `Resumes in ${silenceRemainingSec}s`
    : alertActive
      ? `Tap to silence for ${cooldownSeconds}s`
      : "Chimes on beam trip";
  const buzzerTextDim = alertActive || isSilenced ? "rgba(12,12,12,.65)" : "rgba(255,255,255,.42)";
  const buzzerTextMain = alertActive || isSilenced ? GK_INK : "#fff";

  return (
    <div style={{ height: "100dvh", background: GK_INK, display: "flex", flexDirection: "column", fontFamily: GK_SANS, overflow: "hidden", touchAction: "pan-y" }}>
      {/* Every tab stays mounted (hidden) so unsaved settings edits survive tab switches. */}
      <div style={{ ...screenPad, display: tab === "control" ? "flex" : "none", overflowY: "auto", overflowX: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <Label>Front driveway</Label>
            <H2>Gate<br />Control</H2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {username && (
              <div style={{ width: 44, height: 44, borderRadius: 99, background: "#1B1B1B", border: "1px solid rgba(255,255,255,.1)", display: "flex", alignItems: "center", justifyContent: "center", font: `500 14px ${GK_MONO}`, color: "#fff" }}>
                {initials(username)}
              </div>
            )}
            <button
              type="button"
              onClick={onLogout}
              aria-label="Sign out"
              style={{
                width: 36, height: 36, borderRadius: 99, background: "#1B1B1B",
                border: "1px solid rgba(255,255,255,.1)", color: GK_ACCENT, fontSize: 15,
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flex: "none",
              }}
            >
              ⏻
            </button>
          </div>
        </div>

        <div style={{ background: controllerBg, borderRadius: 22, padding: "15px 17px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, transition: "background .3s" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <Label dark>Controller</Label>
            <span style={{ font: `800 20px/1 ${GK_SANS}`, letterSpacing: "-.02em", color: GK_INK, textTransform: "uppercase" }}>
              {controllerTitle}
            </span>
          </div>
          <span style={{ padding: "5px 9px", borderRadius: 99, background: "rgba(12,12,12,.14)", font: `500 9px ${GK_MONO}`, letterSpacing: ".1em", color: "rgba(12,12,12,.75)", whiteSpace: "nowrap" }}>
            {status?.updatedAt ? `LAST UPDATE ${formatTime(status.updatedAt).toUpperCase()}` : "CONNECTING…"}
          </span>
        </div>
        <span style={{ font: `400 10px/1.4 ${GK_MONO}`, color: "rgba(255,255,255,.36)" }}>{controllerSub}</span>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
          {gateDevices.length === 0 ? (
            <span style={{ gridColumn: "1 / -1", font: `400 11px ${GK_SANS}`, color: "rgba(255,255,255,.4)" }}>
              {loading ? "Loading device status..." : "No devices reporting yet"}
            </span>
          ) : (
            gateDevices.map((d) => (
              <div key={d.role} style={{ background: GK_CARD, border: `1px solid ${d.border}`, borderRadius: 18, padding: "13px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
                <Label>{d.role}</Label>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <div style={{ width: 9, height: 9, borderRadius: 99, background: d.dot, flex: "none" }} />
                  <span style={{ font: `800 16px/1 ${GK_SANS}`, letterSpacing: "-.02em", color: d.fg, textTransform: "uppercase" }}>{d.state}</span>
                </div>
                <span style={{ font: `400 10px/1.35 ${GK_SANS}`, color: "rgba(255,255,255,.4)" }}>{d.meta}</span>
              </div>
            ))
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "4px 0", marginTop: 10 }}>
          <GatePressButton pulsing={sendingSignal} onPress={handleGatePress} />
          {/* Fixed-height slot (not conditionally rendered) so the buzzer
              card below never shifts when this message appears/disappears. */}
          <div style={{ height: 14, display: "flex", alignItems: "center" }}>
            <span style={{ font: `500 10px ${GK_MONO}`, letterSpacing: ".08em", color: "rgba(255,255,255,.5)", textTransform: "uppercase", opacity: gateMessage ? 1 : 0 }}>
              {gateMessage || " "}
            </span>
          </div>
        </div>

        <div
          onClick={() => {
            void handleAcknowledge();
          }}
          style={{
            background: buzzerBg, borderRadius: 22, padding: "15px 17px", display: "flex",
            alignItems: "center", justifyContent: "space-between",
            cursor: alertActive && !isSilenced ? "pointer" : "default",
            border: "1px solid rgba(255,255,255,.08)", transition: "background .25s",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ font: `500 10px/1 ${GK_MONO}`, letterSpacing: ".14em", color: buzzerTextDim, textTransform: "uppercase" }}>Sensor buzzer</span>
            <span style={{ font: `800 19px/1 ${GK_SANS}`, letterSpacing: "-.02em", color: buzzerTextMain, textTransform: "uppercase" }}>{buzzerTitle}</span>
            <span style={{ font: `400 11px/1.3 ${GK_SANS}`, color: buzzerTextDim }}>{acknowledging ? "Silencing…" : buzzerHint}</span>
          </div>
          <Switch on={isSilenced} track={GK_INK} knob={GK_VIOLET} />
        </div>

        {(error || ackError) && (
          <span style={{ font: `400 11px ${GK_SANS}`, color: GK_ACCENT }}>{error ?? ackError}</span>
        )}
        <div style={{ height: 8 }} />
      </div>

      <div style={{ ...screenPad, display: tab === "log" ? "flex" : "none", overflowY: "auto", overflowX: "hidden" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div>
            <H2>Press<br />Log</H2>
            <span style={{ font: `400 11px/1.35 ${GK_SANS}`, color: "rgba(255,255,255,.4)", maxWidth: 220, display: "block" }}>
              Who sent a signal — the controller reports no gate position.
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "none" }}>
            <button
              type="button"
              onClick={() => setDatePickerOpen(true)}
              aria-label="Filter the log by date"
              style={{
                height: 38, borderRadius: 12, border: `1px solid ${GK_HAIR}`, background: GK_CARD,
                color: logDateFilter ? "#fff" : "rgba(255,255,255,.5)", font: `600 11px ${GK_MONO}`,
                letterSpacing: ".02em", padding: "0 12px", cursor: "pointer", display: "flex",
                alignItems: "center", gap: 6, whiteSpace: "nowrap",
              }}
            >
              {logDateFilter ? formatDateInputValue(logDateFilter) : "All dates"}
              <span style={{ fontSize: 9, color: "rgba(255,255,255,.4)" }}>▾</span>
            </button>
            {logDateFilter && (
              <button
                type="button"
                onClick={() => setLogDateFilter("")}
                aria-label="Clear date filter"
                style={{
                  width: 30, height: 30, borderRadius: 99, border: `1px solid ${GK_HAIR}`, background: GK_CARD,
                  color: "rgba(255,255,255,.5)", fontSize: 13, cursor: "pointer", flex: "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                ×
              </button>
            )}
          </div>
        </div>

        {events.length > 0 && (
          <div style={{ background: GK_VIOLET, borderRadius: 22, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
            <Label dark>All-time</Label>
            <span style={{ font: `900 32px/.9 ${GK_SANS}`, letterSpacing: "-.04em", color: GK_INK }}>{totalPresses} presses</span>
            <span style={{ font: `400 11px ${GK_SANS}`, color: "rgba(12,12,12,.7)" }}>
              {events.length} {events.length === 1 ? "person" : "people"}
            </span>
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 16, paddingBottom: DOCK_CLEARANCE }}>
          {filteredEvents.length === 0 ? (
            <span style={{ font: `400 12px ${GK_SANS}`, color: "rgba(255,255,255,.4)", textAlign: "center", padding: "24px 0" }}>
              {loading
                ? "Loading events..."
                : events.length === 0
                  ? "No gate presses recorded yet"
                  : "No presses on that date"}
            </span>
          ) : (
            eventDayGroups.map((group) => (
              <div key={group.key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ font: `600 10px ${GK_MONO}`, letterSpacing: ".12em", textTransform: "uppercase", color: "rgba(255,255,255,.32)" }}>
                  {group.label}
                </span>
                {group.items.map((event) => (
                  <EventRow key={event.id} event={event} canDelete={canDeleteLog} onRequestDelete={setConfirmEvent} />
                ))}
              </div>
            ))
          )}
        </div>
        {canDeleteLog && (
          <span style={{ font: `400 10px/1.4 ${GK_MONO}`, color: "rgba(255,255,255,.3)", textAlign: "center" }}>
            Hold an entry to delete it
          </span>
        )}
        {logError && (
          <span style={{ font: `400 11px ${GK_SANS}`, color: GK_ACCENT }}>{logError}</span>
        )}
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

      <div style={{ ...screenPad, display: tab === "sound" ? "flex" : "none", overflowY: "auto", overflowX: "hidden" }}>
        <H2>Sensor<br />Sound</H2>
        {config ? (
          <>
            <ReceiverSettings initial={config.receiver} saving={saving === "receiver"} onSave={saveReceiver} onTest={testBuzzer} styled />
            <TransmitterSettings initial={config.transmitter} saving={saving === "transmitter"} onSave={saveTransmitter} styled />
          </>
        ) : (
          <span style={{ font: `400 12px ${GK_SANS}`, color: "rgba(255,255,255,.4)" }}>Loading device settings...</span>
        )}

        <div
          onClick={onLogout}
          style={{
            background: GK_CARD, border: `1px solid ${GK_HAIR}`, borderRadius: 18, padding: "13px 15px",
            display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ font: `700 14px/1.1 ${GK_SANS}`, color: GK_ACCENT }}>Sign out</span>
            <span style={{ font: `400 11px/1.2 ${GK_SANS}`, color: "rgba(255,255,255,.42)" }}>
              {username ? `Signed in as ${capitalize(username)}` : "End this session"}
            </span>
          </div>
          <span style={{ fontSize: 16, color: GK_ACCENT }}>⏻</span>
        </div>
        <div style={{ height: 8 }} />
      </div>

      <div style={{ ...screenPad, display: tab === "firmware" ? "flex" : "none", overflowY: "auto", overflowX: "hidden" }}>
        <H2>Firmware<br />Update</H2>
        <FirmwarePanel username={username} styled />
      </div>

      <Dock tab={tab} onChange={setTab} alertActive={alertActive} />
    </div>
  );
}
