import path from "node:path";
import type { FileEntry, FileListing } from "@superdrive/shared";
import { db, now } from "../db.ts";
import { audit } from "../lib/audit.ts";
import { badRequest, conflict } from "../lib/errors.ts";
import { encodeId, ROOT, type RemoteFile, type StorageProvider } from "../providers/types.ts";
import { TRASH } from "../providers/pathutil.ts";
import { type AuthCtx, permissionsFor } from "./permissions.ts";
import { mapProviderError } from "./storages.ts";

export function toEntry(storageId: string, f: RemoteFile, starred = false): FileEntry {
  return {
    id: encodeId(f.id), storageId, parentId: f.parentId ? encodeId(f.parentId) : null, name: f.name, isFolder: f.isFolder,
    mimeType: f.mimeType, size: f.size, modifiedAt: f.modifiedAt, createdAt: f.createdAt, checksum: f.checksum,
    hasThumbnail: f.hasThumbnail, version: f.version, starred,
  };
}

/** Write-through update of the metadata index. `complete` removes children that vanished from the provider. */
export function indexItems(storageId: string, parentId: string, items: RemoteFile[], opts: { complete?: boolean; replaceChildren?: boolean } = {}) {
  const t = now();
  db.tx(() => {
    for (const f of items) {
      const dot = f.name.lastIndexOf(".");
      db.run(
        `INSERT INTO files(storage_id,file_id,parent_id,name,name_lower,ext,mime_type,size,checksum,is_folder,has_thumbnail,version,modified_at,created_at_remote,indexed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(storage_id,file_id) DO UPDATE SET parent_id=excluded.parent_id,name=excluded.name,name_lower=excluded.name_lower,ext=excluded.ext,
          mime_type=excluded.mime_type,size=excluded.size,checksum=excluded.checksum,is_folder=excluded.is_folder,has_thumbnail=excluded.has_thumbnail,
          version=excluded.version,modified_at=excluded.modified_at,created_at_remote=excluded.created_at_remote,indexed_at=excluded.indexed_at`,
        storageId, f.id, f.parentId ?? parentId, f.name, f.name.toLowerCase(), dot > 0 ? f.name.slice(dot + 1).toLowerCase() : null, f.mimeType, f.size,
        f.checksum, f.isFolder ? 1 : 0, f.hasThumbnail ? 1 : 0, f.version, f.modifiedAt, f.createdAt, t);
    }
    if (opts.complete) {
      // Anything indexed under this folder before this scan and not seen again no longer exists.
      db.run("DELETE FROM files WHERE storage_id = ? AND parent_id = ? AND indexed_at < ?", storageId, parentId, t);
    }
  });
}

export function unindex(storageId: string, fileId: string) {
  db.run(
    `WITH RECURSIVE sub(file_id) AS (SELECT ? UNION ALL SELECT f.file_id FROM files f JOIN sub s ON f.parent_id = s.file_id WHERE f.storage_id = ?)
     DELETE FROM files WHERE storage_id = ? AND file_id IN (SELECT file_id FROM sub)`, fileId, storageId, storageId);
}

function starredSet(userId: string, storageId: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = db.all<{ file_id: string }>(
    `SELECT file_id FROM stars WHERE user_id = ? AND storage_id = ? AND file_id IN (${ids.map(() => "?").join(",")})`, userId, storageId, ...ids);
  return new Set(rows.map((r) => r.file_id));
}

export async function listFolder(ctx: AuthCtx, storageId: string, p: StorageProvider, folderId: string, pageToken: string | null, limit = 200): Promise<FileListing> {
  try {
    const [res, folder, crumbs] = await Promise.all([
      p.list(folderId, { pageToken, limit }),
      folderId === ROOT ? Promise.resolve(null) : p.stat(folderId),
      // Breadcrumbs only on the first page; later pages don't need them.
      pageToken ? Promise.resolve([]) : p.path(folderId),
    ]);
    // Only a full single-page listing can prune the index; paged ones just upsert.
    if (folderId === ROOT) res.items = res.items.filter((i) => i.name !== TRASH);
    indexItems(storageId, folderId, res.items, { complete: !pageToken && !res.nextPageToken });
    const stars = starredSet(ctx.userId, storageId, res.items.map((i) => i.id));
    return {
      items: res.items.map((i) => toEntry(storageId, i, stars.has(i.id))), nextPageToken: res.nextPageToken,
      folder: { id: encodeId(folderId), name: folder?.name ?? "", parentId: folder?.parentId ? encodeId(folder.parentId) : folderId === ROOT ? null : ROOT, path: crumbs.map((c) => ({ id: encodeId(c.id), name: c.name })) },
    };
  } catch (e) { mapProviderError(e, storageId); }
}

/** Generate "name (2).ext" until the name is free in `parentId`. */
export async function uniqueName(p: StorageProvider, parentId: string, name: string): Promise<string> {
  const exists = async (n: string) => (p.findChild ? !!(await p.findChild(parentId, n)) : await scanForName(p, parentId, n));
  if (!(await exists(name))) return name;
  const ext = path.extname(name); const base = ext ? name.slice(0, -ext.length) : name;
  for (let i = 2; i < 1000; i++) { const n = `${base} (${i})${ext}`; if (!(await exists(n))) return n; }
  throw conflict("Tidak dapat membuat nama unik.", "NAME_CONFLICT");
}
async function scanForName(p: StorageProvider, parentId: string, name: string) {
  let token: string | null = null;
  do { const r = await p.list(parentId, { pageToken: token, limit: 1000 }); if (r.items.some((i) => i.name === name)) return true; token = r.nextPageToken; } while (token);
  return false;
}

export function validName(name: unknown): string {
  if (typeof name !== "string") throw badRequest("Nama wajib diisi.");
  const n = name.trim();
  if (!n || n.length > 255 || /[\\/\0]/.test(n) || n === "." || n === "..") throw badRequest("Nama tidak valid. Hindari karakter / dan \\.");
  return n;
}

export async function createFolder(ctx: AuthCtx, storageId: string, p: StorageProvider, parentId: string, name: string) {
  try {
    const f = await p.createFolder(parentId, validName(name));
    indexItems(storageId, parentId, [f]);
    audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "file.create_folder", resourceType: "file", resourceId: f.id, metadata: { storageId, name: f.name }, ip: ctx.ip });
    return toEntry(storageId, f);
  } catch (e) { mapProviderError(e, storageId); }
}

export async function renameFile(ctx: AuthCtx, storageId: string, p: StorageProvider, fileId: string, name: string) {
  try {
    const old = await p.stat(fileId);
    const f = await p.rename(fileId, validName(name));
    if (f.id !== fileId) unindex(storageId, fileId);
    indexItems(storageId, f.parentId ?? ROOT, [f]);
    audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "file.rename", resourceType: "file", resourceId: f.id, metadata: { storageId, from: old.name, to: f.name }, ip: ctx.ip });
    return toEntry(storageId, f);
  } catch (e) { mapProviderError(e, storageId); }
}

/** Deleting moves to the trash (recoverable for TRASH_RETENTION_DAYS). */
export async function deleteFile(ctx: AuthCtx, storageId: string, p: StorageProvider, fileId: string) {
  const { trashFiles } = await import("./trash.ts");
  await trashFiles(ctx, storageId, p, [fileId]);
}

export function setStar(userId: string, storageId: string, fileId: string, on: boolean) {
  if (on) db.run("INSERT OR IGNORE INTO stars(user_id,storage_id,file_id) VALUES (?,?,?)", userId, storageId, fileId);
  else db.run("DELETE FROM stars WHERE user_id = ? AND storage_id = ? AND file_id = ?", userId, storageId, fileId);
}

const TYPE_FILTERS: Record<string, string> = {
  folder: "f.is_folder = 1",
  image: "f.mime_type LIKE 'image/%'",
  video: "f.mime_type LIKE 'video/%'",
  audio: "f.mime_type LIKE 'audio/%'",
  pdf: "f.mime_type = 'application/pdf'",
  document: "(f.mime_type LIKE 'text/%' OR f.ext IN ('doc','docx','odt','rtf','txt','md','xls','xlsx','ods','csv','ppt','pptx','odp'))",
  archive: "f.ext IN ('zip','rar','7z','tar','gz','tgz','bz2','xz')",
};

export interface SearchParams {
  q?: string; storageId?: string; type?: string; ext?: string; minSize?: number; maxSize?: number;
  modifiedAfter?: string; modifiedBefore?: string; folderId?: string; sort?: string; page?: number; limit?: number;
  starred?: boolean; recent?: boolean;
}

/** Search the local metadata index. Never touches provider APIs or file contents. */
export function searchIndex(ctx: AuthCtx, s: SearchParams) {
  const storages = db.all<{ id: string }>("SELECT id FROM storages WHERE workspace_id = ? AND status <> 'DISABLED'", ctx.workspaceId)
    .map((r) => r.id).filter((id) => permissionsFor(ctx, id).includes("READ") && (!s.storageId || s.storageId === id));
  if (!storages.length) return { items: [] as FileEntry[], total: 0 };
  const where: string[] = [`f.storage_id IN (${storages.map(() => "?").join(",")})`]; const args: (string | number)[] = [...storages];
  if (s.q?.trim()) {
    for (const term of s.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)) { where.push("f.name_lower LIKE ? ESCAPE '\\'"); args.push(`%${term.replace(/[\\%_]/g, "\\$&")}%`); }
  }
  if (s.type && TYPE_FILTERS[s.type]) where.push(TYPE_FILTERS[s.type]!);
  if (s.ext) { where.push("f.ext = ?"); args.push(s.ext.toLowerCase().replace(/^\./, "")); }
  if (s.folderId) { where.push("f.parent_id = ?"); args.push(s.folderId); }
  if (s.minSize !== undefined) { where.push("f.size >= ?"); args.push(s.minSize); }
  if (s.maxSize !== undefined) { where.push("f.size <= ?"); args.push(s.maxSize); }
  if (s.modifiedAfter) { where.push("f.modified_at >= ?"); args.push(s.modifiedAfter); }
  if (s.modifiedBefore) { where.push("f.modified_at <= ?"); args.push(s.modifiedBefore); }
  if (s.recent) where.push("f.is_folder = 0");
  let from = "files f";
  if (s.starred) { from = "files f JOIN stars st ON st.storage_id = f.storage_id AND st.file_id = f.file_id AND st.user_id = ?"; args.unshift(ctx.userId); }
  const order = { name: "f.name_lower ASC", size: "f.size DESC", modified: "f.modified_at DESC", type: "f.ext ASC, f.name_lower ASC" }[s.sort ?? (s.recent ? "modified" : "name")] ?? "f.name_lower ASC";
  const limit = Math.min(Math.max(s.limit ?? 50, 1), 200); const offset = (Math.max(s.page ?? 1, 1) - 1) * limit;
  const W = where.join(" AND ");
  const total = db.get<{ n: number }>(`SELECT COUNT(*) n FROM ${from} WHERE ${W}`, ...(s.starred ? args : args))!.n;
  const rows = db.all<any>(`SELECT f.* FROM ${from} WHERE ${W} ORDER BY f.is_folder DESC, ${order} LIMIT ? OFFSET ?`, ...args, limit, offset);
  const items: FileEntry[] = rows.map((r) => ({
    id: encodeId(r.file_id), storageId: r.storage_id, parentId: r.parent_id ? encodeId(r.parent_id) : null, name: r.name, isFolder: !!r.is_folder,
    mimeType: r.mime_type, size: r.size, modifiedAt: r.modified_at, createdAt: r.created_at_remote, checksum: r.checksum,
    hasThumbnail: !!r.has_thumbnail, version: r.version, starred: false,
  }));
  if (!s.starred) {
    const byStorage = new Map<string, string[]>();
    for (const r of rows) (byStorage.get(r.storage_id) ?? byStorage.set(r.storage_id, []).get(r.storage_id)!).push(r.file_id);
    for (const [sid, ids] of byStorage) { const set = starredSet(ctx.userId, sid, ids); items.forEach((e, i) => { if (e.storageId === sid && set.has(rows[i].file_id)) e.starred = true; }); }
  } else items.forEach((e) => (e.starred = true));
  return { items, total };
}
