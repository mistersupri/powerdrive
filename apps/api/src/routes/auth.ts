import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.ts";
import { db } from "../db.ts";
import { COOKIE, dropSession, ok, requireAuth } from "../app.ts";
import { changePassword, issueSession, login, logout, register, registerSchema, requestPasswordReset, resetPassword } from "../modules/auth.ts";
import { beginSetup, confirmSetup, disable as mfaDisable, finishChallenge, hasMfa, mfaStatus, startChallenge } from "../modules/mfa.ts";
import { getSettings } from "../modules/settings.ts";
import { audit } from "../lib/audit.ts";
import { mailEnabled } from "../lib/mailer.ts";
import { beginGoogle, completeGoogle, errorCodeOf, grantForApp, redeemAppGrant, userForGoogle } from "../modules/googleLogin.ts";

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

  // ---- Sign in with Google ----
  const STATE_COOKIE = "sd_oauth";
  const toLogin = (reply: any, params: Record<string, string>) => reply.redirect(`/login?${new URLSearchParams(params)}`);
  // Opens a page that hands the Android app its one-time code (a custom-scheme redirect straight from a 302 is blocked by some browsers).
  const handToApp = (reply: any, params: Record<string, string>) => {
    const target = `app.superdrive://login?${new URLSearchParams(params)}`;
    return reply.type("text/html; charset=utf-8").send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kembali ke SuperDrive</title><meta http-equiv="refresh" content="0;url=${target}"><body style="font:16px system-ui;text-align:center;padding:48px 24px"><p>Membuka SuperDrive…</p><p><a href="${target}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#1769e8;color:#fff;text-decoration:none;font-weight:600">Buka SuperDrive</a></p><script>location.replace(${JSON.stringify(target)})</script>`);
  };
  app.get("/google/start", strict, async (req, reply) => {
    const q = z.object({ app: z.string().optional(), cc: z.string().max(100).optional(), invitation: z.string().max(200).optional() }).parse(req.query);
    try {
      const { url, state } = beginGoogle({ app: q.app === "1", cc: q.cc ?? "", invitation: q.invitation ?? "" });
      reply.setCookie(STATE_COOKIE, state, { ...cookieOpts(new Date(Date.now() + 10 * 60_000)), path: "/api/v1/auth/google" });
      return reply.redirect(url);
    } catch (e) { return toLogin(reply, { error: errorCodeOf(e) }); }
  });
  app.get("/google/callback", strict, async (req, reply) => {
    const q = z.object({ code: z.string().max(2000).optional(), state: z.string().max(200).optional(), error: z.string().max(100).optional() }).parse(req.query);
    reply.clearCookie(STATE_COOKIE, { ...cookieOpts(), path: "/api/v1/auth/google" });
    let app_ = false; let cc = "";
    try {
      if (!q.code || !q.state) throw new Error("Google did not return a code"); // e.g. the person pressed Cancel
      const g = await completeGoogle(q.code, q.state, req.cookies[STATE_COOKIE]); app_ = g.app; cc = g.cc;
      const u = await userForGoogle(g, req.ip);
      const ua = req.headers["user-agent"] ?? "";
      // Someone who set up a second factor is still asked for it: Google proves the email, not that the owner of the TOTP is here.
      if (hasMfa(u.id)) { const challenge = startChallenge(u.id, req.ip, ua); return app_ ? handToApp(reply, { challenge }) : toLogin(reply, { challenge }); }
      if (app_) return handToApp(reply, { code: grantForApp(u.id, cc) });
      const s = issueSession(u, req.ip, ua);
      reply.setCookie(COOKIE, s.token, cookieOpts(s.expires));
      return reply.redirect("/");
    } catch (e) { const error = errorCodeOf(e); return app_ ? handToApp(reply, { error }) : toLogin(reply, { error }); }
  });
  // Android only: the app redeems the one-time code (with the verifier only it knows) so the session cookie lands in its own WebView.
  app.get("/google/exchange", strict, async (req, reply) => {
    const q = z.object({ code: z.string().max(100), verifier: z.string().max(100) }).parse(req.query);
    const u = redeemAppGrant(q.code, q.verifier);
    if (!u) return toLogin(reply, { error: "google_state" });
    const s = issueSession(u, req.ip, req.headers["user-agent"] ?? "");
    reply.setCookie(COOKIE, s.token, cookieOpts(s.expires));
    return reply.redirect("/");
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

  // Edit profile: the display name. (The email is also the sign-in identity, so it is not editable here.)
  app.patch("/profile", async (req) => {
    const ctx = requireAuth(req); const b = z.object({ name: z.string().trim().min(1, "Nama tidak boleh kosong.").max(100) }).parse(req.body);
    db.run("UPDATE users SET name = ? WHERE id = ?", b.name, ctx.userId); dropSession(req.sessionToken!);
    return ok(req, { name: b.name });
  });

  app.post("/change-password", async (req) => {
    const ctx = requireAuth(req);
    const b = z.object({ currentPassword: z.string(), newPassword: z.string().min(8) }).parse(req.body);
    await changePassword(ctx.userId, b.currentPassword, b.newPassword, req.sessionToken!);
    audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "auth.change_password", resourceType: "user", resourceId: ctx.userId, ip: ctx.ip });
    return ok(req, {});
  });
}
