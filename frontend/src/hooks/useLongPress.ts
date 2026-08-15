import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";

// Press-and-hold detection for a row/card: fires onLongPress once the
// pointer has stayed down for thresholdMs, and is silently a no-op (no
// click, no fire) for a normal short tap. Also bails out if the pointer
// drifts more than a few px, so scrolling the list doesn't get mistaken
// for a hold.
const MOVE_CANCEL_PX = 10;

export function useLongPress(onLongPress: () => void, thresholdMs = 550) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      clear();
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(onLongPress, thresholdMs);
    },
    [clear, onLongPress, thresholdMs],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      if (!origin.current) return;
      const dx = event.clientX - origin.current.x;
      const dy = event.clientY - origin.current.y;
      if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) clear();
    },
    [clear],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
  };
}
