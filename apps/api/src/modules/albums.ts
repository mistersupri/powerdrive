import { hash, verify } from "@node-rs/argon2";
import type { FileEntry } from "@superdrive/shared";
import { db, now } from "../db.ts";
import { newId, sha256 } from "../lib/crypto.ts";
import { AppError, badRequest, forbidden, notFound } from "../lib/errors.ts";
import { ARGON } from "./auth.ts";
import { permissionsFor, type AuthCtx } from "./permissions.ts";
import { encodeId } from "../providers/types.ts";

/**
 * Albums are personal collections of photos and videos (references to files, nothing is copied).
 * A private album is hidden: its photos disappear from the gallery, search, recent/starred and folder listings
 * for its owner until they are taken out of the album, and the album itself only opens after the owner entered their album password
 * (valid ten minutes for that sign-in session). This hides things in the app; it does not encrypt the files.
 */
const UNLOCK_MS = 10 * 60_000;

export interface AlbumDto { id: string; name: string; isPrivate: boolean; count: number; updatedAt: string; cover: FileEntry | null }

export const entryOfRow = (r: any): FileEntry => ({
  id: encodeId(r.file_id), storageId: r.storage_id, parentId: r.parent_id ? encodeId(r.parent_id) : null, name: r.name, isFolder: false, mimeType: r.mime_type, size: r.size,
  modifiedAt: r.modified_at, createdAt: r.created_at_remote, checksum: r.checksum, hasThumbnail: !!r.has_thumbnail, version: r.version, starred: false,
});

/** SQL that leaves out whatever the user keeps in private albums. `alias` is the files table in the query. */
export function notPrivateSql(ctx: AuthCtx, alias = "f"): { sql: string; args: string[] } {
  return { sql: `NOT EXISTS (SELECT 1 FROM album_items ai JOIN albums al ON al.id = ai.album_id WHERE al.is_private = 1 AND al.owner_id = ? AND ai.storage_id = ${alias}.storage_id AND ai.file_id = ${alias}.file_id)`, args: [ctx.userId] };
}
/** File ids (raw provider ids) of this user's private items in one storage; used to filter live folder listings. */
export function privateIds(ctx: AuthCtx, storageId: string): Set<string> {
  if (ctx.viaShare) return new Set();
  return new Set(db.all<{ file_id: string }>("SELECT ai.file_id FROM album_items ai JOIN albums al ON al.id = ai.album_id WHERE al.is_private = 1 AND al.owner_id = ? AND ai.storage_id = ?", ctx.userId, storageId).map((r) => r.file_id));
}

/* ---- album password and unlock state ---- */
const hasPassword = (userId: string) => !!db.get<{ h: string | null }>("SELECT album_password_hash h FROM users WHERE id = ?", userId)?.h;
const tries = new Map<string, { n: number; until: number }>();
export function privateStatus(ctx: AuthCtx, token: string | null | undefined) {
  const until = token ? db.get<{ p: string | null }>("SELECT private_until p FROM sessions WHERE token_hash = ?", sha256(token))?.p ?? null : null;
  const unlocked = !!until && Date.parse(until) > Date.now();
  const count = db.get<{ n: number }>("SELECT COUNT(*) n FROM albums WHERE owner_id = ? AND workspace_id = ? AND is_private = 1", ctx.userId, ctx.workspaceId)!.n;
  return { hasPassword: hasPassword(ctx.userId), unlocked, until: unlocked ? until : null, count };
}
const validPassword = (pw: string) => { if (pw.length < 6 || pw.length > 200) throw badRequest("Kata sandi album minimal 6 karakter."); };

export async function setPassword(ctx: AuthCtx, password: string, currentPassword: string | undefined) {
  validPassword(password);
  const row = db.get<{ h: string | null }>("SELECT album_password_hash h FROM users WHERE id = ?", ctx.userId);
  if (row?.h) await checkPassword(ctx.userId, currentPassword ?? "");
  db.run("UPDATE users SET album_password_hash = ? WHERE id = ?", await hash(password, ARGON), ctx.userId);
  db.run("UPDATE sessions SET private_until = NULL WHERE user_id = ?", ctx.userId); // everything locks again after a change
}
async function checkPassword(userId: string, password: string) {
  const t = tries.get(userId);
  if (t && t.until > Date.now()) throw new AppError(429, "PASSWORD_LOCKED", "Terlalu banyak percobaan yang salah. Coba lagi dalam beberapa menit.");
  const h = db.get<{ h: string | null }>("SELECT album_password_hash h FROM users WHERE id = ?", userId)?.h;
  if (!h) throw badRequest("Kata sandi album belum dibuat.", "NO_PASSWORD");
  if (!(await verify(h, password).catch(() => false))) {
    const n = (t?.n ?? 0) + 1; tries.set(userId, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
    if (n >= 5) { tries.set(userId, { n: 0, until: Date.now() + 5 * 60_000 }); throw new AppError(429, "PASSWORD_LOCKED", "Terlalu banyak percobaan yang salah. Coba lagi dalam 5 menit."); }
    throw new AppError(401, "WRONG_PASSWORD", "Kata sandi album salah.");
  }
  tries.delete(userId);
}
export async function unlock(ctx: AuthCtx, token: string, password: string) {
  await checkPassword(ctx.userId, password);
  db.run("UPDATE sessions SET private_until = ? WHERE token_hash = ?", new Date(Date.now() + UNLOCK_MS).toISOString(), sha256(token));
}
export function lock(token: string) { db.run("UPDATE sessions SET private_until = NULL WHERE token_hash = ?", sha256(token)); }

/* ---- albums ---- */
function cover(albumId: string): FileEntry | null {
  const r = db.get<any>("SELECT f.* FROM album_items ai JOIN files f ON f.storage_id = ai.storage_id AND f.file_id = ai.file_id WHERE ai.album_id = ? AND f.is_folder = 0 ORDER BY COALESCE(f.modified_at, '') DESC LIMIT 1", albumId);
  return r ? entryOfRow(r) : null;
}
const dto = (a: any): AlbumDto => ({
  id: a.id, name: a.name, isPrivate: !!a.is_private, updatedAt: a.updated_at, cover: cover(a.id),
  count: db.get<{ n: number }>("SELECT COUNT(*) n FROM album_items ai JOIN files f ON f.storage_id = ai.storage_id AND f.file_id = ai.file_id WHERE ai.album_id = ?", a.id)!.n,
});

export function listAlbums(ctx: AuthCtx, token: string | null | undefined) {
  const st = privateStatus(ctx, token);
  const rows = db.all<any>(`SELECT * FROM albums WHERE owner_id = ? AND workspace_id = ? ${st.unlocked ? "" : "AND is_private = 0"} ORDER BY is_private, LOWER(name)`, ctx.userId, ctx.workspaceId);
  return { albums: rows.map(dto), private: st };
}

/** The album if it is the caller's; a private one only while unlocked. */
export function albumFor(ctx: AuthCtx, token: string | null | undefined, id: string) {
  const a = db.get<any>("SELECT * FROM albums WHERE id = ? AND owner_id = ? AND workspace_id = ?", id, ctx.userId, ctx.workspaceId);
  if (!a) throw notFound("Album tidak ditemukan.");
  if (a.is_private && !privateStatus(ctx, token).unlocked) throw new AppError(403, "PRIVATE_LOCKED", "Album privat terkunci. Masukkan kata sandi album untuk membukanya.");
  return a;
}
const cleanName = (n: string) => { const s = n.trim(); if (!s || s.length > 80) throw badRequest("Nama album 1 sampai 80 karakter."); return s; };

export function createAlbum(ctx: AuthCtx, token: string | null | undefined, name: string, isPrivate: boolean): AlbumDto {
  if (isPrivate) { const st = privateStatus(ctx, token); if (!st.hasPassword) throw badRequest("Buat kata sandi album dulu.", "NO_PASSWORD"); if (!st.unlocked) throw new AppError(403, "PRIVATE_LOCKED", "Buka kunci album privat dulu."); }
  const id = newId();
  db.run("INSERT INTO albums(id,workspace_id,owner_id,name,is_private) VALUES (?,?,?,?,?)", id, ctx.workspaceId, ctx.userId, cleanName(name), isPrivate ? 1 : 0);
  return dto(db.get("SELECT * FROM albums WHERE id = ?", id));
}
export function renameAlbum(ctx: AuthCtx, token: string | null | undefined, id: string, name: string) {
  albumFor(ctx, token, id); db.run("UPDATE albums SET name = ?, updated_at = ? WHERE id = ?", cleanName(name), now(), id); return dto(db.get("SELECT * FROM albums WHERE id = ?", id));
}
export function deleteAlbum(ctx: AuthCtx, token: string | null | undefined, id: string) { albumFor(ctx, token, id); db.run("DELETE FROM albums WHERE id = ?", id); }

export interface ItemRef { storageId: string; fileId: string } // fileId is the raw provider id
export function addItems(ctx: AuthCtx, token: string | null | undefined, id: string, items: ItemRef[]) {
  albumFor(ctx, token, id); let added = 0;
  db.tx(() => {
    for (const it of items.slice(0, 2000)) {
      if (!permissionsFor(ctx, it.storageId).includes("READ")) throw forbidden("Anda tidak punya akses ke salah satu file.");
      if (!db.get("SELECT 1 FROM files f JOIN storages s ON s.id = f.storage_id WHERE f.storage_id = ? AND f.file_id = ? AND f.is_folder = 0 AND s.workspace_id = ?", it.storageId, it.fileId, ctx.workspaceId)) continue;
      added += Number(db.run("INSERT OR IGNORE INTO album_items(album_id, storage_id, file_id) VALUES (?,?,?)", id, it.storageId, it.fileId).changes);
    }
    db.run("UPDATE albums SET updated_at = ? WHERE id = ?", now(), id);
  });
  return { added };
}
export function removeItems(ctx: AuthCtx, token: string | null | undefined, id: string, items: ItemRef[]) {
  albumFor(ctx, token, id);
  db.tx(() => { for (const it of items.slice(0, 2000)) db.run("DELETE FROM album_items WHERE album_id = ? AND storage_id = ? AND file_id = ?", id, it.storageId, it.fileId); db.run("UPDATE albums SET updated_at = ? WHERE id = ?", now(), id); });
}

/** Folders that hold photos or videos, newest first: the "Folder" view of the gallery. */
export function mediaFolders(ctx: AuthCtx, mediaSql: string, storageIds: string[]) {
  if (!storageIds.length) return [];
  const hide = notPrivateSql(ctx);
  const rows = db.all<any>(
    `SELECT f.storage_id, f.parent_id, COUNT(*) n, MAX(COALESCE(f.modified_at, '')) latest FROM files f WHERE f.storage_id IN (${storageIds.map(() => "?").join(",")}) AND f.is_folder = 0 AND (${mediaSql}) AND ${hide.sql} GROUP BY f.storage_id, f.parent_id ORDER BY latest DESC LIMIT 500`, ...storageIds, ...hide.args);
  return rows.map((r) => {
    const folder = r.parent_id && r.parent_id !== "root" ? db.get<any>("SELECT name FROM files WHERE storage_id = ? AND file_id = ?", r.storage_id, r.parent_id) : null;
    const storage = db.get<any>("SELECT name, is_default FROM storages WHERE id = ?", r.storage_id);
    const c = db.get<any>(`SELECT f.* FROM files f WHERE f.storage_id = ? AND f.parent_id IS ? AND f.is_folder = 0 AND (${mediaSql}) AND ${hide.sql} ORDER BY COALESCE(f.modified_at, '') DESC LIMIT 1`, r.storage_id, r.parent_id, ...hide.args);
    return { storageId: r.storage_id, folderId: r.parent_id ? encodeId(r.parent_id) : "root", name: folder?.name ?? (storage?.is_default ? "Semua file" : storage?.name ?? "Folder"), storageName: storage?.is_default ? "Semua file" : storage?.name ?? "", count: r.n as number, cover: c ? entryOfRow(c) : null };
  });
}
