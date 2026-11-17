import crypto from "node:crypto";
import { hash } from "@node-rs/argon2";
import { config } from "../config.ts";
import { db, now } from "../db.ts";
import { audit } from "../lib/audit.ts";
import { newId, randomToken } from "../lib/crypto.ts";
import { AppError } from "../lib/errors.ts";
import { ARGON, createWorkspace } from "./auth.ts";
import { getSettings } from "./settings.ts";

/**
 * "Sign in with Google" (OpenID Connect, authorization-code flow with PKCE and a nonce).
 * The id_token is read straight from Google's token endpoint over TLS, which is what the OIDC spec allows without checking its signature;
 * issuer, audience, expiry, nonce and "email_verified" are all checked.
 *
 * A sign-in is matched to an account by Google's stable user id first, then by verified email (and linked), and only then — if the
 * registration policy allows it — a new account is made. Error codes below are what the sign-in page turns into messages.
 */
export type GoogleErrorCode = "google_disabled" | "google_state" | "google_failed" | "email_unverified" | "domain_not_allowed" | "registration_closed" | "account_disabled";
const fail = (code: GoogleErrorCode, message: string) => new AppError(400, code.toUpperCase(), message);
const KNOWN = new Set<string>(["google_disabled", "google_state", "google_failed", "email_unverified", "domain_not_allowed", "registration_closed", "account_disabled"]);
export const errorCodeOf = (e: unknown): GoogleErrorCode => { const c = e instanceof AppError ? e.code.toLowerCase() : ""; return (KNOWN.has(c) ? c : "google_failed") as GoogleErrorCode; };

const cfg = () => ({ ...config.oauth.google, ...config.oauth.googleLogin });
export const googleEnabled = () => !!cfg().clientId && !!cfg().clientSecret && getSettings().security.googleLogin;

interface Pending { nonce: string; verifier: string; app: boolean; cc: string; invitation: string; expires: number }
const pending = new Map<string, Pending>(); // state -> what the callback needs; ten minutes, single use
interface AppGrant { userId: string; cc: string; expires: number }
const grants = new Map<string, AppGrant>(); // one-time codes that hand a browser sign-in to the Android app
const sweep = () => { const t = Date.now(); for (const [k, v] of pending) if (v.expires < t) pending.delete(k); for (const [k, v] of grants) if (v.expires < t) grants.delete(k); if (pending.size > 5000) pending.clear(); if (grants.size > 5000) grants.clear(); };
const b64u = (b: Buffer) => b.toString("base64url");

export function beginGoogle(o: { app: boolean; cc: string; invitation: string }) {
  if (!googleEnabled()) throw fail("google_disabled", "Masuk dengan Google belum diaktifkan.");
  if (o.app && !/^[A-Za-z0-9_-]{43}$/.test(o.cc)) throw fail("google_failed", "Permintaan dari aplikasi tidak valid.");
  sweep();
  const state = randomToken(24); const nonce = randomToken(16); const verifier = b64u(crypto.randomBytes(32));
  pending.set(state, { nonce, verifier, app: o.app, cc: o.cc, invitation: o.invitation.slice(0, 200), expires: Date.now() + 10 * 60_000 });
  const u = new URL(cfg().authUrl);
  u.search = new URLSearchParams({
    client_id: cfg().clientId, redirect_uri: cfg().redirectUri, response_type: "code", scope: "openid email profile", state, nonce,
    code_challenge: b64u(crypto.createHash("sha256").update(verifier).digest()), code_challenge_method: "S256", prompt: "select_account",
  }).toString();
  return { url: u.toString(), state };
}

interface Claims { sub: string; email?: string; email_verified?: boolean | string; name?: string; nonce?: string; aud?: string; iss?: string; exp?: number }

/** Finishes the round trip: checks state, trades the code for tokens, validates the id_token and returns the Google identity. */
export async function completeGoogle(code: string, state: string, cookieState: string | undefined) {
  sweep();
  const p = pending.get(state); pending.delete(state);
  if (!p || !cookieState || cookieState !== state || p.expires < Date.now()) throw fail("google_state", "Sesi masuk Google sudah berakhir. Coba lagi.");
  let claims: Claims;
  try {
    const res = await fetch(cfg().tokenUrl, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, signal: AbortSignal.timeout(15_000),
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: cfg().redirectUri, client_id: cfg().clientId, client_secret: cfg().clientSecret, code_verifier: p.verifier }),
    });
    if (!res.ok) throw new Error(`token endpoint ${res.status}`);
    const idToken = ((await res.json()) as { id_token?: string }).id_token;
    if (!idToken) throw new Error("no id_token");
    claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch { throw fail("google_failed", "Tidak dapat menyelesaikan masuk dengan Google. Coba lagi."); }
  const issuerOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if ((!issuerOk && cfg().tokenUrl === "https://oauth2.googleapis.com/token") || claims.aud !== cfg().clientId || !claims.exp || claims.exp * 1000 < Date.now() || claims.nonce !== p.nonce || !claims.sub)
    throw fail("google_failed", "Jawaban dari Google tidak valid.");
  if (!claims.email || (claims.email_verified !== true && claims.email_verified !== "true")) throw fail("email_unverified", "Email akun Google ini belum terverifikasi.");
  const domains = getSettings().security.googleDomains.split(/[,\s]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
  const domain = claims.email.split("@")[1]!.toLowerCase();
  if (domains.length && !domains.includes(domain)) throw fail("domain_not_allowed", "Domain email ini tidak diizinkan untuk masuk.");
  return { sub: claims.sub, email: claims.email.toLowerCase(), name: (claims.name ?? claims.email.split("@")[0]!).slice(0, 100), app: p.app, cc: p.cc, invitation: p.invitation };
}

/** The account for a verified Google identity: existing (by Google id, then by email, which links it) or newly created if registration allows. */
export async function userForGoogle(g: { sub: string; email: string; name: string }, ip: string) {
  const byId = db.get<any>("SELECT u.* FROM user_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = 'google' AND i.subject = ?", g.sub);
  const byEmail = byId ? undefined : db.get<any>("SELECT * FROM users WHERE email = ?", g.email);
  const existing = byId ?? byEmail;
  if (existing) {
    if (existing.status !== "ACTIVE") throw fail("account_disabled", "Akun ini dinonaktifkan oleh administrator.");
    if (!byId) db.run("INSERT OR IGNORE INTO user_identities(provider,subject,user_id,email) VALUES ('google',?,?,?)", g.sub, existing.id, g.email);
    return existing;
  }
  const first = !db.get("SELECT 1 FROM users LIMIT 1");
  const inv = db.get<any>("SELECT * FROM invitations WHERE lower(email) = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY expires_at DESC LIMIT 1", g.email, now());
  const mode = getSettings().registration.mode;
  if (!first && !inv && mode !== "open") throw fail("registration_closed", mode === "closed" ? "Pendaftaran akun baru sedang ditutup oleh administrator." : "Pendaftaran ditutup. Minta undangan dari administrator.");
  // No password is ever typed for this account; the stored hash is of a random value nobody knows (a reset link can still set one).
  const passwordHash = await hash(randomToken(32), ARGON); const id = newId(); let workspaceId = "";
  db.tx(() => {
    db.run("INSERT INTO users(id,email,name,password_hash,is_super_admin) VALUES (?,?,?,?,?)", id, g.email, g.name, passwordHash, first ? 1 : 0);
    db.run("INSERT INTO user_identities(provider,subject,user_id,email) VALUES ('google',?,?,?)", g.sub, id, g.email);
    if (inv) { db.run("INSERT INTO memberships(id,workspace_id,user_id,role) VALUES (?,?,?,?)", newId(), inv.workspace_id, id, inv.role); db.run("UPDATE invitations SET accepted_at = ? WHERE id = ?", now(), inv.id); workspaceId = inv.workspace_id; }
    else workspaceId = createWorkspace(`Workspace ${g.name}`, id);
  });
  audit({ workspaceId, userId: id, action: "auth.register", resourceType: "user", resourceId: id, ip });
  return db.get<any>("SELECT * FROM users WHERE id = ?", id)!;
}

/** Android: the sign-in happened in the phone's browser, so the app gets a one-time code that only it (holding the verifier) can redeem. */
export function grantForApp(userId: string, cc: string) { sweep(); const code = randomToken(24); grants.set(code, { userId, cc, expires: Date.now() + 2 * 60_000 }); return code; }
export function redeemAppGrant(code: string, verifier: string) {
  const g = grants.get(code); grants.delete(code);
  if (!g || g.expires < Date.now() || !/^[A-Za-z0-9_-]{43}$/.test(verifier) || b64u(crypto.createHash("sha256").update(verifier).digest()) !== g.cc) return null;
  return db.get<any>("SELECT * FROM users WHERE id = ? AND status = 'ACTIVE'", g.userId) ?? null;
}
