import type { TrashItemDto } from "@superdrive/shared";
import { config } from "../config.ts";
import { db, now } from "../db.ts";
import { audit } from "../lib/audit.ts";
import { newId } from "../lib/crypto.ts";
import { AppError, notFound } from "../lib/errors.ts";
import { TRASH } from "../providers/pathutil.ts";
import { ProviderError, ROOT, decodeId, encodeId, type RemoteFile, type StorageProvider } from "../providers/types.ts";
import { bustListCache, indexItems, toEntry, uniqueName, unindex } from "./files.ts";
import type { AuthCtx } from "./permissions.ts";
import { mapProviderError, providerFor } from "./storages.ts";

/**
 * App-level trash. Deleting moves the item into a hidden `.superdrive-trash` folder at the root of the same
 * storage (so it never leaves the account and costs no transfer), and records where it came from. This works the
 * same for every provider and supports restore, which several provider-native recycle bins do not.
 */
const trashFolderCache = new Map<string, string>();

async function trashFolder(storageId: string, p: StorageProvider): Promise<string> {
  const cached = trashFolderCache.get(storageId);
  if (cached) {
    try { await p.stat(cached); return cached; } catch { trashFolderCache.delete(storageId); }
  }
  const existing = p.findChild ? await p.findChild(ROOT, TRASH) : null;
  const folder = existing?.isFolder ? existing : await p.createFolder(ROOT, TRASH, true);
  trashFolderCache.set(storageId, folder.id);
  return folder.id;
}

export interface Trashed { itemId: string; name: string }

/** Move one item to the trash and record it. `userId` may be null (e.g. replaced by an upload). */
export async function trashRaw(workspaceId: string, userId: string | null, storageId: string, p: StorageProvider, fileId: string, reason = "delete"): Promise<Trashed> {
  const f = await p.stat(fileId);
  const crumbs = f.parentId ? await p.path(f.parentId).catch(() => []) : [];
  const tf = await trashFolder(storageId, p);
  const moved = await p.move!(f.id, tf, `${Date.now().toString(36)}-${newId().slice(0, 6)}-${f.name}`.slice(0, 250));
  const id = newId();
  const expires = new Date(Date.now() + config.trashRetentionDays * 86_400_000).toISOString();
  db.run(
    `INSERT INTO trash_items(id,workspace_id,storage_id,name,is_folder,size,original_parent_id,original_path,trash_file_id,trashed_by,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, workspaceId, storageId, f.name, f.isFolder ? 1 : 0, f.size, f.parentId ?? ROOT, "/" + crumbs.map((c) => c.name).join("/"), moved.id, userId, expires);
  unindex(storageId, f.id);
  db.run("DELETE FROM stars WHERE storage_id = ? AND file_id = ?", storageId, f.id);
  void reason;
  return { itemId: id, name: f.name };
}

export async function trashFiles(ctx: AuthCtx, storageId: string, p: StorageProvider, fileIds: string[]) {
  const out: Trashed[] = [];
  try {
    for (const id of fileIds) {
      const t = await trashRaw(ctx.workspaceId, ctx.userId, storageId, p, id);
      out.push(t);
      audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "file.delete", resourceType: "file", resourceId: id, metadata: { storageId, name: t.name, trash: true }, ip: ctx.ip });
    }
  } catch (e) { mapProviderError(e, storageId); }
  return out;
}

const dto = (r: any, storageName: string | null, userName: string | null): TrashItemDto => ({
  id: r.id, storageId: r.storage_id, storageName: storageName ?? "—", name: r.name, isFolder: !!r.is_folder, size: r.size, originalPath: r.original_path ?? "/",
  trashedAt: r.trashed_at, trashedBy: userName, expiresAt: r.expires_at,
});

export function listTrash(ctx: AuthCtx, q: { storageId?: string; q?: string; page?: number; limit?: number }, allowed: string[]) {
  if (!allowed.length) return { items: [], total: 0 };
  const where = [`t.workspace_id = ?`, `t.storage_id IN (${allowed.map(() => "?").join(",")})`]; const args: any[] = [ctx.workspaceId, ...allowed];
  if (q.storageId) { where.push("t.storage_id = ?"); args.push(q.storageId); }
  if (q.q) { where.push("t.name LIKE ?"); args.push(`%${q.q}%`); }
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200), offset = (Math.max(q.page ?? 1, 1) - 1) * limit;
  const total = db.get<{ n: number }>(`SELECT COUNT(*) n FROM trash_items t WHERE ${where.join(" AND ")}`, ...args)!.n;
  const rows = db.all<any>(`SELECT t.*, s.name AS storage_name, u.name AS user_name FROM trash_items t LEFT JOIN storages s ON s.id = t.storage_id LEFT JOIN users u ON u.id = t.trashed_by
    WHERE ${where.join(" AND ")} ORDER BY t.trashed_at DESC LIMIT ? OFFSET ?`, ...args, limit, offset);
  return { items: rows.map((r) => dto(r, r.storage_name, r.user_name)), total };
}

function ownedItem(ctx: AuthCtx, id: string) {
  const r = db.get<any>("SELECT * FROM trash_items WHERE id = ? AND workspace_id = ?", id, ctx.workspaceId);
  if (!r) throw notFound("Item sampah tidak ditemukan.");
  return r;
}

export async function restoreItem(ctx: AuthCtx, id: string) {
  const r = ownedItem(ctx, id);
  const row = db.get<any>("SELECT * FROM storages WHERE id = ?", r.storage_id); if (!row) throw notFound("Penyimpanan sudah tidak ada.");
  const p = providerFor(row);
  try {
    let parent = r.original_parent_id as string;
    try { const pf = await p.stat(parent); if (!pf.isFolder) parent = ROOT; } catch { parent = ROOT; } // original folder is gone: restore at the root
    const name = await uniqueName(p, parent, r.name);
    const moved: RemoteFile = await p.move!(r.trash_file_id, parent, name);
    indexItems(r.storage_id, parent, [moved]); bustListCache(r.storage_id);
    db.run("DELETE FROM trash_items WHERE id = ?", id);
    audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "file.restore", resourceType: "file", resourceId: moved.id, metadata: { storageId: r.storage_id, name: moved.name }, ip: ctx.ip });
    return { name: moved.name, storageId: r.storage_id, parentId: encodeId(parent) };
  } catch (e) {
    // The trashed copy is missing (removed outside SuperDrive): drop the stale record.
    if (e instanceof ProviderError && e.kind === "not_found") { db.run("DELETE FROM trash_items WHERE id = ?", id); throw new AppError(404, "NOT_FOUND", "File sudah tidak ada di tempat sampah penyimpanan."); }
    return mapProviderError(e, r.storage_id);
  }
}

export async function purgeItem(ctx: AuthCtx | null, id: string, workspaceId?: string) {
  const r = ctx ? ownedItem(ctx, id) : db.get<any>("SELECT * FROM trash_items WHERE id = ? AND workspace_id = ?", id, workspaceId!);
  if (!r) return;
  const row = db.get<any>("SELECT * FROM storages WHERE id = ?", r.storage_id);
  if (row) {
    try { await providerFor(row).delete(r.trash_file_id); }
    catch (e) { if (!(e instanceof ProviderError && e.kind === "not_found")) return mapProviderError(e, r.storage_id); }
  }
  db.run("DELETE FROM trash_items WHERE id = ?", id);
  if (ctx) audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "file.purge", resourceType: "file", metadata: { storageId: r.storage_id, name: r.name }, ip: ctx.ip });
}

/** Called hourly: permanently remove items past retention. */
export async function sweepTrash(limit = 100) {
  const due = db.all<any>("SELECT id, workspace_id FROM trash_items WHERE expires_at < ? ORDER BY expires_at LIMIT ?", now(), limit);
  for (const d of due) await purgeItem(null, d.id, d.workspace_id).catch(() => {});
  return due.length;
}

/* ---------------- inside a trashed folder ---------------- */

/** Make sure `raw` really is inside the trashed folder (or is it), so ids cannot be used to reach other files. */
async function assertInside(p: StorageProvider, r: any, raw: string) {
  if (raw === r.trash_file_id) return;
  const chain = await p.path(raw).catch(() => { throw notFound("Tidak ditemukan."); });
  if (!chain.some((c) => c.id === r.trash_file_id)) throw new AppError(403, "FORBIDDEN", "Item ini bukan bagian dari folder di sampah.");
}
const trashProvider = (r: any) => { const row = db.get<any>("SELECT * FROM storages WHERE id = ?", r.storage_id); if (!row) throw notFound("Penyimpanan sudah tidak ada."); return providerFor(row); };

export async function listTrashChildren(ctx: AuthCtx, trashId: string, folderEnc: string | undefined, pageToken: string | null, limit = 200) {
  const r = ownedItem(ctx, trashId); if (!r.is_folder) return { items: [], nextPageToken: null };
  const p = trashProvider(r);
  try {
    const raw = folderEnc && folderEnc !== "root" ? decodeId(folderEnc) : r.trash_file_id;
    await assertInside(p, r, raw);
    const res = await p.list(raw, { pageToken, limit });
    return { items: res.items.map((f) => toEntry(r.storage_id, f)), nextPageToken: res.nextPageToken };
  } catch (e) { return mapProviderError(e, r.storage_id); }
}

async function ensureChain(p: StorageProvider, parentId: string, names: string[]) {
  let cur = parentId;
  for (const n of names) { const hit = p.findChild ? await p.findChild(cur, n) : null; cur = hit?.isFolder ? hit.id : (await p.createFolder(cur, n)).id; }
  return cur;
}

/** Restore selected files/folders from inside a trashed folder, recreating the folders they were in. */
export async function restoreChildren(ctx: AuthCtx, trashId: string, ids: string[]) {
  const r = ownedItem(ctx, trashId); const p = trashProvider(r); const restored: string[] = [];
  try {
    for (const enc of ids) {
      const raw = decodeId(enc); await assertInside(p, r, raw);
      if (raw === r.trash_file_id) { await restoreItem(ctx, trashId); return { restored: [r.name], removedParent: true }; }
      const f = await p.stat(raw);
      const chain = f.parentId ? await p.path(f.parentId) : [];
      const at = chain.findIndex((c) => c.id === r.trash_file_id);
      const rel = at >= 0 ? chain.slice(at + 1).map((c) => c.name) : [];
      let base = r.original_parent_id as string;
      try { if (!(await p.stat(base)).isFolder) base = ROOT; } catch { base = ROOT; }
      const dest = await ensureChain(p, base, [r.name, ...rel]);
      const name = await uniqueName(p, dest, f.name);
      const moved = await p.move!(raw, dest, name);
      indexItems(r.storage_id, dest, [moved]); bustListCache(r.storage_id); restored.push(moved.name);
      await pruneEmpty(p, r, f.parentId);
    }
    const removedParent = await dropIfEmpty(p, r);
    audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "file.restore", resourceType: "file", metadata: { storageId: r.storage_id, count: restored.length, from: r.name }, ip: ctx.ip });
    return { restored, removedParent };
  } catch (e) { return mapProviderError(e, r.storage_id); }
}

export async function purgeChildren(ctx: AuthCtx, trashId: string, ids: string[]) {
  const r = ownedItem(ctx, trashId); const p = trashProvider(r);
  try {
    for (const enc of ids) {
      const raw = decodeId(enc); await assertInside(p, r, raw);
      if (raw === r.trash_file_id) { await purgeItem(ctx, trashId); return { removedParent: true }; }
      const f = await p.stat(raw); await p.delete(raw); await pruneEmpty(p, r, f.parentId);
    }
    const removedParent = await dropIfEmpty(p, r);
    audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "file.purge", resourceType: "file", metadata: { storageId: r.storage_id, count: ids.length, from: r.name }, ip: ctx.ip });
    return { removedParent };
  } catch (e) { return mapProviderError(e, r.storage_id); }
}

/** Remove folders left empty inside the trashed folder, walking up until something is still there. */
async function pruneEmpty(p: StorageProvider, r: any, start: string | null) {
  let cur = start;
  for (let i = 0; cur && cur !== r.trash_file_id && i < 40; i++) {
    const left = await p.list(cur, { limit: 1 }).catch(() => null); if (!left || left.items.length) return;
    const f = await p.stat(cur).catch(() => null); if (!f) return;
    await p.delete(cur).catch(() => {}); cur = f.parentId;
  }
}

/** A trashed folder that has been emptied by restoring/purging its contents has nothing left to show. */
async function dropIfEmpty(p: StorageProvider, r: any) {
  const left = await p.list(r.trash_file_id, { limit: 1 }).catch(() => null);
  if (left && left.items.length === 0) { await p.delete(r.trash_file_id).catch(() => {}); db.run("DELETE FROM trash_items WHERE id = ?", r.id); return true; }
  return false;
}
