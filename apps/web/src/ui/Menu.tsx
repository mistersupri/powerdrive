import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export interface MenuItem { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean; hidden?: boolean; shortcut?: string; divider?: boolean }

/** Floating menu at a point. Used for both the "…" button and right-click. Arrow keys, Home/End, Escape. */
export function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const visible = items.filter((i) => !i.hidden);

  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(x, innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, innerHeight - r.height - 8)) });
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    const down = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "ArrowDown") { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
      if (e.key === "Home") btns[0]?.focus();
      if (e.key === "End") btns.at(-1)?.focus();
    };
    addEventListener("pointerdown", down, true); addEventListener("keydown", key); addEventListener("scroll", onClose, true); addEventListener("resize", onClose);
    return () => { removeEventListener("pointerdown", down, true); removeEventListener("keydown", key); removeEventListener("scroll", onClose, true); removeEventListener("resize", onClose); };
  }, [onClose]);

  return createPortal(
    <div ref={ref} role="menu" style={pos} className="anim-pop fixed z-[60] max-h-[calc(100dvh-1rem)] min-w-52 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-float">
      {visible.map((it, i) => (
        <div key={i}>
          {it.divider && <div className="my-1 h-px bg-line" />}
          <button role="menuitem" disabled={it.disabled} onClick={() => { onClose(); it.onSelect(); }}
            className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:outline-none disabled:opacity-40", it.danger && "text-danger-ink hover:bg-danger-soft focus:bg-danger-soft")}>
            <span className="grid size-4 place-items-center text-muted [&>svg]:size-4">{it.icon}</span>
            <span className="flex-1">{it.label}</span>
            {it.shortcut && <kbd className="text-[11px] text-faint">{it.shortcut}</kbd>}
          </button>
        </div>
      ))}
    </div>, document.body);
}

export function useMenu() {
  const [m, setM] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  return { open: (x: number, y: number, items: MenuItem[]) => setM({ x, y, items }), element: m ? <Menu {...m} onClose={() => setM(null)} /> : null };
}
