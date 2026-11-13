import type { ConflictPolicy, FileEntry } from "@superdrive/shared";
import { ArrowLeft, ArrowRight, ChevronRight, Copy, FolderInput } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { PageHeader, useStorages } from "@/features/layout/Shell";
import { FileBrowser } from "@/features/files/FileBrowser";
import { useSelection } from "@/features/files/selection";
import { startTransfer } from "@/features/files/transferApi";
import { sortEntries, useFolder } from "@/features/files/useFolder";
import { Button } from "@/ui/Button";
import { Select } from "@/ui/Field";
import { EmptyState } from "@/ui/misc";
import { Columns2 } from "lucide-react";

function Pane({ label, storageId, setStorageId, folderId, setFolderId, selection, onDrop, storages, onEntries }: {
  label: string; storageId: string; setStorageId(s: string): void; folderId: string; setFolderId(f: string): void; selection: ReturnType<typeof useSelection>;
  onDrop(payload: { storageId: string; ids: string[] }, targetFolder: string, copy: boolean): void; storages: { id: string; name: string }[]; onEntries(e: FileEntry[]): void;
}) {
  const f = useFolder(storageId, folderId);
  const shown = useMemo(() => sortEntries(f.entries, { key: "name", dir: "asc" }), [f.entries]);
  useEffect(() => onEntries(shown), [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (e: FileEntry) => { if (e.isFolder) { selection.clear(); setFolderId(e.id); } };
  const path = f.folder?.path ?? [];
  return (
    <section aria-label={label} className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-line bg-surface shadow-card">
      <header className="space-y-2 border-b border-line p-3">
        <div className="flex items-center gap-2"><span className="text-[11px] font-semibold tracking-wider text-muted uppercase">{label}</span><Select aria-label={`Penyimpanan ${label}`} className="h-8 flex-1 text-[13px]" value={storageId} onChange={(e) => { setStorageId(e.target.value); setFolderId("root"); selection.clear(); }}>{storages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
        <nav aria-label="Lokasi" className="flex items-center gap-0.5 overflow-x-auto text-[12px] scroll-thin">
          <button onClick={() => setFolderId("root")} className={cn("rounded px-1.5 py-0.5 whitespace-nowrap hover:bg-surface-2", !path.length && "font-semibold")}>Akar</button>
          {path.map((c, i) => <span key={c.id} className="flex items-center"><ChevronRight className="size-3 text-faint" aria-hidden /><button onClick={() => setFolderId(c.id)} className={cn("rounded px-1.5 py-0.5 whitespace-nowrap hover:bg-surface-2", i === path.length - 1 && "font-semibold")}>{c.name}</button></span>)}
        </nav>
      </header>
      <FileBrowser compact entries={shown} view="list" selected={selection.selected} loading={f.isLoading}
        empty={<p className="py-12 text-center text-[13px] text-muted">Folder kosong.</p>}
        onSelect={(e, m) => selection.click(e.id, shown, { ...m, additive: m.additive || true })} onSetSelection={(ids) => selection.setSelected(new Set(ids))} onOpen={open} onContext={() => {}}
        onKeyAction={(k) => { if (k === "selectAll") selection.selectAll(shown); if (k === "clear") selection.clear(); }}
        onDropItems={(t, p, copy) => onDrop(p, t ? t.id : folderId, copy)} onDropFiles={() => toast.info("Untuk mengunggah dari komputer, gunakan halaman penyimpanan.")} dropLabel="Lepaskan untuk memindahkan ke sini (Alt = salin)" />
    </section>
  );
}

export default function DualPanePage() {
  const storages = (useStorages().data ?? []).filter((s) => s.status === "CONNECTED");
  const [aS, setAS] = useState(""); const [bS, setBS] = useState(""); const [aF, setAF] = useState("root"); const [bF, setBF] = useState("root");
  const selA = useSelection(); const selB = useSelection(); const [ea, setEa] = useState<FileEntry[]>([]); const [eb, setEb] = useState<FileEntry[]>([]);
  const [policy, setPolicy] = useState<ConflictPolicy>("RENAME");
  useEffect(() => { if (storages.length && !aS) { setAS(storages[0]!.id); setBS((storages[1] ?? storages[0]!).id); } }, [storages, aS]);
  if (storages.length === 0) return <div className="flex min-h-0 flex-1 flex-col"><PageHeader title="Salin dua panel" /><EmptyState icon={Columns2} title="Belum ada penyimpanan aktif">Hubungkan minimal satu penyimpanan terlebih dahulu.</EmptyState></div>;

  const send = async (type: "COPY" | "MOVE", dir: "ab" | "ba") => {
    const [from, fromSel, fromEntries, to, toF] = dir === "ab" ? [aS, selA, ea, bS, bF] as const : [bS, selB, eb, aS, aF] as const;
    const ids = fromEntries.filter((e) => fromSel.selected.has(e.id)).map((e) => e.id);
    if (!ids.length) return toast.info("Pilih file atau folder di panel sumber dulu.");
    try { await startTransfer(type, from, ids, { storageId: to, folderId: toF, folderName: storages.find((s) => s.id === to)?.name ?? "" }, policy); fromSel.clear(); } catch (e) { toast.error((e as Error).message); }
  };
  const drop = (toS: string) => async (p: { storageId: string; ids: string[] }, target: string, copy: boolean) => {
    try { await startTransfer(copy ? "COPY" : "MOVE", p.storageId, p.ids, { storageId: toS, folderId: target, folderName: "panel tujuan" }, policy); selA.clear(); selB.clear(); } catch (e) { toast.error((e as Error).message); }
  };
  const nA = selA.selected.size, nB = selB.selected.size;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Salin dua panel" subtitle="Pilih file di satu sisi, lalu salin atau pindahkan ke sisi lain. Bisa juga ditarik dan dilepas." />
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5 sm:px-8">
        <Button size="sm" variant="primary" disabled={!nA} icon={<Copy className="size-3.5" />} onClick={() => send("COPY", "ab")}>Salin <ArrowRight className="size-3.5" /></Button>
        <Button size="sm" disabled={!nA} icon={<FolderInput className="size-3.5" />} onClick={() => send("MOVE", "ab")}>Pindahkan <ArrowRight className="size-3.5" /></Button>
        <span className="mx-1 h-5 w-px bg-line" />
        <Button size="sm" variant="primary" disabled={!nB} icon={<ArrowLeft className="size-3.5" />} onClick={() => send("COPY", "ba")}>Salin</Button>
        <Button size="sm" disabled={!nB} icon={<ArrowLeft className="size-3.5" />} onClick={() => send("MOVE", "ba")}>Pindahkan</Button>
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-[12px] text-muted">Jika nama sama<Select className="h-8 w-40 text-[13px]" value={policy} onChange={(e) => setPolicy(e.target.value as ConflictPolicy)}><option value="RENAME">Simpan keduanya</option><option value="SKIP">Lewati</option><option value="OVERWRITE">Timpa</option><option value="FAIL">Hentikan</option></Select></label>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-6 lg:flex-row">
        <Pane label="Sumber" storageId={aS} setStorageId={setAS} folderId={aF} setFolderId={setAF} selection={selA} storages={storages} onDrop={drop(aS)} onEntries={setEa} />
        <Pane label="Tujuan" storageId={bS} setStorageId={setBS} folderId={bF} setFolderId={setBF} selection={selB} storages={storages} onDrop={drop(bS)} onEntries={setEb} />
      </div>
    </div>
  );
}
