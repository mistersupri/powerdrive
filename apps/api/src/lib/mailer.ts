import nodemailer from "nodemailer";
import { getSettings, smtpPassword } from "../modules/settings.ts";
import { badRequest } from "./errors.ts";

export const mailEnabled = () => { const e = getSettings().email; return e.enabled && !!e.host && !!e.fromAddress; };

/** Sends through the SMTP server configured in the admin settings. Resolves false when email is off, so callers can fall back to showing the link. */
export async function sendMail(msg: { to: string; subject: string; text: string; html?: string }): Promise<boolean> {
  if (!mailEnabled()) return false;
  const s = getSettings().email;
  const tr = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: s.user ? { user: s.user, pass: smtpPassword(getSettings()) } : undefined, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12_000 });
  await tr.sendMail({ from: `"${s.fromName.replace(/"/g, "")}" <${s.fromAddress}>`, ...msg });
  return true;
}

export async function sendTestMail(to: string) {
  if (!mailEnabled()) throw badRequest("Email belum diaktifkan.");
  try { await sendMail({ to, subject: `Email uji dari ${getSettings().brand.appName}`, text: "Jika Anda membaca ini, pengaturan SMTP sudah benar." }); }
  catch (e) { throw badRequest(`Gagal mengirim: ${(e as Error).message}`, "SMTP_FAILED"); }
}
