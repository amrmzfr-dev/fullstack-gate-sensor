import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChevronsRight, DoorOpen, Loader2 } from "lucide-react";

const IDLE_RELOCK_MS = 45_000;
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
  const idleTimer = useRef<number | null>(null);

  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  const clearIdleTimer = useCallback(() => {
    if (idleTimer.current !== null) {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  }, []);

  const relock = useCallback(() => {
    clearIdleTimer();
    setUnlocked(false);
    setDragX(0);
  }, [clearIdleTimer]);

  // While unlocked, the cover stays open until this window elapses with no
  // press; each press below restarts the window instead of re-covering.
  const armIdleTimer = useCallback(() => {
    clearIdleTimer();
    idleTimer.current = window.setTimeout(relock, IDLE_RELOCK_MS);
  }, [clearIdleTimer, relock]);

  useEffect(() => clearIdleTimer, [clearIdleTimer]);

  useEffect(() => {
    if (unlocked) armIdleTimer();
  }, [unlocked, armIdleTimer]);

  const handlePress = useCallback(() => {
    armIdleTimer();
    void onPress();
  }, [onPress, armIdleTimer]);

  const onThumbPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pulsing) return;
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

  const isLg = size === "lg";

  return (
    <div
      className={`relative select-none ${isLg ? "h-14" : "h-10"} ${className}`}
    >
      <button
        type="button"
        disabled={!unlocked || pulsing}
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

      {!unlocked && (
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
            Slide to unlock →
          </span>
        </div>
      )}
    </div>
  );
}
