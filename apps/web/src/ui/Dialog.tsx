import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./Button";

interface Props { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; width?: string; bare?: boolean }

/** Built on the native <dialog>: focus trap, Escape and inert background come from the browser. */
export function Dialog({ open, onClose, title, description, children, footer, width = "max-w-md", bare }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onMouseDown={(e) => { if (e.target === ref.current) onClose(); }}
      className={cn("m-auto w-[calc(100%-2rem)] rounded-2xl bg-surface p-0 text-ink shadow-float backdrop:bg-black/40 backdrop:backdrop-blur-[1px] anim-pop", width)}
      aria-labelledby="dlg-title"
    >
      <div className="flex max-h-[min(86vh,760px)] flex-col">
        {!bare && (
          <header className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
            <div className="min-w-0">
              <h2 id="dlg-title" className="text-[17px] font-bold balance">{title}</h2>
              {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
            </div>
            <IconButton label="Tutup" onClick={onClose} className="-mt-1 -mr-2 bg-surface-2"><X className="size-4" /></IconButton>
          </header>
        )}
        <div className={cn("min-h-0 flex-1 overflow-y-auto", !bare && "px-6 py-5")}>{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</footer>}
      </div>
    </dialog>
  );
}
