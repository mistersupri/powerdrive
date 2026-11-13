import type { TransferItemDto } from "@superdrive/shared";
import { formatBytes } from "@superdrive/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, Columns2, Pause, Play, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dateTime, formatEta, formatSpeed, percent } from "@/lib/format";
import { PageHeader } from "@/features/layout/Shell";
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

export default function TransfersPage() {
  const jobs = transferStore.use((s) => s.jobs); const [tab, setTab] = useState<(typeof TABS)[number][0]>("all");
  const n = (f: (j: JobView) => boolean) => jobs.filter(f).length;
  const counts = { active: n((j) => j.status === "RUNNING" || j.status === "VALIDATING" || j.status === "VERIFYING" || j.status === "RETRYING"), queued: n((j) => j.status === "QUEUED"), done: n((j) => j.status === "COMPLETED" || j.status === "COPY_COMPLETED_SOURCE_RETAINED"), failed: n((j) => j.status === "FAILED") };
  const list = jobs.filter((j) => tab === "all" || (tab === "active" && (ACTIVE.includes(j.status) || j.status === "PAUSED")) || (tab === "done" && (j.status === "COMPLETED" || j.status === "COPY_COMPLETED_SOURCE_RETAINED")) || (tab === "failed" && (j.status === "FAILED" || j.status === "CANCELLED")));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Transfer" subtitle="Pantau pemindahan file antar penyimpanan." actions={<Link to="/dual"><Button variant="primary" size="sm" icon={<Columns2 className="size-4" />}>Transfer baru</Button></Link>} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-surface px-4 py-3 sm:px-8">
        {([["Berjalan", counts.active, "bg-primary"], ["Antre", counts.queued, "bg-warn-ink"], ["Selesai", counts.done, "bg-ok-ink"], ["Gagal", counts.failed, "bg-danger"]] as const).map(([l, v, c]) => (
          <div key={l} className="flex items-center gap-1.5 text-[12px]"><span className={cn("size-2 rounded-full", c)} aria-hidden /><span className="text-muted">{l}</span><span className="tnum text-[13px] font-semibold">{v}</span></div>))}
        <span className="flex-1" />
        <div className="flex rounded-lg bg-surface-2 p-0.5" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("rounded-md px-3.5 py-1.5 text-[12px] font-medium text-muted transition-colors", tab === k && "bg-surface text-ink shadow-card")}>{l}</button>)}</div>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto p-4 sm:p-8">
        {list.length === 0 ? <EmptyState icon={Columns2} title="Belum ada transfer" action={<Link to="/dual"><Button variant="primary">Buka salin dua panel</Button></Link>}>Pilih file di file manager lalu pilih Salin atau Pindahkan, atau gunakan tampilan dua panel.</EmptyState>
          : <ul className="mx-auto max-w-4xl space-y-3">{list.map((j) => <JobCard key={j.id} j={j} />)}</ul>}
      </div>
    </div>
  );
}
