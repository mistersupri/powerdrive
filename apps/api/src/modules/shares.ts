import { logActivity } from "./activity.ts";
import crypto from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import type { ShareLinkDto } from "@superdrive/shared";
import { config } from "../config.ts";
import { db, now } from "../db.ts";
import { audit, notify } from "../lib/audit.ts";
import { deriveSecret, newId, open, randomToken, seal, sha256 } from "../lib/crypto.ts";
import { AppError, badRequest, forbidden, notFound } from "../lib/errors.ts";
import { decodeId, encodeId, ROOT, type RemoteFile, type StorageProvider } from "../providers/types.ts";
import { ARGON } from "./auth.ts";
import type { AuthCtx } from "./permissions.ts";
import { providerFor } from "./storages.ts";

/** Visitors of a share link act with the creator's id for auditing, but must never create, change or list links. */
const denyVisitor = (ctx: AuthCtx) => { if (ctx.viaShare) throw forbidden("Pengunjung tautan tidak bisa membuat atau mengelola tautan."); };
const cleanTitle = (t: string | null | undefined) => { const v = (t ?? "").trim().replace(/\s+/g, " ").slice(0, 80); return v || null; };
const MAX_LINKS_PER_ITEM = 25;

const NOT_FOUND = "Tautan tidak ditemukan atau sudah tidak berlaku.";

/** Sentinel `file_id` of a bundle: it can never equal a real raw id, so nothing is accidentally "the whole storage". */
export const BUNDLE = "@bundle";
export const isBundle = (share: any) => share.kind === "bundle";
export const shareItems = (shareId: string) => db.all<{ file_id: string; name: string; is_folder: number }>("SELECT file_id, name, is_folder FROM share_items WHERE share_id = ? ORDER BY position", shareId);

export function toShareDto(r: any): ShareLinkDto {
  const token = open<string>(JSON.parse(r.token_enc));
  return {
    id: r.id, title: r.title ?? null, kind: r.kind === "bundle" ? "bundle" : "single", itemCount: r.kind === "bundle" ? (r.item_count ?? 0) : 1,
    items: r.kind === "bundle" ? db.all<any>("SELECT name, is_folder FROM share_items WHERE share_id = ? ORDER BY position LIMIT 6", r.id).map((i) => ({ name: i.name, isFolder: !!i.is_folder })) : [{ name: r.name, isFolder: !!r.is_folder }],
    recipient: r.recipient_user_id ? { id: r.recipient_user_id, name: r.recipient_name ?? "Anggota", email: r.recipient_email ?? "" } : null, storageId: r.storage_id, storageName: r.storage_name ?? "—", fileId: r.kind === "bundle" ? "" : encodeId(r.file_id), name: r.name, isFolder: !!r.is_folder, role: r.role,
    url: `${config.appUrl}/share/${token}`, hasPassword: !!r.password_hash, expiresAt: r.expires_at, maxUploadBytes: r.max_upload_bytes, uploadedBytes: r.uploaded_bytes,
    accessCount: r.access_count, lastAccessAt: r.last_access_at, createdAt: r.created_at, createdByName: r.creator_name ?? null, revokedAt: r.revoked_at,
    expired: !!r.expires_at && r.expires_at < now(),
  };
}
const SELECT = `SELECT l.*, s.name AS storage_name, u.name AS creator_name, r.name AS recipient_name, r.email AS recipient_email, (SELECT COUNT(*) FROM share_items i WHERE i.share_id = l.id) AS item_count FROM share_links l LEFT JOIN storages s ON s.id = l.storage_id LEFT JOIN users u ON u.id = l.created_by LEFT JOIN users r ON r.id = l.recipient_user_id`;

export interface CreateShare { storageId: string; fileId?: string; /** Several items under one link. */ fileIds?: string[]; /** Share with these workspace members instead of making a link. */ recipientUserIds?: string[]; role: "VIEWER" | "EDITOR"; expiresInDays?: number | null; password?: string | null; maxUploadMb?: number | null; regenerate?: boolean; /** Always make an additional link (optionally with a title) instead of reusing the existing one. */ newLink?: boolean; title?: string | null }

const expiryOf = (days?: number | null) => (days ? new Date(Date.now() + days * 86_400_000).toISOString() : null);

/** One link for one item, or one bundle link for several. Direct shares to members go through createDirectShares. */
export async function createShare(ctx: AuthCtx, p: StorageProvider, input: CreateShare) {
  denyVisitor(ctx);
  const rawIds = [...new Set((input.fileIds?.length ? input.fileIds : input.fileId ? [input.fileId] : []).map(decodeId))];
  if (!rawIds.length) throw badRequest("Pilih minimal satu file atau folder.");
  if (rawIds.length > 200) throw badRequest("Satu tautan maksimal 200 item.");
  const files: RemoteFile[] = []; for (const raw of rawIds) files.push(await p.stat(raw).catch(() => { throw notFound("File tidak ditemukan."); }));
  const bundle = files.length > 1;
  if (input.role === "EDITOR" && !files.some((f) => f.isFolder)) throw badRequest(bundle ? "Tautan editor butuh minimal satu folder." : "Tautan editor hanya untuk folder.");
  const title = cleanTitle(input.title);
  const raw = bundle ? BUNDLE : rawIds[0]!; const f = files[0]!;
  if (!bundle && (input.newLink || title)) {
    const n = db.get<{ n: number }>("SELECT COUNT(*) n FROM share_links WHERE storage_id = ? AND file_id = ? AND revoked_at IS NULL AND recipient_user_id IS NULL", input.storageId, raw)!.n;
    if (n >= MAX_LINKS_PER_ITEM) throw badRequest(`Satu item maksimal ${MAX_LINKS_PER_ITEM} tautan aktif. Matikan yang tidak dipakai dulu.`);
  } else if (!bundle) {
    // Legacy behaviour: one reusable link per role unless the caller asks for a fresh one.
    const existing = db.get<any>(`${SELECT} WHERE l.storage_id = ? AND l.file_id = ? AND l.role = ? AND l.revoked_at IS NULL AND l.title IS NULL AND l.recipient_user_id IS NULL`, input.storageId, raw, input.role);
    if (existing && !input.regenerate && !(existing.expires_at && existing.expires_at < now())) return toShareDto(existing);
    if (existing) db.run("UPDATE share_links SET revoked_at = ? WHERE id = ?", now(), existing.id);
  }
  const token = randomToken(32); const id = newId();
  const name = bundle ? `${files.length} item` : f.name === "" ? "Folder" : f.name;
  db.tx(() => {
    db.run(
      `INSERT INTO share_links(id,workspace_id,storage_id,file_id,is_folder,name,role,token_hash,token_enc,password_hash,expires_at,max_upload_bytes,created_by,title,kind) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, ctx.workspaceId, input.storageId, raw, bundle || f.isFolder ? 1 : 0, name, input.role, sha256(token), JSON.stringify(seal(token)), null, expiryOf(input.expiresInDays),
      input.role === "EDITOR" && input.maxUploadMb ? Math.round(input.maxUploadMb * 1024 * 1024) : null, ctx.userId, title, bundle ? "bundle" : "single");
    if (bundle) files.forEach((x, i) => db.run("INSERT INTO share_items(share_id, file_id, name, is_folder, position) VALUES (?,?,?,?,?)", id, x.id, x.name, x.isFolder ? 1 : 0, i));
  });
  if (input.password) db.run("UPDATE share_links SET password_hash = ? WHERE id = ?", await hash(input.password, ARGON), id);
  for (const x of files) logActivity(ctx, input.storageId, x.id, "share", { role: input.role, title, bundle: bundle || undefined });
  audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "share.create", resourceType: "share", resourceId: id, metadata: { storageId: input.storageId, name, role: input.role, title, items: files.length }, ip: ctx.ip });
  return toShareDto(db.get<any>(`${SELECT} WHERE l.id = ?`, id));
}

/** Share with specific workspace members: they find it under "Dibagikan ke saya" and need to be signed in. */
export async function createDirectShares(ctx: AuthCtx, p: StorageProvider, input: CreateShare) {
  denyVisitor(ctx);
  const recipients = [...new Set(input.recipientUserIds ?? [])].slice(0, 50); if (!recipients.length) throw badRequest("Pilih minimal satu anggota.");
  const members = db.all<{ user_id: string }>(`SELECT user_id FROM memberships WHERE workspace_id = ? AND user_id IN (${recipients.map(() => "?").join(",")})`, ctx.workspaceId, ...recipients).map((m) => m.user_id);
  if (members.length !== recipients.length) throw badRequest("Penerima harus anggota workspace ini.");
  if (recipients.includes(ctx.userId)) throw badRequest("Tidak perlu membagikan ke diri sendiri.");
  const rawIds = [...new Set((input.fileIds?.length ? input.fileIds : input.fileId ? [input.fileId] : []).map(decodeId))];
  if (!rawIds.length) throw badRequest("Pilih minimal satu file atau folder.");
  const files: RemoteFile[] = []; for (const raw of rawIds) files.push(await p.stat(raw).catch(() => { throw notFound("File tidak ditemukan."); }));
  const bundle = files.length > 1;
  if (input.role === "EDITOR" && !files.some((f) => f.isFolder)) throw badRequest("Izin editor butuh minimal satu folder.");
  const out: ShareLinkDto[] = []; const title = cleanTitle(input.title);
  for (const uid of recipients) {
    // One live direct share per recipient and item set: sharing again updates its permission instead of piling up duplicates.
    const raw = bundle ? BUNDLE : rawIds[0]!;
    const dup = !bundle ? db.get<any>("SELECT id FROM share_links WHERE storage_id = ? AND file_id = ? AND recipient_user_id = ? AND revoked_at IS NULL", input.storageId, raw, uid) : undefined;
    if (dup) { db.run("UPDATE share_links SET role = ?, title = COALESCE(?, title), expires_at = ? WHERE id = ?", input.role, title, expiryOf(input.expiresInDays), dup.id); out.push(toShareDto(db.get<any>(`${SELECT} WHERE l.id = ?`, dup.id))); continue; }
    const id = newId(); const token = randomToken(32); const name = bundle ? `${files.length} item` : files[0]!.name || "Folder";
    db.tx(() => {
      db.run(`INSERT INTO share_links(id,workspace_id,storage_id,file_id,is_folder,name,role,token_hash,token_enc,expires_at,created_by,title,kind,recipient_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, ctx.workspaceId, input.storageId, raw, bundle || files[0]!.isFolder ? 1 : 0, name, input.role, sha256(token), JSON.stringify(seal(token)), expiryOf(input.expiresInDays), ctx.userId, title, bundle ? "bundle" : "single", uid);
      if (bundle) files.forEach((x, i) => db.run("INSERT INTO share_items(share_id, file_id, name, is_folder, position) VALUES (?,?,?,?,?)", id, x.id, x.name, x.isFolder ? 1 : 0, i));
    });
    notify(ctx.workspaceId, uid, "share.received", "Dibagikan ke Anda", `${ctx.userName} membagikan ${bundle ? `${files.length} item` : `“${name}”`} (${input.role === "EDITOR" ? "bisa mengedit" : "hanya melihat"}).`, { shareId: id });
    out.push(toShareDto(db.get<any>(`${SELECT} WHERE l.id = ?`, id)));
  }
  for (const x of files) logActivity(ctx, input.storageId, x.id, "share", { role: input.role, to: recipients.length, direct: true });
  audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "share.direct", resourceType: "share", metadata: { storageId: input.storageId, recipients: recipients.length, items: files.length, role: input.role }, ip: ctx.ip });
  return out;
}

/** Items other members shared with this user (and are still valid). */
export function listSharedWithMe(ctx: AuthCtx) {
  const rows = db.all<any>(`${SELECT} WHERE l.workspace_id = ? AND l.recipient_user_id = ? AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at > ?) ORDER BY l.created_at DESC`, ctx.workspaceId, ctx.userId, now());
  return rows.map((r) => ({ ...toShareDto(r), url: `/shared/${r.id}` }));
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
    if (patch.role === "EDITOR" && !(isBundle(r) ? shareItems(id).some((i) => i.is_folder) : r.is_folder)) throw badRequest(isBundle(r) ? "Tautan editor butuh minimal satu folder." : "Tautan editor hanya untuk folder.");
    db.run("UPDATE share_links SET role = ?, max_upload_bytes = CASE WHEN ? = 'EDITOR' THEN max_upload_bytes ELSE NULL END WHERE id = ?", patch.role, patch.role, id);
    audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "share.role", resourceType: "share", resourceId: id, metadata: { name: r.name, from: r.role, to: patch.role }, ip: ctx.ip });
    logActivity(ctx, r.storage_id, r.file_id, "share_role", { from: r.role, to: patch.role, title: r.title });
    r.role = patch.role;
  }
  if (patch.expiresInDays !== undefined) db.run("UPDATE share_links SET expires_at = ? WHERE id = ?", patch.expiresInDays ? new Date(Date.now() + patch.expiresInDays * 86_400_000).toISOString() : null, id);
  if (patch.password !== undefined && !r.recipient_user_id) db.run("UPDATE share_links SET password_hash = ? WHERE id = ?", patch.password ? await hash(patch.password, ARGON) : null, id);
  if (patch.maxUploadMb !== undefined && r.role === "EDITOR") db.run("UPDATE share_links SET max_upload_bytes = ? WHERE id = ?", patch.maxUploadMb ? Math.round(patch.maxUploadMb * 1048576) : null, id);
  return toShareDto(db.get<any>(`${SELECT} WHERE l.id = ?`, id));
}
export function revokeShare(ctx: AuthCtx, id: string) {
  const r = ownedShare(ctx, id);
  db.run("UPDATE share_links SET revoked_at = ? WHERE id = ?", now(), id);
  logActivity(ctx, r.storage_id, r.file_id, "unshare", { title: r.title });
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

/** A member opening something that was shared directly with them: same machinery as a public link, but tied to their login. */
export function resolveDirectShare(ctx: AuthCtx, shareId: string, ip: string): ResolvedShare {
  const share = db.get<any>("SELECT * FROM share_links WHERE id = ? AND workspace_id = ? AND recipient_user_id = ?", shareId, ctx.workspaceId, ctx.userId);
  if (!share || share.revoked_at || (share.expires_at && share.expires_at < now())) throw notFound("Item ini sudah tidak dibagikan ke Anda.");
  const storage = db.get<any>("SELECT * FROM storages WHERE id = ?", share.storage_id);
  if (!storage || storage.status !== "CONNECTED") throw new AppError(503, "STORAGE_UNAVAILABLE", "Penyimpanan ini sedang tidak tersedia.");
  return { share, storage, p: providerFor(storage), ctx: { userId: ctx.userId, userName: ctx.userName, isSuperAdmin: false, workspaceId: ctx.workspaceId, role: "MEMBER", ip, viaShare: true, actorOverride: ctx.userId } };
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
  if (isBundle(share)) {
    const items = shareItems(share.id);
    if (items.some((i) => i.file_id === raw)) return;
    const dirs = items.filter((i) => i.is_folder).map((i) => i.file_id);
    if (!dirs.length) throw forbidden("Di luar item yang dibagikan.");
    const k = `${share.id}:${raw}`; const hit = within.get(k); if (hit && hit > Date.now()) return;
    const chain = await p.path(raw).catch(() => { throw notFound("Tidak ditemukan."); });
    if (!chain.some((c) => dirs.includes(c.id))) throw forbidden("Di luar item yang dibagikan.");
    within.set(k, Date.now() + 60_000); return;
  }
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
