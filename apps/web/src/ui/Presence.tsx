import { useEffect, useState, type ReactNode } from "react";

/**
 * Keeps something on screen for [exitMs] after [show] turns false, so it can play its exit animation
 * (give it `data-closing` while `closing` is true) before it is really removed.
 */
export function Presence({ show, exitMs = 160, children }: { show: boolean; exitMs?: number; children: (closing: boolean) => ReactNode }) {
  const [mounted, setMounted] = useState(show);
  useEffect(() => {
    if (show) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(t);
  }, [show, exitMs]);
  return mounted || show ? <>{children(!show)}</> : null;
}

/** The same idea for a component that has to animate itself out before telling its parent: call `close` instead of `onClose`. */
export function useExit(onClose: () => void, exitMs = 120) {
  const [closing, setClosing] = useState(false);
  return { closing, close: () => { if (closing) return; setClosing(true); setTimeout(onClose, exitMs); } };
}
