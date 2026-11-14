import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ok, requireAuth } from "../app.ts";
import { requireStorage } from "../modules/permissions.ts";
import { createDirectShares, createShare, listAllShares, listSharedWithMe, listSharesForTarget, revokeShare, updateShare } from "../modules/shares.ts";
import { providerFor } from "../modules/storages.ts";
import { decodeId } from "../providers/types.ts";

const opts = { title: z.string().max(120).nullable().optional(), expiresInDays: z.number().int().min(1).max(3650).nullable().optional(), password: z.string().min(4).max(100).nullable().optional(), maxUploadMb: z.number().min(1).max(1_000_000).nullable().optional() };

export async function shareRoutes(app: FastifyInstance) {
  // Links for one file/folder (viewer and editor).
  app.get("/shares", async (req) => {
    const ctx = requireAuth(req);
    const q = z.object({ storageId: z.string(), fileId: z.string() }).parse(req.query);
    requireStorage(ctx, q.storageId, "SHARE");
    return ok(req, listSharesForTarget(q.storageId, decodeId(q.fileId)));
  });
  // Things other members shared directly with the signed-in user.
  app.get("/shared-with-me", async (req) => ok(req, listSharedWithMe(requireAuth(req))));
  app.get("/shares/all", async (req) => ok(req, listAllShares(requireAuth(req), z.object({ page: z.coerce.number().int().optional(), limit: z.coerce.number().int().optional(), q: z.string().optional() }).parse(req.query))));
  app.post("/shares", async (req) => {
    const ctx = requireAuth(req);
    const b = z.object({ storageId: z.string(), fileId: z.string().optional(), fileIds: z.array(z.string()).min(1).max(200).optional(), recipientUserIds: z.array(z.string()).min(1).max(50).optional(), role: z.enum(["VIEWER", "EDITOR"]), regenerate: z.boolean().optional(), newLink: z.boolean().optional(), ...opts }).parse(req.body);
    const row = requireStorage(ctx, b.storageId, "SHARE");
    if (b.recipientUserIds?.length) return ok(req, await createDirectShares(ctx, providerFor(row), b));
    return ok(req, await createShare(ctx, providerFor(row), b));
  });
  app.patch("/shares/:id", async (req) => ok(req, await updateShare(requireAuth(req), (req.params as any).id, z.object({ ...opts, role: z.enum(["VIEWER", "EDITOR"]).optional() }).parse(req.body))));
  app.delete("/shares/:id", async (req) => { revokeShare(requireAuth(req), (req.params as any).id); return ok(req, {}); });
}
