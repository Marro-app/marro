import { useCallback, useEffect, useRef, useState } from 'react';

// Auto sign-out after a stretch of inactivity, for shared/borrowed-computer
// safety (see docs/PRODUCT_DECISIONS.md, auth-hardening pass). Warns ~60s
// before it fires so an idle-but-still-there user (reading, not clicking)
// isn't logged out with no notice. Only "real" interaction resets the clock —
// background data-sync polling in App.jsx does NOT count as activity.
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const IDLE_WARNING_MS = 60 * 1000;      // warn this long before sign-out

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'];

export function useIdleTimeout({ enabled, onTimeout, idleMs = IDLE_TIMEOUT_MS, warnMs = IDLE_WARNING_MS }){
  const [warning, setWarning] = useState(false);
  const warnTimer = useRef(null);
  const finalTimer = useRef(null);
  const onTimeoutRef = useRef(onTimeout);
  useEffect(() => { onTimeoutRef.current = onTimeout; }, [onTimeout]);

  const clearTimers = useCallback(() => {
    if (warnTimer.current) clearTimeout(warnTimer.current);
    if (finalTimer.current) clearTimeout(finalTimer.current);
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    setWarning(false);
    if (!enabled) return;
    warnTimer.current = setTimeout(() => setWarning(true), Math.max(0, idleMs - warnMs));
    finalTimer.current = setTimeout(() => onTimeoutRef.current?.(), idleMs);
  }, [enabled, idleMs, warnMs, clearTimers]);

  useEffect(() => {
    if (!enabled){ clearTimers(); setWarning(false); return; }
    reset();
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, reset, { passive: true }));
    return () => {
      clearTimers();
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, reset));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { warning, stayActive: reset };
}
