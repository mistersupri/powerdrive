import { logActivity, touchFolder } from "./activity.ts";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { PassThrough, Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ConflictPolicy, UploadDto } from "@superdrive/shared";
import { config } from "../config.ts";
import { db, now } from "../db.ts";
import { audit } from "../lib/audit.ts";
import { newId } from "../lib/crypto.ts";
import { AppError, badRequest, conflict, notFound } from "../lib/errors.ts";
import { LocalProvider } from "../providers/local.ts";
import { type StorageProvider } from "../providers/types.ts";
import { bustListCache, indexItems, toEntry, uniqueName, validName } from "./files.ts";
import { prewarmThumbnail } from "./thumbnails.ts";
import type { AuthCtx } from "./permissions.ts";
import { mapProviderError, providerFor } from "./storages.ts";
import { decodeId } from "../providers/types.ts";

const pushed = new Map<string, number>();
const finalizing = new Set<string>();

function dto(r: any): UploadDto {
  return {
    id: r.id, name: r.name, size: r.size, offset: r.received, status: r.status, errorMessage: r.error_message, chunkSize: config.upload.chunkSize,
    pushed: pushed.get(r.id), skipped: r.result ? JSON.parse(r.result).skipped : undefined,
    file: r.result && JSON.parse(r.result).file ? JSON.parse(r.result).file : undefined,
  };
}

/** An upload belongs to its creator, or — when made through a share link — to that link only. */
function owned(ctx: AuthCtx, id: string, shareId?: string) {
  const r = shareId
    ? db.get<any>("SELECT * FROM uploads WHERE id = ? AND share_id = ?", id, shareId)
    : db.get<any>("SELECT * FROM uploads WHERE id = ? AND workspace_id = ? AND user_id = ? AND share_id IS NULL", id, ctx.workspaceId, ctx.userId);
  if (!r) throw notFound("Unggahan tidak ditemukan.");
  return r;
}

/** Guards for heavy public use: disk in staging, simultaneous uploads per client, and per-link quota. */
function checkQuotas(ctx: AuthCtx, size: number, shareId?: string) {
  const cap = config.upload.stagingMaxBytes;
  if (cap) {
    const used = db.get<{ n: number }>("SELECT COALESCE(SUM(size),0) n FROM uploads WHERE status IN ('RECEIVING','FINALIZING')")!.n;
    if (used + size > cap) throw new AppError(507, "SERVER_BUSY", "Server sedang menerima terlalu banyak unggahan. Coba lagi beberapa menit lagi.");
  }
  if (ctx.ip) {
    const n = db.get<{ n: number }>("SELECT COUNT(*) n FROM uploads WHERE ip = ? AND status IN ('RECEIVING','FINALIZING')", ctx.ip)!.n;
    if (n >= config.upload.maxActivePerIp) throw new AppError(429, "TOO_MANY_UPLOADS", "Terlalu banyak unggahan berjalan dari alamat ini. Tunggu sebagian selesai.");
  }
  if (shareId) {
    const s = db.get<any>("SELECT max_upload_bytes, uploaded_bytes FROM share_links WHERE id = ?", shareId);
    if (s?.max_upload_bytes && s.uploaded_bytes + size > s.max_upload_bytes) throw new AppError(413, "SHARE_QUOTA", "Kuota unggahan untuk tautan ini sudah habis.");
  }
}

export async function createUpload(ctx: AuthCtx, input: { storageId: string; parentId: string; name: string; size: number; mimeType?: string | null; conflictPolicy?: ConflictPolicy }, shareId?: string) {
  const name = validName(input.name);
  if (!Number.isSafeInteger(input.size) || input.size < 0) throw badRequest("Ukuran file tidak valid.");
  if (config.upload.maxFileSize && input.size > config.upload.maxFileSize) throw new AppError(413, "FILE_TOO_LARGE", "File melebihi ukuran maksimum yang diizinkan.");
  checkQuotas(ctx, input.size, shareId);
  const id = newId();
  await fsp.mkdir(config.stagingDir, { recursive: true });
  const staging = path.join(config.stagingDir, `${id}.part`);
  await fsp.writeFile(staging, "", { mode: 0o600 });
  db.run("INSERT INTO uploads(id,workspace_id,user_id,storage_id,parent_id,name,size,mime_type,conflict_policy,staging_path,share_id,ip) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    id, ctx.workspaceId, ctx.userId, input.storageId, decodeId(input.parentId), name, input.size, input.mimeType ?? null, input.conflictPolicy ?? "RENAME", staging, shareId ?? null, ctx.ip || null);
  if (shareId) db.run("UPDATE share_links SET uploaded_bytes = uploaded_bytes + ? WHERE id = ?", input.size, shareId);
  const row = db.get<any>("SELECT * FROM uploads WHERE id = ?", id)!;
  if (input.size === 0) startFinalize(ctx, row);
  return dto(db.get<any>("SELECT * FROM uploads WHERE id = ?", id));
}

export const getUpload = (ctx: AuthCtx, id: string, shareId?: string) => dto(owned(ctx, id, shareId));

/** Append a chunk at `offset`. Only the exact next offset is accepted, so retries are safe. */
export async function receiveChunk(ctx: AuthCtx, id: string, offset: number, body: Readable, shareId?: string) {
  const r = owned(ctx, id, shareId);
  if (r.status !== "RECEIVING") { body.resume(); throw conflict("Unggahan ini sudah tidak menerima data.", "UPLOAD_CLOSED"); }
  if (offset !== r.received) { body.resume(); throw new AppError(409, "OFFSET_MISMATCH", `Offset harus ${r.received}.`); }
  const remaining = r.size - r.received;
  let got = 0;
  const limiter = new Transform({
    transform(chunk, _e, cb) {
      got += chunk.length;
      if (got > remaining) return cb(new AppError(413, "CHUNK_TOO_LARGE", "Data melebihi ukuran file yang dijanjikan."));
      cb(null, chunk);
    },
  });
  const out = fs.createWriteStream(r.staging_path, { flags: "r+", start: offset, highWaterMark: 1024 * 1024 });
  // Buffer through a PassThrough so a failed write never destroys the request socket — we still need it to send the error response.
  const gate = new PassThrough({ highWaterMark: 1024 * 1024 });
  body.pipe(gate);
  try { await pipeline(gate, limiter, out); }
  catch (e) {
    body.unpipe(gate); body.resume();
    // A chunk is all-or-nothing: drop the partial bytes so the committed offset stays exact and the client can resend it.
    await fsp.truncate(r.staging_path, r.received).catch(() => {});
    throw e;
  }
  const received = r.received + got;
  db.run("UPDATE uploads SET received = ?, updated_at = ? WHERE id = ?", received, now(), id);
  if (received === r.size) {
    const done = startFinalize(ctx, { ...r, received });
    // Most finalizations (rename into place) take milliseconds: answer with the final state instead of making the client poll.
    if (done) await Promise.race([done, new Promise((res) => setTimeout(res, 600))]);
  }
  return dto(db.get<any>("SELECT * FROM uploads WHERE id = ?", id));
}

export function cancelUpload(ctx: AuthCtx, id: string, shareId?: string) {
  const r = owned(ctx, id, shareId);
  if (r.status === "FINALIZING") throw conflict("Unggahan sedang diselesaikan.", "UPLOAD_BUSY");
  fsp.rm(r.staging_path, { force: true }).catch(() => {});
  releaseQuota(r);
  db.run("DELETE FROM uploads WHERE id = ?", id);
}

function releaseQuota(r: any) { if (r.share_id && r.status !== "DONE") db.run("UPDATE share_links SET uploaded_bytes = MAX(0, uploaded_bytes - ?) WHERE id = ?", r.size, r.share_id); }

export function retryUpload(ctx: AuthCtx, id: string, shareId?: string) {
  const r = owned(ctx, id, shareId);
  if (r.status !== "FAILED") throw conflict("Hanya unggahan yang gagal yang bisa diulang.");
  startFinalize(ctx, r);
  return dto(db.get<any>("SELECT * FROM uploads WHERE id = ?", id));
}

function startFinalize(ctx: AuthCtx, r: any): Promise<void> | undefined {
  if (finalizing.has(r.id)) return;
  finalizing.add(r.id);
  db.run("UPDATE uploads SET status = 'FINALIZING', error_message = NULL, updated_at = ? WHERE id = ?", now(), r.id);
  return finalize(ctx, r).finally(() => { finalizing.delete(r.id); pushed.delete(r.id); });
}

/** Moves the staged file to the destination provider. Local destinations just rename the file into place. */
async function finalize(ctx: AuthCtx, r: any) {
  try {
    const row = db.get<any>("SELECT * FROM storages WHERE id = ? AND workspace_id = ?", r.storage_id, r.workspace_id);
    if (!row) throw notFound("Penyimpanan tujuan sudah tidak ada.");
    const p: StorageProvider = providerFor(row);
    let name = r.name as string;
    const existing = p.findChild ? await p.findChild(r.parent_id, name) : null;
    if (existing) {
      if (r.conflict_policy === "FAIL") throw conflict(`“${name}” sudah ada di folder tujuan.`, "NAME_CONFLICT");
      if (r.conflict_policy === "SKIP") {
        await fsp.rm(r.staging_path, { force: true });
        db.run("UPDATE uploads SET status='DONE', result=?, updated_at=? WHERE id=?", JSON.stringify({ skipped: true }), now(), r.id);
        return;
      }
      if (r.conflict_policy === "RENAME") name = await uniqueName(p, r.parent_id, name);
    }
    let file;
    if (p instanceof LocalProvider && !(existing && r.conflict_policy === "OVERWRITE")) file = await p.adopt(r.parent_id, name, r.staging_path);
    else {
      // Overwrite on a remote provider: upload under a temporary name, then swap, so a failed upload never destroys the old file.
      const swap = existing && r.conflict_policy === "OVERWRITE";
      const tmpName = swap ? `${name}.sdtmp-${r.id.slice(0, 8)}` : name;
      const counter = new Transform({ transform(c, _e, cb) { pushed.set(r.id, (pushed.get(r.id) ?? 0) + c.length); cb(null, c); } });
      const src = fs.createReadStream(r.staging_path, { highWaterMark: 1024 * 1024 }).pipe(counter);
      file = await p.write({ parentId: r.parent_id, name: tmpName, size: r.size, mimeType: r.mime_type, stream: src });
      if (swap) { await (await import("./trash.ts")).trashRaw(r.workspace_id, r.user_id, r.storage_id, p, existing!.id); file = await p.rename(file.id, name); }
      await fsp.rm(r.staging_path, { force: true });
    }
    indexItems(r.storage_id, r.parent_id, [file]); bustListCache(r.storage_id);
    touchFolder(r.storage_id, r.parent_id, r.share_id ? `share:${r.share_id}` : r.user_id); logActivity({ ...ctx, workspaceId: r.workspace_id, userId: r.user_id, viaShare: !!r.share_id }, r.storage_id, file.id, "upload", { name: file.name, size: r.size }, r.share_id ?? undefined);
    prewarmThumbnail(r.storage_id, p, file);
    audit({ workspaceId: r.workspace_id, userId: r.user_id, action: "file.upload", resourceType: "file", resourceId: file.id, metadata: { storageId: r.storage_id, name: file.name, size: r.size }, ip: ctx.ip });
    db.run("UPDATE uploads SET status='DONE', result=?, updated_at=? WHERE id=?", JSON.stringify({ file: toEntry(r.storage_id, file) }), now(), r.id);
  } catch (e) {
    let msg = e instanceof Error ? e.message : String(e);
    try { mapProviderError(e, r.storage_id); } catch (m) { msg = (m as Error).message; }
    db.run("UPDATE uploads SET status='FAILED', error_message=?, updated_at=? WHERE id=?", msg, now(), r.id);
  }
}

/** On boot: resume finalization of uploads that were interrupted by a restart. */
export function recoverUploads() {
  for (const r of db.all<any>("SELECT * FROM uploads WHERE status = 'FINALIZING'")) {
    const ctx = { userId: r.user_id, userName: "", isSuperAdmin: false, workspaceId: r.workspace_id, role: "ADMIN" as const, ip: "" };
    startFinalize(ctx, r);
  }
}

export async function sweepStaleUploads() {
  const cutoff = new Date(Date.now() - config.upload.staleHours * 3600_000).toISOString();
  for (const r of db.all<any>("SELECT * FROM uploads WHERE status IN ('RECEIVING','FAILED') AND updated_at < ?", cutoff)) {
    await fsp.rm(r.staging_path, { force: true }); releaseQuota(r); db.run("DELETE FROM uploads WHERE id = ?", r.id);
  }
  db.run("DELETE FROM uploads WHERE status = 'DONE' AND updated_at < ?", cutoff);
}
