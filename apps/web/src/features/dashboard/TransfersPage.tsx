import { Pagination } from "@/ui/Pagination";
import type { Paged, PlaceDto, TransferItemDto, TransferJobDto, UploadHistoryDto } from "@superdrive/shared";
import { formatBytes } from "@superdrive/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, Columns2, Eraser, FilterX, MapPin, Pause, Play, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dateTime, formatEta, formatSpeed, percent } from "@/lib/format";
import { PageHeader, useStorages } from "@/features/layout/Shell";
import { useDebounced } from "@/lib/useDebounced";
import { placeHref } from "@/lib/place";
import { Dialog } from "@/ui/Dialog";
import { Input, Select } from "@/ui/Field";
import { transferActions, transferStore, type JobView } from "@/features/transfers/store";
import { Button } from "@/ui/Button";
import { uploadActions, uploadStore, type UploadTask } from "@/features/uploads/manager";
import { sortUploads, UploadRow } from "@/features/transfers/FloatingProgress";
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
            <span className="min-w-0 flex-1 break-all sm:truncate" title={i.relativePath ?? i.fileName}>{i.relativePath ?? i.fileName}</span>
            <span className="tnum text-muted">{formatBytes(i.fileSize)}</span>
            <TransferStatusBadge status={i.status} />
            {i.errorMessage && <span className="break-words text-danger-ink sm:max-w-48 sm:truncate" title={i.errorMessage}>{i.errorMessage}</span>}
          </li>))}
      </ul>
      {q.data && q.data.total > q.data.items.length && <p className="border-t border-line px-3 py-2 text-[12px] text-muted">Menampilkan {q.data.items.length} dari {q.data.total} file.</p>}
    </div>
  );
}

/** A folder as a link that opens it in the file manager. */
function PlaceLink({ label, place, storageName }: { label?: string; place: PlaceDto; storageName?: string }) {
  const storages = useStorages().data ?? [];
  return <Link to={placeHref(storages, place)} className="inline-flex max-w-full items-center gap-1 text-[12px] text-muted hover:text-primary-ink" title="Buka folder ini"><MapPin className="size-3 shrink-0" aria-hidden />{label && <span className="shrink-0 text-faint">{label}</span>}<span className="truncate">{storageName ? `${storageName} · ` : ""}{place.path}</span></Link>;
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
        <h3 className="min-w-0 basis-full break-all text-[14px] font-semibold sm:basis-0 sm:flex-1 sm:truncate" title={j.title}>{j.title}</h3>
        <TransferStatusBadge status={j.status} />
        <div className="flex items-center gap-1 text-[12px] text-muted"><span className="sm:truncate">{j.sourceStorageName}</span><ArrowRight className="size-3" aria-hidden /><span className="sm:truncate">{j.destinationStorageName}</span><span className="ml-1 rounded bg-surface px-1.5 py-0.5 text-[11px] font-medium">{j.type === "COPY" ? "Salin" : "Pindah"}</span></div>
      </div>
      {(live || paused || j.status === "COMPLETED") && <div className="mt-3 flex items-center gap-3"><Progress value={j.status === "COMPLETED" ? 100 : pct} tone={tone} className="flex-1" /><span className="tnum w-9 text-right text-[12px] font-medium">{j.status === "COMPLETED" ? 100 : pct}%</span></div>}
      {j.errorMessage && <p className="mt-2 text-[12px] text-danger-ink">{j.errorMessage}</p>}
      {(j.sourcePlace || j.destinationPlace) && <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">{j.sourcePlace && <PlaceLink label="Dari" place={j.sourcePlace} storageName={j.sourceStorageName} />}{j.destinationPlace && <PlaceLink label="Ke" place={j.destinationPlace} storageName={j.destinationStorageName} />}</div>}
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

/** What this account has uploaded lately (kept on the server for 90 days), with a link to the folder each file went to. */
function UploadHistory() {
  const q = useQuery({ queryKey: ["upload-history"], queryFn: () => api<Paged<UploadHistoryDto>>("/uploads/history?limit=30"), staleTime: 15_000 });
  const items = q.data?.items ?? [];
  if (!items.length) return null;
  return (
    <section aria-label="Riwayat unggahan" className="rounded-[10px] border border-line bg-surface-2/50">
      <div className="flex flex-wrap items-center gap-x-3 p-4 pb-2"><h3 className="flex-1 text-[14px] font-semibold">Riwayat unggahan</h3><span className="tnum text-[12px] text-muted">{q.data?.total ?? 0} file · 90 hari terakhir</span></div>
      <ul className="scroll-thin max-h-[24rem] divide-y divide-line overflow-y-auto">
        {items.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-[13px]">
            <span className="min-w-0 flex-1 basis-full break-all sm:basis-0 sm:truncate" title={h.name}>{h.name}</span>
            <span className="tnum text-[12px] text-muted">{formatBytes(h.size)}</span>
            <span className={cn("text-[12px]", h.status === "FAILED" ? "text-danger-ink" : "text-muted")}>{h.status === "FAILED" ? "Gagal" : h.status === "SKIPPED" ? "Dilewati" : dateTime(h.createdAt)}</span>
            {h.place && <PlaceLink place={h.place} storageName={h.storageName} />}
            {h.errorMessage && <span className="basis-full text-[12px] text-danger-ink">{h.errorMessage}</span>}
          </li>))}
      </ul>
    </section>
  );
}

const UPLOAD_GROUP: Record<string, string> = { queued: "active", uploading: "active", processing: "active", done: "done", skipped: "done", error: "failed", cancelled: "failed" };

/** Files this browser is sending right now (kept in memory, so they disappear on reload). */
function UploadsCard({ tasks }: { tasks: UploadTask[] }) {
  const active = tasks.filter((t) => UPLOAD_GROUP[t.status] === "active").length;
  const sent = tasks.reduce((n, t) => n + (t.status === "done" || t.status === "skipped" ? t.size : t.status === "processing" ? t.size : Math.min(t.sent, t.size)), 0);
  const total = tasks.reduce((n, t) => n + t.size, 0);
  return (
    <section aria-label="Unggahan dari perangkat ini" className="rounded-[10px] border border-line bg-surface-2/50">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4 pb-2">
        <h3 className="flex-1 text-[14px] font-semibold">Unggahan dari perangkat ini</h3>
        <span className="tnum text-[12px] text-muted">{active} berjalan · {tasks.length} file · {formatBytes(sent)} / {formatBytes(total)}</span>
        {active === 0 && <Button size="sm" variant="ghost" onClick={() => uploadActions.clearFinished()}>Bersihkan</Button>}
      </div>
      <div className="px-4"><Progress value={percent(sent, total)} className="h-1.5" /></div>
      <ul className="scroll-thin mt-2 max-h-[28rem] overflow-y-auto">{sortUploads(tasks).map((t) => <UploadRow key={t.id} t={t} />)}</ul>
    </section>
  );
}

const EMPTY = { status: "all", q: "", type: "", storageId: "", from: "", to: "" };

export default function TransfersPage() {
  const qc = useQueryClient(); const storages = useStorages().data ?? []; const live = transferStore.use((s) => s.jobs);
  const [showFilters, setShowFilters] = useState(false); const [f, setF] = useState(EMPTY); const [page, setPage] = useState(1); const [limit, setLimit] = useState(20); const [clear, setClear] = useState<null | "finished" | "done" | "failed">(null);
  const q = useDebounced(f.q, 300);
  useEffect(() => setPage(1), [f.status, q, f.type, f.storageId, f.from, f.to, limit]);
  const qs = (extra = "") => `status=${f.status}${q ? `&q=${encodeURIComponent(q)}` : ""}${f.type ? `&type=${f.type}` : ""}${f.storageId ? `&storageId=${f.storageId}` : ""}${f.from ? `&from=${new Date(`${f.from}T00:00:00`).toISOString()}` : ""}${f.to ? `&to=${new Date(`${f.to}T23:59:59`).toISOString()}` : ""}${extra}`;
  const res = useQuery({ queryKey: ["transfers", f.status, q, f.type, f.storageId, f.from, f.to, page, limit], queryFn: () => api<Paged<TransferJobDto>>(`/transfers?${qs(`&page=${page}&limit=${limit}`)}`), placeholderData: (p) => p, staleTime: 3000 });
  const count = (status: string) => useQuery({ queryKey: ["transfers-count", status], queryFn: () => api<Paged<TransferJobDto>>(`/transfers?status=${status}&limit=1`).then((r) => r.total), staleTime: 5000 }).data ?? 0; // eslint-disable-line react-hooks/rules-of-hooks
  const nActive = count("active"), nDone = count("done"), nFailed = count("failed"), nAll = count("all");

  // Keep the list fresh as jobs change state (progress itself comes from the live stream below).
  const signature = useMemo(() => live.map((j) => `${j.id}:${j.status}`).join("|"), [live]);
  useEffect(() => { void qc.invalidateQueries({ queryKey: ["transfers"] }); void qc.invalidateQueries({ queryKey: ["transfers-count"] }); }, [signature, qc]);
  const allUploads = uploadStore.use((s) => s.tasks); const uq = q.trim().toLowerCase();
  const uploads = f.type ? [] : allUploads.filter((t) => (f.status === "all" || UPLOAD_GROUP[t.status] === f.status) && (!uq || t.relativePath.toLowerCase().includes(uq)) && (!f.storageId || f.storageId === t.storageId));
  const liveById = useMemo(() => new Map(live.map((j) => [j.id, j])), [live]);
  const items: JobView[] = (res.data?.items ?? []).map((j) => liveById.get(j.id) ?? { ...j, speed: null, eta: null });
  const pages = Math.max(1, Math.ceil((res.data?.total ?? 0) / limit));
  const dirty = JSON.stringify(f) !== JSON.stringify(EMPTY); const activeN = [f.type, f.storageId, f.from, f.to].filter(Boolean).length;
  const clearHistory = async () => { try { const r = await api<{ removed: number }>(`/transfers?${qs()}&scope=${clear}`, { method: "DELETE" }); toast.success(`${r.removed} riwayat dibersihkan`); setClear(null); void qc.invalidateQueries({ queryKey: ["transfers"] }); void qc.invalidateQueries({ queryKey: ["transfers-count"] }); } catch (e) { toast.error((e as Error).message); } };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Transfer" subtitle="Pantau pemindahan file antar penyimpanan." actions={<div className="flex items-center gap-2"><Button size="sm" className="max-sm:hidden" icon={<Eraser className="size-4" />} onClick={() => setClear("finished")}>Bersihkan</Button><Link to="/dual"><Button variant="primary" size="sm" iconOnlyMobile icon={<Columns2 className="size-4" />}>Transfer baru</Button></Link></div>} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-surface px-4 py-3 max-sm:hidden sm:px-8">
        {([["Aktif", nActive, "bg-primary"], ["Selesai", nDone, "bg-ok-ink"], ["Gagal/batal", nFailed, "bg-danger"]] as const).map(([l, v, c]) => (
          <div key={l} className="flex items-center gap-1.5 text-[12px]"><span className={cn("size-2 rounded-full", c)} aria-hidden /><span className="text-muted">{l}</span><span className="tnum text-[13px] font-semibold">{v}</span></div>))}
        <span className="flex-1" />
        <div className="flex rounded-lg bg-surface-2 p-0.5" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={f.status === k} onClick={() => setF({ ...f, status: k })} className={cn("rounded-md px-3.5 py-1.5 text-[12px] font-medium text-muted transition-colors", f.status === k && "bg-surface text-ink shadow-card")}>{l}</button>)}</div>
      </div>
      <div className="border-b border-line bg-surface px-4 py-2.5 sm:px-8">
        {/* Phones: the status as chips with counts, like the media gallery. */}
        <div role="group" aria-label="Status transfer" className="mb-2 flex items-center gap-1 overflow-x-auto sm:hidden">
          {([["all", "Semua", nAll], ["active", "Aktif", nActive], ["done", "Selesai", nDone], ["failed", "Gagal", nFailed]] as const).map(([k, l, n]) => (
            <button key={k} type="button" aria-pressed={f.status === k} onClick={() => setF({ ...f, status: k })} className={cn("h-9 shrink-0 rounded-full px-3.5 text-[13px] font-medium pointer-coarse:h-11", f.status === k ? "bg-primary-soft text-primary-ink" : "text-muted hover:bg-surface-2")}>{l}<span className="tnum ml-1.5 text-[12px] opacity-70">{n}</span></button>))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-0 sm:flex-none sm:basis-auto"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" aria-hidden /><Input aria-label="Cari transfer" className="h-9 w-full pl-8 text-[13px] sm:h-8 sm:w-52" placeholder="Cari nama" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
          {/* On phones the filters stay folded away; the badge says how many are active. */}
          <span className="relative sm:hidden"><Button size="sm" iconOnlyMobile  variant={showFilters || activeN ? "soft" : "secondary"} aria-expanded={showFilters} aria-controls="transfer-filters" aria-label={activeN ? `Filter, ${activeN} aktif` : "Filter"} title="Filter" icon={<SlidersHorizontal className="size-4" />} onClick={() => setShowFilters((v) => !v)}>
            Filter
          </Button>{activeN > 0 && <span aria-hidden className="tnum pointer-events-none absolute -top-1.5 -right-1.5 grid size-[18px] place-items-center rounded-full bg-primary text-[11px] font-semibold text-white ring-2 ring-surface">{activeN}</span>}</span>
          <Button size="sm" iconOnlyMobile className="sm:hidden" aria-label="Bersihkan riwayat" title="Bersihkan riwayat" icon={<Eraser className="size-4" />} onClick={() => setClear("finished")}>Bersihkan</Button>
          <div id="transfer-filters" className={cn("w-full grid-cols-2 gap-2 sm:contents", showFilters ? "grid" : "hidden")}>
            <label className="text-[12px] text-muted sm:contents"><span className="sm:sr-only">Jenis</span><Select aria-label="Jenis" className="h-9 w-full text-[13px] sm:h-8 sm:w-32" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Semua jenis</option><option value="COPY">Salin</option><option value="MOVE">Pindah</option></Select></label>
            <label className="text-[12px] text-muted sm:contents"><span className="sm:sr-only">Penyimpanan</span><Select aria-label="Penyimpanan" className="h-9 w-full text-[13px] sm:h-8 sm:w-44" value={f.storageId} onChange={(e) => setF({ ...f, storageId: e.target.value })}><option value="">Semua penyimpanan</option>{storages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></label>
            <label className="text-[12px] text-muted sm:contents"><span className="sm:sr-only">Dari tanggal</span><Input type="date" aria-label="Dari tanggal" className="h-9 w-full text-[13px] sm:h-8 sm:w-36" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
            <span className="hidden text-muted sm:inline" aria-hidden>–</span>
            <label className="text-[12px] text-muted sm:contents"><span className="sm:sr-only">Sampai tanggal</span><Input type="date" aria-label="Sampai tanggal" className="h-9 w-full text-[13px] sm:h-8 sm:w-36" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
            <Button size="sm" variant="ghost" disabled={!dirty} icon={<FilterX className="size-4" />} onClick={() => setF(EMPTY)}>Reset</Button>
          </div>
        </div>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto p-4 sm:p-8">
        {res.isLoading ? <Skeleton className="mx-auto h-48 max-w-4xl" /> : items.length === 0 && uploads.length === 0 ? <><EmptyState icon={Columns2} title={dirty ? "Tidak ada transfer yang cocok" : "Belum ada transfer"} action={dirty ? <Button onClick={() => setF(EMPTY)}>Reset filter</Button> : <Link to="/dual"><Button variant="primary">Salin dua panel</Button></Link>}>{dirty ? "Ubah atau reset filter." : "Pilih file di file manager lalu pilih Salin atau Pindahkan, atau gunakan tampilan dua panel."}</EmptyState>{page === 1 && !dirty && <div className="mx-auto mt-6 max-w-4xl"><UploadHistory /></div>}</>
          : <div className="mx-auto max-w-4xl space-y-3">{uploads.length > 0 && page === 1 && <UploadsCard tasks={uploads} />}<ul className="space-y-3">{items.map((j) => <JobCard key={j.id} j={j} />)}</ul>{page === 1 && !dirty && <UploadHistory />}</div>}
      </div>
      <Pagination className="border-t border-line bg-surface px-4 py-2.5 sm:px-8" page={page} pages={pages} total={res.data?.total ?? 0} noun="transfer" note={res.isFetching ? " · memperbarui…" : ""} onPage={setPage} limit={limit} limits={[10, 20, 50, 100]} onLimit={setLimit} />
      <Dialog open={clear !== null} onClose={() => setClear(null)} width="max-w-sm" title="Bersihkan riwayat" footer={<><Button onClick={() => setClear(null)}>Batal</Button><Button variant="danger" icon={<Eraser className="size-4" />} onClick={clearHistory}>Bersihkan</Button></>}>
        <fieldset className="space-y-1">
          <legend className="sr-only">Yang dibersihkan</legend>
          {([["finished", "Semua yang sudah berakhir", nDone + nFailed], ["done", "Yang selesai", nDone], ["failed", "Yang gagal / dibatalkan", nFailed]] as const).map(([k, l, n]) => (
            <label key={k} className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 text-[14px]", clear === k ? "border-primary bg-primary-soft" : "border-line hover:bg-surface-2")}>
              <input type="radio" name="clear-scope" className="size-4 accent-[var(--color-primary)]" checked={clear === k} onChange={() => setClear(k)} />
              <span className="flex-1">{l}</span>{!dirty && <span className="tnum text-[12px] text-muted">{n}</span>}
            </label>))}
        </fieldset>
        <p className="mt-3 text-[13px] text-muted">{dirty ? "Hanya yang cocok dengan filter saat ini. " : ""}Hanya catatan di daftar yang dihapus. <b className="text-ink">File tidak disentuh</b>, dan transfer yang masih berjalan tidak ikut terhapus.</p>
      </Dialog>
    </div>
  );
}
