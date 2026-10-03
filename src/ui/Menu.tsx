import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn.ts";

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  /** Draw a divider above this item. */
  separated?: boolean;
  disabled?: boolean;
}

function MenuList({
  items,
  title,
  onClose,
  className,
  style,
  originClass,
}: {
  items: MenuItem[];
  title?: string;
  onClose: () => void;
  className?: string;
  style?: React.CSSProperties;
  originClass?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const nodes = Array.from<HTMLElement>(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') || []);
    const i = nodes.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      nodes[(i + 1) % nodes.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      nodes[(i - 1 + nodes.length) % nodes.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      nodes[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      nodes[nodes.length - 1]?.focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={title}
      onKeyDown={onKeyDown}
      style={style}
      className={cn(
        "w-60 max-w-[calc(100vw-24px)] bg-surface border border-ink-200 rounded-xl shadow-float p-1 text-sm text-ink-800 animate-pop-in select-none",
        originClass,
        className
      )}
    >
      {title && <div className="px-2.5 pt-1.5 pb-2 text-xs font-semibold text-ink-500 truncate">{title}</div>}
      {items.map((item, idx) => (
        <React.Fragment key={`${item.label}-${idx}`}>
          {item.separated && idx > 0 && <div className="h-px bg-ink-100 my-1" role="separator" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={cn(
              "w-full flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-left font-medium outline-none",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              item.danger
                ? "text-danger-600 hover:bg-danger-50 focus-visible:bg-danger-50"
                : "hover:bg-ink-100 focus-visible:bg-ink-100"
            )}
          >
            <span className={cn("w-4 h-4 shrink-0 flex items-center justify-center", item.danger ? "" : "text-ink-500")}>
              {item.icon}
            </span>
            <span className="truncate">{item.label}</span>
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

/** Menu opened at a pointer position (right click or long press). */
export function ContextMenu({
  x,
  y,
  title,
  items,
  onClose,
}: {
  x: number;
  y: number;
  title?: string;
  items: MenuItem[];
  onClose: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string }>({ left: x, top: y, origin: "origin-top-left" });

  // Clamp to the viewport using the real rendered size, and grow from the corner
  // nearest the pointer so the menu reads as coming from where the user clicked.
  useLayoutEffect(() => {
    const el = wrapRef.current?.firstElementChild as HTMLElement | null;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const flipX = x + width > window.innerWidth - 8;
    const flipY = y + height > window.innerHeight - 8;
    setPos({
      left: Math.max(8, flipX ? x - width : x),
      top: Math.max(8, flipY ? y - height : y),
      origin: `${flipY ? "origin-bottom" : "origin-top"}-${flipX ? "right" : "left"}`,
    });
  }, [x, y]);

  useEffect(() => {
    const close = (e: Event) => {
      if (wrapRef.current && e.target instanceof Node && wrapRef.current.contains(e.target)) return;
      onClose();
    };
    const onResize = () => onClose();
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close, { passive: true });
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", onResize);
    };
  }, [onClose]);

  return createPortal(
    <div ref={wrapRef} className="fixed z-[70]" style={{ left: pos.left, top: pos.top }}>
      <MenuList items={items} title={title} onClose={onClose} originClass={pos.origin} />
    </div>,
    document.body
  );
}

/** Menu anchored under a trigger button (account menu, "New" menu). */
export function DropdownMenu({
  trigger,
  items,
  title,
  align = "end",
  header,
}: {
  trigger: (props: { open: boolean; toggle: () => void; ref: React.Ref<HTMLButtonElement> }) => React.ReactNode;
  items: MenuItem[];
  title?: string;
  align?: "start" | "end";
  header?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={wrapRef} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v), ref: triggerRef })}
      {open && (
        <div className={cn("absolute top-full mt-2 z-50", align === "end" ? "right-0" : "left-0")}>
          {header ? (
            <div className="w-64 bg-surface border border-ink-200 rounded-xl shadow-float animate-pop-in origin-top-right overflow-hidden">
              {header}
              <MenuList items={items} title={title} onClose={close} className="w-full border-0 shadow-none rounded-none animate-none" />
            </div>
          ) : (
            <MenuList
              items={items}
              title={title}
              onClose={close}
              originClass={align === "end" ? "origin-top-right" : "origin-top-left"}
            />
          )}
        </div>
      )}
    </div>
  );
}
