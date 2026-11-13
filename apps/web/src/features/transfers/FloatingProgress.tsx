import { ArrowRight, CheckCircle2, ChevronDown, ChevronUp, FileUp, Pause, Play, RotateCcw, X, XCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/cn";
import { formatBytes, formatEta, formatSpeed, percent } from "@/lib/format";
import { IconButton } from "@/ui/Button";
import { Progress } from "@/ui/misc";
import { uploadActions, uploadStore, type UploadTask } from "@/features/uploads/manager";
import { transferActions, transferStore, type JobView } from "./store";

const ACTIVE = ["QUEUED", "VALIDATING", "RUNNING", "RETRYING", "VERIFYING"];

function UploadRow({ t }: { t: UploadTask }) {
  const running = t.status === "uploading" || t.status === "processing" || t.status === "queued";
  const pct = t.status === "processing" ? percent(t.pushed, t.size) : percent(t.sent, t.size);
  const eta = t.speed && t.status === "uploading" ? (t.size - t.sent) / t.speed : null;
  return (
    <li className="space-y-1.5 border-b border-line px-[18px] py-3 last:border-0">
      <div className="flex items-center gap-2">
        <FileUp className="size-4 shrink-0 text-primary-ink" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={t.relativePath}>{t.name}</span>
        {t.status === "done" && <CheckCircle2 className="size-4 text-ok-ink" aria-label="Selesai" />}
        {t.status === "skipped" && <span className="text-[11px] text-muted">Dilewati</span>}
        {t.status === "error" && <><XCircle className="size-4 text-danger-ink" aria-label="Gagal" /><IconButton label="Coba lagi" className="size-6" onClick={() => uploadActions.retry(t.id)}><RotateCcw className="size-3.5" /></IconButton></>}
        {running && <IconButton label="Batalkan" className="size-6" onClick={() => uploadActions.cancel(t.id)}><X className="size-3.5" /></IconButton>}
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted">
        <span>Unggah</span><ArrowRight className="size-2.5" aria-hidden /><span className="truncate">{t.storageName}</span>
        {t.status === "uploading" && <><span>·</span><span className="tnum">{formatSpeed(t.speed)}</span><span>·</span><span className="tnum">{formatEta(eta)} lagi</span></>}
        {t.status === "processing" && <><span>·</span><span>Menyimpan ke penyimpanan…</span></>}
        {t.status === "queued" && <><span>·</span><span>Menunggu</span></>}
        {t.status === "error" && <span className="text-danger-ink">· {t.error}</span>}
      </div>
      {running && <Progress value={pct} className="h-1" />}
    </li>
  );
}

function JobRow({ j }: { j: JobView }) {
  const active = ACTIVE.includes(j.status);
  const pct = percent(j.transferredBytes, j.totalBytes) || (j.totalFiles ? Math.floor(((j.completedFiles + j.skippedFiles) / j.totalFiles) * 100) : 0);
  return (
    <li className="space-y-1.5 border-b border-line px-[18px] py-3 last:border-0">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={j.title}>{j.title}</span>
        <span className="tnum text-[12px] font-medium text-muted">{active || j.status === "PAUSED" ? `${pct}%` : ""}</span>
        {j.status === "COMPLETED" && <CheckCircle2 className="size-4 text-ok-ink" aria-label="Selesai" />}
        {j.status === "FAILED" && <XCircle className="size-4 text-danger-ink" aria-label="Gagal" />}
        {active && <IconButton label="Jeda" className="size-6" onClick={() => void transferActions.pause(j.id)}><Pause className="size-3.5" /></IconButton>}
        {j.status === "PAUSED" && <IconButton label="Lanjutkan" className="size-6" onClick={() => void transferActions.resume(j.id)}><Play className="size-3.5" /></IconButton>}
        {(active || j.status === "PAUSED") && <IconButton label="Batalkan" className="size-6" onClick={() => void transferActions.cancel(j.id)}><X className="size-3.5" /></IconButton>}
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted">
        <span className="truncate">{j.sourceStorageName}</span><ArrowRight className="size-2.5" aria-hidden /><span className="truncate">{j.destinationStorageName}</span>
        {j.status === "RUNNING" && j.speed !== null && <><span>·</span><span className="tnum">{formatSpeed(j.speed)}</span><span>·</span><span className="tnum">{formatEta(j.eta)} lagi</span></>}
        {j.status === "QUEUED" && <><span>·</span><span>Menunggu giliran</span></>}
        {j.status === "PAUSED" && <><span>·</span><span>Dijeda</span></>}
        {j.status === "RETRYING" && <><span>·</span><span>Mencoba lagi…</span></>}
        {j.status === "FAILED" && <span className="text-danger-ink">· {j.errorMessage}</span>}
      </div>
      {(active || j.status === "PAUSED") && <Progress value={pct} className="h-1" tone={j.status === "RETRYING" ? "warn" : "primary"} />}
      {j.totalBytes ? <span className="sr-only">{formatBytes(j.transferredBytes)} dari {formatBytes(j.totalBytes)}</span> : null}
    </li>
  );
}

/** Bottom-right panel with everything in flight: browser uploads and server-side transfers. */
export function FloatingProgress() {
  const uploads = uploadStore.use((s) => s.tasks);
  const jobs = transferStore.use((s) => s.jobs);
  const [min, setMin] = useState(false); const [dismissed, setDismissed] = useState(0);
  const shownJobs = jobs.filter((j) => ACTIVE.includes(j.status) || j.status === "PAUSED" || Date.now() - new Date(j.completedAt ?? j.createdAt).getTime() < 60_000).slice(0, 8);
  const shownUploads = uploads.slice(0, 12);
  const running = shownJobs.filter((j) => ACTIVE.includes(j.status)).length + uploads.filter((t) => ["uploading", "processing", "queued"].includes(t.status)).length;
  const done = shownJobs.filter((j) => j.status === "COMPLETED").length + uploads.filter((t) => t.status === "done").length;
  const total = shownJobs.length + shownUploads.length;
  if (!total || dismissed === total + running * 1000) return null;
  return (
    <section aria-label="Unggahan dan transfer" className="anim-slide-up fixed right-4 bottom-4 z-30 w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[14px] border border-line bg-surface shadow-float">
      <header className="flex items-center gap-2 bg-navy px-[18px] py-3.5 text-white">
        <h2 className="text-[14px] font-semibold">Unggahan &amp; transfer</h2>
        {running > 0 && <span className="tnum rounded-full bg-white/20 px-2 text-[11px] leading-[18px] font-semibold">{running}</span>}
        <span className="flex-1" />
        <button aria-label={min ? "Perluas" : "Ciutkan"} className="grid size-6 place-items-center rounded hover:bg-white/15" onClick={() => setMin((m) => !m)}>{min ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</button>
        {running === 0 && <button aria-label="Tutup" className="grid size-6 place-items-center rounded hover:bg-white/15" onClick={() => { setDismissed(total + running * 1000); uploadActions.clearFinished(); }}><X className="size-4" /></button>}
      </header>
      {!min && (<>
        <ul className={cn("scroll-thin max-h-[340px] overflow-y-auto")}>
          {shownUploads.map((t) => <UploadRow key={t.id} t={t} />)}
          {shownJobs.map((j) => <JobRow key={j.id} j={j} />)}
        </ul>
        <footer className="flex items-center justify-between bg-surface-2 px-[18px] py-2.5 text-[11px] text-muted">
          <span className="tnum">{running} berjalan · {done} selesai</span>
          <Link to="/transfers" className="inline-flex items-center gap-1 rounded-md bg-surface px-2.5 py-1 font-medium text-primary-ink hover:bg-primary-soft">Lihat semua <ArrowRight className="size-3" /></Link>
        </footer>
      </>)}
    </section>
  );
}
