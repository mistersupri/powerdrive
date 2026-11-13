import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.ts";
import { db } from "../db.ts";
import { COOKIE, dropSession, ok, requireAuth } from "../app.ts";
import { changePassword, login, logout, register, registerSchema, requestPasswordReset, resetPassword } from "../modules/auth.ts";
import { audit } from "../lib/audit.ts";

const cookieOpts = (expires?: Date) => ({ httpOnly: true, sameSite: "lax" as const, secure: config.isProd, path: "/", ...(expires ? { expires } : {}) });

export async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.post("/register", strict, async (req, reply) => {
    const body = registerSchema.parse(req.body);
    await register(body, req.ip);
    const s = await login(body.email, body.password, req.ip, req.headers["user-agent"] ?? "");
    reply.setCookie(COOKIE, s.token, cookieOpts(s.expires));
    return ok(req, { user: s.user });
  });

  app.post("/login", strict, async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const s = await login(body.email, body.password, req.ip, req.headers["user-agent"] ?? "");
    reply.setCookie(COOKIE, s.token, cookieOpts(s.expires));
    return ok(req, { user: s.user });
  });

  app.post("/logout", async (req, reply) => {
    const t = req.cookies[COOKIE];
    if (t) { logout(t); dropSession(t); }
    reply.clearCookie(COOKIE, cookieOpts());
    return ok(req, {});
  });

  app.get("/me", async (req) => {
    const ctx = requireAuth(req);
    const workspaces = db.all<any>(
      "SELECT w.id, w.name, w.slug, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY m.created_at", ctx.userId);
    const u = db.get<any>("SELECT id, email, name, is_super_admin FROM users WHERE id = ?", ctx.userId)!;
    return ok(req, { user: { id: u.id, email: u.email, name: u.name, isSuperAdmin: !!u.is_super_admin }, workspaces, activeWorkspaceId: ctx.workspaceId });
  });

  app.post("/forgot-password", strict, async (req) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    // Same answer whether or not the account exists. Without a mail server the link goes to the server log.
    requestPasswordReset(email, (m) => req.log.warn(m));
    return ok(req, { message: "Jika email terdaftar, tautan reset telah dibuat. Minta administrator mengambilnya dari log server jika email belum dikonfigurasi." });
  });

  app.post("/reset-password", strict, async (req) => {
    const b = z.object({ token: z.string().min(10), password: z.string().min(8) }).parse(req.body);
    await resetPassword(b.token, b.password);
    return ok(req, {});
  });

  app.post("/change-password", async (req) => {
    const ctx = requireAuth(req);
    const b = z.object({ currentPassword: z.string(), newPassword: z.string().min(8) }).parse(req.body);
    await changePassword(ctx.userId, b.currentPassword, b.newPassword, req.sessionToken!);
    audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "auth.change_password", resourceType: "user", resourceId: ctx.userId, ip: ctx.ip });
    return ok(req, {});
  });
}
