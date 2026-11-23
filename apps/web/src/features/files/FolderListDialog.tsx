import { FOLDER_LIST_MAX, parseFolderList, type FolderNode } from "@superdrive/shared";
import { FolderClosed } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";

const EXAMPLE = "Proyek\n  Desain\n  Kode\nArsip 2025";

function Tree({ nodes, depth = 0 }: { nodes: FolderNode[]; depth?: number }) {
  return <>{nodes.map((n, i) => (
    <div key={`${n.name}-${i}`}>
      <div className="flex items-center gap-1.5 py-0.5 text-[13px]" style={{ paddingLeft: depth * 16 }}><FolderClosed className="size-3.5 shrink-0 text-primary" aria-hidden /><span className="truncate">{n.name}</span></div>
      <Tree nodes={n.children} depth={depth + 1} />
    </div>))}</>;
}

/** Creates several folders at once from a list: one name per line, indented lines become subfolders. */
export function FolderListDialog({ open, storageId, parentId, parentName, onClose, onDone }: { open: boolean; storageId: string; parentId: string; parentName: string; onClose(): void; onDone(): void }) {
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { if (open) { setText(""); setErr(""); } }, [open]);
  const parsed = useMemo(() => parseFolderList(text), [text]);
  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api<{ created: number; existing: number; skipped: string[] }>("/files/folders/batch", { body: { storageId, parentId, text } });
      toast.success(`${r.created} folder dibuat${r.existing ? `, ${r.existing} sudah ada` : ""}${r.skipped.length ? `, ${r.skipped.length} dilewati` : ""}`);
      onDone(); onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} width="max-w-2xl" title="Folder baru dari daftar"
      footer={<><span className="mr-auto self-center text-[12px] text-muted" aria-live="polite">{parsed.count ? `${parsed.count} folder akan dibuat di “${parentName}”` : "Belum ada nama"}</span><Button onClick={onClose}>Batal</Button><Button variant="primary" loading={busy} disabled={!parsed.count || parsed.errors.length > 0} onClick={submit}>Buat</Button></>}>
      <p className="mb-2 text-[13px] text-muted">Tulis satu nama folder per baris. Baris yang menjorok (spasi atau Tab) menjadi subfolder dari baris di atasnya. Folder yang sudah ada dipakai ulang. Maksimal {FOLDER_LIST_MAX} folder.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="folder-list" className="block text-[13px] font-medium">Daftar nama</label>
          <textarea id="folder-list" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} rows={9} spellCheck={false}
            className="block min-h-40 w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 font-mono text-[16px] text-ink placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 sm:text-[13px]" />
        </div>
        <div className="space-y-1.5">
          <span className="block text-[13px] font-medium">Hasil</span>
          <div className="max-h-56 min-h-40 overflow-auto rounded-lg border border-line bg-surface-2 p-2.5" aria-label="Pratinjau folder">
            {parsed.nodes.length ? <Tree nodes={parsed.nodes} /> : <p className="text-[13px] text-muted">Pratinjau pohon folder muncul di sini.</p>}
          </div>
        </div>
      </div>
      {(parsed.errors.length > 0 || err) && <ul role="alert" className="mt-3 space-y-0.5 text-[13px] text-danger-ink">{[...parsed.errors.slice(0, 4), ...(err ? [err] : [])].map((e) => <li key={e}>{e}</li>)}</ul>}
    </Dialog>
  );
}
