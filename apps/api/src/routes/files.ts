import { addComment, addTag, deleteComment, listActivity, listComments, listTags, removeTag, workspaceTags } from "../modules/activity.ts";
import { fileMetadata } from "../modules/metadata.ts";
import { logActivity } from "../modules/activity.ts";
import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.ts";
import { ok, requireAuth } from "../app.ts";
import { audit } from "../lib/audit.ts";
import { badRequest } from "../lib/errors.ts";
import { sendFile, sendFolderZip, sendThumbnail, sendZip } from "../modules/delivery.ts";
import { createFolder, deleteFile, listFolder, renameFile, searchIndex, setStar, toEntry } from "../modules/files.ts";
import { requireStorage } from "../modules/permissions.ts";
import { getThumbnail, pickSize } from "../modules/thumbnails.ts";
import { cancelUpload, createUpload, getUpload, receiveChunk, retryUpload } from "../modules/uploads.ts";
import { mapProviderError, providerFor } from "../modules/storages.ts";
import { createTransfer } from "../modules/transfers.ts";
import { decodeId, ROOT, type RemoteFile } from "../providers/types.ts";

const conflictPolicy = z.enum(["SKIP", "OVERWRITE", "RENAME", "FAIL"]);

export async function fileRoutes(app: FastifyInstance) {
  const open = (req: any, perm: Parameters<typeof requireStorage>[2], storageId: string) => {
    const ctx = requireAuth(req);
    const row = requireStorage(ctx, storageId, perm);
    return { ctx, row, p: providerFor(row) };
  };

  /** Metadata for a file: index first (no provider round-trip), provider as fallback. */
  const metaOf = async (storageId: string, p: ReturnType<typeof providerFor>, rawId: string): Promise<RemoteFile> => {
    const r = db.get<any>("SELECT * FROM files WHERE storage_id = ? AND file_id = ?", storageId, rawId);
    if (r) return { id: r.file_id, parentId: r.parent_id, name: r.name, isFolder: !!r.is_folder, mimeType: r.mime_type, size: r.size, modifiedAt: r.modified_at, createdAt: r.created_at_remote, checksum: r.checksum, version: r.version, hasThumbnail: !!r.has_thumbnail };
    try { return await p.stat(rawId); } catch (e) { mapProviderError(e, storageId); }
  };

  app.get("/files", async (req) => {
    const q = z.object({ storageId: z.string(), folderId: z.string().default(ROOT), pageToken: z.string().optional(), limit: z.coerce.number().int().min(1).max(1000).default(200), foldersOnly: z.enum(["true", "false"]).optional(), peek: z.enum(["1"]).optional() }).parse(req.query);
    const { ctx, p } = open(req, "READ", q.storageId);
    return ok(req, await listFolder(ctx, q.storageId, p, decodeId(q.folderId), q.pageToken ?? null, q.limit, q.foldersOnly === "true", q.peek === "1"));
  });

  /* ---- activity, tags, comments, metadata (shown in the details panel) ---- */
  app.get("/files/:storageId/:fileId/activity", async (req) => { const { storageId, fileId } = req.params as any; open(req, "READ", storageId); return ok(req, listActivity(storageId, decodeId(fileId), Number((req.query as any).limit) || 60)); });
  app.get("/files/:storageId/:fileId/metadata", async (req) => { const { storageId, fileId } = req.params as any; const { p } = open(req, "READ", storageId); return ok(req, await fileMetadata(storageId, p, await metaOf(storageId, p, decodeId(fileId)))); });
  app.get("/files/:storageId/:fileId/tags", async (req) => { const { storageId, fileId } = req.params as any; open(req, "READ", storageId); return ok(req, listTags(storageId, decodeId(fileId))); });
  app.post("/files/:storageId/:fileId/tags", async (req) => { const { storageId, fileId } = req.params as any; const { ctx } = open(req, "RENAME", storageId); return ok(req, addTag(ctx, storageId, decodeId(fileId), z.object({ tag: z.string() }).parse(req.body).tag)); });
  app.delete("/files/:storageId/:fileId/tags/:tag", async (req) => { const { storageId, fileId, tag } = req.params as any; const { ctx } = open(req, "RENAME", storageId); return ok(req, removeTag(ctx, storageId, decodeId(fileId), decodeURIComponent(tag))); });
  app.get("/tags", async (req) => ok(req, workspaceTags(requireAuth(req).workspaceId)));
  app.get("/files/:storageId/:fileId/comments", async (req) => { const { storageId, fileId } = req.params as any; const { ctx } = open(req, "READ", storageId); return ok(req, listComments(ctx, storageId, decodeId(fileId))); });
  app.post("/files/:storageId/:fileId/comments", async (req) => { const { storageId, fileId } = req.params as any; const { ctx } = open(req, "READ", storageId); return ok(req, addComment(ctx, storageId, decodeId(fileId), z.object({ body: z.string() }).parse(req.body).body)); });
  app.delete("/files/:storageId/comments/:commentId", async (req) => { const { storageId, commentId } = req.params as any; const { ctx } = open(req, "READ", storageId); deleteComment(ctx, storageId, commentId); return ok(req, {}); });

  app.get("/files/:storageId/:fileId", async (req) => {
    const { storageId, fileId } = req.params as any;
    const { ctx, p } = open(req, "READ", storageId);
    try {
      const f = await p.stat(decodeId(fileId));
      const starred = !!db.get("SELECT 1 FROM stars WHERE user_id = ? AND storage_id = ? AND file_id = ?", ctx.userId, storageId, f.id);
      return ok(req, toEntry(storageId, f, starred));
    } catch (e) { mapProviderError(e, storageId); }
  });

  // Recursive size/count of a folder for the details panel. Bounded so a huge drive cannot tie up the server.
  app.get("/files/:storageId/:fileId/stats", async (req) => {
    const { storageId, fileId } = req.params as any;
    const { p } = open(req, "READ", storageId);
    const out = { files: 0, folders: 0, bytes: 0, truncated: false };
    const deadline = Date.now() + 8000; const stack = [decodeId(fileId)];
    try {
      while (stack.length) {
        if (Date.now() > deadline || out.files + out.folders > 50_000) { out.truncated = true; break; }
        const id = stack.pop()!; let token: string | null = null;
        do { const page = await p.list(id, { pageToken: token, limit: 1000 }); token = page.nextPageToken; for (const i of page.items) { if (i.isFolder) { out.folders++; stack.push(i.id); } else { out.files++; out.bytes += i.size ?? 0; } } } while (token && Date.now() < deadline);
      }
    } catch (e) { mapProviderError(e, storageId); }
    return ok(req, out);
  });

  app.post("/files/folders", async (req) => {
    const b = z.object({ storageId: z.string(), parentId: z.string().default(ROOT), name: z.string() }).parse(req.body);
    const { ctx, p } = open(req, "UPLOAD", b.storageId);
    return ok(req, await createFolder(ctx, b.storageId, p, decodeId(b.parentId), b.name));
  });

  app.post("/files/rename", async (req) => {
    const b = z.object({ storageId: z.string(), fileId: z.string(), name: z.string() }).parse(req.body);
    const { ctx, p } = open(req, "RENAME", b.storageId);
    return ok(req, await renameFile(ctx, b.storageId, p, decodeId(b.fileId), b.name));
  });

  // Copy/move always run as transfer jobs so they are tracked, retryable and permission-checked in one place.
  for (const type of ["copy", "move"] as const) {
    app.post(`/files/${type}`, async (req, reply) => {
      const ctx = requireAuth(req);
      const b = z.object({ storageId: z.string(), fileIds: z.array(z.string()).min(1), destination: z.object({ storageId: z.string(), folderId: z.string().default(ROOT) }), conflictPolicy: conflictPolicy.optional(), idempotencyKey: z.string().optional() }).parse(req.body);
      const job = await createTransfer(ctx, { type: type.toUpperCase() as "COPY" | "MOVE", source: { storageId: b.storageId, fileIds: b.fileIds }, destination: b.destination, conflictPolicy: b.conflictPolicy, idempotencyKey: b.idempotencyKey });
      return reply.status(202).send(ok(req, job));
    });
  }

  app.delete("/files/:storageId/:fileId", async (req) => {
    const { storageId, fileId } = req.params as any;
    const { ctx, p } = open(req, "DELETE", storageId);
    await deleteFile(ctx, storageId, p, decodeId(fileId));
    return ok(req, {});
  });

  app.post("/files/:storageId/:fileId/star", async (req) => {
    const { storageId, fileId } = req.params as any;
    const { ctx } = open(req, "READ", storageId);
    const { starred } = z.object({ starred: z.boolean() }).parse(req.body);
    setStar(ctx.userId, storageId, decodeId(fileId), starred);
    return ok(req, { starred });
  });

  /* ---- delivery ---- */
  const deliver = (inline: boolean) => async (req: any, reply: any) => {
    const { storageId, fileId } = req.params as any;
    const { ctx, p } = open(req, "DOWNLOAD", storageId);
    let f: RemoteFile;
    try { f = await p.stat(decodeId(fileId)); } catch (e) { mapProviderError(e, storageId); }
    // Count a download once, not for every range request a video player makes.
    if (!inline && (!req.headers.range || req.headers.range.startsWith("bytes=0-")))
      audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "file.download", resourceType: "file", resourceId: f.id, metadata: { storageId, name: f.name, size: f.size }, ip: ctx.ip });
    if (!f.isFolder && (!req.headers.range || req.headers.range.startsWith("bytes=0-"))) logActivity(ctx, storageId, f.id, inline ? "view" : "download", {});
    if (f.isFolder) return sendFolderZip(req, reply, p, storageId, f);
    return sendFile(req, reply, p, storageId, f, inline);
  };
  // Several files/folders in one ZIP. Submitted as a form so the browser downloads it natively.
  app.post("/files/zip", async (req, reply) => {
    const b = z.object({ storageId: z.string(), id: z.union([z.string(), z.array(z.string())]) }).parse(req.body);
    const ids = (Array.isArray(b.id) ? b.id : [b.id]).slice(0, 2000);
    const { ctx, p } = open(req, "DOWNLOAD", b.storageId);
    const roots: RemoteFile[] = [];
    for (const id of ids) { try { roots.push(await p.stat(decodeId(id))); } catch (e) { mapProviderError(e, b.storageId); } }
    audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "file.download", resourceType: "file", metadata: { storageId: b.storageId, items: roots.length, zip: true }, ip: ctx.ip });
    return sendZip(req, reply, p, roots, `SuperDrive-${roots.length}-item.zip`);
  });
  app.get("/files/:storageId/:fileId/download", deliver(false));
  app.get("/files/:storageId/:fileId/preview", deliver(true));

  app.get("/files/:storageId/:fileId/thumbnail", async (req, reply) => {
    const { storageId, fileId } = req.params as any;
    const q = z.object({ s: z.coerce.number().int().min(32).max(2048).default(256), v: z.string().optional() }).parse(req.query);
    const { p } = open(req, "READ", storageId);
    return sendThumbnail(req, reply, storageId, p, decodeId(fileId), q.s, q.v);
  });

  /* ---- resumable uploads ---- */
  app.post("/uploads", async (req, reply) => {
    const b = z.object({ storageId: z.string(), parentId: z.string().default(ROOT), name: z.string(), size: z.number().int().min(0), mimeType: z.string().nullish(), conflictPolicy: conflictPolicy.optional() }).parse(req.body);
    const { ctx, p } = open(req, "UPLOAD", b.storageId);
    if (!p.capabilities.uploadFile) throw badRequest("Penyimpanan ini tidak mendukung unggah.");
    return reply.status(201).send(ok(req, await createUpload(ctx, b)));
  });
  app.get("/uploads/:id", async (req) => ok(req, getUpload(requireAuth(req), (req.params as any).id)));
  app.patch("/uploads/:id", async (req, reply) => {
    const ctx = requireAuth(req);
    const offset = Number(req.headers["upload-offset"]);
    if (!Number.isSafeInteger(offset) || offset < 0) throw badRequest("Header Upload-Offset wajib diisi.");
    const dto = await receiveChunk(ctx, (req.params as any).id, offset, req.raw);
    return reply.send(ok(req, dto));
  });
  app.post("/uploads/:id/retry", async (req) => ok(req, retryUpload(requireAuth(req), (req.params as any).id)));
  app.delete("/uploads/:id", async (req) => { cancelUpload(requireAuth(req), (req.params as any).id); return ok(req, {}); });

  /* ---- search / recent / starred ---- */
  app.get("/search", async (req) => {
    const ctx = requireAuth(req);
    const q = z.object({
      q: z.string().optional(), storageId: z.string().optional(), type: z.string().optional(), ext: z.string().optional(),
      minSize: z.coerce.number().optional(), maxSize: z.coerce.number().optional(), modifiedAfter: z.string().optional(), modifiedBefore: z.string().optional(),
      page: z.coerce.number().int().optional(), limit: z.coerce.number().int().optional(), sort: z.string().optional(),
      starred: z.enum(["true", "false"]).optional(), recent: z.enum(["true", "false"]).optional(), tag: z.string().max(40).optional(),
    }).parse(req.query);
    return ok(req, searchIndex(ctx, { ...q, starred: q.starred === "true", recent: q.recent === "true" }));
  });
}
