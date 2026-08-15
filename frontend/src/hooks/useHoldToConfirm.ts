import { useCallback, useRef, useState } from "react";

// Drives a "hold this button for N ms" confirm control: progress goes
// 0 -> 1 over durationMs while held, firing onConfirm the moment it
// completes; releasing early (cancel) resets it to 0 with no side effect.
export function useHoldToConfirm(durationMs: number, onConfirm: () => void) {
  const [progress, setProgress] = useState(0);
  const startedAt = useRef<number | null>(null);
  const frame = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    startedAt.current = null;
    setProgress(0);
  }, []);

  const start = useCallback(() => {
    startedAt.current = Date.now();

    const tick = () => {
      if (startedAt.current === null) return;
      const elapsed = Date.now() - startedAt.current;
      const next = Math.min(1, elapsed / durationMs);
      setProgress(next);

      if (next >= 1) {
        startedAt.current = null;
        frame.current = null;
        onConfirm();
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
  }, [durationMs, onConfirm]);

  return { progress, start, cancel };
}
