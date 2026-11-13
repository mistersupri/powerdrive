import type { ConflictPolicy, FileEntry, FileListing, StorageConnectionDto } from "@superdrive/shared";
import { PROVIDER_LABEL } from "@superdrive/shared";
import { ChevronRight, FolderClosed, HardDrive } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, Input, Select } from "@/ui/Field";
import { Skeleton } from "@/ui/misc";
import { useStorages } from "@/features/layout/Shell";
import { useFolder } from "./useFolder";

export function NameDialog({ open, title, label, initial = "", action, onClose, onSubmit }: { open: boolean; title: string; label: string; initial?: string; action: string; onClose(): void; onSubmit(name: string): Promise<void> }) {
  const [name, setName] = useState(initial); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { if (open) { setName(initial); setErr(""); } }, [open, initial]);
  const submit = async () => {
    if (!name.trim()) return setErr("Nama tidak boleh kosong.");
    setBusy(true); setErr("");
    try { await onSubmit(name.trim()); onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title={title} footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" loading={busy} onClick={submit}>{action}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label={label} error={err}>{(id) => <Input id={id} autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => { const dot = initial.lastIndexOf("."); e.currentTarget.setSelectionRange(0, dot > 0 ? dot : e.currentTarget.value.length); }} />}</Field>
      </form>
    </Dialog>
  );
}

const TRASH_NOTE = "Item dipindahkan ke Sampah dan bisa dipulihkan selama 30 hari.";
export function DeleteDialog({ open, entries, provider, onClose, onConfirm }: { open: boolean; entries: FileEntry[]; provider?: string; onClose(): void; onConfirm(): Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const one = entries.length === 1 ? entries[0]! : null;
  return (
    <Dialog open={open} onClose={onClose} title={one ? `Hapus “${one.name}”?` : `Hapus ${entries.length} item?`} width="max-w-sm"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="danger" loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}>Hapus</Button></>}>
      <p className="text-[14px] text-muted">{one?.isFolder ? "Folder beserta seluruh isinya akan dihapus. " : ""}{TRASH_NOTE}</p>
    </Dialog>
  );
}

import type { Destination } from "./transferApi";
export type { Destination };
const POLICIES: { v: ConflictPolicy; label: string; hint: string }[] = [
  { v: "RENAME", label: "Simpan keduanya", hint: "Nama file ditambah (2), (3), dst." }, { v: "SKIP", label: "Lewati", hint: "File yang sudah ada dibiarkan." },
  { v: "OVERWRITE", label: "Timpa", hint: "File di tujuan diganti. Versi lama masuk sampah bila penyedia mendukung." }, { v: "FAIL", label: "Hentikan", hint: "Gagalkan jika ada nama yang sama." },
];

/** Pick a destination folder in any storage, and what to do when names collide. */
export function TransferDialog({ open, mode, entries, fromStorageId, initialStorageId, initialFolderId, onClose, onConfirm }: {
  open: boolean; mode: "COPY" | "MOVE"; entries: FileEntry[]; fromStorageId: string; initialStorageId?: string; initialFolderId?: string; onClose(): void;
  onConfirm(dest: Destination, policy: ConflictPolicy): Promise<void>;
}) {
  const storages = (useStorages().data ?? []).filter((s) => s.permissions.includes("UPLOAD") && s.status === "CONNECTED");
  const [sid, setSid] = useState(initialStorageId ?? fromStorageId); const [folderId, setFolderId] = useState(initialFolderId ?? "root");
  const [policy, setPolicy] = useState<ConflictPolicy>("RENAME"); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { if (open) { setSid(initialStorageId ?? fromStorageId); setFolderId(initialFolderId ?? "root"); setErr(""); } }, [open, fromStorageId, initialStorageId, initialFolderId]);
  const f = useFolder(open ? sid : "", folderId);
  const verb = mode === "COPY" ? "Salin" : "Pindahkan";
  const blocked = new Set(entries.filter((e) => e.isFolder).map((e) => e.id));
  const dirs = f.entries.filter((e) => e.isFolder && !(sid === fromStorageId && blocked.has(e.id)));
  const path = f.folder?.path ?? [];
  const name = folderId === "root" ? storages.find((s) => s.id === sid)?.name ?? "" : f.folder?.name ?? "";
  return (
    <Dialog open={open} onClose={onClose} width="max-w-lg" title={`${verb} ${entries.length === 1 ? `“${entries[0]!.name}”` : `${entries.length} item`} ke…`} description="Pilih folder tujuan. File dikirim lewat server, tanpa diunduh ke komputer Anda."
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" loading={busy} disabled={!sid} onClick={async () => { setBusy(true); setErr(""); try { await onConfirm({ storageId: sid, folderId, folderName: name }, policy); onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }}>{verb} ke sini</Button></>}>
      <div className="space-y-4">
        <Field label="Penyimpanan tujuan">{(id) => <Select id={id} value={sid} onChange={(e) => { setSid(e.target.value); setFolderId("root"); }}>{storages.map((s) => <option key={s.id} value={s.id}>{s.name} ({PROVIDER_LABEL[s.provider]})</option>)}</Select>}</Field>
        <div>
          <nav aria-label="Lokasi tujuan" className="mb-2 flex flex-wrap items-center gap-1 text-[13px]">
            <button className={cn("rounded px-1.5 py-0.5 hover:bg-surface-2", folderId === "root" && "font-semibold")} onClick={() => setFolderId("root")}>{storages.find((s) => s.id === sid)?.name}</button>
            {path.map((c) => <span key={c.id} className="flex items-center gap-1"><ChevronRight className="size-3.5 text-faint" aria-hidden /><button className="rounded px-1.5 py-0.5 hover:bg-surface-2" onClick={() => setFolderId(c.id)}>{c.name}</button></span>)}
          </nav>
          <ul className="scroll-thin h-52 overflow-y-auto rounded-lg border border-line" role="listbox" aria-label="Folder">
            {f.isLoading ? Array.from({ length: 5 }, (_, i) => <li key={i} className="p-2"><Skeleton className="h-6" /></li>)
              : dirs.length === 0 ? <li className="grid h-full place-items-center px-4 text-center text-[13px] text-muted">Tidak ada subfolder. Folder tujuan: <b className="text-ink">{name}</b></li>
              : dirs.map((d) => <li key={d.id}><button className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-surface-2" onClick={() => setFolderId(d.id)} role="option" aria-selected={false}><FolderClosed className="size-4 text-primary-ink" aria-hidden />{d.name}<ChevronRight className="ml-auto size-4 text-faint" aria-hidden /></button></li>)}
          </ul>
        </div>
        <Field label="Jika nama file sama" hint={POLICIES.find((p) => p.v === policy)?.hint}>{(id) => <Select id={id} value={policy} onChange={(e) => setPolicy(e.target.value as ConflictPolicy)}>{POLICIES.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}</Select>}</Field>
        {mode === "MOVE" && sid !== fromStorageId && <p className="rounded-lg bg-warn-soft px-3 py-2 text-[12px] text-warn-ink">Pemindahan antar penyimpanan menyalin dulu, memeriksa hasilnya, baru menghapus file asal. Jika file asal gagal dihapus, ia dibiarkan dan ditandai.</p>}
        {err && <p role="alert" className="text-[13px] text-danger-ink">{err}</p>}
      </div>
    </Dialog>
  );
}

export function StorageHint({ s }: { s: StorageConnectionDto }) { return <span className="inline-flex items-center gap-1.5 text-muted"><HardDrive className="size-3.5" />{s.name}</span>; }
export type { FileListing };
