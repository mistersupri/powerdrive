import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ok, requireAuth } from "../app.ts";
import { addItems, albumFor, createAlbum, deleteAlbum, listAlbums, lock, privateStatus, removeItems, renameAlbum, setPassword, unlock } from "../modules/albums.ts";
import { decodeId } from "../providers/types.ts";

const items = z.object({ items: z.array(z.object({ storageId: z.string().max(60), fileId: z.string().max(2000) })).min(1).max(2000) });
const raw = (b: z.infer<typeof items>) => b.items.map((i) => ({ storageId: i.storageId, fileId: decodeId(i.fileId) }));

export async function albumRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: process.env.NODE_ENV === "test" ? 10_000 : 20, timeWindow: "1 minute" } } };
  app.get("/albums", async (req) => ok(req, listAlbums(requireAuth(req), req.sessionToken)));
  app.post("/albums", async (req, reply) => {
    const ctx = requireAuth(req); const b = z.object({ name: z.string(), private: z.boolean().optional() }).parse(req.body);
    return reply.status(201).send(ok(req, createAlbum(ctx, req.sessionToken, b.name, !!b.private)));
  });
  app.patch("/albums/:id", async (req) => { const ctx = requireAuth(req); return ok(req, renameAlbum(ctx, req.sessionToken, (req.params as any).id, z.object({ name: z.string() }).parse(req.body).name)); });
  app.delete("/albums/:id", async (req) => { const ctx = requireAuth(req); deleteAlbum(ctx, req.sessionToken, (req.params as any).id); return ok(req, {}); });
  app.get("/albums/:id", async (req) => { const ctx = requireAuth(req); const a = albumFor(ctx, req.sessionToken, (req.params as any).id); return ok(req, { id: a.id, name: a.name, isPrivate: !!a.is_private }); });
  app.post("/albums/:id/items", async (req) => { const ctx = requireAuth(req); return ok(req, addItems(ctx, req.sessionToken, (req.params as any).id, raw(items.parse(req.body)))); });
  app.post("/albums/:id/items/remove", async (req) => { const ctx = requireAuth(req); removeItems(ctx, req.sessionToken, (req.params as any).id, raw(items.parse(req.body))); return ok(req, {}); });

  // The password that guards private albums (separate from the sign-in password, so it also works for accounts that sign in with Google).
  app.get("/albums-private/status", async (req) => ok(req, privateStatus(requireAuth(req), req.sessionToken)));
  app.post("/albums-private/password", strict, async (req) => { const ctx = requireAuth(req); const b = z.object({ password: z.string().max(200), currentPassword: z.string().max(200).optional() }).parse(req.body); await setPassword(ctx, b.password, b.currentPassword); return ok(req, {}); });
  app.post("/albums-private/unlock", strict, async (req) => { const ctx = requireAuth(req); await unlock(ctx, req.sessionToken!, z.object({ password: z.string().max(200) }).parse(req.body).password); return ok(req, privateStatus(ctx, req.sessionToken)); });
  app.post("/albums-private/lock", async (req) => { const ctx = requireAuth(req); lock(req.sessionToken!); return ok(req, privateStatus(ctx, req.sessionToken)); });
}
