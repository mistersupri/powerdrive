import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { bootstrap } from "./helpers.ts";

let t: Awaited<ReturnType<typeof bootstrap>>; let server: http.Server;
let cfg: typeof import("../config.ts").config; let db: typeof import("../db.ts").db; let settings: typeof import("../modules/settings.ts");
// What the pretend Google token endpoint answers with next.
let claims: Record<string, unknown> = {}; let seenVerifier = "";
const CID = "test-client-id.apps.googleusercontent.com";

before(async () => {
  t = await bootstrap();
  ({ config: cfg } = await import("../config.ts")); ({ db } = await import("../db.ts")); settings = await import("../modules/settings.ts");
  server = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => {
      seenVerifier = new URLSearchParams(body).get("code_verifier") ?? "";
      const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id_token: `${part({ alg: "none" })}.${part({ iss: "https://accounts.google.com", aud: CID, exp: Math.floor(Date.now() / 1000) + 600, ...claims })}.sig` }));
    });
  }).listen(0);
  await new Promise((r) => server.once("listening", r));
  cfg.oauth.googleLogin.tokenUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/token`;
  await t.register("ana"); // the first account (super admin) so later ones are ordinary users
});
after(async () => { server.close(); await t.engine.stop(); await t.app.close(); });

const enable = () => { cfg.oauth.google.clientId = CID; cfg.oauth.google.clientSecret = "secret"; };
/** Runs start + callback like a browser would, and returns the callback response. */
async function signIn(c: Record<string, unknown>, o: { app?: boolean; cc?: string; wrongState?: boolean } = {}) {
  const start = await t.call("", "GET", `/auth/google/start${o.app ? `?app=1&cc=${o.cc}` : ""}`);
  assert.equal(start.status, 302, "start redirects");
  if (!String(start.res.headers.location).startsWith("http")) return start; // refused before leaving (e.g. disabled)
  const loc = new URL(String(start.res.headers.location));
  claims = { nonce: loc.searchParams.get("nonce"), ...c };
  const state = loc.searchParams.get("state")!;
  return t.call("", "GET", `/auth/google/callback?code=abc&state=${state}`, undefined, { cookie: `sd_oauth=${o.wrongState ? "other" : state}` });
}
const location = (r: { res: { headers: Record<string, unknown> } }) => String(r.res.headers.location ?? "");
const sessionOf = (r: { res: { headers: Record<string, unknown> } }) => { const s = r.res.headers["set-cookie"]; return (Array.isArray(s) ? s : [String(s ?? "")]).map((x) => x.split(";")[0]).find((x) => x?.startsWith("sd_session=")); };
const me = async (cookie: string) => (await t.call("", "GET", "/auth/me", undefined, { cookie })).data?.user;

describe("sign in with Google", () => {
  it("is off until the server has Google credentials", async () => {
    const r = await signIn({});
    assert.match(location(r), /\/login\?error=google_disabled/);
    assert.equal((await t.call("", "GET", "/branding")).data.google, false);
  });

  it("sends the browser to Google with state, nonce and PKCE", async () => {
    enable();
    assert.equal((await t.call("", "GET", "/branding")).data.google, true);
    const start = await t.call("", "GET", "/auth/google/start"); const u = new URL(location(start));
    assert.equal(u.searchParams.get("client_id"), CID); assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.ok(u.searchParams.get("state") && u.searchParams.get("nonce") && u.searchParams.get("code_challenge"));
    assert.equal(u.searchParams.get("scope"), "openid email profile");
    assert.match(String(start.res.headers["set-cookie"]), /sd_oauth=/);
  });

  it("creates an account on first sign-in and recognises it afterwards", async () => {
    const r = await signIn({ sub: "g-1", email: "Nina@Example.com", email_verified: true, name: "Nina" });
    assert.equal(location(r), "/"); const cookie = sessionOf(r)!; assert.ok(cookie);
    const u = await me(cookie); assert.equal(u.email, "nina@example.com"); assert.equal(u.name, "Nina"); assert.equal(u.isSuperAdmin, false);
    assert.ok(seenVerifier.length >= 43, "the PKCE verifier reaches Google");
    const again = await signIn({ sub: "g-1", email: "nina@example.com", email_verified: true, name: "Nina B" });
    assert.equal((await me(sessionOf(again)!)).id, u.id, "same Google id, same account");
    assert.equal(db.get<{ n: number }>("SELECT COUNT(*) n FROM users WHERE email = 'nina@example.com'")!.n, 1);
  });

  it("signs in to an existing account with the same verified email and links it", async () => {
    await t.register("ben"); const ben = (await t.call("ben", "GET", "/auth/me")).data.user;
    const r = await signIn({ sub: "g-ben", email: "ben@example.com", email_verified: true });
    assert.equal((await me(sessionOf(r)!)).id, ben.id);
    assert.equal(db.get<{ n: number }>("SELECT COUNT(*) n FROM user_identities WHERE user_id = ?", ben.id)!.n, 1);
    // Google verified this address, so another Google id with the same address reaches the same account (it is the same mailbox owner).
    const other = await signIn({ sub: "g-ben-2", email: "ben@example.com", email_verified: true });
    assert.equal((await me(sessionOf(other)!)).id, ben.id);
  });

  it("refuses an unverified email, a wrong state, and a forged audience", async () => {
    assert.match(location(await signIn({ sub: "g-x", email: "x@example.com", email_verified: false })), /error=email_unverified/);
    assert.match(location(await signIn({ sub: "g-x", email: "x@example.com", email_verified: true }, { wrongState: true })), /error=google_state/);
    assert.match(location(await signIn({ sub: "g-x", email: "x@example.com", email_verified: true, aud: "someone-else" })), /error=google_failed/);
    assert.match(location(await signIn({ sub: "g-x", email: "x@example.com", email_verified: true, nonce: "replayed" })), /error=google_failed/);
    assert.equal(db.get<{ n: number }>("SELECT COUNT(*) n FROM users WHERE email = 'x@example.com'")!.n, 0);
  });

  it("can be limited to some email domains", async () => {
    settings.updateSettings({ security: { googleDomains: "corp.test, partner.test" } });
    assert.match(location(await signIn({ sub: "g-d1", email: "z@example.com", email_verified: true })), /error=domain_not_allowed/);
    assert.equal(location(await signIn({ sub: "g-d2", email: "z@corp.test", email_verified: true })), "/");
    settings.updateSettings({ security: { googleDomains: "" } });
  });

  it("follows the registration policy for people without an account", async () => {
    settings.updateSettings({ registration: { mode: "invite" } });
    assert.match(location(await signIn({ sub: "g-n1", email: "nobody@example.com", email_verified: true })), /error=registration_closed/);
    const ws = db.get<{ id: string }>("SELECT id FROM workspaces LIMIT 1")!.id;
    db.run("INSERT INTO invitations(id,workspace_id,email,role,token_hash,expires_at) VALUES (?,?,?,?,?,?)", crypto.randomUUID(), ws, "invited@example.com", "MEMBER", crypto.randomUUID(), new Date(Date.now() + 86_400_000).toISOString());
    const r = await signIn({ sub: "g-n2", email: "invited@example.com", email_verified: true });
    assert.equal(location(r), "/");
    assert.equal((await t.call("", "GET", "/auth/me", undefined, { cookie: sessionOf(r)! })).data.workspaces[0].id, ws, "joins the inviting workspace");
    settings.updateSettings({ registration: { mode: "closed" } });
    assert.match(location(await signIn({ sub: "g-n3", email: "late@example.com", email_verified: true })), /error=registration_closed/);
    assert.equal(location(await signIn({ sub: "g-ben", email: "ben@example.com", email_verified: true })), "/", "existing accounts are unaffected");
    settings.updateSettings({ registration: { mode: "open" } });
  });

  it("does not sign in a disabled account, and still asks for the second factor", async () => {
    await t.register("cy"); const cy = (await t.call("cy", "GET", "/auth/me")).data.user.id;
    db.run("INSERT INTO user_mfa(user_id, secret_enc, confirmed_at) VALUES (?, 'x', ?)", cy, new Date().toISOString());
    const r = await signIn({ sub: "g-cy", email: "cy@example.com", email_verified: true });
    assert.match(location(r), /^\/login\?challenge=/); assert.equal(sessionOf(r), undefined, "no session before the TOTP code");
    db.run("UPDATE users SET status = 'DISABLED' WHERE id = ?", cy);
    assert.match(location(await signIn({ sub: "g-cy", email: "cy@example.com", email_verified: true })), /error=account_disabled/);
  });

  it("hands the session to the Android app only with the verifier it generated", async () => {
    const verifier = crypto.randomBytes(32).toString("base64url"); const cc = crypto.createHash("sha256").update(verifier).digest("base64url");
    const r = await signIn({ sub: "g-app", email: "app@example.com", email_verified: true }, { app: true, cc });
    assert.equal(r.status, 200); assert.equal(sessionOf(r), undefined, "the browser gets no session");
    const code = /app\.superdrive:\/\/login\?code=([\w-]+)/.exec(r.res.body)?.[1]; assert.ok(code);
    const wrong = await t.call("", "GET", `/auth/google/exchange?code=${code}&verifier=${crypto.randomBytes(32).toString("base64url")}`);
    assert.match(location(wrong), /error=google_state/);
    // the code was burnt by the failed attempt: even the right verifier cannot use it now
    assert.match(location(await t.call("", "GET", `/auth/google/exchange?code=${code}&verifier=${verifier}`)), /error=google_state/);
    const r2 = await signIn({ sub: "g-app", email: "app@example.com", email_verified: true }, { app: true, cc });
    const code2 = /code=([\w-]+)/.exec(r2.res.body)![1];
    const good = await t.call("", "GET", `/auth/google/exchange?code=${code2}&verifier=${verifier}`);
    assert.equal(location(good), "/"); assert.equal((await me(sessionOf(good)!)).email, "app@example.com");
  });

  it("can be switched off by the administrator", async () => {
    settings.updateSettings({ security: { googleLogin: false } });
    assert.equal((await t.call("", "GET", "/branding")).data.google, false);
    assert.match(location(await signIn({})), /error=google_disabled/);
    settings.updateSettings({ security: { googleLogin: true } });
  });
});
