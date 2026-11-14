import { z } from "zod";
import { config } from "../config.ts";
import { db, now } from "../db.ts";
import { open, seal } from "../lib/crypto.ts";
import { badRequest } from "../lib/errors.ts";

/** Instance-wide settings, edited by the super admin. Defaults come from the environment so a fresh install behaves as before. */
export interface AppSettings {
  registration: { mode: "open" | "invite" | "closed" };
  guest: { allowLinks: boolean; allowUploads: boolean; requirePassword: boolean; maxExpiryDays: number; defaultExpiryDays: number };
  retention: { trashDays: number; auditDays: number; transferHistoryDays: number };
  security: { mfa: "off" | "admins" | "everyone"; idleTimeoutMinutes: number; sessionDays: number };
  email: { enabled: boolean; host: string; port: number; secure: boolean; user: string; passwordSealed: string | null; fromName: string; fromAddress: string };
  brand: { appName: string; color: string; defaultTheme: "light" | "dark" | "system"; loginMessage: string; iconVersion: number };
}

export const defaults = (): AppSettings => ({
  registration: { mode: config.allowRegistration ? "open" : "invite" },
  guest: { allowLinks: true, allowUploads: true, requirePassword: false, maxExpiryDays: 0, defaultExpiryDays: 0 },
  retention: { trashDays: config.trashRetentionDays, auditDays: 0, transferHistoryDays: 0 },
  security: { mfa: "off", idleTimeoutMinutes: 0, sessionDays: config.sessionTtlDays },
  email: { enabled: false, host: "", port: 587, secure: false, user: "", passwordSealed: null, fromName: "SuperDrive", fromAddress: "" },
  brand: { appName: "SuperDrive", color: "#1769e8", defaultTheme: "light", loginMessage: "", iconVersion: 0 },
});

let cache: AppSettings | null = null;
const merge = <T extends object>(base: T, patch: any): T => { const out: any = { ...base }; for (const k of Object.keys(patch ?? {})) { if (!(k in out) || patch[k] === undefined) continue; out[k] = out[k] && typeof out[k] === "object" && !Array.isArray(out[k]) && patch[k] && typeof patch[k] === "object" ? merge(out[k], patch[k]) : patch[k]; } return out; };

export function getSettings(): AppSettings {
  if (cache) return cache;
  const row = db.get<{ value: string }>("SELECT value FROM app_settings WHERE key = 'app'");
  let stored: any = {}; try { stored = row ? JSON.parse(row.value) : {}; } catch { /* corrupt row: fall back to defaults */ }
  return (cache = merge(defaults(), stored));
}

/** WCAG: white text on the accent must be readable, so the accent needs at least 4.5:1 against white. */
export function contrastWithWhite(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 1.05 / (0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]! + 0.05);
}

function persist(s: AppSettings) {
  db.run("INSERT INTO app_settings(key, value, updated_at) VALUES ('app', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", JSON.stringify(s), now());
  cache = s;
}

const int = (min: number, max: number) => z.number().int().min(min).max(max);
export const patchSchema = z.object({
  registration: z.object({ mode: z.enum(["open", "invite", "closed"]) }).partial(),
  guest: z.object({ allowLinks: z.boolean(), allowUploads: z.boolean(), requirePassword: z.boolean(), maxExpiryDays: int(0, 3650), defaultExpiryDays: int(0, 3650) }).partial(),
  retention: z.object({ trashDays: int(1, 3650), auditDays: int(0, 3650), transferHistoryDays: int(0, 3650) }).partial(),
  security: z.object({ mfa: z.enum(["off", "admins", "everyone"]), idleTimeoutMinutes: int(0, 10_080), sessionDays: int(1, 365) }).partial(),
  email: z.object({ enabled: z.boolean(), host: z.string().max(200), port: int(1, 65535), secure: z.boolean(), user: z.string().max(200), password: z.string().max(500).nullable(), fromName: z.string().max(80), fromAddress: z.string().max(200) }).partial(),
  brand: z.object({ appName: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Warna harus berformat #RRGGBB."), defaultTheme: z.enum(["light", "dark", "system"]), loginMessage: z.string().max(300) }).partial(),
}).partial().strict();

export function updateSettings(patch: unknown): AppSettings {
  const p = patchSchema.parse(patch); const cur = getSettings();
  const next = merge(cur, { ...p, email: p.email ? { ...p.email, password: undefined } : undefined });
  if (p.email && p.email.password !== undefined) next.email.passwordSealed = p.email.password ? JSON.stringify(seal(p.email.password)) : null;
  if (next.brand.color.toLowerCase() !== cur.brand.color.toLowerCase() && contrastWithWhite(next.brand.color) < 4.5) throw badRequest("Warna terlalu terang: teks putih di atasnya sulit dibaca (butuh kontras minimal 4,5:1). Pilih warna yang lebih gelap.");
  if (next.guest.maxExpiryDays > 0 && next.guest.defaultExpiryDays > next.guest.maxExpiryDays) next.guest.defaultExpiryDays = next.guest.maxExpiryDays;
  if (next.email.enabled && (!next.email.host || !next.email.fromAddress)) throw badRequest("Isi server SMTP dan alamat pengirim sebelum mengaktifkan email.");
  persist(next); return next;
}
export function setIconVersion(v: number) { const s = getSettings(); s.brand.iconVersion = v; persist(s); return s; }
export const resetSettingsCache = () => { cache = null; };
export const smtpPassword = (s: AppSettings) => (s.email.passwordSealed ? open<string>(JSON.parse(s.email.passwordSealed)) : "");

/** What the admin screen gets: never the SMTP password, only whether one is set. */
export function settingsDto(s = getSettings()) { const { passwordSealed, ...email } = s.email; return { ...s, email: { ...email, hasPassword: !!passwordSealed } }; }
/** What anyone may see before signing in. */
export function publicBranding(s = getSettings()) {
  return { appName: s.brand.appName, color: s.brand.color, defaultTheme: s.brand.defaultTheme, loginMessage: s.brand.loginMessage, iconUrl: s.brand.iconVersion ? `/api/v1/branding/icon/192?v=${s.brand.iconVersion}` : null, registration: s.registration.mode };
}
