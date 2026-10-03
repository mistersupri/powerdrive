import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../lib/cn.ts";
import { IconButton } from "./Button.tsx";

// Open dialogs in mount order, so Escape and focus trapping act on the top one only.
const openStack: string[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const widths = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: keyof typeof widths;
  /** When false, Escape and backdrop clicks do nothing (e.g. while a request is running). */
  dismissible?: boolean;
  className?: string;
  /** Accessible name when no <DialogHeader> title is rendered. */
  label?: string;
  zIndex?: number;
}

const DialogTitleContext = React.createContext<string | undefined>(undefined);

export function Dialog({
  open,
  onClose,
  children,
  size = "md",
  dismissible = true,
  className,
  label,
  zIndex = 60,
}: DialogProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    openStack.push(id);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus the element marked autoFocus, else the first focusable control.
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      // Prefer an explicit target, then the first real control (not the close button).
      const target =
        panel.querySelector<HTMLElement>("[data-autofocus]") ||
        Array.from<HTMLElement>(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).find((el) => !el.hasAttribute("data-dialog-close"));
      (target || panel).focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== id) return;
      if (e.key === "Escape" && dismissibleRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const items = Array.from<HTMLElement>(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null
        );
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      const idx = openStack.lastIndexOf(id);
      if (idx !== -1) openStack.splice(idx, 1);
      if (openStack.length === 0) document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, id]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center sm:p-4"
      style={{ zIndex }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissibleRef.current) onClose();
      }}
    >
      <div className="absolute inset-0 bg-night-950/45 animate-fade-in pointer-events-none" aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={label ? undefined : titleId}
        aria-label={label}
        tabIndex={-1}
        className={cn(
          "relative w-full bg-surface text-ink-900 border border-ink-200 shadow-float animate-dialog-in",
          "rounded-t-2xl sm:rounded-2xl max-h-[92dvh] flex flex-col overflow-hidden outline-none",
          widths[size],
          className
        )}
      >
        <DialogTitleContext.Provider value={titleId}>{children}</DialogTitleContext.Provider>
      </div>
    </div>,
    document.body
  );
}

export function DialogHeader({
  title,
  description,
  icon,
  onClose,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  onClose?: () => void;
}) {
  const titleId = React.useContext(DialogTitleContext);
  return (
    <div className="flex items-start gap-3 px-5 pt-5 pb-3">
      {icon && (
        <div className="w-9 h-9 rounded-xl bg-ink-100 text-ink-700 flex items-center justify-center shrink-0">{icon}</div>
      )}
      <div className="flex-1 min-w-0 pt-0.5">
        <h2 id={titleId} className="text-base font-bold text-ink-900 leading-snug">
          {title}
        </h2>
        {description && <p className="text-sm text-ink-500 mt-1 leading-relaxed">{description}</p>}
      </div>
      {onClose && (
        <IconButton label="Tutup" size="sm" onClick={onClose} className="-mr-1.5 -mt-1" data-dialog-close>
          <X className="w-4 h-4" />
        </IconButton>
      )}
    </div>
  );
}

export function DialogBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("px-5 py-2 overflow-y-auto", className)}>{children}</div>;
}

export function DialogFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 [&>button]:w-full sm:[&>button]:w-auto",
        className
      )}
    >
      {children}
    </div>
  );
}
