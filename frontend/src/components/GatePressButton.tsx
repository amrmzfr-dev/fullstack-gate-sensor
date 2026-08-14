import { useEffect, useState } from "react";
import { CircleDot, Loader2 } from "lucide-react";

// Steps the button walks through on each press. The controller is a dry relay
// with no position feedback, so this is only a local hint — never a claim
// about where the gate actually is. It goes stale after a few minutes idle,
// since a fob or keypad press elsewhere would silently invalidate it.
const STEPS = ["Open", "Stop", "Close", "Stop"] as const;
const STALE_MS = 3 * 60_000;

interface GatePressButtonProps {
  pulsing: boolean;
  onPress: () => void | Promise<void>;
  className?: string;
}

export function GatePressButton({ pulsing, onPress, className = "" }: GatePressButtonProps) {
  const [presses, setPresses] = useState(0);
  const [lastPressAt, setLastPressAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (lastPressAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [lastPressAt]);

  const handleClick = () => {
    const pressedAt = Date.now();
    setPresses((p) => p + 1);
    setLastPressAt(pressedAt);
    setNow(pressedAt);
    void onPress();
  };

  const secsAgo = lastPressAt === null ? null : Math.max(0, Math.round((now - lastPressAt) / 1000));
  const stale = presses > 0 && secsAgo !== null && secsAgo * 1000 > STALE_MS;
  const idx = presses === 0 || stale ? -1 : (presses - 1) % STEPS.length;
  const nextIdx = idx === -1 ? -1 : (idx + 1) % STEPS.length;

  const ago = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`);

  const sub = pulsing
    ? "Sending…"
    : nextIdx === -1
      ? "Open · stop · close"
      : `Next: ${STEPS[nextIdx].toLowerCase()}`;

  const footer =
    nextIdx === -1
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
