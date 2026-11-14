import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.ts";
import { db } from "../db.ts";
import { COOKIE, dropSession, ok, requireAuth } from "../app.ts";
import { changePassword, issueSession, login, logout, register, registerSchema, requestPasswordReset, resetPassword } from "../modules/auth.ts";
import { beginSetup, confirmSetup, disable as mfaDisable, finishChallenge, mfaStatus } from "../modules/mfa.ts";
import { getSettings } from "../modules/settings.ts";
import { audit } from "../lib/audit.ts";
import { mailEnabled } from "../lib/mailer.ts";

const cookieOpts = (expires?: Date) => ({ httpOnly: true, sameSite: "lax" as const, secure: config.isProd, path: "/", ...(expires ? { expires } : {}) });

export async function authRoutes(app: FastifyInstance) {
  // Brute-force guard on sign-in and friends. Relaxed under test, where one process makes dozens of logins in a minute.
  const strict = { config: { rateLimit: { max: process.env.NODE_ENV === "test" ? 10_000 : 10, timeWindow: "1 minute" } } };

  app.post("/register", strict, async (req, reply) => {
    const body = registerSchema.parse(req.body);
    await register(body, req.ip);
    const s = await login(body.email, body.password, req.ip, req.headers["user-agent"] ?? "");
    if (s.mfa) throw new Error("A new account cannot have a second factor yet.");
    reply.setCookie(COOKIE, s.token, cookieOpts(s.expires));
    return ok(req, { user: s.user, mfaSetupRequired: s.mfaSetupRequired });
  });

  app.post("/login", strict, async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const s = await login(body.email, body.password, req.ip, req.headers["user-agent"] ?? "");
    if (s.mfa) return ok(req, { mfaRequired: true, challenge: s.challenge });
    reply.setCookie(COOKIE, s.token, cookieOpts(s.expires));
    return ok(req, { user: s.user, mfaSetupRequired: s.mfaSetupRequired });
  });

  // Second step of a sign-in for accounts with two-step verification.
  app.post("/mfa/verify", strict, async (req, reply) => {
    const b = z.object({ challenge: z.string().min(10), code: z.string().max(20).optional(), recoveryCode: z.string().max(30).optional() }).refine((x) => x.code || x.recoveryCode, "Masukkan kode.").parse(req.body);
    const done = finishChallenge(b.challenge, b);
    const u = db.get<any>("SELECT * FROM users WHERE id = ?", done.userId)!;
    const s = issueSession(u, req.ip, req.headers["user-agent"] ?? "");
    reply.setCookie(COOKIE, s.token, cookieOpts(s.expires));
    return ok(req, { user: s.user, mfaSetupRequired: false });
  });
  app.get("/mfa", async (req) => ok(req, mfaStatus(requireAuth(req).userId)));
  app.post("/mfa/setup", async (req) => { const ctx = requireAuth(req); const u = db.get<any>("SELECT email FROM users WHERE id = ?", ctx.userId)!; return ok(req, await beginSetup(ctx.userId, u.email)); });
  app.post("/mfa/enable", strict, async (req) => { const ctx = requireAuth(req); const codes = await confirmSetup(ctx.userId, z.object({ code: z.string().max(20) }).parse(req.body).code); audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "auth.mfa_enable", resourceType: "user", resourceId: ctx.userId, ip: ctx.ip }); dropSession(req.sessionToken!); return ok(req, { recoveryCodes: codes }); });
  app.post("/mfa/disable", strict, async (req) => { const ctx = requireAuth(req); await mfaDisable(ctx.userId, z.object({ password: z.string() }).parse(req.body).password); audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "auth.mfa_disable", resourceType: "user", resourceId: ctx.userId, ip: ctx.ip }); return ok(req, {}); });

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
    return ok(req, { user: { id: u.id, email: u.email, name: u.name, isSuperAdmin: !!u.is_super_admin }, workspaces, activeWorkspaceId: ctx.workspaceId, policy: { idleTimeoutMinutes: getSettings().security.idleTimeoutMinutes } });
  });

  app.post("/forgot-password", strict, async (req) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    // Same answer whether or not the account exists. Without a mail server the link goes to the server log.
    await requestPasswordReset(email, (m) => req.log.warn(m));
    return ok(req, { message: mailEnabled() ? "Jika email terdaftar, tautan reset sudah dikirim. Periksa kotak masuk Anda." : "Jika email terdaftar, tautan reset telah dibuat. Minta administrator mengambilnya dari log server jika email belum dikonfigurasi." });
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
