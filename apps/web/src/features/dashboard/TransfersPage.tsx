import type { Paged, TransferItemDto, TransferJobDto } from "@superdrive/shared";
import { formatBytes } from "@superdrive/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, Columns2, Eraser, FilterX, Pause, Play, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dateTime, formatEta, formatSpeed, percent } from "@/lib/format";
import { PageHeader, useStorages } from "@/features/layout/Shell";
import { useDebounced } from "@/lib/useDebounced";
import { Dialog } from "@/ui/Dialog";
import { Input, Select } from "@/ui/Field";
import { transferActions, transferStore, type JobView } from "@/features/transfers/store";
import { Button } from "@/ui/Button";
import { EmptyState, Progress, Skeleton, TransferStatusBadge } from "@/ui/misc";

const ACTIVE = ["QUEUED", "VALIDATING", "RUNNING", "RETRYING", "VERIFYING"];
const TABS = [["all", "Semua"], ["active", "Aktif"], ["done", "Selesai"], ["failed", "Gagal"]] as const;

function Metric({ label, value }: { label: string; value: string }) { return <div className="flex gap-1.5 text-[12px]"><span className="text-muted">{label}</span><span className="tnum font-medium">{value}</span></div>; }

function Items({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["transfer-items", id], queryFn: () => api<{ items: TransferItemDto[]; total: number }>(`/transfers/${id}/items?limit=200`), staleTime: 3000, refetchInterval: 4000 });
  if (q.isLoading) return <Skeleton className="mt-3 h-20" />;
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-line bg-surface">
      <ul className="scroll-thin max-h-64 divide-y divide-line overflow-y-auto">
        {q.data?.items.map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-3 py-2 text-[12px]">
            <span className="min-w-0 flex-1 truncate" title={i.relativePath ?? i.fileName}>{i.relativePath ?? i.fileName}</span>
            <span className="tnum text-muted">{formatBytes(i.fileSize)}</span>
            <TransferStatusBadge status={i.status} />
            {i.errorMessage && <span className="max-w-48 truncate text-danger-ink" title={i.errorMessage}>{i.errorMessage}</span>}
          </li>))}
      </ul>
      {q.data && q.data.total > q.data.items.length && <p className="border-t border-line px-3 py-2 text-[12px] text-muted">Menampilkan {q.data.items.length} dari {q.data.total} file.</p>}
    </div>
  );
}

function JobCard({ j }: { j: JobView }) {
  const [open, setOpen] = useState(false);
  const live = ACTIVE.includes(j.status); const paused = j.status === "PAUSED";
  const pct = percent(j.transferredBytes, j.totalBytes) || (j.totalFiles ? Math.floor(((j.completedFiles + j.skippedFiles) / j.totalFiles) * 100) : 0);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { toast.error((e as Error).message); } };
  const tone = j.status === "FAILED" ? "danger" : j.status === "COMPLETED" ? "ok" : j.status === "RETRYING" ? "warn" : "primary";
  return (
    <li className="rounded-[10px] border border-line bg-surface-2/50 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold" title={j.title}>{j.title}</h3>
        <TransferStatusBadge status={j.status} />
        <div className="flex items-center gap-1 text-[12px] text-muted"><span className="truncate">{j.sourceStorageName}</span><ArrowRight className="size-3" aria-hidden /><span className="truncate">{j.destinationStorageName}</span><span className="ml-1 rounded bg-surface px-1.5 py-0.5 text-[11px] font-medium">{j.type === "COPY" ? "Salin" : "Pindah"}</span></div>
      </div>
      {(live || paused || j.status === "COMPLETED") && <div className="mt-3 flex items-center gap-3"><Progress value={j.status === "COMPLETED" ? 100 : pct} tone={tone} className="flex-1" /><span className="tnum w-9 text-right text-[12px] font-medium">{j.status === "COMPLETED" ? 100 : pct}%</span></div>}
      {j.errorMessage && <p className="mt-2 text-[12px] text-danger-ink">{j.errorMessage}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <Metric label="File" value={`${j.completedFiles + j.skippedFiles}/${j.totalFiles}${j.failedFiles ? ` · ${j.failedFiles} gagal` : ""}`} />
        <Metric label="Ukuran" value={formatBytes(j.totalBytes)} />
        <Metric label="Terkirim" value={formatBytes(j.transferredBytes)} />
        {j.status === "RUNNING" && <><Metric label="Kecepatan" value={formatSpeed(j.speed)} /><Metric label="Perkiraan" value={formatEta(j.eta)} /></>}
        {!live && !paused && <Metric label="Selesai" value={dateTime(j.completedAt)} />}
        <span className="flex-1" />
        <div className="flex items-center gap-1">
          {live && <Button size="sm" variant="ghost" icon={<Pause className="size-3.5" />} onClick={() => act(() => transferActions.pause(j.id))}>Jeda</Button>}
          {paused && <Button size="sm" variant="soft" icon={<Play className="size-3.5" />} onClick={() => act(() => transferActions.resume(j.id))}>Lanjutkan</Button>}
          {(live || paused) && <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => act(() => transferActions.cancel(j.id))}>Batal</Button>}
          {(j.status === "FAILED" || j.status === "CANCELLED") && <Button size="sm" variant="soft" icon={<RotateCcw className="size-3.5" />} onClick={() => act(() => transferActions.retry(j.id))}>Ulangi</Button>}
          <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Rincian<ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} /></Button>
        </div>
      </div>
      {open && <Items id={j.id} />}
    </li>
  );
}

const EMPTY = { status: "all", q: "", type: "", storageId: "", from: "", to: "" };

export default function TransfersPage() {
  const qc = useQueryClient(); const storages = useStorages().data ?? []; const live = transferStore.use((s) => s.jobs);
  const [f, setF] = useState(EMPTY); const [page, setPage] = useState(1); const [limit, setLimit] = useState(20); const [clear, setClear] = useState<null | "finished" | "done" | "failed">(null);
  const q = useDebounced(f.q, 300);
  useEffect(() => setPage(1), [f.status, q, f.type, f.storageId, f.from, f.to, limit]);
  const qs = (extra = "") => `status=${f.status}${q ? `&q=${encodeURIComponent(q)}` : ""}${f.type ? `&type=${f.type}` : ""}${f.storageId ? `&storageId=${f.storageId}` : ""}${f.from ? `&from=${new Date(`${f.from}T00:00:00`).toISOString()}` : ""}${f.to ? `&to=${new Date(`${f.to}T23:59:59`).toISOString()}` : ""}${extra}`;
  const res = useQuery({ queryKey: ["transfers", f.status, q, f.type, f.storageId, f.from, f.to, page, limit], queryFn: () => api<Paged<TransferJobDto>>(`/transfers?${qs(`&page=${page}&limit=${limit}`)}`), placeholderData: (p) => p, staleTime: 3000 });
  const count = (status: string) => useQuery({ queryKey: ["transfers-count", status], queryFn: () => api<Paged<TransferJobDto>>(`/transfers?status=${status}&limit=1`).then((r) => r.total), staleTime: 5000 }).data ?? 0; // eslint-disable-line react-hooks/rules-of-hooks
  const nActive = count("active"), nDone = count("done"), nFailed = count("failed");

  // Keep the list fresh as jobs change state (progress itself comes from the live stream below).
  const signature = useMemo(() => live.map((j) => `${j.id}:${j.status}`).join("|"), [live]);
  useEffect(() => { void qc.invalidateQueries({ queryKey: ["transfers"] }); void qc.invalidateQueries({ queryKey: ["transfers-count"] }); }, [signature, qc]);
  const liveById = useMemo(() => new Map(live.map((j) => [j.id, j])), [live]);
  const items: JobView[] = (res.data?.items ?? []).map((j) => liveById.get(j.id) ?? { ...j, speed: null, eta: null });
  const pages = Math.max(1, Math.ceil((res.data?.total ?? 0) / limit));
  const dirty = JSON.stringify(f) !== JSON.stringify(EMPTY);
  const clearHistory = async () => { try { const r = await api<{ removed: number }>(`/transfers?${qs()}&scope=${clear}`, { method: "DELETE" }); toast.success(`${r.removed} riwayat dibersihkan`); setClear(null); void qc.invalidateQueries({ queryKey: ["transfers"] }); void qc.invalidateQueries({ queryKey: ["transfers-count"] }); } catch (e) { toast.error((e as Error).message); } };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Transfer" subtitle="Pantau pemindahan file antar penyimpanan." actions={<Link to="/dual"><Button variant="primary" size="sm" icon={<Columns2 className="size-4" />}>Transfer baru</Button></Link>} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-surface px-4 py-3 sm:px-8">
        {([["Aktif", nActive, "bg-primary"], ["Selesai", nDone, "bg-ok-ink"], ["Gagal/batal", nFailed, "bg-danger"]] as const).map(([l, v, c]) => (
          <div key={l} className="flex items-center gap-1.5 text-[12px]"><span className={cn("size-2 rounded-full", c)} aria-hidden /><span className="text-muted">{l}</span><span className="tnum text-[13px] font-semibold">{v}</span></div>))}
        <span className="flex-1" />
        <div className="flex rounded-lg bg-surface-2 p-0.5" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={f.status === k} onClick={() => setF({ ...f, status: k })} className={cn("rounded-md px-3.5 py-1.5 text-[12px] font-medium text-muted transition-colors", f.status === k && "bg-surface text-ink shadow-card")}>{l}</button>)}</div>
      </div>
      <div className="grid grid-cols-2 items-center gap-2 border-b border-line bg-surface px-4 py-2.5 sm:flex sm:flex-wrap sm:px-8">
        <div className="relative col-span-2 sm:col-span-1"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" aria-hidden /><Input aria-label="Cari transfer" className="h-8 w-full pl-8 sm:w-52 text-[13px]" placeholder="Cari nama" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
        <Select aria-label="Jenis" className="h-8 w-full sm:w-32 text-[13px]" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Semua jenis</option><option value="COPY">Salin</option><option value="MOVE">Pindah</option></Select>
        <Select aria-label="Penyimpanan" className="h-8 w-full sm:w-44 text-[13px]" value={f.storageId} onChange={(e) => setF({ ...f, storageId: e.target.value })}><option value="">Semua penyimpanan</option>{storages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Input type="date" aria-label="Dari tanggal" className="h-8 w-full sm:w-36 text-[13px]" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /><span className="hidden text-muted sm:inline">–</span><Input type="date" aria-label="Sampai tanggal" className="h-8 w-full sm:w-36 text-[13px]" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <Button size="sm" variant="ghost" disabled={!dirty} icon={<FilterX className="size-4" />} onClick={() => setF(EMPTY)}>Reset filter</Button>
        <span className="hidden flex-1 sm:block" />
        <Select aria-label="Bersihkan riwayat" className="h-8 w-full sm:w-44 text-[13px]" value="" onChange={(e) => { if (e.target.value) setClear(e.target.value as "finished" | "done" | "failed"); }}><option value="">Bersihkan riwayat…</option><option value="done">Yang selesai</option><option value="failed">Yang gagal / dibatalkan</option><option value="finished">Semua yang sudah berakhir</option></Select>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto p-4 sm:p-8">
        {res.isLoading ? <Skeleton className="mx-auto h-48 max-w-4xl" /> : items.length === 0 ? <EmptyState icon={Columns2} title={dirty ? "Tidak ada transfer yang cocok" : "Belum ada transfer"} action={dirty ? <Button onClick={() => setF(EMPTY)}>Reset filter</Button> : <Link to="/dual"><Button variant="primary">Buka salin dua panel</Button></Link>}>{dirty ? "Ubah atau reset filter." : "Pilih file di file manager lalu pilih Salin atau Pindahkan, atau gunakan tampilan dua panel."}</EmptyState>
          : <ul className="mx-auto max-w-4xl space-y-3">{items.map((j) => <JobCard key={j.id} j={j} />)}</ul>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface px-4 py-2.5 text-[12px] text-muted sm:px-8">
        <span className="tnum">{res.data?.total ?? 0} transfer{res.isFetching ? " · memperbarui…" : ""}</span>
        <div className="flex items-center gap-2"><label className="flex items-center gap-1.5">Per halaman<Select aria-label="Per halaman" className="h-8 w-[76px] pr-6 pl-2 text-[12px]" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>{[10, 20, 50, 100].map((n) => <option key={n}>{n}</option>)}</Select></label>
          <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Sebelumnya</Button><span className="tnum">{page} / {pages}</span><Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Berikutnya</Button></div>
      </div>
      <Dialog open={clear !== null} onClose={() => setClear(null)} width="max-w-sm" title="Bersihkan riwayat?" footer={<><Button onClick={() => setClear(null)}>Batal</Button><Button variant="danger" icon={<Eraser className="size-4" />} onClick={clearHistory}>Bersihkan</Button></>}>
        <p className="text-[14px] text-muted">Catatan transfer yang sudah berakhir{dirty ? " dan cocok dengan filter saat ini" : ""} akan dihapus dari daftar. <b className="text-ink">File tidak disentuh</b>, dan transfer yang masih berjalan tidak ikut terhapus.</p>
      </Dialog>
    </div>
  );
}
