import { db, now } from "../db.ts";
import { newId } from "../lib/crypto.ts";
import { badRequest, forbidden, notFound } from "../lib/errors.ts";
import { decodeId, ROOT } from "../providers/types.ts";
import type { AuthCtx } from "./permissions.ts";

/** Who did it, as stored: a member's id, or "share:<id>" for a visitor of a share link. */
export const actorOf = (ctx: AuthCtx, shareId?: string) => (ctx.viaShare ? `share:${shareId ?? "?"}` : ctx.userId);

/* ---------------- "something changed in this folder" badges ---------------- */

function ancestorsOf(storageId: string, folderRaw: string): string[] {
  const out: string[] = []; let cur: string | null = folderRaw;
  for (let i = 0; cur && cur !== ROOT && i < 60; i++) {
    out.push(cur);
    cur = db.get<{ parent_id: string | null }>("SELECT parent_id FROM files WHERE storage_id = ? AND file_id = ?", storageId, cur)?.parent_id ?? null;
  }
  return out;
}

/** A change happened inside `folderRaw`: it and every folder above it get a badge for everyone except the actor, until opened. */
export function touchFolder(storageId: string, folderRaw: string | null | undefined, actor: string) {
  if (!folderRaw || folderRaw === ROOT) return;
  const at = now();
  for (const id of ancestorsOf(storageId, folderRaw))
    db.run("INSERT INTO folder_changes(storage_id, folder_id, changed_at, by_actor) VALUES (?,?,?,?) ON CONFLICT(storage_id, folder_id) DO UPDATE SET changed_at = excluded.changed_at, by_actor = excluded.by_actor", storageId, id, at, actor);
}

export function markSeen(userId: string, storageId: string, folderRaw: string) {
  if (folderRaw === ROOT) return;
  db.run("INSERT INTO folder_seen(user_id, storage_id, folder_id, seen_at) VALUES (?,?,?,?) ON CONFLICT(user_id, storage_id, folder_id) DO UPDATE SET seen_at = excluded.seen_at", userId, storageId, folderRaw, now());
}

/** Folders among `ids` with changes by someone else that this user has not seen yet. */
export function changedFolders(userId: string, storageId: string, ids: string[]): Set<string> {
  const out = new Set<string>(); if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400); const q = chunk.map(() => "?").join(",");
    const rows = db.all<{ folder_id: string }>(
      `SELECT c.folder_id FROM folder_changes c LEFT JOIN folder_seen s ON s.user_id = ? AND s.storage_id = c.storage_id AND s.folder_id = c.folder_id
       WHERE c.storage_id = ? AND c.folder_id IN (${q}) AND c.by_actor != ? AND (s.seen_at IS NULL OR s.seen_at < c.changed_at)`, userId, storageId, ...chunk, userId);
    for (const r of rows) out.add(r.folder_id);
  }
  return out;
}

/* ---------------- activity per file ---------------- */

export type FileAction = "create" | "upload" | "rename" | "delete" | "restore" | "move" | "view" | "download" | "share" | "unshare" | "share_role" | "comment" | "tag";
/** Record what happened to a file. Repeated views/downloads by the same actor within a minute count once. */
export function logActivity(ctx: AuthCtx, storageId: string, fileRaw: string, action: FileAction, meta: Record<string, unknown> = {}, shareId?: string) {
  const actor = actorOf(ctx, shareId);
  if (action === "view" || action === "download") {
    const recent = db.get("SELECT 1 FROM file_activity WHERE storage_id = ? AND file_id = ? AND actor = ? AND action = ? AND created_at > ?", storageId, fileRaw, actor, action, new Date(Date.now() - 60_000).toISOString());
    if (recent) return;
  }
  db.run("INSERT INTO file_activity(id, workspace_id, storage_id, file_id, actor, action, meta, ip) VALUES (?,?,?,?,?,?,?,?)", newId(), ctx.workspaceId, storageId, fileRaw, actor, action, Object.keys(meta).length ? JSON.stringify(meta) : null, ctx.ip);
}

export interface ActivityDto { id: string; action: FileAction; actor: string; actorKind: "member" | "visitor" | "system"; meta: Record<string, unknown>; at: string; ip: string | null }
export function listActivity(storageId: string, fileRaw: string, limit = 60): ActivityDto[] {
  const rows = db.all<any>(
    `SELECT a.*, u.name AS user_name, l.title AS share_title, l.name AS share_name FROM file_activity a
     LEFT JOIN users u ON u.id = a.actor LEFT JOIN share_links l ON a.actor = 'share:' || l.id
     WHERE a.storage_id = ? AND a.file_id = ? ORDER BY a.created_at DESC LIMIT ?`, storageId, fileRaw, Math.min(Math.max(limit, 1), 200));
  return rows.map((r) => ({
    id: r.id, action: r.action, at: r.created_at, ip: r.ip, meta: r.meta ? JSON.parse(r.meta) : {},
    actor: r.user_name ?? (String(r.actor).startsWith("share:") ? `Tamu${r.share_title ? ` · ${r.share_title}` : " · tautan berbagi"}` : "Sistem"),
    actorKind: r.user_name ? "member" : String(r.actor).startsWith("share:") ? "visitor" : "system",
  }));
}

/* ---------------- tags ---------------- */

const cleanTag = (t: unknown) => { const v = String(t ?? "").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 32); if (!v) throw badRequest("Tag tidak valid. Pakai huruf, angka, atau tanda hubung."); return v; };
export const listTags = (storageId: string, fileRaw: string) => db.all<{ tag: string }>("SELECT tag FROM file_tags WHERE storage_id = ? AND file_id = ? ORDER BY tag", storageId, fileRaw).map((r) => r.tag);
export function addTag(ctx: AuthCtx, storageId: string, fileRaw: string, tag: unknown) {
  const t = cleanTag(tag);
  if ((db.get<{ n: number }>("SELECT COUNT(*) n FROM file_tags WHERE storage_id = ? AND file_id = ?", storageId, fileRaw)?.n ?? 0) >= 20) throw badRequest("Maksimal 20 tag per item.");
  const r = db.run("INSERT OR IGNORE INTO file_tags(storage_id, file_id, tag, workspace_id, created_by) VALUES (?,?,?,?,?)", storageId, fileRaw, t, ctx.workspaceId, ctx.userId);
  if (r.changes) logActivity(ctx, storageId, fileRaw, "tag", { add: t });
  return listTags(storageId, fileRaw);
}
export function removeTag(ctx: AuthCtx, storageId: string, fileRaw: string, tag: string) {
  const r = db.run("DELETE FROM file_tags WHERE storage_id = ? AND file_id = ? AND tag = ?", storageId, fileRaw, tag);
  if (r.changes) logActivity(ctx, storageId, fileRaw, "tag", { remove: tag });
  return listTags(storageId, fileRaw);
}
export const workspaceTags = (workspaceId: string) => db.all<{ tag: string; n: number }>("SELECT tag, COUNT(*) n FROM file_tags WHERE workspace_id = ? GROUP BY tag ORDER BY n DESC, tag LIMIT 100", workspaceId);

/* ---------------- comments ---------------- */

export interface CommentDto { id: string; body: string; authorId: string; authorName: string; createdAt: string; mine: boolean }
const commentDto = (r: any, me: string): CommentDto => ({ id: r.id, body: r.body, authorId: r.user_id, authorName: r.author_name ?? "Pengguna", createdAt: r.created_at, mine: r.user_id === me });
export const listComments = (ctx: AuthCtx, storageId: string, fileRaw: string) =>
  db.all<any>("SELECT c.*, u.name AS author_name FROM file_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.storage_id = ? AND c.file_id = ? ORDER BY c.created_at", storageId, fileRaw).map((r) => commentDto(r, ctx.userId));
export function addComment(ctx: AuthCtx, storageId: string, fileRaw: string, body: unknown) {
  const text = String(body ?? "").trim(); if (!text) throw badRequest("Komentar tidak boleh kosong."); if (text.length > 2000) throw badRequest("Komentar maksimal 2000 karakter.");
  const id = newId(); db.run("INSERT INTO file_comments(id, workspace_id, storage_id, file_id, user_id, body) VALUES (?,?,?,?,?,?)", id, ctx.workspaceId, storageId, fileRaw, ctx.userId, text);
  logActivity(ctx, storageId, fileRaw, "comment", {});
  return commentDto(db.get<any>("SELECT c.*, u.name AS author_name FROM file_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?", id), ctx.userId);
}
export function deleteComment(ctx: AuthCtx, storageId: string, commentId: string) {
  const r = db.get<any>("SELECT * FROM file_comments WHERE id = ? AND storage_id = ? AND workspace_id = ?", commentId, storageId, ctx.workspaceId); if (!r) throw notFound("Komentar tidak ditemukan.");
  if (r.user_id !== ctx.userId && ctx.role !== "OWNER" && ctx.role !== "ADMIN") throw forbidden("Hanya penulis atau admin yang bisa menghapus komentar.");
  db.run("DELETE FROM file_comments WHERE id = ?", commentId);
}
export const commentCount = (storageId: string, fileRaw: string) => db.get<{ n: number }>("SELECT COUNT(*) n FROM file_comments WHERE storage_id = ? AND file_id = ?", storageId, fileRaw)?.n ?? 0;
void decodeId;
