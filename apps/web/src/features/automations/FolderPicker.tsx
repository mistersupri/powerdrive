import { PROVIDER_LABEL } from "@superdrive/shared";
import { ChevronRight, FolderClosed } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useStorages } from "@/features/layout/Shell";
import { useFolder } from "@/features/files/useFolder";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, Select } from "@/ui/Field";
import { Skeleton } from "@/ui/misc";

export interface Picked { storageId: string; folderId: string; label: string }

/** Choose a storage and a folder in it. `writable` limits the list to storages the person may upload to. */
export function FolderPicker({ open, initial, writable, title, onPick, onClose }: { open: boolean; initial?: { storageId?: string; folderId?: string }; writable?: boolean; title: string; onPick(p: Picked): void; onClose(): void }) {
  const storages = (useStorages().data ?? []).filter((s) => s.status === "CONNECTED" && (!writable || s.permissions.includes("UPLOAD")));
  const [sid, setSid] = useState(""); const [folderId, setFolderId] = useState("root");
  useEffect(() => { if (open) { setSid(initial?.storageId && storages.some((s) => s.id === initial.storageId) ? initial.storageId : storages[0]?.id ?? ""); setFolderId(initial?.folderId ?? "root"); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = useFolder(open ? sid : "", folderId);
  const dirs = f.entries.filter((e) => e.isFolder); const path = f.folder?.path ?? []; const storage = storages.find((s) => s.id === sid);
  const label = `${storage?.isDefault ? "Semua file" : storage?.name ?? ""}${folderId === "root" ? "" : " · /" + path.map((c) => c.name).join("/")}`;
  return (
    <Dialog open={open} onClose={onClose} width="max-w-lg" title={title} footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" disabled={!sid} onClick={() => { onPick({ storageId: sid, folderId, label }); onClose(); }}>Pilih folder ini</Button></>}>
      <div className="space-y-3">
        <Field label="Penyimpanan">{(id) => <Select id={id} value={sid} onChange={(e) => { setSid(e.target.value); setFolderId("root"); }}>{storages.map((s) => <option key={s.id} value={s.id}>{s.isDefault ? "Semua file" : s.name} ({PROVIDER_LABEL[s.provider]})</option>)}</Select>}</Field>
        <nav aria-label="Lokasi" className="flex flex-wrap items-center gap-1 text-[13px]">
          <button type="button" className={cn("rounded px-1.5 py-0.5 hover:bg-surface-2", folderId === "root" && "font-semibold")} onClick={() => setFolderId("root")}>{storage?.isDefault ? "Semua file" : storage?.name}</button>
          {path.map((c) => <span key={c.id} className="flex items-center gap-1"><ChevronRight className="size-3.5 text-faint" aria-hidden /><button type="button" className="rounded px-1.5 py-0.5 hover:bg-surface-2" onClick={() => setFolderId(c.id)}>{c.name}</button></span>)}
        </nav>
        <ul className="scroll-thin h-52 overflow-y-auto rounded-lg border border-line" role="listbox" aria-label="Folder">
          {f.isLoading ? Array.from({ length: 5 }, (_, i) => <li key={i} className="p-2"><Skeleton className="h-6" /></li>)
            : dirs.length === 0 ? <li className="grid h-full place-items-center px-4 text-center text-[13px] text-muted">Tidak ada subfolder. Folder terpilih: <b className="text-ink">{label}</b></li>
            : dirs.map((d) => <li key={d.id}><button type="button" role="option" aria-selected={false} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-surface-2" onClick={() => setFolderId(d.id)}><FolderClosed className="size-4 text-primary-ink" aria-hidden /><span className="truncate">{d.name}</span></button></li>)}
        </ul>
        <p className="text-[12px] text-muted">Terpilih: <b className="text-ink">{label}</b></p>
      </div>
    </Dialog>
  );
}
