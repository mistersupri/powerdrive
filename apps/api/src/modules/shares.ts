import crypto from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import type { ShareLinkDto } from "@superdrive/shared";
import { config } from "../config.ts";
import { db, now } from "../db.ts";
import { audit } from "../lib/audit.ts";
import { deriveSecret, newId, open, randomToken, seal, sha256 } from "../lib/crypto.ts";
import { AppError, badRequest, forbidden, notFound } from "../lib/errors.ts";
import { decodeId, encodeId, ROOT, type StorageProvider } from "../providers/types.ts";
import { ARGON } from "./auth.ts";
import type { AuthCtx } from "./permissions.ts";
import { providerFor } from "./storages.ts";

/** Visitors of a share link act with the creator's id for auditing, but must never create, change or list links. */
const denyVisitor = (ctx: AuthCtx) => { if (ctx.viaShare) throw forbidden("Pengunjung tautan tidak bisa membuat atau mengelola tautan."); };
const cleanTitle = (t: string | null | undefined) => { const v = (t ?? "").trim().replace(/\s+/g, " ").slice(0, 80); return v || null; };
const MAX_LINKS_PER_ITEM = 25;

const NOT_FOUND = "Tautan tidak ditemukan atau sudah tidak berlaku.";

export function toShareDto(r: any): ShareLinkDto {
  const token = open<string>(JSON.parse(r.token_enc));
  return {
    id: r.id, title: r.title ?? null, storageId: r.storage_id, storageName: r.storage_name ?? "—", fileId: encodeId(r.file_id), name: r.name, isFolder: !!r.is_folder, role: r.role,
    url: `${config.appUrl}/share/${token}`, hasPassword: !!r.password_hash, expiresAt: r.expires_at, maxUploadBytes: r.max_upload_bytes, uploadedBytes: r.uploaded_bytes,
    accessCount: r.access_count, lastAccessAt: r.last_access_at, createdAt: r.created_at, createdByName: r.creator_name ?? null, revokedAt: r.revoked_at,
    expired: !!r.expires_at && r.expires_at < now(),
  };
}
const SELECT = `SELECT l.*, s.name AS storage_name, u.name AS creator_name FROM share_links l LEFT JOIN storages s ON s.id = l.storage_id LEFT JOIN users u ON u.id = l.created_by`;

export interface CreateShare { storageId: string; fileId: string; role: "VIEWER" | "EDITOR"; expiresInDays?: number | null; password?: string | null; maxUploadMb?: number | null; regenerate?: boolean; /** Always make an additional link (optionally with a title) instead of reusing the existing one. */ newLink?: boolean; title?: string | null }

export async function createShare(ctx: AuthCtx, p: StorageProvider, input: CreateShare) {
  denyVisitor(ctx);
  const raw = decodeId(input.fileId);
  const f = await p.stat(raw).catch(() => { throw notFound("File tidak ditemukan."); });
  if (input.role === "EDITOR" && !f.isFolder) throw badRequest("Tautan editor hanya untuk folder.");
  const title = cleanTitle(input.title);
  if (input.newLink || title) {
    const n = db.get<{ n: number }>("SELECT COUNT(*) n FROM share_links WHERE storage_id = ? AND file_id = ? AND revoked_at IS NULL", input.storageId, raw)!.n;
    if (n >= MAX_LINKS_PER_ITEM) throw badRequest(`Satu item maksimal ${MAX_LINKS_PER_ITEM} tautan aktif. Matikan yang tidak dipakai dulu.`);
  } else {
    // Legacy behaviour: one reusable link per role unless the caller asks for a fresh one.
    const existing = db.get<any>(`${SELECT} WHERE l.storage_id = ? AND l.file_id = ? AND l.role = ? AND l.revoked_at IS NULL AND l.title IS NULL`, input.storageId, raw, input.role);
    if (existing && !input.regenerate && !(existing.expires_at && existing.expires_at < now())) return toShareDto(existing);
    if (existing) db.run("UPDATE share_links SET revoked_at = ? WHERE id = ?", now(), existing.id);
  }
  const token = randomToken(32);
  const id = newId();
  db.run(
    `INSERT INTO share_links(id,workspace_id,storage_id,file_id,is_folder,name,role,token_hash,token_enc,password_hash,expires_at,max_upload_bytes,created_by,title) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, ctx.workspaceId, input.storageId, raw, f.isFolder ? 1 : 0, f.name === "" ? "Folder" : f.name, input.role, sha256(token), JSON.stringify(seal(token)),
    input.password ? await hash(input.password, ARGON) : null, input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString() : null,
    input.role === "EDITOR" && input.maxUploadMb ? Math.round(input.maxUploadMb * 1024 * 1024) : null, ctx.userId, title);
  audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "share.create", resourceType: "share", resourceId: id, metadata: { storageId: input.storageId, name: f.name, role: input.role, title }, ip: ctx.ip });
  return toShareDto(db.get<any>(`${SELECT} WHERE l.id = ?`, id));
}

export const listSharesForTarget = (storageId: string, fileRaw: string) =>
  db.all<any>(`${SELECT} WHERE l.storage_id = ? AND l.file_id = ? AND l.revoked_at IS NULL ORDER BY l.created_at`, storageId, fileRaw).map(toShareDto);

export function listAllShares(ctx: AuthCtx, q: { page?: number; limit?: number; q?: string }) {
  const admin = ctx.role === "OWNER" || ctx.role === "ADMIN";
  const where = ["l.workspace_id = ?", "l.revoked_at IS NULL"]; const args: any[] = [ctx.workspaceId];
  if (!admin) { where.push("l.created_by = ?"); args.push(ctx.userId); }
  if (q.q) { where.push("(l.name LIKE ? OR l.title LIKE ?)"); args.push(`%${q.q}%`, `%${q.q}%`); }
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200), offset = (Math.max(q.page ?? 1, 1) - 1) * limit;
  const total = db.get<{ n: number }>(`SELECT COUNT(*) n FROM share_links l WHERE ${where.join(" AND ")}`, ...args)!.n;
  return { total, items: db.all<any>(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`, ...args, limit, offset).map(toShareDto) };
}

function ownedShare(ctx: AuthCtx, id: string) {
  denyVisitor(ctx);
  const r = db.get<any>(`${SELECT} WHERE l.id = ? AND l.workspace_id = ?`, id, ctx.workspaceId);
  if (!r) throw notFound("Tautan tidak ditemukan.");
  if (r.created_by !== ctx.userId && ctx.role !== "OWNER" && ctx.role !== "ADMIN") throw forbidden("Tautan ini dibuat pengguna lain.");
  return r;
}
export async function updateShare(ctx: AuthCtx, id: string, patch: { expiresInDays?: number | null; password?: string | null; maxUploadMb?: number | null; title?: string | null; role?: "VIEWER" | "EDITOR" }) {
  const r = ownedShare(ctx, id);
  if (patch.title !== undefined) db.run("UPDATE share_links SET title = ? WHERE id = ?", cleanTitle(patch.title), id);
  // The permission can change at any time, even after the link has been used: the public routes read the role on every request.
  if (patch.role !== undefined && patch.role !== r.role) {
    if (patch.role === "EDITOR" && !r.is_folder) throw badRequest("Tautan editor hanya untuk folder.");
    db.run("UPDATE share_links SET role = ?, max_upload_bytes = CASE WHEN ? = 'EDITOR' THEN max_upload_bytes ELSE NULL END WHERE id = ?", patch.role, patch.role, id);
    audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "share.role", resourceType: "share", resourceId: id, metadata: { name: r.name, from: r.role, to: patch.role }, ip: ctx.ip });
    r.role = patch.role;
  }
  if (patch.expiresInDays !== undefined) db.run("UPDATE share_links SET expires_at = ? WHERE id = ?", patch.expiresInDays ? new Date(Date.now() + patch.expiresInDays * 86_400_000).toISOString() : null, id);
  if (patch.password !== undefined) db.run("UPDATE share_links SET password_hash = ? WHERE id = ?", patch.password ? await hash(patch.password, ARGON) : null, id);
  if (patch.maxUploadMb !== undefined && r.role === "EDITOR") db.run("UPDATE share_links SET max_upload_bytes = ? WHERE id = ?", patch.maxUploadMb ? Math.round(patch.maxUploadMb * 1048576) : null, id);
  return toShareDto(db.get<any>(`${SELECT} WHERE l.id = ?`, id));
}
export function revokeShare(ctx: AuthCtx, id: string) {
  const r = ownedShare(ctx, id);
  db.run("UPDATE share_links SET revoked_at = ? WHERE id = ?", now(), id);
  audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "share.revoke", resourceType: "share", resourceId: id, metadata: { name: r.name, role: r.role }, ip: ctx.ip });
}

/* ---------------- public side ---------------- */

export interface ResolvedShare { share: any; storage: any; p: StorageProvider; ctx: AuthCtx }

export function findShare(token: string) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) throw notFound(NOT_FOUND);
  const r = db.get<any>("SELECT * FROM share_links WHERE token_hash = ?", sha256(token));
  if (!r || r.revoked_at || (r.expires_at && r.expires_at < now())) throw notFound(NOT_FOUND);
  return r;
}

export function resolveShare(token: string, ip: string): ResolvedShare {
  const share = findShare(token);
  const storage = db.get<any>("SELECT * FROM storages WHERE id = ?", share.storage_id);
  if (!storage || storage.status !== "CONNECTED") throw new AppError(503, "STORAGE_UNAVAILABLE", "Penyimpanan untuk tautan ini sedang tidak tersedia.");
  const ctx: AuthCtx = { userId: share.created_by, userName: "Tautan berbagi", isSuperAdmin: false, workspaceId: share.workspace_id, role: "MEMBER", ip, viaShare: true };
  return { share, storage, p: providerFor(storage), ctx };
}

/** Short-lived proof that the password was entered: HMAC over share id + expiry, sent back as a cookie. */
const sign = (shareId: string, exp: number) => crypto.createHmac("sha256", deriveSecret("share-access")).update(`${shareId}.${exp}`).digest("base64url");
export const makeAccessKey = (shareId: string) => { const exp = Math.floor(Date.now() / 1000) + 12 * 3600; return `${exp}.${sign(shareId, exp)}`; };
export function accessKeyValid(shareId: string, key: string | undefined) {
  if (!key) return false;
  const [exp, sig] = key.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const want = Buffer.from(sign(shareId, Number(exp))), got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
export const checkSharePassword = (share: any, pw: string) => (share.password_hash ? verify(share.password_hash, pw).catch(() => false) : Promise.resolve(true));

/** Is `raw` inside the shared item? Cached briefly so a page of thumbnails costs one lookup. */
const within = new Map<string, number>();
export async function assertWithin(share: any, p: StorageProvider, raw: string) {
  if (share.file_id === ROOT) return;
  if (raw === share.file_id) return;
  if (!share.is_folder) throw forbidden("Di luar item yang dibagikan.");
  const key = `${share.id}:${raw}`;
  const hit = within.get(key);
  if (hit && hit > Date.now()) return;
  const chain = await p.path(raw).catch(() => { throw notFound("Tidak ditemukan."); });
  if (!chain.some((c) => c.id === share.file_id)) throw forbidden("Di luar item yang dibagikan.");
  within.set(key, Date.now() + 60_000);
  if (within.size > 20_000) for (const [k, t] of within) if (t < Date.now()) within.delete(k);
}
