import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/** Tabs whose underline glides to the chosen tab (one element that moves, not one that blinks on and off). */
export function SlidingTabs<T extends string>({ tabs, value, onChange, label, className }: { tabs: readonly (readonly [T, string])[]; value: T; onChange(v: T): void; label: string; className?: string }) {
  const refs = useRef(new Map<T, HTMLButtonElement>()); const [bar, setBar] = useState<{ x: number; w: number } | null>(null); const [glide, setGlide] = useState(false);
  const measure = () => { const el = refs.current.get(value); if (el) setBar({ x: el.offsetLeft, w: el.offsetWidth }); };
  useLayoutEffect(measure, [value, tabs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = requestAnimationFrame(() => setGlide(true)); addEventListener("resize", measure); return () => { cancelAnimationFrame(t); removeEventListener("resize", measure); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div role="tablist" aria-label={label} className={cn("relative flex items-end gap-1", className)}>
      {tabs.map(([k, text]) => (
        <button key={k} ref={(el) => { if (el) refs.current.set(k, el); }} role="tab" type="button" aria-selected={value === k} onClick={() => onChange(k)}
          className={cn("press h-10 px-3.5 text-[13px] font-medium transition-colors pointer-coarse:h-12", value === k ? "text-primary-ink" : "text-muted hover:text-ink")}>{text}</button>))}
      {bar && <span aria-hidden className={cn("absolute bottom-0 left-0 h-0.5 rounded-t bg-primary", glide && "transition-[transform,width] duration-300 ease-[var(--ease-drawer)]")} style={{ transform: `translateX(${bar.x}px)`, width: bar.w }} />}
    </div>
  );
}
