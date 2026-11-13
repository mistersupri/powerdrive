import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { config } from "./config.ts";
import { db } from "./db.ts";
import { AppError, forbidden, unauthorized } from "./lib/errors.ts";
import { sessionUser } from "./modules/auth.ts";
import type { AuthCtx } from "./modules/permissions.ts";
import { ProviderError } from "./providers/types.ts";

declare module "fastify" {
  interface FastifyRequest { auth: AuthCtx | null; sessionToken: string | null }
}

export const COOKIE = "sd_session";

const sessionCache = new Map<string, { user: ReturnType<typeof sessionUser>; until: number }>();
export function dropSession(token: string) { sessionCache.delete(token); }

/** Resolve the caller and the workspace they are acting in. Throws 401/403 — never returns a half-authenticated context. */
export function requireAuth(req: FastifyRequest): AuthCtx {
  if (req.auth) return req.auth;
  const token = req.cookies[COOKIE];
  if (!token) throw unauthorized();
  let c = sessionCache.get(token);
  if (!c || c.until < Date.now()) { c = { user: sessionUser(token), until: Date.now() + 15_000 }; sessionCache.set(token, c); }
  if (!c.user) { sessionCache.delete(token); throw unauthorized("Sesi berakhir. Silakan masuk lagi."); }
  const user = c.user;

  // The workspace comes from an explicit header/query, else from the storage in the URL (so <img>/<a> work), else the first membership.
  const params = (req.params ?? {}) as Record<string, string>;
  let wsId = (req.headers["x-workspace-id"] as string | undefined) ?? (req.query as any)?.ws;
  if (!wsId && params.storageId) wsId = db.get<{ workspace_id: string }>("SELECT workspace_id FROM storages WHERE id = ?", params.storageId)?.workspace_id;
  const m = wsId
    ? db.get<{ workspace_id: string; role: any }>("SELECT workspace_id, role FROM memberships WHERE user_id = ? AND workspace_id = ?", user.id, wsId)
    : db.get<{ workspace_id: string; role: any }>("SELECT workspace_id, role FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1", user.id);
  if (!m) throw forbidden("Anda bukan anggota workspace ini.");
  req.sessionToken = token;
  req.auth = { userId: user.id, userName: user.name, isSuperAdmin: user.isSuperAdmin, workspaceId: m.workspace_id, role: m.role, ip: req.ip };
  return req.auth;
}

export function ok<T>(req: FastifyRequest, data: T) { return { success: true as const, data, meta: { requestId: req.id } }; }

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.isProd ? "info" : "warn", redact: ["req.headers.cookie", "req.headers.authorization"] },
    trustProxy: true, bodyLimit: 2 * 1024 * 1024, genReqId: () => Math.random().toString(36).slice(2, 10),
    // Long downloads/uploads must not be cut by the default 5s keep-alive / request timeout.
    requestTimeout: 0, connectionTimeout: 0, keepAliveTimeout: 65_000,
  });
  app.decorateRequest("auth", null);
  app.decorateRequest("sessionToken", null);
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  // Raw chunk uploads are streamed straight to disk, never buffered.
  app.addContentTypeParser("application/octet-stream", (_req, _payload, done) => done(null));

  app.addHook("onRequest", async (req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "same-origin");
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    // CSRF: browsers always send Origin on cross-site writes. Cookie is SameSite=Lax as a second layer.
    const origin = req.headers.origin;
    if (origin) {
      const allowed = new Set([new URL(config.appUrl).origin, `${req.protocol}://${req.headers.host}`]);
      if (!allowed.has(origin)) throw forbidden("Permintaan lintas situs ditolak.");
    } else if (req.headers["x-requested-with"] !== "superdrive") {
      // No Origin (non-browser client): require a header a cross-site form cannot set.
      throw forbidden("Header keamanan tidak ada.");
    }
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ success: false, error: { code: err.code, message: err.message } });
    if (err instanceof ZodError) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: err.issues[0]?.message ?? "Data tidak valid." } });
    if (err instanceof ProviderError) return reply.status(502).send({ success: false, error: { code: "PROVIDER_ERROR", message: err.message } });
    if (err.statusCode === 429) return reply.status(429).send({ success: false, error: { code: "RATE_LIMITED", message: "Terlalu banyak percobaan. Coba lagi sebentar lagi." } });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ success: false, error: { code: err.code ?? "BAD_REQUEST", message: err.message } });
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ success: false, error: { code: "INTERNAL", message: "Terjadi kesalahan di server." } });
  });

  const { registerRoutes } = await import("./routes/index.ts");
  await app.register(registerRoutes, { prefix: "/api/v1" });
  app.get("/healthz", async () => ({ ok: true, uptime: process.uptime() }));
  app.all("/api/*", async (_req, reply) => reply.status(404).send({ success: false, error: { code: "NOT_FOUND", message: "Endpoint tidak ditemukan." } }));

  // Production: serve the built web app with long-lived caching for hashed assets.
  const webDist = path.resolve(import.meta.dirname ?? ".", "../../web/dist");
  const dist = fs.existsSync(webDist) ? webDist : path.resolve(process.cwd(), "apps/web/dist");
  if (fs.existsSync(path.join(dist, "index.html"))) {
    await app.register(fastifyStatic, { root: dist, wildcard: false, setHeaders: (res, p: string) => {
      if (p.includes(`${path.sep}assets${path.sep}`)) res.header("cache-control", "public, max-age=31536000, immutable");
      else res.header("cache-control", "no-cache");
    } });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND", message: "Endpoint tidak ditemukan." } });
      return reply.header("cache-control", "no-cache").header("x-frame-options", "DENY").type("text/html").send(fs.createReadStream(path.join(dist, "index.html")));
    });
  }
  return app;
}

export type Reply = FastifyReply;
