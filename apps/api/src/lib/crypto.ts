import crypto from "node:crypto";
import { config } from "../config.ts";

/**
 * Envelope-style credential encryption: AES-256-GCM, versioned master keys so keys can
 * be rotated without re-encrypting everything at once. Master key lives in the environment,
 * never in the database.
 */
type KeyRing = { current: string; keys: Map<string, Buffer> };

function loadKeys(): KeyRing {
  const keys = new Map<string, Buffer>();
  let current = "";
  const raw = config.masterKeys.trim();
  if (!raw) {
    if (config.isProd) throw new Error("ENCRYPTION_MASTER_KEY wajib diisi di production (format: v1:<base64 32 byte>).");
    // Development fallback: derived, stable key so restarts keep working.
    keys.set("dev", crypto.createHash("sha256").update("superdrive-dev-key").digest());
    return { current: "dev", keys };
  }
  for (const part of raw.split(",")) {
    const [ver, b64] = part.trim().split(":");
    if (!ver || !b64) throw new Error("Format ENCRYPTION_MASTER_KEY tidak valid.");
    const key = Buffer.from(b64, "base64");
    if (key.length !== 32) throw new Error(`Kunci ${ver} harus 32 byte (base64).`);
    keys.set(ver, key);
    if (!current) current = ver;
  }
  return { current, keys };
}

let ring: KeyRing | null = null;
const getRing = () => (ring ??= loadKeys());

export interface Sealed { ciphertext: string; iv: string; authTag: string; keyVersion: string }

export function seal(plain: unknown): Sealed {
  const { current, keys } = getRing();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keys.get(current)!, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(plain), "utf8"), cipher.final()]);
  return { ciphertext: ct.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), keyVersion: current };
}

export function open<T = unknown>(s: Sealed): T {
  const key = getRing().keys.get(s.keyVersion);
  if (!key) throw new Error(`Kunci enkripsi versi ${s.keyVersion} tidak tersedia.`);
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(s.iv, "base64"));
  d.setAuthTag(Buffer.from(s.authTag, "base64"));
  const pt = Buffer.concat([d.update(Buffer.from(s.ciphertext, "base64")), d.final()]);
  return JSON.parse(pt.toString("utf8")) as T;
}

export const currentKeyVersion = () => getRing().current;
export const resetKeyRingForTests = () => { ring = null; };
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const newId = () => crypto.randomUUID();
