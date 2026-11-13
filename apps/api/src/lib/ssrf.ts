import dns from "node:dns/promises";
import net from "node:net";
import { config } from "../config.ts";
import { badRequest } from "./errors.ts";

function isPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
}

/**
 * Validates a user-supplied endpoint before the server connects to it. Resolves DNS and
 * rejects private, loopback, link-local and cloud-metadata targets unless an administrator
 * explicitly opted in with ALLOW_PRIVATE_HOSTS=true (needed for a NAS on the LAN).
 */
export async function assertSafeHost(hostRaw: string, port: number): Promise<void> {
  const host = hostRaw.replace(/^\[|\]$/g, "");
  if (!host || /[\s/\\@]/.test(host)) throw badRequest("Alamat host tidak valid.", "INVALID_ENDPOINT");
  if (host === "metadata.google.internal") throw badRequest("Host tidak diizinkan.", "INVALID_ENDPOINT");
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => { throw badRequest("Host tidak dapat ditemukan.", "INVALID_ENDPOINT"); })).map((a) => a.address);
  if (addrs.some((a) => a === "169.254.169.254" || a.startsWith("fd00:ec2"))) throw badRequest("Host tidak diizinkan.", "INVALID_ENDPOINT");
  if (!config.allowPrivateHosts && addrs.some(isPrivate)) throw badRequest("Alamat jaringan internal diblokir. Administrator dapat mengizinkannya dengan ALLOW_PRIVATE_HOSTS=true.", "INVALID_ENDPOINT");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw badRequest("Port tidak valid.", "INVALID_ENDPOINT");
}

export async function assertSafeEndpoint(raw: string): Promise<void> {
  let u: URL;
  try { u = new URL(raw); } catch { throw badRequest("Alamat endpoint tidak valid.", "INVALID_ENDPOINT"); }
  if (u.protocol !== "https:" && !(config.allowPrivateHosts && u.protocol === "http:")) throw badRequest("Endpoint harus memakai HTTPS.", "INVALID_ENDPOINT");
  if (u.username || u.password) throw badRequest("Endpoint tidak boleh memuat kredensial.", "INVALID_ENDPOINT");
  const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
  if (port < 1024 && port !== 80 && port !== 443) throw badRequest("Port endpoint tidak diizinkan.", "INVALID_ENDPOINT");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "metadata.google.internal") throw badRequest("Host tidak diizinkan.", "INVALID_ENDPOINT");
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => { throw badRequest("Host endpoint tidak dapat ditemukan.", "INVALID_ENDPOINT"); })).map((a) => a.address);
  if (addrs.some((a) => a === "169.254.169.254" || a.startsWith("fd00:ec2"))) throw badRequest("Host tidak diizinkan.", "INVALID_ENDPOINT");
  if (!config.allowPrivateHosts && addrs.some(isPrivate)) {
    throw badRequest("Alamat jaringan internal diblokir. Administrator dapat mengizinkannya dengan ALLOW_PRIVATE_HOSTS=true.", "INVALID_ENDPOINT");
  }
}
