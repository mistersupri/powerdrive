import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.ts";
import { ok, requireAuth } from "../app.ts";
import { forbidden } from "../lib/errors.ts";
import { permissionsFor, requireRole } from "../modules/permissions.ts";
import { listTrash, purgeItem, restoreItem } from "../modules/trash.ts";

export async function trashRoutes(app: FastifyInstance) {
  const allowed = (ctx: ReturnType<typeof requireAuth>) =>
    db.all<{ id: string }>("SELECT id FROM storages WHERE workspace_id = ?", ctx.workspaceId).map((s) => s.id).filter((id) => permissionsFor(ctx, id).includes("DELETE"));

  app.get("/trash", async (req) => {
    const ctx = requireAuth(req);
    return ok(req, listTrash(ctx, z.object({ storageId: z.string().optional(), q: z.string().optional(), page: z.coerce.number().int().optional(), limit: z.coerce.number().int().optional() }).parse(req.query), allowed(ctx)));
  });
  const guard = (ctx: ReturnType<typeof requireAuth>, ids: string[]) => {
    const ok = new Set(allowed(ctx));
    for (const id of ids) {
      const r = db.get<{ storage_id: string }>("SELECT storage_id FROM trash_items WHERE id = ? AND workspace_id = ?", id, ctx.workspaceId);
      if (r && !ok.has(r.storage_id)) throw forbidden();
    }
  };
  app.post("/trash/restore", async (req) => {
    const ctx = requireAuth(req); const { ids } = z.object({ ids: z.array(z.string()).min(1).max(500) }).parse(req.body);
    guard(ctx, ids); const out = [];
    for (const id of ids) out.push(await restoreItem(ctx, id));
    return ok(req, out);
  });
  app.post("/trash/purge", async (req) => {
    const ctx = requireAuth(req); const { ids } = z.object({ ids: z.array(z.string()).min(1).max(500) }).parse(req.body);
    guard(ctx, ids);
    for (const id of ids) await purgeItem(ctx, id);
    return ok(req, {});
  });
  // Empty the trash (admins), optionally for one storage.
  app.delete("/trash", async (req) => {
    const ctx = requireAuth(req); requireRole(ctx, "ADMIN");
    const { storageId } = z.object({ storageId: z.string().optional() }).parse(req.query);
    const rows = db.all<{ id: string }>(`SELECT id FROM trash_items WHERE workspace_id = ?${storageId ? " AND storage_id = ?" : ""}`, ...(storageId ? [ctx.workspaceId, storageId] : [ctx.workspaceId]));
    for (const r of rows) await purgeItem(ctx, r.id).catch(() => {});
    return ok(req, { removed: rows.length });
  });
}
