import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { Transform } from "node:stream";
import { ACTIVE_TRANSFER_STATUSES, type ConflictPolicy, type TransferItemDto, type TransferJobDto, type TransferStatus, type TransferType } from "@superdrive/shared";
import { config } from "../config.ts";
import { db, now } from "../db.ts";
import { audit, notify } from "../lib/audit.ts";
import { newId } from "../lib/crypto.ts";
import { AppError, badRequest, conflict, notFound } from "../lib/errors.ts";
import { decodeId, isRetryable, ProviderError, ROOT, type RemoteFile, type StorageProvider } from "../providers/types.ts";
import { indexItems, unindex, uniqueName } from "./files.ts";
import { can, type AuthCtx } from "./permissions.ts";
import { providerFor } from "./storages.ts";

export const transferBus = new EventEmitter();
transferBus.setMaxListeners(0);

const ITEM_CONCURRENCY = 3;
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res) => {
  const t = setTimeout(res, ms); signal?.addEventListener("abort", () => { clearTimeout(t); res(); }, { once: true });
});

interface Control { ctl: AbortController; intent: "run" | "pause" | "cancel" }
const controls = new Map<string, Control>();
const running = new Set<string>();

/* ---------- DTO / events ---------- */

function jobDto(r: any): TransferJobDto {
  return {
    id: r.id, type: r.type, status: r.status, conflictPolicy: r.conflict_policy, sourceStorageId: r.source_storage_id, destinationStorageId: r.destination_storage_id,
    sourceStorageName: r.source_name ?? "—", destinationStorageName: r.dest_name ?? "—", title: r.title, totalFiles: r.total_files, completedFiles: r.completed_files,
    failedFiles: r.failed_files, skippedFiles: r.skipped_files, totalBytes: r.total_bytes, transferredBytes: r.transferred_bytes, errorMessage: r.error_message,
    retryCount: r.retry_count, startedAt: r.started_at, completedAt: r.completed_at, createdAt: r.created_at, userId: r.user_id,
  };
}
const JOB_SQL = `SELECT j.*, s.name AS source_name, d.name AS dest_name FROM transfer_jobs j
  LEFT JOIN storages s ON s.id = j.source_storage_id LEFT JOIN storages d ON d.id = j.destination_storage_id`;
export const getJobRow = (id: string) => db.get<any>(`${JOB_SQL} WHERE j.id = ?`, id);

const pending = new Map<string, NodeJS.Timeout>();
/** Coalesce progress events to ~4/s per job; state changes go out immediately. */
function emit(jobId: string, immediate = false) {
  const send = () => { pending.delete(jobId); const r = getJobRow(jobId); if (r) transferBus.emit("job", { workspaceId: r.workspace_id, job: jobDto(r) }); };
  if (immediate) { const t = pending.get(jobId); if (t) clearTimeout(t); return send(); }
  if (!pending.has(jobId)) pending.set(jobId, setTimeout(send, 250));
}

function setJob(id: string, status: TransferStatus, extra: Record<string, string | number | null> = {}) {
  const cols = Object.keys(extra);
  db.run(`UPDATE transfer_jobs SET status = ?, updated_at = ?${cols.map((c) => `, ${c} = ?`).join("")} WHERE id = ?`, status, now(), ...cols.map((c) => extra[c]!), id);
  emit(id, true);
}

/* ---------- creating jobs ---------- */

export interface CreateTransferInput {
  type: TransferType;
  source: { storageId: string; fileIds?: string[]; fileId?: string };
  destination: { storageId: string; folderId: string };
  conflictPolicy?: ConflictPolicy;
  idempotencyKey?: string;
}

export async function createTransfer(ctx: AuthCtx, input: CreateTransferInput) {
  const ids = (input.source.fileIds ?? (input.source.fileId ? [input.source.fileId] : [])).map(decodeId);
  if (!ids.length) throw badRequest("Pilih minimal satu file atau folder.");
  if (ids.length > 5000) throw badRequest("Terlalu banyak item dalam satu transfer.");
  const src = db.get<any>("SELECT * FROM storages WHERE id = ? AND workspace_id = ?", input.source.storageId, ctx.workspaceId);
  const dst = db.get<any>("SELECT * FROM storages WHERE id = ? AND workspace_id = ?", input.destination.storageId, ctx.workspaceId);
  if (!src || !dst) throw notFound("Penyimpanan tidak ditemukan.");
  const need = input.type === "MOVE" ? "MOVE" : "COPY";
  if (!can(ctx, src.id, "READ") || !can(ctx, src.id, need) || !can(ctx, src.id, "DOWNLOAD")) throw new AppError(403, "FORBIDDEN", `Anda tidak punya izin ${need === "MOVE" ? "memindahkan" : "menyalin"} dari penyimpanan sumber.`);
  if (input.type === "MOVE" && !can(ctx, src.id, "DELETE") && src.id !== dst.id && ctx.role !== "OWNER" && ctx.role !== "ADMIN")
    throw new AppError(403, "FORBIDDEN", "Memindahkan antar penyimpanan menghapus file sumber, dan itu memerlukan izin hapus.");
  if (!can(ctx, dst.id, "UPLOAD")) throw new AppError(403, "FORBIDDEN", "Anda tidak punya izin menulis ke penyimpanan tujuan.");
  providerFor(src); providerFor(dst); // throws a clear error when a connection is disabled or expired

  const key = input.idempotencyKey?.slice(0, 120) || newId();
  const dup = db.get<any>("SELECT id FROM transfer_jobs WHERE workspace_id = ? AND idempotency_key = ?", ctx.workspaceId, key);
  if (dup) return jobDto(getJobRow(dup.id));

  // Title: first name + count. Names come from the index when possible to avoid provider calls.
  const first = db.get<{ name: string }>("SELECT name FROM files WHERE storage_id = ? AND file_id = ?", src.id, ids[0]!)?.name ?? (await providerFor(src).stat(ids[0]!).then((f) => f.name, () => "item"));
  const title = ids.length > 1 ? `${first} dan ${ids.length - 1} lainnya` : first;
  const id = newId();
  db.run(
    `INSERT INTO transfer_jobs(id,workspace_id,user_id,source_storage_id,destination_storage_id,type,conflict_policy,title,request,idempotency_key)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id, ctx.workspaceId, ctx.userId, src.id, dst.id, input.type, input.conflictPolicy ?? "RENAME", title,
    JSON.stringify({ fileIds: ids, destinationFolderId: decodeId(input.destination.folderId) }), key);
  audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: `transfer.${input.type.toLowerCase()}.create`, resourceType: "transfer", resourceId: id, metadata: { from: src.name, to: dst.name, items: ids.length }, ip: ctx.ip });
  notify(ctx.workspaceId, ctx.userId, "transfer.started", "Transfer dimulai", `${title}: ${src.name} → ${dst.name}`, { jobId: id });
  emit(id, true);
  engine.kick();
  return jobDto(getJobRow(id));
}

function ownedJob(ctx: AuthCtx, id: string) {
  const r = getJobRow(id);
  if (!r || r.workspace_id !== ctx.workspaceId) throw notFound("Transfer tidak ditemukan.");
  // Members manage their own transfers; admins manage all.
  if (r.user_id !== ctx.userId && ctx.role !== "OWNER" && ctx.role !== "ADMIN") throw new AppError(403, "FORBIDDEN", "Transfer ini milik pengguna lain.");
  return r;
}

export function listJobs(ctx: AuthCtx, q: { status?: string; limit?: number } = {}) {
  const mine = ctx.role === "OWNER" || ctx.role === "ADMIN" ? "" : " AND j.user_id = ?";
  const st = q.status === "active" ? ` AND j.status IN (${ACTIVE_TRANSFER_STATUSES.map((s) => `'${s}'`).join(",")})` : q.status ? " AND j.status = ?" : "";
  const args: any[] = [ctx.workspaceId]; if (mine) args.push(ctx.userId); if (st.includes("?")) args.push(q.status);
  return db.all<any>(`${JOB_SQL} WHERE j.workspace_id = ?${mine}${st} ORDER BY j.created_at DESC LIMIT ?`, ...args, Math.min(q.limit ?? 100, 500)).map(jobDto);
}
export const getJob = (ctx: AuthCtx, id: string) => jobDto(ownedJob(ctx, id));

export function listItems(ctx: AuthCtx, id: string, page = 1, limit = 100): { items: TransferItemDto[]; total: number } {
  ownedJob(ctx, id);
  const total = db.get<{ n: number }>("SELECT COUNT(*) n FROM transfer_items WHERE job_id = ? AND is_folder = 0", id)!.n;
  const rows = db.all<any>("SELECT * FROM transfer_items WHERE job_id = ? AND is_folder = 0 ORDER BY seq LIMIT ? OFFSET ?", id, limit, (page - 1) * limit);
  return { total, items: rows.map((r) => ({ id: r.id, fileName: r.file_name, relativePath: r.relative_path, fileSize: r.file_size, transferredBytes: r.transferred_bytes, status: r.status, errorMessage: r.error_message, retryCount: r.retry_count })) };
}

/* ---------- control: pause / resume / cancel / retry ---------- */

export function pauseJob(ctx: AuthCtx, id: string) {
  const r = ownedJob(ctx, id);
  if (!ACTIVE_TRANSFER_STATUSES.includes(r.status) || r.status === "PAUSED") throw conflict("Transfer ini tidak dapat dijeda.");
  const c = controls.get(id);
  if (c) { c.intent = "pause"; c.ctl.abort(); }
  else setJob(id, "PAUSED"); // still queued
  return getJob(ctx, id);
}
export function resumeJob(ctx: AuthCtx, id: string) {
  const r = ownedJob(ctx, id);
  if (r.status !== "PAUSED") throw conflict("Transfer ini tidak sedang dijeda.");
  if (running.has(id)) throw conflict("Transfer sedang menghentikan proses. Coba lagi sebentar lagi.");
  setJob(id, "QUEUED"); engine.kick();
  return getJob(ctx, id);
}
export function cancelJob(ctx: AuthCtx, id: string) {
  const r = ownedJob(ctx, id);
  if (!ACTIVE_TRANSFER_STATUSES.includes(r.status)) throw conflict("Transfer ini sudah selesai.");
  const c = controls.get(id);
  if (c) { c.intent = "cancel"; c.ctl.abort(); }
  else finishCancelled(id);
  audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "transfer.cancel", resourceType: "transfer", resourceId: id, ip: ctx.ip });
  return getJob(ctx, id);
}
export function retryJob(ctx: AuthCtx, id: string) {
  const r = ownedJob(ctx, id);
  if (!["FAILED", "CANCELLED"].includes(r.status)) throw conflict("Hanya transfer yang gagal atau dibatalkan yang dapat diulang.");
  db.tx(() => {
    db.run("UPDATE transfer_items SET status='QUEUED', error_message=NULL, transferred_bytes=0, retry_count=retry_count+1, updated_at=? WHERE job_id=? AND status IN ('FAILED','CANCELLED')", now(), id);
    db.run("UPDATE transfer_jobs SET failed_files=0, error_message=NULL, completed_at=NULL, retry_count=retry_count+1 WHERE id=?", id);
    recount(id);
  });
  setJob(id, "QUEUED"); engine.kick();
  return getJob(ctx, id);
}

function finishCancelled(id: string) {
  db.run("UPDATE transfer_items SET status='CANCELLED', updated_at=? WHERE job_id=? AND status IN ('QUEUED','RUNNING','RETRYING','VERIFYING','VALIDATING')", now(), id);
  setJob(id, "CANCELLED", { completed_at: now() });
}

/** Recompute job counters from its items (source of truth). */
function recount(id: string) {
  const c = db.get<any>(
    `SELECT SUM(is_folder=0) files, SUM(is_folder=0 AND status IN ('COMPLETED','COPY_COMPLETED_SOURCE_RETAINED')) done, SUM(is_folder=0 AND status='FAILED') failed,
            SUM(is_folder=0 AND status='SKIPPED') skipped, SUM(CASE WHEN is_folder=0 THEN COALESCE(file_size,0) END) bytes,
            SUM(CASE WHEN is_folder=0 THEN transferred_bytes ELSE 0 END) moved FROM transfer_items WHERE job_id = ?`, id)!;
  db.run("UPDATE transfer_jobs SET total_files=?, completed_files=?, failed_files=?, skipped_files=?, total_bytes=?, transferred_bytes=?, updated_at=? WHERE id=?",
    c.files ?? 0, c.done ?? 0, c.failed ?? 0, c.skipped ?? 0, c.bytes ?? 0, c.moved ?? 0, now(), id);
}

/* ---------- the engine ---------- */

class Engine {
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;
  get isStopping() { return this.stopping; }

  start() {
    // Crash recovery: anything that was mid-flight goes back to the queue. Finished items are kept.
    const stale = db.all<{ id: string }>("SELECT id FROM transfer_jobs WHERE status IN ('VALIDATING','RUNNING','RETRYING','VERIFYING')");
    for (const j of stale) {
      db.run("UPDATE transfer_items SET status='QUEUED', transferred_bytes=0, updated_at=? WHERE job_id=? AND status IN ('RUNNING','RETRYING','VERIFYING','VALIDATING')", now(), j.id);
      recount(j.id);
      db.run("UPDATE transfer_jobs SET status='QUEUED', updated_at=? WHERE id=?", now(), j.id);
    }
    this.timer = setInterval(() => this.kick(), 5000);
    this.timer.unref();
    this.kick();
  }
  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    // Graceful shutdown: pause what is running so it resumes after restart.
    for (const [, c] of controls) { c.intent = "pause"; c.ctl.abort(); }
    const t0 = Date.now();
    while (running.size && Date.now() - t0 < 8000) await sleep(100);
  }

  kick() {
    if (this.stopping) return;
    queueMicrotask(() => this.pump());
  }

  private pump() {
    if (running.size >= config.transfer.globalConcurrency) return;
    const rows = db.all<any>("SELECT id, workspace_id FROM transfer_jobs WHERE status = 'QUEUED' ORDER BY created_at");
    const perWs = new Map<string, number>();
    for (const id of running) { const r = db.get<any>("SELECT workspace_id FROM transfer_jobs WHERE id = ?", id); if (r) perWs.set(r.workspace_id, (perWs.get(r.workspace_id) ?? 0) + 1); }
    for (const r of rows) {
      if (running.size >= config.transfer.globalConcurrency) break;
      if (running.has(r.id)) continue;
      if ((perWs.get(r.workspace_id) ?? 0) >= config.transfer.perWorkspaceConcurrency) continue;
      perWs.set(r.workspace_id, (perWs.get(r.workspace_id) ?? 0) + 1);
      running.add(r.id);
      void runJob(r.id).catch((e) => {
        setJob(r.id, "FAILED", { error_message: e instanceof Error ? e.message : String(e), completed_at: now() });
      }).finally(() => { running.delete(r.id); controls.delete(r.id); this.kick(); });
    }
  }
}
export const engine = new Engine();

class Interrupted extends Error { constructor(public intent: "pause" | "cancel") { super(intent); } }

async function runJob(jobId: string) {
  const ctl = new AbortController();
  const control: Control = { ctl, intent: "run" };
  controls.set(jobId, control);
  const job = db.get<any>("SELECT * FROM transfer_jobs WHERE id = ?", jobId)!;
  setJob(jobId, "VALIDATING", { started_at: job.started_at ?? now() });

  const srcRow = db.get<any>("SELECT * FROM storages WHERE id = ?", job.source_storage_id);
  const dstRow = db.get<any>("SELECT * FROM storages WHERE id = ?", job.destination_storage_id);
  if (!srcRow || !dstRow) throw new Error("Penyimpanan sumber atau tujuan sudah dihapus.");
  const src = providerFor(srcRow); const dst = providerFor(dstRow);
  const req = JSON.parse(job.request) as { fileIds: string[]; destinationFolderId: string };

  try {
    if (!job.expanded) await expand(job, src, dst, req, ctl.signal);
    if (ctl.signal.aborted) throw new Interrupted(control.intent === "cancel" ? "cancel" : "pause");
    recount(jobId);
    setJob(jobId, "RUNNING");

    const fatal = { error: null as null | string };
    const queue = db.all<any>("SELECT * FROM transfer_items WHERE job_id = ? AND is_folder = 0 AND status = 'QUEUED' ORDER BY seq", jobId);
    let next = 0;
    const worker = async () => {
      while (!ctl.signal.aborted && !fatal.error) {
        const item = queue[next++]; if (!item) return;
        try { await processItem(job, item, src, dst, ctl.signal, srcRow.id === dstRow.id); }
        catch (e) {
          if (e instanceof Interrupted) return;
          const err = describe(e);
          db.run("UPDATE transfer_items SET status='FAILED', error_message=?, updated_at=? WHERE id=?", err.message, now(), item.id);
          if (err.fatal) fatal.error = err.message;
        }
        recount(jobId); emit(jobId);
      }
    };
    await Promise.all(Array.from({ length: Math.min(ITEM_CONCURRENCY, Math.max(queue.length, 1)) }, worker));

    if (ctl.signal.aborted) throw new Interrupted(control.intent === "cancel" ? "cancel" : "pause");
    recount(jobId);

    // MOVE with folders: remove the now-empty source folders, deepest first, only if every file made it.
    const j2 = db.get<any>("SELECT * FROM transfer_jobs WHERE id = ?", jobId)!;
    let retained = db.get("SELECT 1 FROM transfer_items WHERE job_id=? AND status='COPY_COMPLETED_SOURCE_RETAINED'", jobId) !== undefined;
    const allOk = j2.failed_files === 0 && !fatal.error && !db.get("SELECT 1 FROM transfer_items WHERE job_id=? AND is_folder=0 AND status IN ('QUEUED','CANCELLED')", jobId);
    if (job.type === "MOVE" && allOk && !retained) {
      const folders = db.all<any>("SELECT * FROM transfer_items WHERE job_id=? AND is_folder=1 AND source_deleted=0 ORDER BY seq DESC", jobId);
      const skipped = j2.skipped_files > 0; // skipped files still live in the source folder
      for (const f of folders) {
        if (skipped) { retained = true; break; }
        try { await src.delete(f.source_file_id); unindex(srcRow.id, f.source_file_id); db.run("UPDATE transfer_items SET source_deleted=1 WHERE id=?", f.id); }
        catch { retained = true; }
      }
    }
    const final: TransferStatus = fatal.error || j2.failed_files > 0 ? "FAILED" : retained ? "COPY_COMPLETED_SOURCE_RETAINED" : "COMPLETED";
    const msg = fatal.error ?? (j2.failed_files > 0 ? `${j2.failed_files} dari ${j2.total_files} file gagal.` : retained ? "File sudah tersalin, tetapi sebagian sumber tidak dapat dihapus dan dibiarkan." : null);
    setJob(jobId, final, { error_message: msg, completed_at: now() });
    audit({ workspaceId: job.workspace_id, userId: job.user_id, action: `transfer.${final === "FAILED" ? "fail" : "complete"}`, resourceType: "transfer", resourceId: jobId, metadata: { title: job.title, status: final, files: j2.total_files, failed: j2.failed_files } });
    notify(job.workspace_id, job.user_id, final === "FAILED" ? "transfer.failed" : "transfer.completed",
      final === "FAILED" ? "Transfer gagal" : "Transfer selesai", `${job.title}${msg ? ` — ${msg}` : ""}`, { jobId });
  } catch (e) {
    if (e instanceof Interrupted) {
      if (e.intent === "cancel") finishCancelled(jobId);
      else {
        db.run("UPDATE transfer_items SET status='QUEUED', transferred_bytes=0, updated_at=? WHERE job_id=? AND status IN ('RUNNING','RETRYING','VERIFYING','VALIDATING')", now(), jobId);
        recount(jobId);
        // A graceful shutdown pauses; on restart those jobs should simply continue.
        setJob(jobId, engine.isStopping ? "QUEUED" : "PAUSED");
      }
      return;
    }
    throw e;
  }
}

/** Walk the selection, create destination folders, and record one item per file. Idempotent so a restart can resume it. */
async function expand(job: any, src: StorageProvider, dst: StorageProvider, req: { fileIds: string[]; destinationFolderId: string }, signal: AbortSignal) {
  const sameStorage = job.source_storage_id === job.destination_storage_id;
  const policy = job.conflict_policy as ConflictPolicy;
  let seq = (db.get<{ m: number }>("SELECT COALESCE(MAX(seq),0) m FROM transfer_items WHERE job_id = ?", job.id)!.m);

  const addItem = (o: { srcId: string; srcParent: string | null; destParent: string; rel: string; name: string; size: number | null; folder?: boolean; destId?: string | null }) => {
    const row = db.get<any>("SELECT id, destination_file_id FROM transfer_items WHERE job_id=? AND source_file_id=?", job.id, o.srcId);
    if (row) return row;
    const id = newId();
    db.run(`INSERT INTO transfer_items(id,job_id,seq,source_file_id,source_parent_id,destination_parent_id,destination_file_id,relative_path,file_name,is_folder,file_size,status)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, id, job.id, ++seq, o.srcId, o.srcParent, o.destParent, o.destId ?? null, o.rel, o.name, o.folder ? 1 : 0, o.size, o.folder ? "COMPLETED" : "QUEUED");
    return { id, destination_file_id: o.destId ?? null };
  };

  const walk = async (folderId: string, destFolderId: string, rel: string) => {
    let token: string | null = null;
    do {
      if (signal.aborted) return;
      const page = await src.list(folderId, { pageToken: token, limit: 500 });
      token = page.nextPageToken;
      for (const f of page.items) {
        const r = rel ? `${rel}/${f.name}` : f.name;
        if (f.isFolder) {
          const existing = db.get<any>("SELECT destination_file_id FROM transfer_items WHERE job_id=? AND source_file_id=?", job.id, f.id);
          let did = existing?.destination_file_id as string | undefined;
          if (!did) {
            const clash = dst.findChild ? await dst.findChild(destFolderId, f.name) : null;
            did = clash?.isFolder ? clash.id : (await dst.createFolder(destFolderId, f.name)).id;
          }
          addItem({ srcId: f.id, srcParent: folderId, destParent: destFolderId, rel: r, name: f.name, size: null, folder: true, destId: did });
          await walk(f.id, did, r);
        } else addItem({ srcId: f.id, srcParent: folderId, destParent: destFolderId, rel: r, name: f.name, size: f.size });
      }
    } while (token);
  };

  // Moving a folder into itself would recurse forever.
  const destAncestors = sameStorage ? new Set((await dst.path(req.destinationFolderId)).map((a) => a.id).concat(req.destinationFolderId)) : new Set<string>();

  for (const id of req.fileIds) {
    if (signal.aborted) return;
    const f = await src.stat(id);
    if (f.isFolder) {
      if (sameStorage && destAncestors.has(f.id)) throw new Error(`Tidak bisa ${job.type === "MOVE" ? "memindahkan" : "menyalin"} “${f.name}” ke dalam dirinya sendiri.`);
      const existing = db.get<any>("SELECT destination_file_id FROM transfer_items WHERE job_id=? AND source_file_id=?", job.id, f.id);
      let did = existing?.destination_file_id as string | undefined;
      if (!did) {
        const clash = dst.findChild ? await dst.findChild(req.destinationFolderId, f.name) : null;
        if (clash && policy === "FAIL") throw new Error(`Folder “${f.name}” sudah ada di tujuan.`);
        if (clash && policy === "RENAME") did = (await dst.createFolder(req.destinationFolderId, await uniqueName(dst, req.destinationFolderId, f.name))).id;
        else if (clash?.isFolder) did = clash.id;
        else did = (await dst.createFolder(req.destinationFolderId, clash ? await uniqueName(dst, req.destinationFolderId, f.name) : f.name)).id;
      }
      addItem({ srcId: f.id, srcParent: f.parentId, destParent: req.destinationFolderId, rel: f.name, name: f.name, size: null, folder: true, destId: did });
      await walk(f.id, did, f.name);
    } else addItem({ srcId: f.id, srcParent: f.parentId, destParent: req.destinationFolderId, rel: f.name, name: f.name, size: f.size });
    recount(job.id); emit(job.id);
  }
  if (!signal.aborted) db.run("UPDATE transfer_jobs SET expanded = 1 WHERE id = ?", job.id);
}

function describe(e: unknown): { message: string; fatal: boolean } {
  if (e instanceof ProviderError) {
    if (e.kind === "quota") return { message: "Ruang di penyimpanan tujuan tidak cukup.", fatal: true };
    if (e.kind === "auth") return { message: "Otorisasi penyimpanan berakhir. Hubungkan ulang lalu ulangi transfer.", fatal: true };
    return { message: e.message, fatal: false };
  }
  return { message: e instanceof Error ? e.message : String(e), fatal: false };
}

/** Where a file lands inside its destination folder, applying the conflict policy. */
async function resolveTarget(dst: StorageProvider, destParent: string, name: string, policy: ConflictPolicy) {
  const existing = dst.findChild ? await dst.findChild(destParent, name) : null;
  if (!existing) return { name, skip: false, replace: null as RemoteFile | null };
  switch (policy) {
    case "SKIP": return { name, skip: true, replace: null };
    case "FAIL": throw new Error(`“${name}” sudah ada di folder tujuan.`);
    case "OVERWRITE": return { name, skip: false, replace: existing };
    default: return { name: await uniqueName(dst, destParent, name), skip: false, replace: null };
  }
}

async function processItem(job: any, item: any, src: StorageProvider, dst: StorageProvider, signal: AbortSignal, sameStorage: boolean) {
  const interrupted = () => { if (signal.aborted) throw new Interrupted(controls.get(job.id)?.intent === "cancel" ? "cancel" : "pause"); };
  const setItem = (status: string, extra: Record<string, string | number | null> = {}) => {
    const cols = Object.keys(extra);
    db.run(`UPDATE transfer_items SET status=?, updated_at=?${cols.map((c) => `, ${c}=?`).join("")} WHERE id=?`, status, now(), ...cols.map((c) => extra[c]!), item.id);
  };
  interrupted();
  setItem("VALIDATING");

  const source = await src.stat(item.source_file_id); // validates the source still exists
  const size = source.size;
  setItem("RUNNING", { file_size: size, transferred_bytes: 0 });

  // Moving a file into the folder it already lives in is a no-op, not a reason to create "name (2)".
  if (job.type === "MOVE" && sameStorage && item.source_parent_id && item.source_parent_id === item.destination_parent_id) { setItem("SKIPPED"); return; }

  const target = await resolveTarget(dst, item.destination_parent_id, item.file_name, job.conflict_policy);
  if (target.skip) { setItem("SKIPPED", { transferred_bytes: 0 }); return; }

  // Strategy A — native operation inside one provider: no bytes leave the provider.
  const native = sameStorage && !target.replace && (job.type === "MOVE" ? !!src.move : !!src.copy) &&
    (job.type === "MOVE" ? src.capabilities.nativeMove : src.capabilities.nativeCopy);
  let result: RemoteFile;
  let moved = false;

  if (native) {
    result = job.type === "MOVE" ? await src.move!(source.id, item.destination_parent_id, target.name) : await src.copy!(source.id, item.destination_parent_id, target.name);
    moved = job.type === "MOVE";
    db.run("UPDATE transfer_items SET transferred_bytes = ? WHERE id = ?", size ?? 0, item.id);
  } else {
    // Strategy B — stream through the server with bounded memory; retry with backoff.
    const swapName = target.replace ? `${target.name}.sdtmp-${crypto.randomBytes(3).toString("hex")}` : target.name;
    let attempt = 0;
    for (;;) {
      interrupted();
      let sent = 0; let lastFlush = 0;
      const hash = crypto.createHash("sha256");
      const meter = new Transform({
        highWaterMark: config.transfer.bufferSize,
        transform(chunk: Buffer, _e, cb) {
          sent += chunk.length; hash.update(chunk);
          const t = Date.now();
          if (t - lastFlush > 400) {
            lastFlush = t;
            db.run("UPDATE transfer_items SET transferred_bytes=?, checkpoint=?, updated_at=? WHERE id=?", sent, JSON.stringify({ bytes: sent, at: now() }), now(), item.id);
            recount(job.id); emit(job.id);
          }
          cb(null, chunk);
        },
      });
      try {
        const r = await src.read(source.id, { signal });
        r.stream.on("error", (e) => meter.destroy(e));
        r.stream.pipe(meter);
        signal.addEventListener("abort", () => { r.stream.destroy(); meter.destroy(); }, { once: true });
        const written = await dst.write({ parentId: item.destination_parent_id, name: swapName, size: size ?? r.size, mimeType: source.mimeType, stream: meter, signal });
        interrupted();
        setItem("VERIFYING", { transferred_bytes: sent });
        // Verify what landed: byte count must match what we read, and what the source said it had.
        const check = await dst.stat(written.id);
        if (check.size !== null && check.size !== sent) throw new ProviderError(`Verifikasi gagal: tujuan ${check.size} byte, terkirim ${sent} byte.`, "other");
        if (size !== null && sent !== size) throw new ProviderError(`Verifikasi gagal: sumber ${size} byte, terbaca ${sent} byte.`, "other");
        if (check.checksum && source.checksum && check.checksum.length === source.checksum.length && /^[0-9a-f]{32,}$/i.test(check.checksum) && check.checksum.toLowerCase() !== source.checksum.toLowerCase())
          throw new ProviderError("Verifikasi gagal: checksum tidak sama.", "other");
        result = written;
        db.run("UPDATE transfer_items SET checksum=? WHERE id=?", hash.digest("hex"), item.id);
        if (target.replace) { await dst.delete(target.replace.id); result = await dst.rename(written.id, target.name); }
        break;
      } catch (e) {
        if (signal.aborted) throw new Interrupted(controls.get(job.id)?.intent === "cancel" ? "cancel" : "pause");
        if (!isRetryable(e) && !(e instanceof ProviderError && e.message.startsWith("Verifikasi gagal"))) throw e;
        if (++attempt > config.transfer.retryAttempts) throw e;
        // Exponential backoff with full jitter. The file restarts: arbitrary streams cannot be resumed from a byte offset.
        const wait = Math.random() * Math.min(60_000, config.transfer.retryBaseMs * 2 ** attempt);
        setItem("RETRYING", { retry_count: attempt, error_message: (e as Error).message, transferred_bytes: 0 });
        setJob(job.id, "RETRYING");
        await sleep(wait, signal);
        setJob(job.id, "RUNNING");
      }
    }
  }

  indexItems(job.destination_storage_id, item.destination_parent_id, [result]);
  db.run("UPDATE transfer_items SET destination_file_id=?, transferred_bytes=?, error_message=NULL WHERE id=?", result.id, size ?? 0, item.id);

  // MOVE across providers: delete the source only now that the destination is verified and recorded.
  if (job.type === "MOVE" && !moved) {
    try {
      await src.delete(source.id);
      unindex(job.source_storage_id, source.id);
      db.run("UPDATE transfer_items SET source_deleted = 1 WHERE id = ?", item.id);
    } catch (e) {
      setItem("COPY_COMPLETED_SOURCE_RETAINED", { error_message: `Sumber tidak dapat dihapus: ${(e as Error).message}` });
      return;
    }
  } else if (moved) { unindex(job.source_storage_id, source.id); db.run("UPDATE transfer_items SET source_deleted = 1 WHERE id = ?", item.id); }
  setItem("COMPLETED", { error_message: null });
}

export { ROOT };
