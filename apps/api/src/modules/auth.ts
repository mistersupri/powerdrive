import { getSettings } from "./settings.ts";
import { sendMail } from "../lib/mailer.ts";
import { hasMfa, mfaRequiredFor, startChallenge } from "./mfa.ts";
import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";
import { config } from "../config.ts";
import { db, now } from "../db.ts";
import { audit } from "../lib/audit.ts";
import { newId, randomToken, sha256 } from "../lib/crypto.ts";
import { AppError, badRequest, conflict, unauthorized } from "../lib/errors.ts";
import type { User, WorkspaceRole } from "@superdrive/shared";

// Argon2id with OWASP-recommended minimum parameters (19 MiB, t=2, p=1).
export const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 as const };

export const registerSchema = z.object({
  email: z.string().email().max(200), name: z.string().trim().min(1).max(100),
  password: z.string().min(8, "Kata sandi minimal 8 karakter.").max(200), invitationToken: z.string().optional(),
  workspaceName: z.string().trim().min(1).max(100).optional(),
});

export const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace";
export function uniqueSlug(base: string) {
  let slug = slugify(base); let i = 1;
  while (db.get("SELECT 1 FROM workspaces WHERE slug = ?", slug)) slug = `${slugify(base)}-${++i}`;
  return slug;
}

export function toUser(r: any): User { return { id: r.id, email: r.email, name: r.name, isSuperAdmin: !!r.is_super_admin }; }

export function createWorkspace(name: string, ownerId: string) {
  const id = newId();
  db.tx(() => {
    db.run("INSERT INTO workspaces(id,name,slug) VALUES (?,?,?)", id, name, uniqueSlug(name));
    db.run("INSERT INTO memberships(id,workspace_id,user_id,role) VALUES (?,?,?,'OWNER')", newId(), id, ownerId);
  });
  void import("./storages.ts").then((m) => m.ensureDefaultStorage(id)).catch(() => {});
  return id;
}

export async function register(input: z.infer<typeof registerSchema>, ip: string) {
  const email = input.email.toLowerCase();
  const inv = input.invitationToken
    ? db.get<any>("SELECT * FROM invitations WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?", sha256(input.invitationToken), now()) : undefined;
  if (input.invitationToken && !inv) throw badRequest("Undangan tidak valid atau sudah kedaluwarsa.", "INVALID_INVITATION");
  if (inv && inv.email.toLowerCase() !== email) throw badRequest("Undangan ini dibuat untuk alamat email lain.", "INVALID_INVITATION");
  const first = !db.get("SELECT 1 FROM users LIMIT 1");
  const mode = getSettings().registration.mode;
  if (!first && mode === "closed") throw new AppError(403, "REGISTRATION_CLOSED", "Pendaftaran akun baru sedang ditutup oleh administrator.");
  if (!first && !inv && mode !== "open") throw new AppError(403, "REGISTRATION_CLOSED", "Pendaftaran ditutup. Minta undangan dari administrator.");
  if (db.get("SELECT 1 FROM users WHERE email = ?", email)) throw conflict("Email sudah terdaftar.", "EMAIL_TAKEN");
  const passwordHash = await hash(input.password, ARGON);
  const id = newId();
  let workspaceId: string;
  db.tx(() => {
    db.run("INSERT INTO users(id,email,name,password_hash,is_super_admin) VALUES (?,?,?,?,?)", id, email, input.name, passwordHash, first ? 1 : 0);
    if (inv) {
      db.run("INSERT INTO memberships(id,workspace_id,user_id,role) VALUES (?,?,?,?)", newId(), inv.workspace_id, id, inv.role);
      db.run("UPDATE invitations SET accepted_at = ? WHERE id = ?", now(), inv.id);
      workspaceId = inv.workspace_id;
    } else workspaceId = createWorkspace(input.workspaceName ?? `Workspace ${input.name}`, id);
  });
  audit({ workspaceId: workspaceId!, userId: id, action: "auth.register", resourceType: "user", resourceId: id, ip });
  return id;
}

export async function login(emailRaw: string, password: string, ip: string, ua: string) {
  const u = db.get<any>("SELECT * FROM users WHERE email = ?", emailRaw.toLowerCase());
  // Verify against a dummy hash when the user is unknown so timing does not reveal which emails exist.
  const ok = u ? await verify(u.password_hash, password).catch(() => false) : (await verify(await getDummy(), password).catch(() => false), false);
  if (!u || !ok || u.status !== "ACTIVE") throw unauthorized("Email atau kata sandi salah.");
  // Right password, but a second factor is set up: hand out a short-lived challenge, not a session.
  if (hasMfa(u.id)) return { mfa: true as const, challenge: startChallenge(u.id, ip, ua) };
  return { mfa: false as const, ...issueSession(u, ip, ua) };
}

export function issueSession(u: any, ip: string, ua: string) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + getSettings().security.sessionDays * 86_400_000).toISOString();
  db.run("INSERT INTO sessions(id,user_id,token_hash,expires_at,ip,user_agent,last_seen_at) VALUES (?,?,?,?,?,?,?)", newId(), u.id, sha256(token), expires, ip, ua.slice(0, 250), now());
  db.run("UPDATE users SET last_login_at = ? WHERE id = ?", now(), u.id);
  const m = db.get<any>("SELECT workspace_id FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1", u.id);
  if (m) audit({ workspaceId: m.workspace_id, userId: u.id, action: "auth.login", resourceType: "user", resourceId: u.id, ip });
  return { token, expires: new Date(expires), user: toUser(u), mfaSetupRequired: mfaRequiredFor(u.id) && !hasMfa(u.id) };
}
let dummyHash: Promise<string> | null = null;
const getDummy = () => (dummyHash ??= hash("not-a-real-password", ARGON));

export function sessionUser(token: string | undefined): User | null {
  if (!token) return null;
  const r = db.get<any>(
    "SELECT u.*, s.last_seen_at AS seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'ACTIVE'", sha256(token), now());
  if (!r) return null;
  // Inactivity timeout: a session nobody has touched for too long is over. "Seen" is refreshed at most once a minute.
  const idle = getSettings().security.idleTimeoutMinutes; const last = r.seen ? Date.parse(r.seen) : 0;
  if (idle > 0 && last && Date.now() - last > idle * 60_000) { db.run("DELETE FROM sessions WHERE token_hash = ?", sha256(token)); return null; }
  if (!last || Date.now() - last > 60_000) db.run("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", now(), sha256(token));
  return toUser(r);
}
export function logout(token: string) { db.run("DELETE FROM sessions WHERE token_hash = ?", sha256(token)); }
export function revokeOtherSessions(userId: string, keepToken: string) { db.run("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?", userId, sha256(keepToken)); }

export async function changePassword(userId: string, current: string, next: string, keepToken: string) {
  const u = db.get<any>("SELECT * FROM users WHERE id = ?", userId)!;
  if (!(await verify(u.password_hash, current).catch(() => false))) throw badRequest("Kata sandi saat ini salah.", "WRONG_PASSWORD");
  if (next.length < 8) throw badRequest("Kata sandi baru minimal 8 karakter.");
  db.run("UPDATE users SET password_hash = ? WHERE id = ?", await hash(next, ARGON), userId);
  revokeOtherSessions(userId, keepToken);
}

/** There is no mail server in the box: the reset link is written to the server log for the administrator. */
export async function requestPasswordReset(emailRaw: string, log: (msg: string) => void) {
  const u = db.get<any>("SELECT id FROM users WHERE email = ? AND status = 'ACTIVE'", emailRaw.toLowerCase());
  if (!u) return;
  const token = randomToken(32);
  db.run("DELETE FROM password_resets WHERE user_id = ?", u.id);
  db.run("INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES (?,?,?)", sha256(token), u.id, new Date(Date.now() + 3600_000).toISOString());
  const link = `${config.appUrl}/reset-password?token=${token}`;
  const app = getSettings().brand.appName;
  // With SMTP configured the link is emailed; otherwise (or if sending fails) it goes to the server log for the administrator.
  const sent = await sendMail({ to: emailRaw, subject: `Atur ulang kata sandi ${app}`, text: `Seseorang meminta pengaturan ulang kata sandi untuk akun ini.\n\nBuka tautan ini dalam 1 jam:\n${link}\n\nJika bukan Anda, abaikan email ini.` }).catch((e) => { log(`[password-reset] email failed: ${(e as Error).message}`); return false; });
  if (!sent) log(`[password-reset] ${emailRaw}: ${link}`);
}
export async function resetPassword(token: string, password: string) {
  if (password.length < 8) throw badRequest("Kata sandi minimal 8 karakter.");
  const r = db.get<any>("SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ?", sha256(token), now());
  if (!r) throw badRequest("Tautan reset tidak valid atau sudah kedaluwarsa.", "INVALID_TOKEN");
  const h = await hash(password, ARGON);
  db.tx(() => {
    db.run("UPDATE users SET password_hash = ? WHERE id = ?", h, r.user_id);
    db.run("DELETE FROM password_resets WHERE user_id = ?", r.user_id);
    db.run("DELETE FROM sessions WHERE user_id = ?", r.user_id);
  });
}

export const roleRank: Record<WorkspaceRole, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };
