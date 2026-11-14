import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";

/**
 * Signs the person out after `minutes` without any interaction (0 = never), mirroring the server's own inactivity limit.
 * One minute before, a toast offers to stay signed in; any key press, tap or movement also counts as activity.
 * Clock-based, so a laptop that slept past the limit is signed out as soon as it wakes.
 */
export function useIdleLogout(minutes: number) {
  const last = useRef(Date.now()); const warned = useRef(false); const ping = useRef(0);
  useEffect(() => {
    if (!minutes) return; const limit = minutes * 60_000; warned.current = false; last.current = Date.now();
    const bump = () => {
      last.current = Date.now();
      if (warned.current) { warned.current = false; toast.dismiss("idle"); }
      // Keep the server-side session fresh while the person is active (it only records activity on requests).
      if (Date.now() - ping.current > Math.max(60_000, limit / 4)) { ping.current = Date.now(); void api("/auth/me").catch(() => {}); }
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart", "visibilitychange"] as const;
    events.forEach((e) => addEventListener(e, bump, { passive: true }));
    const tick = setInterval(async () => {
      const idle = Date.now() - last.current;
      if (idle >= limit) { clearInterval(tick); await api("/auth/logout", { body: {} }).catch(() => {}); queryClient.clear(); location.assign(`/login?expired=1`); }
      else if (idle >= limit - 60_000 && !warned.current) { warned.current = true; toast.warning("Sesi akan berakhir dalam 1 menit karena tidak ada aktivitas.", { id: "idle", duration: Infinity, action: { label: "Tetap masuk", onClick: () => bump() } }); }
    }, 5_000);
    return () => { clearInterval(tick); events.forEach((e) => removeEventListener(e, bump)); toast.dismiss("idle"); };
  }, [minutes]);
}
