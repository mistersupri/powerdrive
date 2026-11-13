import type { Paged, TrashItemDto } from "@superdrive/shared";
import { formatBytes } from "@superdrive/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { File, Folder, RotateCcw, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { dateTime, timeAgo } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";
import { useWorkspace } from "@/features/auth/useAuth";
import { PageHeader, useStorages } from "@/features/layout/Shell";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input, Select } from "@/ui/Field";
import { Card, EmptyState, Skeleton } from "@/ui/misc";

export default function TrashPage() {
  const qc = useQueryClient(); const { isAdmin } = useWorkspace(); const storages = useStorages().data ?? [];
  const [page, setPage] = useState(1); const [limit, setLimit] = useState(25); const [text, setText] = useState(""); const [storageId, setStorageId] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set()); const [confirm, setConfirm] = useState<null | "purge" | "empty">(null);
  const qtext = useDebounced(text, 300);
  const q = useQuery({ queryKey: ["trash", page, limit, qtext, storageId], queryFn: () => api<Paged<TrashItemDto>>(`/trash?page=${page}&limit=${limit}${qtext ? `&q=${encodeURIComponent(qtext)}` : ""}${storageId ? `&storageId=${storageId}` : ""}`), placeholderData: (p) => p });
  useEffect(() => setPage(1), [qtext, storageId, limit]);
  const items = q.data?.items ?? []; const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / limit));
  const done = () => { setSel(new Set()); void qc.invalidateQueries({ queryKey: ["trash"] }); void qc.invalidateQueries({ queryKey: ["files"] }); };
  const restore = useMutation({ mutationFn: (ids: string[]) => api("/trash/restore", { body: { ids } }), onSuccess: (_d, ids) => { toast.success(ids.length === 1 ? "Dipulihkan ke lokasi semula" : `${ids.length} item dipulihkan`); done(); }, onError: (e) => { toast.error((e as Error).message); done(); } });
  const purge = useMutation({ mutationFn: (ids: string[]) => api("/trash/purge", { body: { ids } }), onSuccess: () => { toast.success("Dihapus permanen"); setConfirm(null); done(); }, onError: (e) => toast.error((e as Error).message) });
  const empty = useMutation({ mutationFn: () => api<{ removed: number }>(`/trash${storageId ? `?storageId=${storageId}` : ""}`, { method: "DELETE" }), onSuccess: (r) => { toast.success(`${r.removed} item dihapus permanen`); setConfirm(null); done(); } });
  const all = items.length > 0 && items.every((i) => sel.has(i.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Sampah" subtitle="Item yang dihapus disimpan 30 hari sebelum dihapus permanen." actions={isAdmin && (q.data?.total ?? 0) > 0 ? <Button size="sm" variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirm("empty")}>Kosongkan sampah</Button> : undefined} />
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5 sm:px-8">
        <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" aria-hidden /><Input aria-label="Cari di sampah" className="h-8 w-56 pl-8 text-[13px]" placeholder="Cari nama" value={text} onChange={(e) => setText(e.target.value)} /></div>
        <Select aria-label="Penyimpanan" className="h-8 w-44 text-[13px]" value={storageId} onChange={(e) => setStorageId(e.target.value)}><option value="">Semua penyimpanan</option>{storages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <span className="flex-1" />
        {sel.size > 0 && <><span className="tnum text-[13px] text-muted">{sel.size} dipilih</span><Button size="sm" variant="primary" icon={<RotateCcw className="size-3.5" />} loading={restore.isPending} onClick={() => restore.mutate([...sel])}>Pulihkan</Button><Button size="sm" variant="ghost" className="text-danger-ink hover:bg-danger-soft" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirm("purge")}>Hapus permanen</Button></>}
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto p-4 sm:p-8">
        {q.isLoading ? <Skeleton className="h-64" /> : !items.length ? <EmptyState icon={Trash2} title={qtext || storageId ? "Tidak ada yang cocok" : "Sampah kosong"}>{qtext || storageId ? "Ubah pencarian atau filter." : "File yang Anda hapus akan muncul di sini dan bisa dipulihkan."}</EmptyState> : (
          <Card className="mx-auto max-w-6xl overflow-hidden">
            <table className="w-full text-left text-[13px]"><thead><tr className="border-b border-line bg-surface-2/60 text-[12px] text-muted">
              <th className="w-10 px-4 py-2.5"><input type="checkbox" aria-label="Pilih semua" className="size-4 accent-[var(--primary)]" checked={all} onChange={() => setSel(all ? new Set() : new Set(items.map((i) => i.id)))} /></th>
              <th className="px-2 py-2.5 font-semibold">Nama</th><th className="hidden px-4 py-2.5 font-semibold md:table-cell">Lokasi asal</th><th className="hidden px-4 py-2.5 font-semibold lg:table-cell">Penyimpanan</th><th className="px-4 py-2.5 text-right font-semibold">Ukuran</th><th className="hidden px-4 py-2.5 font-semibold sm:table-cell">Dihapus</th><th className="w-24" /></tr></thead>
              <tbody className="divide-y divide-line">{items.map((i) => (
                <tr key={i.id} className={sel.has(i.id) ? "bg-primary-soft" : "hover:bg-surface-2/60"}>
                  <td className="px-4 py-2.5"><input type="checkbox" aria-label={`Pilih ${i.name}`} className="size-4 accent-[var(--primary)]" checked={sel.has(i.id)} onChange={() => toggle(i.id)} /></td>
                  <td className="max-w-0 px-2 py-2.5"><span className="flex items-center gap-2 truncate">{i.isFolder ? <Folder className="size-4 shrink-0 text-primary-ink" /> : <File className="size-4 shrink-0 text-muted" />}<span className="truncate font-medium" title={i.name}>{i.name}</span></span></td>
                  <td className="hidden max-w-48 truncate px-4 py-2.5 text-muted md:table-cell" title={i.originalPath}>{i.originalPath}</td><td className="hidden truncate px-4 py-2.5 text-muted lg:table-cell">{i.storageName}</td>
                  <td className="tnum px-4 py-2.5 text-right text-muted">{i.isFolder ? "—" : formatBytes(i.size)}</td>
                  <td className="hidden px-4 py-2.5 text-muted sm:table-cell" title={dateTime(i.trashedAt)}>{timeAgo(i.trashedAt)}{i.trashedBy ? ` · ${i.trashedBy}` : ""}</td>
                  <td className="px-2 py-2.5 text-right"><Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} aria-label={`Pulihkan ${i.name}`} onClick={() => restore.mutate([i.id])}>Pulihkan</Button></td></tr>))}</tbody></table>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[12px] text-muted"><span className="tnum">{q.data!.total} item</span>
              <div className="flex items-center gap-2"><label className="flex items-center gap-1.5">Per halaman<Select aria-label="Per halaman" className="h-7 w-16 text-[12px]" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>{[10, 25, 50, 100].map((n) => <option key={n}>{n}</option>)}</Select></label>
                <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Sebelumnya</Button><span className="tnum">{page} / {pages}</span><Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Berikutnya</Button></div></div>
          </Card>)}
      </div>
      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} width="max-w-sm" title={confirm === "empty" ? "Kosongkan sampah?" : `Hapus permanen ${sel.size} item?`}
        footer={<><Button onClick={() => setConfirm(null)}>Batal</Button><Button variant="danger" loading={purge.isPending || empty.isPending} onClick={() => (confirm === "empty" ? empty.mutate() : purge.mutate([...sel]))}>Hapus permanen</Button></>}>
        <p className="text-[14px] text-muted">{confirm === "empty" ? `Semua item${storageId ? " di penyimpanan ini" : ""} akan dihapus permanen. ` : ""}<b className="text-ink">Tindakan ini tidak bisa dibatalkan.</b></p>
      </Dialog>
    </div>
  );
}
