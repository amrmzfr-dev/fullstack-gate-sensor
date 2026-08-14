import { type ReactNode, useEffect, useState } from "react";

import {
  ReceiverSettings,
  TransmitterSettings,
} from "@/components/DeviceSettingsPanel";
import { FirmwarePanel } from "@/components/FirmwarePanel";
import { GatePressButton } from "@/components/GatePressButton";
import { useDeviceConfig } from "@/hooks/useDeviceConfig";
import { useGateMonitor } from "@/hooks/useGateMonitor";
import { capitalize, formatDeviceName, formatTime } from "@/lib/format";
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

type Tab = "control" | "log" | "sound" | "firmware";

// The actual API call often resolves in a few ms, which makes "Signal sent"
// flash too fast to read. Hold the sent state visible for a minimum stretch
// regardless of how quickly the request completes.
const SIGNAL_SENT_DISPLAY_MS = 1500;

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
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

  const [tab, setTab] = useState<Tab>("control");
  const [gateMessage, setGateMessage] = useState<string | null>(null);
  const [signalSentFlash, setSignalSentFlash] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);
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
          {username && (
            <div style={{ width: 44, height: 44, borderRadius: 99, background: "#1B1B1B", border: "1px solid rgba(255,255,255,.1)", display: "flex", alignItems: "center", justifyContent: "center", font: `500 14px ${GK_MONO}`, color: "#fff" }}>
              {initials(username)}
            </div>
          )}
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

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "4px 0" }}>
          <GatePressButton pulsing={sendingSignal} onPress={handleGatePress} />
          {gateMessage && (
            <span style={{ font: `500 10px ${GK_MONO}`, letterSpacing: ".08em", color: "rgba(255,255,255,.5)", textTransform: "uppercase" }}>
              {gateMessage}
            </span>
          )}
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
        <div>
          <H2>Press<br />Log</H2>
          <span style={{ font: `400 11px/1.35 ${GK_SANS}`, color: "rgba(255,255,255,.4)", maxWidth: 260, display: "block" }}>
            Who sent a signal — the controller reports no gate position.
          </span>
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

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 8, paddingBottom: DOCK_CLEARANCE }}>
          {events.length === 0 ? (
            <span style={{ font: `400 12px ${GK_SANS}`, color: "rgba(255,255,255,.4)", textAlign: "center", padding: "24px 0" }}>
              {loading ? "Loading events..." : "No gate presses recorded yet"}
            </span>
          ) : (
            events.map((event) => (
              <div key={event.id} style={{ background: GK_CARD, border: `1px solid ${GK_HAIR}`, borderRadius: 18, padding: "13px 14px", display: "flex", alignItems: "center", gap: 12 }}>
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
            ))
          )}
        </div>
      </div>

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
