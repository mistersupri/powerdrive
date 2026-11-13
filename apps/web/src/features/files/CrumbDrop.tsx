import type { FileEntry } from "@superdrive/shared";
import { Folder } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/ui/misc";
import { activeDrag, DRAG_MIME } from "./dnd";
import { useFolder } from "./useFolder";

export type DropPayload = { storageId: string; ids: string[] };

function FolderGrid({ storageId, folderId, label, onPick }: { storageId: string; folderId: string; label: string; onPick(folderId: string, e: React.DragEvent): void }) {
  const f = useFolder(storageId, folderId);
  const dirs = f.entries.filter((e: FileEntry) => e.isFolder && !activeDrag?.ids.includes(e.id));
  const [over, setOver] = useState("");
  return (
    <div>
      <div className={cn("mb-2 rounded-lg border border-dashed px-3 py-2 text-center text-[12px] transition-colors", over === "self" ? "border-primary bg-primary-soft text-primary-ink" : "border-line-strong text-muted")}
        onDragOver={(e) => { e.preventDefault(); setOver("self"); }} onDragLeave={() => setOver("")} onDrop={(e) => { e.preventDefault(); onPick(folderId, e); }}>Lepaskan di sini untuk memindahkan ke <b>{label}</b></div>
      {f.isLoading ? <div className="grid grid-cols-2 gap-1.5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
        : dirs.length === 0 ? <p className="px-1 py-3 text-center text-[12px] text-muted">Tidak ada subfolder.</p>
        : <div className="grid max-h-[260px] grid-cols-2 gap-1.5 overflow-y-auto pr-0.5 scroll-thin">
          {dirs.map((d) => (
            <div key={d.id} className={cn("flex h-9 items-center gap-2 rounded-lg border px-2.5 text-[13px] transition-colors", over === d.id ? "border-primary bg-primary-soft ring-2 ring-primary" : "border-line bg-surface hover:bg-surface-2")}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(d.id); }} onDragLeave={() => setOver((o) => (o === d.id ? "" : o))} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onPick(d.id, e); }}>
              <Folder className="size-4 shrink-0 text-primary-ink" aria-hidden /><span className="truncate" title={d.name}>{d.name}</span></div>))}</div>}
    </div>
  );
}

/**
 * A breadcrumb that, while something is dragged over it, opens a grid of the folders inside it.
 * Dropping on a folder in the grid moves the dragged items there.
 */
export function CrumbDrop({ storageId, folderId, label, children, onDropTo }: { storageId: string; folderId: string; label: string; children: ReactNode; onDropTo(folderId: string, payload: DropPayload, copy: boolean): void }) {
  const ref = useRef<HTMLSpanElement>(null); const [open, setOpen] = useState(false); const [hl, setHl] = useState(false);
  const enter = useRef<ReturnType<typeof setTimeout>>(undefined); const leave = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const closeSoon = () => { clearTimeout(enter.current); clearTimeout(leave.current); leave.current = setTimeout(() => { setOpen(false); setHl(false); }, 260); };
  const hold = () => { clearTimeout(leave.current); };
  useEffect(() => {
    // Deferred one tick: the drop handlers inside the popover must run before it is unmounted.
    const stop = () => setTimeout(() => { clearTimeout(enter.current); clearTimeout(leave.current); setOpen(false); setHl(false); }, 0);
    window.addEventListener("dragend", stop, true); window.addEventListener("drop", stop, true);
    return () => { window.removeEventListener("dragend", stop, true); window.removeEventListener("drop", stop, true); clearTimeout(enter.current); clearTimeout(leave.current); };
  }, []);
  const pick = (target: string, e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_MIME); setOpen(false); setHl(false);
    if (raw) onDropTo(target, JSON.parse(raw), e.altKey);
  };
  return (
    <span ref={ref} className={cn("rounded-md transition-colors", hl && "bg-primary-soft ring-2 ring-primary")}
      onDragEnter={(e) => { if (!e.dataTransfer.types.includes(DRAG_MIME)) return; hold(); setHl(true); clearTimeout(enter.current); enter.current = setTimeout(() => { const r = ref.current?.getBoundingClientRect(); if (r) { setPos({ left: Math.max(8, Math.min(r.left, innerWidth - 380)), top: r.bottom + 6 }); setOpen(true); } }, 380); }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); hold(); } }}
      onDragLeave={closeSoon}
      onDrop={(e) => { e.preventDefault(); pick(folderId, e); }}>
      {children}
      {open && createPortal(
        <div className="anim-pop fixed z-[70] w-[360px] max-w-[calc(100vw-1rem)] rounded-xl border border-line bg-surface p-3 shadow-float" style={pos} onDragEnter={hold} onDragOver={(e) => { e.preventDefault(); hold(); }} onDragLeave={closeSoon} role="dialog" aria-label={`Folder di ${label}`}>
          <p className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Isi “{label}”</p>
          <FolderGrid storageId={storageId} folderId={folderId} label={label} onPick={pick} />
        </div>, document.body)}
    </span>
  );
}
