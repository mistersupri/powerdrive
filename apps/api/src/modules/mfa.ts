import crypto from "node:crypto";
import QRCode from "qrcode";
import { verify } from "@node-rs/argon2";
import { db, now } from "../db.ts";
import { open, randomToken, seal, sha256 } from "../lib/crypto.ts";
import { AppError, badRequest, unauthorized } from "../lib/errors.ts";
import { newSecret, otpauthUrl, verifyTotp } from "../lib/totp.ts";
import { getSettings } from "./settings.ts";

const row = (userId: string) => db.get<any>("SELECT * FROM user_mfa WHERE user_id = ?", userId);
export const hasMfa = (userId: string) => !!row(userId)?.confirmed_at;

/** Does the instance policy demand a second factor from this user? */
export function mfaRequiredFor(userId: string): boolean {
  const m = getSettings().security.mfa; if (m === "off") return false; if (m === "everyone") return true;
  return !!db.get("SELECT 1 FROM users u WHERE u.id = ? AND (u.is_super_admin = 1 OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.role IN ('OWNER','ADMIN')))", userId);
}
export const mfaStatus = (userId: string) => ({ enabled: hasMfa(userId), required: mfaRequiredFor(userId), recoveryLeft: hasMfa(userId) ? (JSON.parse(row(userId).recovery) as string[]).length : 0 });

/** Step 1 of enrolment: a fresh secret (not active until a code from the app proves it works). */
export async function beginSetup(userId: string, email: string) {
  if (hasMfa(userId)) throw badRequest("Verifikasi dua langkah sudah aktif. Nonaktifkan dulu untuk mengatur ulang.");
  const secret = newSecret();
  db.run("INSERT INTO user_mfa(user_id, secret_enc) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET secret_enc = excluded.secret_enc, confirmed_at = NULL, recovery = '[]', last_step = 0", userId, JSON.stringify(seal(secret)));
  const url = otpauthUrl(secret, email, getSettings().brand.appName);
  return { secret, otpauthUrl: url, qrSvg: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
}
const makeRecoveryCodes = () => Array.from({ length: 10 }, () => `${crypto.randomBytes(3).toString("hex")}-${crypto.randomBytes(3).toString("hex")}`);

export async function confirmSetup(userId: string, code: string) {
  const r = row(userId); if (!r || r.confirmed_at) throw badRequest("Mulai pengaturan dulu.");
  const step = verifyTotp(open<string>(JSON.parse(r.secret_enc)), code); if (step === null) throw badRequest("Kode salah atau sudah kedaluwarsa. Coba kode terbaru dari aplikasi.", "WRONG_CODE");
  const codes = makeRecoveryCodes();
  db.run("UPDATE user_mfa SET confirmed_at = ?, last_step = ?, recovery = ? WHERE user_id = ?", now(), step, JSON.stringify(codes.map((c) => sha256(c))), userId);
  return codes; // shown once; only hashes are kept
}

export async function disable(userId: string, password: string) {
  const u = db.get<any>("SELECT password_hash FROM users WHERE id = ?", userId)!;
  if (!(await verify(u.password_hash, password).catch(() => false))) throw badRequest("Kata sandi salah.", "WRONG_PASSWORD");
  if (mfaRequiredFor(userId)) throw new AppError(403, "MFA_REQUIRED", "Administrator mewajibkan verifikasi dua langkah untuk akun Anda.");
  db.run("DELETE FROM user_mfa WHERE user_id = ?", userId);
}

/** After the password was right but a second factor is needed: a short-lived challenge instead of a session. */
export function startChallenge(userId: string, ip: string, ua: string) {
  const token = randomToken(32);
  db.run("INSERT INTO mfa_challenges(token_hash, user_id, expires_at, ip, user_agent) VALUES (?,?,?,?,?)", sha256(token), userId, new Date(Date.now() + 5 * 60_000).toISOString(), ip, ua.slice(0, 250));
  return token;
}

/** Verify the code (or a one-time recovery code) for a challenge. Five wrong tries burn the challenge. */
export function finishChallenge(challenge: string, input: { code?: string; recoveryCode?: string }) {
  const c = db.get<any>("SELECT * FROM mfa_challenges WHERE token_hash = ? AND expires_at > ?", sha256(challenge), now());
  if (!c) throw unauthorized("Sesi verifikasi berakhir. Masuk lagi.");
  const r = row(c.user_id); if (!r?.confirmed_at) throw unauthorized("Verifikasi dua langkah tidak aktif.");
  const fail = () => { const n = c.attempts + 1; if (n >= 5) db.run("DELETE FROM mfa_challenges WHERE token_hash = ?", c.token_hash); else db.run("UPDATE mfa_challenges SET attempts = ? WHERE token_hash = ?", n, c.token_hash); throw unauthorized("Kode salah."); };
  if (input.recoveryCode) {
    const codes: string[] = JSON.parse(r.recovery); const h = sha256(input.recoveryCode.trim().toLowerCase()); const i = codes.indexOf(h);
    if (i < 0) return fail(); codes.splice(i, 1); db.run("UPDATE user_mfa SET recovery = ? WHERE user_id = ?", JSON.stringify(codes), c.user_id);
  } else {
    const step = verifyTotp(open<string>(JSON.parse(r.secret_enc)), input.code ?? ""); if (step === null) return fail();
    if (step <= r.last_step) return fail(); // the same code cannot be used twice
    db.run("UPDATE user_mfa SET last_step = ? WHERE user_id = ?", step, c.user_id);
  }
  db.run("DELETE FROM mfa_challenges WHERE token_hash = ?", c.token_hash);
  return { userId: c.user_id as string, ip: c.ip as string, ua: c.user_agent as string };
}
