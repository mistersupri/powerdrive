import { logActivity } from "../modules/activity.ts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { PublicShareDto } from "@superdrive/shared";
import { COOKIE_PATH_PREFIX, ok } from "./publicShared.ts";
import { requireAuth } from "../app.ts";
import { db, now } from "../db.ts";
import { audit } from "../lib/audit.ts";
import { AppError, badRequest, forbidden } from "../lib/errors.ts";
import { sendFile, sendFolderZip, sendThumbnail, sendZip } from "../modules/delivery.ts";
import { createFolder, listFolderShared, renameFile, toEntry } from "../modules/files.ts";
import { accessKeyValid, assertWithin, checkSharePassword, findShare, isBundle, makeAccessKey, resolveDirectShare, resolveShare, shareItems, type ResolvedShare } from "../modules/shares.ts";
import { trashFiles } from "../modules/trash.ts";
import { cancelUpload, createUpload, getUpload, receiveChunk, retryUpload } from "../modules/uploads.ts";
import { mapProviderError } from "../modules/storages.ts";
import { decodeId, ROOT, type RemoteFile } from "../providers/types.ts";
import { config } from "../config.ts";

const cookieName = (id: string) => `sd_sk_${id.slice(0, 12)}`;
const lim = (max: number) => ({ config: { rateLimit: { max, timeWindow: "1 minute" } } });

/**
 * The routes behind a share. Registered twice: under /public (anyone with the token, optional password) and under /shared
 * (a signed-in member the item was shared with directly; `:token` is then the share id). Everything else is identical,
 * including the rule that nothing outside the shared item(s) is reachable.
 */
const makeShareRoutes = (direct: boolean) => async function shareRoutes(app: FastifyInstance) {
  const rootParent = (share: any) => { if (isBundle(share)) throw badRequest("Buka salah satu folder dulu untuk menambah atau mengubah isinya."); return share.file_id as string; };
  /** Top-level items of a share can be neither renamed nor deleted through it. */
  const isTopLevel = (share: any, raw: string) => (isBundle(share) ? shareItems(share.id).some((i) => i.file_id === raw) : raw === share.file_id);
  /** Resolve the link and enforce the password gate. Never reveals why a link is unavailable. */
  const gate = (req: FastifyRequest, needEditor = false): ResolvedShare => {
    const { token } = req.params as any;
    const r = direct ? resolveDirectShare(requireAuth(req), token, req.ip) : resolveShare(token, req.ip);
    if (!direct && r.share.password_hash && !accessKeyValid(r.share.id, (req.cookies as any)[cookieName(r.share.id)]))
      throw new AppError(401, "PASSWORD_REQUIRED", "Tautan ini dilindungi kata sandi.");
    if (needEditor && r.share.role !== "EDITOR") throw forbidden("Tautan ini hanya untuk melihat.");
    return r;
  };
  const noStore = (reply: FastifyReply) => reply.header("cache-control", "private, no-store");

  app.get("/share/:token", lim(120), async (req, reply) => {
    const { token } = req.params as any;
    const r = direct ? resolveDirectShare(requireAuth(req), token, req.ip) : resolveShare(token, req.ip);
    const unlocked = direct || !r.share.password_hash || accessKeyValid(r.share.id, (req.cookies as any)[cookieName(r.share.id)]);
    db.run("UPDATE share_links SET access_count = access_count + 1, last_access_at = ? WHERE id = ?", now(), r.share.id);
    const d: PublicShareDto = { name: r.share.name, isFolder: !!r.share.is_folder, isBundle: isBundle(r.share), itemCount: isBundle(r.share) ? shareItems(r.share.id).length : 1, role: r.share.role, requiresPassword: !direct && !!r.share.password_hash, unlocked, expiresAt: r.share.expires_at, maxUploadBytes: r.share.max_upload_bytes, uploadedBytes: r.share.uploaded_bytes };
    noStore(reply); return ok(req, d);
  });

  if (!direct) app.post("/share/:token/unlock", lim(10), async (req, reply) => {
    const { token } = req.params as any;
    const share = findShare(token);
    const { password } = z.object({ password: z.string().max(200) }).parse(req.body);
    if (!(await checkSharePassword(share, password))) throw new AppError(401, "WRONG_PASSWORD", "Kata sandi salah.");
    reply.setCookie(cookieName(share.id), makeAccessKey(share.id), { httpOnly: true, sameSite: "lax", secure: config.isProd, path: `${COOKIE_PATH_PREFIX}/${token}`, maxAge: 12 * 3600 });
    return ok(req, {});
  });

  app.get("/share/:token/list", lim(3000), async (req, reply) => {
    const r = gate(req);
    const q = z.object({ folderId: z.string().optional(), pageToken: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query);
    if (!r.share.is_folder) throw badRequest("Tautan ini untuk satu file.");
    const bundle = isBundle(r.share);
    if (bundle && (!q.folderId || q.folderId === "root")) {
      // Virtual top level of a bundle: just the shared items, folders first.
      const items = []; for (const it of shareItems(r.share.id)) { try { items.push({ ...toEntry("share", await r.p.stat(it.file_id)), parentId: null, starred: false }); } catch { /* removed since sharing */ } }
      items.sort((x, y) => Number(y.isFolder) - Number(x.isFolder) || x.name.localeCompare(y.name, undefined, { numeric: true }));
      noStore(reply); return ok(req, { items, nextPageToken: null, folder: { id: "root", name: r.share.name, parentId: null, path: [] } });
    }
    const folder = q.folderId && q.folderId !== "root" ? decodeId(q.folderId) : r.share.file_id;
    await assertWithin(r.share, r.p, folder);
    const listing = structuredClone(await listFolderShared(r.ctx, r.storage.id, r.p, folder, q.pageToken ?? null, q.limit));
    // Present paths relative to the shared folder (or, for a bundle, starting at the shared top-level folder) and never expose the parent.
    const isRoot = !bundle && folder === r.share.file_id;
    if (bundle) { const dirs = shareItems(r.share.id).filter((i) => i.is_folder).map((i) => i.file_id); const at = listing.folder.path.findIndex((c) => dirs.includes(decodeId(c.id))); listing.folder.path = at >= 0 ? listing.folder.path.slice(at) : []; }
    else { const rootEnc = listing.folder.path.findIndex((c) => decodeId(c.id) === r.share.file_id); listing.folder.path = r.share.file_id === ROOT ? listing.folder.path : listing.folder.path.slice(rootEnc + 1); }
    listing.items = listing.items.map((i) => ({ ...i, storageId: "share", starred: false }));
    listing.folder = { ...listing.folder, id: isRoot ? "root" : listing.folder.id, parentId: null, name: isRoot ? r.share.name : listing.folder.name };
    noStore(reply); return ok(req, listing);
  });

  /** The single shared file (for file links). */
  app.get("/share/:token/item", lim(300), async (req) => {
    const r = gate(req);
    try { return ok(req, { ...toEntry("share", await r.p.stat(r.share.file_id)) }); } catch (e) { return mapProviderError(e, r.storage.id); }
  });

  const target = async (req: FastifyRequest) => {
    const r = gate(req); const { fileId } = req.params as any;
    const raw = fileId === "root" ? rootParent(r.share) : decodeId(fileId);
    await assertWithin(r.share, r.p, raw);
    let f: RemoteFile; try { f = await r.p.stat(raw); } catch (e) { return mapProviderError(e, r.storage.id); }
    return { r, f };
  };
  const deliver = (inline: boolean) => async (req: FastifyRequest, reply: FastifyReply) => {
    if (!inline && (req.params as any).fileId === "root") {
      const r0 = gate(req); if (isBundle(r0.share)) return sendZip(req, reply, r0.p, await Promise.all(shareItems(r0.share.id).map((i) => r0.p.stat(i.file_id))), `${r0.share.title ?? "dibagikan"}.zip`);
    }
    const { r, f } = await target(req);
    if (!inline && (!req.headers.range || req.headers.range.startsWith("bytes=0-")))
      audit({ workspaceId: r.share.workspace_id, userId: null, action: "share.download", resourceType: "share", resourceId: r.share.id, metadata: { name: f.name, size: f.size }, ip: req.ip });
    if (!f.isFolder && (!req.headers.range || req.headers.range.startsWith("bytes=0-"))) logActivity(r.ctx, r.storage.id, f.id, inline ? "view" : "download", {}, r.share.id);
    if (f.isFolder) return sendFolderZip(req, reply, r.p, r.storage.id, f);
    return sendFile(req, reply, r.p, r.storage.id, f, inline);
  };
  app.get("/share/:token/files/:fileId/download", lim(300), deliver(false));
  app.get("/share/:token/files/:fileId/preview", lim(1200), deliver(true));
  app.get("/share/:token/files/:fileId/thumbnail", lim(3000), async (req, reply) => {
    const { r, f } = await target(req);
    const q = z.object({ s: z.coerce.number().int().min(32).max(2048).default(256), v: z.string().optional() }).parse(req.query);
    return sendThumbnail(req, reply, r.storage.id, r.p, f.id, q.s, q.v);
  });
  app.post("/share/:token/zip", lim(30), async (req, reply) => {
    const r = gate(req);
    const b = z.object({ id: z.union([z.string(), z.array(z.string())]) }).parse(req.body);
    const roots: RemoteFile[] = [];
    for (const id of (Array.isArray(b.id) ? b.id : [b.id]).slice(0, 2000)) {
      if (id === "root") { if (isBundle(r.share)) for (const it of shareItems(r.share.id)) roots.push(await r.p.stat(it.file_id)); else roots.push(await r.p.stat(r.share.file_id)); continue; }
      const raw = decodeId(id); await assertWithin(r.share, r.p, raw); roots.push(await r.p.stat(raw));
    }
    return sendZip(req, reply, r.p, roots, `${isBundle(r.share) ? "dibagikan" : r.share.name}.zip`);
  });

  /* ---- editor ---- */
  app.post("/share/:token/folders", lim(120), async (req) => {
    const r = gate(req, true);
    const b = z.object({ parentId: z.string().default("root"), name: z.string() }).parse(req.body);
    const parent = b.parentId === "root" ? rootParent(r.share) : decodeId(b.parentId);
    await assertWithin(r.share, r.p, parent);
    const e = await createFolder(r.ctx, r.storage.id, r.p, parent, b.name);
    return ok(req, { ...e, storageId: "share" });
  });
  app.post("/share/:token/rename", lim(120), async (req) => {
    const r = gate(req, true);
    const b = z.object({ fileId: z.string(), name: z.string() }).parse(req.body);
    const raw = decodeId(b.fileId);
    if (isTopLevel(r.share, raw)) throw forbidden("Item utama tautan tidak bisa diganti namanya.");
    await assertWithin(r.share, r.p, raw);
    return ok(req, { ...(await renameFile(r.ctx, r.storage.id, r.p, raw, b.name)), storageId: "share" });
  });
  app.delete("/share/:token/files/:fileId", lim(120), async (req) => {
    const r = gate(req, true);
    const raw = decodeId((req.params as any).fileId);
    if (isTopLevel(r.share, raw)) throw forbidden("Item utama tautan tidak bisa dihapus.");
    await assertWithin(r.share, r.p, raw);
    await trashFiles(r.ctx, r.storage.id, r.p, [raw]); // goes to the trash, recoverable by the owner
    return ok(req, {});
  });

  app.post("/share/:token/uploads", lim(4000), async (req, reply) => {
    const r = gate(req, true);
    const b = z.object({ parentId: z.string().default("root"), name: z.string(), size: z.number().int().min(0), mimeType: z.string().nullish(), conflictPolicy: z.enum(["SKIP", "OVERWRITE", "RENAME", "FAIL"]).optional() }).parse(req.body);
    const parent = b.parentId === "root" ? rootParent(r.share) : decodeId(b.parentId);
    await assertWithin(r.share, r.p, parent);
    // Public uploaders may add files but never overwrite what is already there.
    const up = await createUpload(r.ctx, { storageId: r.storage.id, parentId: encodeParent(parent), name: b.name, size: b.size, mimeType: b.mimeType, conflictPolicy: b.conflictPolicy === "SKIP" ? "SKIP" : "RENAME" }, r.share.id);
    return reply.status(201).send(ok(req, up));
  });
  app.get("/share/:token/uploads/:id", lim(12000), async (req) => { const r = gate(req, true); return ok(req, getUpload(r.ctx, (req.params as any).id, r.share.id)); });
  app.patch("/share/:token/uploads/:id", lim(12000), async (req, reply) => {
    const r = gate(req, true);
    const offset = Number(req.headers["upload-offset"]);
    if (!Number.isSafeInteger(offset) || offset < 0) throw badRequest("Header Upload-Offset wajib diisi.");
    return reply.send(ok(req, await receiveChunk(r.ctx, (req.params as any).id, offset, req.raw, r.share.id)));
  });
  app.post("/share/:token/uploads/:id/retry", lim(120), async (req) => { const r = gate(req, true); return ok(req, retryUpload(r.ctx, (req.params as any).id, r.share.id)); });
  app.delete("/share/:token/uploads/:id", lim(600), async (req) => { const r = gate(req, true); cancelUpload(r.ctx, (req.params as any).id, r.share.id); return ok(req, {}); });
}

import { encodeId } from "../providers/types.ts";
const encodeParent = (raw: string) => encodeId(raw);

export const publicRoutes = makeShareRoutes(false);
export const directShareRoutes = makeShareRoutes(true);
