import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ok, requireAuth } from "../app.ts";
import { cancelJob, clearJobs, createTransfer, getJob, listItems, listJobs, pauseJob, queryJobs, resumeJob, retryJob, transferBus } from "../modules/transfers.ts";

const body = z.object({
  type: z.enum(["COPY", "MOVE"]),
  source: z.object({ storageId: z.string(), fileId: z.string().optional(), fileIds: z.array(z.string()).optional() }),
  destination: z.object({ storageId: z.string(), folderId: z.string().default("root") }),
  conflictPolicy: z.enum(["SKIP", "OVERWRITE", "RENAME", "FAIL"]).optional(),
  idempotencyKey: z.string().max(120).optional(),
});

/** Opens a Server-Sent Events stream and calls `filter` for each job update. */
function sse(req: FastifyRequest, reply: FastifyReply, accept: (e: { workspaceId: string; job: any }) => boolean, initial: unknown[]) {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("snapshot", initial);
  const onJob = (e: { workspaceId: string; job: any }) => { if (accept(e)) send("job", e.job); };
  transferBus.on("job", onJob);
  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
  req.raw.on("close", () => { clearInterval(ping); transferBus.off("job", onJob); });
}

export async function transferRoutes(app: FastifyInstance) {
  app.post("/transfers", async (req, reply) => {
    const ctx = requireAuth(req);
    const job = await createTransfer(ctx, body.parse(req.body));
    return reply.status(202).send(ok(req, job));
  });

  const filters = z.object({
    status: z.string().optional(), q: z.string().max(100).optional(), type: z.enum(["COPY", "MOVE"]).optional(), storageId: z.string().optional(),
    from: z.string().optional(), to: z.string().optional(), page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(200).optional(),
  });
  // Paged and filterable history: { items, total }.
  app.get("/transfers", async (req) => ok(req, queryJobs(requireAuth(req), filters.parse(req.query))));
  // Remove finished jobs from the history (never touches files). Active jobs are always kept.
  app.delete("/transfers", async (req) => {
    const ctx = requireAuth(req);
    const q = filters.extend({ scope: z.enum(["finished", "done", "failed"]).default("finished") }).parse(req.query);
    return ok(req, { removed: clearJobs(ctx, q.scope, q) });
  });

  // Live updates for every transfer the caller can see. Registered before :id so "events" is not read as an id.
  app.get("/transfers/events", async (req, reply) => {
    const ctx = requireAuth(req);
    const admin = ctx.role === "OWNER" || ctx.role === "ADMIN";
    return sse(req, reply, (e) => e.workspaceId === ctx.workspaceId && (admin || e.job.userId === ctx.userId), listJobs(ctx, { limit: 100 }));
  });

  app.get("/transfers/:id", async (req) => ok(req, getJob(requireAuth(req), (req.params as any).id)));
  app.get("/transfers/:id/items", async (req) => {
    const q = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    return ok(req, listItems(requireAuth(req), (req.params as any).id, q.page, q.limit));
  });
  app.get("/transfers/:id/events", async (req, reply) => {
    const ctx = requireAuth(req);
    const id = (req.params as any).id;
    return sse(req, reply, (e) => e.job.id === id && e.workspaceId === ctx.workspaceId, [getJob(ctx, id)]);
  });
  app.post("/transfers/:id/pause", async (req) => ok(req, pauseJob(requireAuth(req), (req.params as any).id)));
  app.post("/transfers/:id/resume", async (req) => ok(req, resumeJob(requireAuth(req), (req.params as any).id)));
  app.post("/transfers/:id/cancel", async (req) => ok(req, cancelJob(requireAuth(req), (req.params as any).id)));
  app.post("/transfers/:id/retry", async (req) => ok(req, retryJob(requireAuth(req), (req.params as any).id)));
}
