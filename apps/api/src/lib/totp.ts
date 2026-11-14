import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const base32 = (buf: Buffer) => { let bits = 0, v = 0, out = ""; for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += ALPHABET[(v >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += ALPHABET[(v << (5 - bits)) & 31]; return out; };
export const unbase32 = (s: string) => { let bits = 0, v = 0; const out: number[] = []; for (const c of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) { v = (v << 5) | ALPHABET.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };

export const newSecret = () => base32(crypto.randomBytes(20));
/** RFC 6238, SHA-1, 6 digits, 30 s steps (what every authenticator app expects). */
export function totp(secret: string, atMs = Date.now(), stepOffset = 0): string {
  const counter = Math.floor(atMs / 30_000) + stepOffset; const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", unbase32(secret)).update(b).digest(); const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!; return String(n % 1_000_000).padStart(6, "0");
}
/** Accepts the current code and one step either side (clock drift). Returns the matched step so a code cannot be replayed. */
export function verifyTotp(secret: string, code: string, atMs = Date.now()): number | null {
  const c = code.replace(/\s/g, ""); if (!/^\d{6}$/.test(c)) return null;
  for (const off of [0, -1, 1]) { const want = Buffer.from(totp(secret, atMs, off)); if (crypto.timingSafeEqual(want, Buffer.from(c))) return Math.floor(atMs / 30_000) + off; }
  return null;
}
export const otpauthUrl = (secret: string, account: string, issuer: string) => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
