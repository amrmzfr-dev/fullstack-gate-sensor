import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { GK_ACCENT, GK_INK, GK_MONO, GK_SANS } from "@/lib/gatekeepTheme";

// Steps the button walks through on each press. The controller is a dry relay
// with no position feedback, so this is only a local hint — never a claim
// about where the gate actually is. It goes stale after a few minutes idle,
// since a fob or keypad press elsewhere would silently invalidate it.
const STEPS = ["OPEN", "STOP", "CLOSE", "STOP"] as const;
const STALE_SECONDS = 3 * 60;

// Glass safety cover: physically blocks the button until slid open. Slide
// only — no tap shortcut. Re-latches 1.4s after a press, or after 8s idle
// with nothing pressed.
// 3px larger than the reference on every edge.
const COVER_W = 178;
const COVER_H = 178;
const COVER_OPEN_X = 200;
const COVER_OPEN_THRESHOLD = 0.45;
const RELOCK_IDLE_MS = 8_000;
const RELOCK_AFTER_PRESS_MS = 1_400;
const CYL = 15;

interface GatePressButtonProps {
  pulsing: boolean;
  onPress: () => void | Promise<void>;
}

export function GatePressButton({ pulsing, onPress }: GatePressButtonProps) {
  const [presses, setPresses] = useState(0);
  const [lastPressAt, setLastPressAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pressed, setPressed] = useState(false);

  const [coverOpen, setCoverOpen] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const relockTimer = useRef<number | null>(null);

  useEffect(() => {
    if (lastPressAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [lastPressAt]);

  const clearRelockTimer = useCallback(() => {
    if (relockTimer.current !== null) {
      window.clearTimeout(relockTimer.current);
      relockTimer.current = null;
    }
  }, []);

  const closeCover = useCallback(() => {
    relockTimer.current = null;
    setCoverOpen(false);
    setDragX(0);
  }, []);

  const armRelock = useCallback(
    (ms: number) => {
      clearRelockTimer();
      relockTimer.current = window.setTimeout(closeCover, ms);
    },
    [clearRelockTimer, closeCover],
  );

  useEffect(() => clearRelockTimer, [clearRelockTimer]);

  // Window-level listeners in the capture phase so a parent scroll container
  // never steals the drag once it has started on the cover. dragX/baseX are
  // both absolute positions (0 = closed, COVER_OPEN_X = open) so the same
  // handler drives sliding it open from closed AND sliding it back closed
  // by hand from open — direction just falls out of which edge the drag
  // ends up closer to.
  const baseX = useRef(0);

  const onCoverPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    startX.current = e.clientX;
    baseX.current = coverOpen ? COVER_OPEN_X : 0;
    setDragX(baseX.current);
    setDragging(true);

    // touch-action:none and preventDefault() on the pointer events are not
    // reliably enough on their own to stop mobile Safari/Chrome from also
    // starting a native page-pan gesture for the same finger movement —
    // this directly blocks the underlying touchmove for the duration of the
    // drag, which is the part that actually pans the viewport. Must be a
    // real (non-React) listener registered as non-passive, since passive
    // touchmove listeners can't call preventDefault() at all.
    const blockTouchScroll = (ev: TouchEvent) => {
      ev.preventDefault();
    };
    document.addEventListener("touchmove", blockTouchScroll, { passive: false, capture: true });

    const move = (ev: PointerEvent) => {
      ev.preventDefault();
      setDragX(Math.max(0, Math.min(COVER_OPEN_X, baseX.current + (ev.clientX - startX.current))));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      document.removeEventListener("touchmove", blockTouchScroll, true);
      setDragging(false);
      const final = Math.max(0, Math.min(COVER_OPEN_X, baseX.current + (ev.clientX - startX.current)));
      const open = final > COVER_OPEN_X * COVER_OPEN_THRESHOLD;
      setCoverOpen(open);
      setDragX(0);
      if (open) armRelock(RELOCK_IDLE_MS);
      else clearRelockTimer();
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  };

  const handleClick = () => {
    if (!coverOpen || pulsing) return;
    const pressedAt = Date.now();
    setPresses((p) => p + 1);
    setLastPressAt(pressedAt);
    setNow(pressedAt);
    armRelock(RELOCK_AFTER_PRESS_MS);
    void onPress();
  };

  const secsAgo = lastPressAt === null ? null : Math.max(0, Math.round((now - lastPressAt) / 1000));
  const stale = presses > 0 && secsAgo !== null && secsAgo > STALE_SECONDS;
  const idx = presses === 0 || stale ? -1 : (presses - 1) % STEPS.length;
  const nextIdx = idx === -1 ? -1 : (idx + 1) % STEPS.length;

  const ago = (s: number | null) => (s === null ? "" : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`);

  const rim = `color-mix(in oklab, ${GK_ACCENT} 62%, #000)`;
  const rim2 = `color-mix(in oklab, ${GK_ACCENT} 40%, #000)`;
  const capShadow = pressed
    ? "inset 0 8px 16px rgba(0,0,0,.5)"
    : `inset 0 3px 0 rgba(255,255,255,.45), inset 0 -6px 12px rgba(0,0,0,.18),0 4px 0 ${rim},0 8px 0 ${rim},0 12px 0 ${rim2},0 ${CYL}px 0 ${rim2},0 22px 22px rgba(0,0,0,.55)`;
  const housingShadow = pressed
    ? "inset 0 10px 20px rgba(0,0,0,.6)"
    : `0 4px 0 ${rim},0 8px 0 ${rim},0 12px 0 ${rim2},0 ${CYL}px 0 ${rim2},0 22px 22px rgba(0,0,0,.55),inset 0 8px 16px rgba(0,0,0,.55)`;

  const sub = pulsing
    ? "Sending…"
    : !coverOpen
      ? "Covered"
      : nextIdx === -1
        ? "Open · stop · close"
        : `Next: ${STEPS[nextIdx].toLowerCase()}`;

  const footer = !coverOpen
    ? "Safety cover closed · slide the glass to arm the button"
    : nextIdx === -1
      ? "Each press steps the gate to its next state · a press after a stop reverses it"
      : `Sent ${ago(secsAgo)} · next press should ${STEPS[nextIdx].toLowerCase()}${
          nextIdx % 2 ? " the gate mid-travel" : " it"
        }`;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <div
        style={{
          position: "relative",
          width: 314,
          height: 186,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "absolute", left: "50%", top: "50%", width: 188, height: 188,
            margin: "-96px 0 0 -94px", borderRadius: 99, border: "1px solid rgba(255,255,255,.09)",
          }}
        />
        <div
          style={{
            position: "absolute", left: "50%", top: "50%", width: 162, height: 162,
            margin: "-83px 0 0 -81px", borderRadius: 99, border: "1px dashed rgba(255,255,255,.12)",
          }}
        />
        {/* static cylinder housing: the cap sinks INTO this */}
        <div
          style={{
            position: "absolute", left: "50%", top: "50%", width: 154, height: 154,
            margin: "-77px 0 0 -77px", borderRadius: 99, background: rim2,
            boxShadow: housingShadow, transition: "box-shadow .12s",
          }}
        />
        {pulsing && (
          <div
            style={{
              position: "absolute", width: 154, height: 154, borderRadius: 99,
              background: GK_ACCENT, animation: "gcPulse 1.1s ease-out infinite",
            }}
          />
        )}

        <button
          type="button"
          onClick={handleClick}
          onPointerDown={() => setPressed(true)}
          onPointerUp={() => setPressed(false)}
          onPointerLeave={() => setPressed(false)}
          onPointerCancel={() => setPressed(false)}
          disabled={pulsing}
          style={{
            position: "relative", width: 154, height: 154, borderRadius: 99, border: "none",
            background: GK_ACCENT, display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: 5, cursor: "pointer", userSelect: "none", boxShadow: capShadow,
            transform: pressed ? "translateY(7px)" : "translateY(-8px)",
            transition: "background .12s, box-shadow .12s, transform .12s",
          }}
        >
          <span style={{ fontSize: 30, lineHeight: 1, color: GK_INK }}>◉</span>
          <span style={{ font: `900 23px/.9 ${GK_SANS}`, letterSpacing: "-.03em", color: GK_INK, textTransform: "uppercase" }}>
            Press
          </span>
          <span
            style={{
              font: `500 9px/1.3 ${GK_MONO}`, letterSpacing: ".1em", color: "rgba(12,12,12,.62)",
              textTransform: "uppercase", textAlign: "center",
            }}
          >
            {sub}
          </span>
        </button>

        {/* Clip boundary for the glass only — not the button/rings/stage, and
            not any other content on the screen. Sized generously wider than
            the glass could ever travel (its real max reach is well under
            300px from center) so it never visibly triggers; it exists only
            to satisfy the same close-ancestor overflow:hidden that actually
            stops the page itself from being draggable while the cover is
            open (plain page-root overflow:hidden alone did not — confirmed
            by several failed attempts). Absolutely positioned so its width
            can't force the page, or any of the surrounding UI's normal
            spacing, wider. */}
        <div
          style={{
            position: "absolute", width: 700,
            // 18px taller than the cover itself: its decorative "glass
            // thickness" bottom lip extends 15px below the cover's own
            // box for the 3D-depth look, which this clip box was cutting
            // off since it matched the cover's height exactly.
            height: COVER_H + 18,
            left: "50%", top: "50%",
            marginLeft: -89, marginTop: -101,
            overflow: "hidden", zIndex: 5, pointerEvents: "none",
          }}
        >
          <div
            role="button"
            tabIndex={0}
            aria-label={coverOpen ? "Slide the safety cover back closed" : "Slide open the safety cover to arm the gate button"}
            aria-pressed={coverOpen}
            onPointerDown={onCoverPointerDown}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              if (coverOpen) {
                clearRelockTimer();
                setCoverOpen(false);
              } else {
                setCoverOpen(true);
                armRelock(RELOCK_IDLE_MS);
              }
              setDragX(0);
            }}
            style={{
              // Same size/start position the glass has always had — only the
              // clipping box around it got wider, not the glass itself.
              position: "absolute", left: 0, top: 0, width: COVER_W, height: COVER_H,
              cursor: "grab", touchAction: "none", userSelect: "none", outline: "none",
              pointerEvents: "auto",
              transform: `translateX(${dragging ? dragX : coverOpen ? COVER_OPEN_X : 0}px)`,
              transition: dragging ? "none" : "transform .34s cubic-bezier(.3,.9,.3,1)",
            }}
          >
            {/* glass thickness */}
            <div
              style={{
                position: "absolute", left: 3, right: 3, bottom: -15, height: 26,
                borderRadius: "0 0 15px 15px",
                background: "linear-gradient(180deg,rgba(214,238,248,.34),rgba(120,152,168,.26) 60%,rgba(12,12,12,.5))",
                border: "1px solid rgba(255,255,255,.22)", borderTop: "none", boxSizing: "border-box",
              }}
            />
            {/* lid */}
            <div
              style={{
                position: "absolute", inset: 0, borderRadius: 14, boxSizing: "border-box", overflow: "hidden",
                background:
                  "linear-gradient(128deg,rgba(255,255,255,.46) 0%,rgba(214,238,248,.20) 34%,rgba(214,238,248,.12) 58%,rgba(255,255,255,.30) 100%)",
                border: "1px solid rgba(255,255,255,.6)",
                boxShadow:
                  "inset 0 2px 12px rgba(255,255,255,.45),inset 0 -14px 26px rgba(0,0,0,.16),0 4px 0 rgba(214,238,248,.3),0 8px 0 rgba(180,210,224,.26),0 12px 0 rgba(120,152,168,.3),0 15px 0 rgba(12,12,12,.6),0 22px 26px rgba(0,0,0,.5)",
                backdropFilter: "blur(7px) saturate(1.25)",
                WebkitBackdropFilter: "blur(7px) saturate(1.25)",
                display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 14,
              }}
            >
              <div
                style={{
                  position: "absolute", left: 14, top: 16, right: 46, height: 2, borderRadius: 2,
                  background: "linear-gradient(90deg,rgba(255,255,255,.75),rgba(255,255,255,0))",
                }}
              />
              <div
                style={{
                  position: "absolute", left: "-10%", top: "-20%", width: "46%", height: "150%",
                  transform: "rotate(24deg)",
                  background: "linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.22),rgba(255,255,255,0))",
                }}
              />
              <div
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 99,
                  background: "rgba(12,12,12,.4)", border: "1px solid rgba(255,255,255,.28)",
                }}
              >
                <span
                  style={{
                    font: `500 8.5px/1 ${GK_MONO}`, letterSpacing: ".16em", color: "rgba(255,255,255,.92)",
                    textTransform: "uppercase", whiteSpace: "nowrap",
                  }}
                >
                  Slide cover
                </span>
                <span style={{ fontSize: 13, lineHeight: 1, color: "rgba(255,255,255,.92)" }}>›››</span>
              </div>
              <div
                style={{
                  position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)",
                  width: 13, height: 56, borderRadius: 6, background: "rgba(255,255,255,.26)",
                  border: "1px solid rgba(255,255,255,.45)",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        {STEPS.map((step, i) => (
          <div key={`${step}-${i}`} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div
              style={{
                padding: "5px 9px", borderRadius: 99,
                background: i === nextIdx ? GK_ACCENT : "#1A1A1A",
                border: `1px solid ${i === nextIdx ? GK_ACCENT : "rgba(255,255,255,.1)"}`,
                font: `500 9px ${GK_MONO}`, letterSpacing: ".1em",
                color: i === nextIdx ? GK_INK : "rgba(255,255,255,.4)", whiteSpace: "nowrap",
              }}
            >
              {step}
            </div>
            {i < STEPS.length - 1 && (
              <span style={{ font: `400 10px ${GK_MONO}`, color: "rgba(255,255,255,.25)" }}>→</span>
            )}
          </div>
        ))}
      </div>

      <span
        style={{
          font: `400 10px/1.4 ${GK_MONO}`, color: "rgba(255,255,255,.36)",
          textAlign: "center", maxWidth: 290,
        }}
      >
        {footer}
      </span>
    </div>
  );
}
