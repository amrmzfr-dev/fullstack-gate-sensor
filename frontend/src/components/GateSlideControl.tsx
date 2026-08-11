import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChevronsRight, DoorOpen, Loader2 } from "lucide-react";

const COOLDOWN_MS = 10_000;
const AUTO_RELOCK_MS = 6_000;
const UNLOCK_THRESHOLD = 0.7;

interface GateSlideControlProps {
  pulsing: boolean;
  onPress: () => void | Promise<void>;
  size?: "md" | "lg";
  className?: string;
}

export function GateSlideControl({
  pulsing,
  onPress,
  size = "md",
  className = "",
}: GateSlideControlProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragInfo = useRef<{ startClientX: number; trackWidth: number } | null>(
    null,
  );
  const autoRelockTimer = useRef<number | null>(null);
  const cooldownInterval = useRef<number | null>(null);

  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);

  const clearAutoRelock = useCallback(() => {
    if (autoRelockTimer.current !== null) {
      window.clearTimeout(autoRelockTimer.current);
      autoRelockTimer.current = null;
    }
  }, []);

  const relock = useCallback(() => {
    clearAutoRelock();
    setUnlocked(false);
    setDragX(0);
  }, [clearAutoRelock]);

  const startCooldown = useCallback(() => {
    setCooldownLeft(COOLDOWN_MS / 1000);
    if (cooldownInterval.current !== null) {
      window.clearInterval(cooldownInterval.current);
    }
    cooldownInterval.current = window.setInterval(() => {
      setCooldownLeft((prev) => {
        if (prev <= 1) {
          if (cooldownInterval.current !== null) {
            window.clearInterval(cooldownInterval.current);
            cooldownInterval.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(
    () => () => {
      clearAutoRelock();
      if (cooldownInterval.current !== null) {
        window.clearInterval(cooldownInterval.current);
      }
    },
    [clearAutoRelock],
  );

  // Safety net: an unlocked cover that's never pressed re-locks itself
  // rather than leaving the real button exposed indefinitely.
  useEffect(() => {
    if (!unlocked) return;
    autoRelockTimer.current = window.setTimeout(relock, AUTO_RELOCK_MS);
    return clearAutoRelock;
  }, [unlocked, relock, clearAutoRelock]);

  const handlePress = useCallback(() => {
    relock();
    startCooldown();
    void onPress();
  }, [onPress, relock, startCooldown]);

  const onThumbPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (cooldownLeft > 0 || pulsing) return;
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    dragInfo.current = {
      startClientX: e.clientX,
      trackWidth: Math.max(rect.width - rect.height, 0),
    };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onThumbPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging || !dragInfo.current) return;
    const { startClientX, trackWidth } = dragInfo.current;
    const next = Math.min(Math.max(e.clientX - startClientX, 0), trackWidth);
    setDragX(next);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging || !dragInfo.current) return;
    const { trackWidth } = dragInfo.current;
    setDragging(false);
    if (trackWidth > 0 && dragX / trackWidth >= UNLOCK_THRESHOLD) {
      setDragX(trackWidth);
      setUnlocked(true);
    } else {
      setDragX(0);
    }
    dragInfo.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const locked = !unlocked || cooldownLeft > 0;
  const isLg = size === "lg";

  return (
    <div
      className={`relative select-none ${isLg ? "h-14" : "h-10"} ${className}`}
    >
      <button
        type="button"
        disabled={!unlocked || pulsing || cooldownLeft > 0}
        onClick={handlePress}
        className={`flex size-full items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-background font-medium text-foreground disabled:opacity-60 ${
          isLg ? "text-base" : "text-sm"
        }`}
      >
        {pulsing ? (
          <Loader2 className={isLg ? "size-5 animate-spin" : "size-4 animate-spin"} />
        ) : (
          <DoorOpen className={isLg ? "size-5 text-primary" : "size-4 text-primary"} />
        )}
        Gate — open / stop / close
      </button>

      {locked && (
        <div
          ref={trackRef}
          className="absolute inset-0 flex items-center rounded-lg border border-border bg-muted"
        >
          <div
            className="absolute inset-y-0 left-0 flex aspect-square touch-none items-center justify-center rounded-md bg-primary text-primary-foreground shadow"
            style={{
              transform: `translateX(${dragX}px)`,
              transition: dragging ? "none" : "transform 200ms ease",
            }}
            onPointerDown={onThumbPointerDown}
            onPointerMove={onThumbPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <ChevronsRight className={isLg ? "size-5" : "size-4"} />
          </div>
          <span className="pointer-events-none w-full text-center text-xs text-muted-foreground">
            {cooldownLeft > 0 ? `Wait ${cooldownLeft}s...` : "Slide to unlock →"}
          </span>
        </div>
      )}
    </div>
  );
}
