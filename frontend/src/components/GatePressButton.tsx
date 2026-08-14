import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CircleDot, Loader2 } from "lucide-react";

// Steps the button walks through on each press. The controller is a dry relay
// with no position feedback, so this is only a local hint — never a claim
// about where the gate actually is. It goes stale after a few minutes idle,
// since a fob or keypad press elsewhere would silently invalidate it.
const STEPS = ["Open", "Stop", "Close", "Stop"] as const;
const STALE_MS = 3 * 60_000;

// Safety cover: a frosted pill sits over the button and physically blocks
// clicks (pointer-events) until slid or tapped open. It re-closes itself
// shortly after a press, or after sitting idle armed with nothing pressed.
const COVER_TRAVEL = 110;
const COVER_OPEN_THRESHOLD = 0.45;
const RELOCK_IDLE_MS = 8_000;
const RELOCK_AFTER_PRESS_MS = 1_400;

interface GatePressButtonProps {
  pulsing: boolean;
  onPress: () => void | Promise<void>;
  className?: string;
}

export function GatePressButton({ pulsing, onPress, className = "" }: GatePressButtonProps) {
  const [presses, setPresses] = useState(0);
  const [lastPressAt, setLastPressAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [coverOpen, setCoverOpen] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef(0);
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
    clearRelockTimer();
    setCoverOpen(false);
    setDragX(0);
  }, [clearRelockTimer]);

  const armRelock = useCallback(
    (ms: number) => {
      clearRelockTimer();
      relockTimer.current = window.setTimeout(closeCover, ms);
    },
    [clearRelockTimer, closeCover],
  );

  useEffect(() => clearRelockTimer, [clearRelockTimer]);

  const openCover = useCallback(() => {
    setCoverOpen(true);
    setDragX(0);
    armRelock(RELOCK_IDLE_MS);
  }, [armRelock]);

  const onCoverPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (coverOpen) return;
    dragStartX.current = e.clientX;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onCoverPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragX(Math.min(COVER_TRAVEL, Math.max(0, e.clientX - dragStartX.current)));
  };

  const onCoverPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    if (dragX >= COVER_TRAVEL * COVER_OPEN_THRESHOLD) {
      openCover();
    } else {
      setDragX(0);
    }
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Dragging precisely is fiddly on a small target — a plain tap on the
  // cover opens it too (fires after pointerup only when barely moved).
  const onCoverClick = () => {
    if (coverOpen) return;
    openCover();
  };

  const onCoverKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (coverOpen) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openCover();
    }
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
  const stale = presses > 0 && secsAgo !== null && secsAgo * 1000 > STALE_MS;
  const idx = presses === 0 || stale ? -1 : (presses - 1) % STEPS.length;
  const nextIdx = idx === -1 ? -1 : (idx + 1) % STEPS.length;

  const ago = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`);

  const sub = pulsing
    ? "Sending…"
    : !coverOpen
      ? "Covered"
      : nextIdx === -1
        ? "Open · stop · close"
        : `Next: ${STEPS[nextIdx].toLowerCase()}`;

  const footer = !coverOpen
    ? "Safety cover closed · slide or tap the glass to arm the button"
    : nextIdx === -1
      ? "Each press steps the gate to its next state — a press after a stop reverses it"
      : `Sent ${ago(secsAgo ?? 0)} ago · next press should ${STEPS[nextIdx].toLowerCase()}${
          nextIdx === 1 || nextIdx === 3 ? " the gate mid-travel" : " it"
        }`;

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <div className="relative flex size-48 items-center justify-center">
        <div className="absolute inset-0 rounded-full border border-border" aria-hidden />
        <div className="absolute inset-3 rounded-full border border-dashed border-border" aria-hidden />
        {pulsing && (
          <span
            className="absolute inset-5 animate-ping rounded-full bg-tone-control/60"
            aria-hidden
          />
        )}
        <button
          type="button"
          onClick={handleClick}
          disabled={pulsing}
          className="relative flex size-40 flex-col items-center justify-center gap-1 rounded-full bg-tone-control text-tone-control-foreground shadow-[0_10px_0_oklch(0.45_0.16_35)] transition-transform active:translate-y-1.5 active:shadow-[0_4px_0_oklch(0.45_0.16_35)] disabled:opacity-90"
        >
          {pulsing ? (
            <Loader2 className="size-7 animate-spin" />
          ) : (
            <CircleDot className="size-7" />
          )}
          <span className="font-display text-2xl font-black uppercase tracking-tight">
            Press
          </span>
          <span className="font-label text-[10px] uppercase tracking-widest opacity-75">
            {sub}
          </span>
        </button>

        <div
          role="button"
          tabIndex={coverOpen ? -1 : 0}
          aria-label="Slide open the safety cover to arm the gate button"
          aria-pressed={coverOpen}
          onPointerDown={onCoverPointerDown}
          onPointerMove={onCoverPointerMove}
          onPointerUp={onCoverPointerUp}
          onPointerCancel={onCoverPointerUp}
          onClick={onCoverClick}
          onKeyDown={onCoverKeyDown}
          className="absolute inset-4 flex cursor-grab touch-none select-none flex-col items-center justify-center gap-1 overflow-hidden rounded-full border border-white/25 bg-card/70 shadow-lg backdrop-blur-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            transform: `translateX(${coverOpen ? COVER_TRAVEL + 40 : dragX}px)`,
            transition: dragging ? "none" : "transform 340ms cubic-bezier(.3,.9,.3,1)",
            pointerEvents: coverOpen ? "none" : "auto",
          }}
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/35 via-white/5 to-transparent" aria-hidden />
          <span className="relative font-label text-[9px] uppercase tracking-widest text-foreground/70">
            Slide cover
          </span>
          <span className="relative text-sm tracking-widest text-foreground/55">›››</span>
          <div className="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col items-center gap-1" aria-hidden>
            <span className="h-px w-3 bg-foreground/30" />
            <span className="h-px w-3 bg-foreground/30" />
            <span className="h-px w-3 bg-foreground/30" />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {STEPS.map((step, i) => (
          <div key={`${step}-${i}`} className="flex items-center gap-1.5">
            <span
              className={`font-label rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-widest ${
                i === nextIdx
                  ? "border-tone-control bg-tone-control text-tone-control-foreground"
                  : "border-border text-muted-foreground"
              }`}
            >
              {step}
            </span>
            {i < STEPS.length - 1 && (
              <span className="text-xs text-muted-foreground/50">→</span>
            )}
          </div>
        ))}
      </div>

      <p className="max-w-[280px] text-center font-label text-[10px] leading-relaxed text-muted-foreground">
        {footer}
      </p>
    </div>
  );
}
