import crypto from "node:crypto";
import type { ProviderType } from "@superdrive/shared";
import { config } from "../config.ts";
import { db, now } from "../db.ts";
import { newId, open, seal } from "../lib/crypto.ts";
import { json, request } from "./http.ts";
import { ProviderError } from "./types.ts";

export interface TokenBundle { accessToken: string; refreshToken?: string; expiresAt: number; scope?: string }

interface Def {
  label: string; authUrl: string; tokenUrl: string; scopes: string[]; clientId: string; clientSecret: string;
  redirectUri: string; extra: Record<string, string>; pkce: boolean;
}

export type OAuthSlug = "google-drive" | "onedrive" | "dropbox";
export const SLUG_TO_PROVIDER: Record<OAuthSlug, ProviderType> = { "google-drive": "GOOGLE_DRIVE", onedrive: "ONEDRIVE", dropbox: "DROPBOX" };

export function oauthDef(slug: OAuthSlug): Def {
  const o = config.oauth;
  switch (slug) {
    case "google-drive":
      return {
        label: "Google Drive", authUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token",
        // Full drive scope: `drive.file` only exposes files the app created, which cannot power a file manager.
        scopes: ["https://www.googleapis.com/auth/drive", "openid", "email"],
        ...o.google, extra: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" }, pkce: true,
      };
    case "onedrive":
      return {
        label: "OneDrive", authUrl: `https://login.microsoftonline.com/${o.microsoft.tenant}/oauth2/v2.0/authorize`,
        tokenUrl: `https://login.microsoftonline.com/${o.microsoft.tenant}/oauth2/v2.0/token`,
        scopes: ["offline_access", "User.Read", "Files.ReadWrite.All"], clientId: o.microsoft.clientId,
        clientSecret: o.microsoft.clientSecret, redirectUri: o.microsoft.redirectUri, extra: { prompt: "select_account" }, pkce: true,
      };
    case "dropbox":
      return {
        label: "Dropbox", authUrl: "https://www.dropbox.com/oauth2/authorize", tokenUrl: "https://api.dropboxapi.com/oauth2/token",
        scopes: [], ...o.dropbox, extra: { token_access_type: "offline" }, pkce: true,
      };
  }
}
export const oauthConfigured = (slug: OAuthSlug) => { const d = oauthDef(slug); return !!(d.clientId && d.clientSecret); };

export function buildAuthUrl(slug: OAuthSlug, ctx: { userId: string; workspaceId: string; name?: string; reconnectStorageId?: string }) {
  const def = oauthDef(slug);
  if (!def.clientId || !def.clientSecret) throw new ProviderError(`${def.label} belum dikonfigurasi oleh administrator (client id/secret kosong).`, "unsupported");
  const state = crypto.randomBytes(24).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  db.run("DELETE FROM oauth_states WHERE expires_at < ?", now());
  db.run(
    "INSERT INTO oauth_states(state,user_id,workspace_id,provider,code_verifier,name,reconnect_storage_id,expires_at) VALUES (?,?,?,?,?,?,?,?)",
    state, ctx.userId, ctx.workspaceId, slug, verifier, ctx.name ?? null, ctx.reconnectStorageId ?? null, new Date(Date.now() + 10 * 60_000).toISOString(),
  );
  const p = new URLSearchParams({ client_id: def.clientId, redirect_uri: def.redirectUri, response_type: "code", state, ...def.extra });
  if (def.scopes.length) p.set("scope", def.scopes.join(" "));
  if (def.pkce) { p.set("code_challenge", crypto.createHash("sha256").update(verifier).digest("base64url")); p.set("code_challenge_method", "S256"); }
  return `${def.authUrl}?${p}`;
}

/** Validates and consumes a state value (one-time use). */
export function consumeState(state: string) {
  const row = db.get<any>("SELECT * FROM oauth_states WHERE state = ?", state);
  if (!row) return null;
  db.run("DELETE FROM oauth_states WHERE state = ?", state);
  if (row.expires_at < now()) return null;
  return row as { state: string; user_id: string; workspace_id: string; provider: OAuthSlug; code_verifier: string | null; name: string | null; reconnect_storage_id: string | null };
}

function bundleFrom(r: any, prev?: TokenBundle): TokenBundle {
  return {
    accessToken: r.access_token,
    // Providers may rotate refresh tokens; keep the old one only when none is returned.
    refreshToken: r.refresh_token ?? prev?.refreshToken,
    expiresAt: Date.now() + (Number(r.expires_in ?? 3600) - 60) * 1000,
    scope: r.scope,
  };
}

export async function exchangeCode(slug: OAuthSlug, code: string, verifier: string | null): Promise<TokenBundle> {
  const d = oauthDef(slug);
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: d.redirectUri, client_id: d.clientId, client_secret: d.clientSecret });
  if (verifier) body.set("code_verifier", verifier);
  return bundleFrom(await json(d.tokenUrl, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" }, retries: 1 }));
}

async function refresh(slug: OAuthSlug, prev: TokenBundle): Promise<TokenBundle> {
  if (!prev.refreshToken) throw new ProviderError("Token kedaluwarsa dan tidak ada refresh token.", "auth");
  const d = oauthDef(slug);
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: prev.refreshToken, client_id: d.clientId, client_secret: d.clientSecret });
  try {
    return bundleFrom(await json(d.tokenUrl, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" }, retries: 1 }), prev);
  } catch (e) {
    if (e instanceof ProviderError && (e.status === 400 || e.status === 401)) throw new ProviderError("Otorisasi telah dicabut atau kedaluwarsa. Hubungkan ulang penyimpanan.", "auth", e.status);
    throw e;
  }
}

export function saveCredential(type: string, payload: unknown, existingId?: string | null): string {
  const s = seal(payload);
  if (existingId) {
    db.run("UPDATE credentials SET ciphertext=?, iv=?, auth_tag=?, key_version=?, credential_type=?, updated_at=? WHERE id=?",
      s.ciphertext, s.iv, s.authTag, s.keyVersion, type, now(), existingId);
    return existingId;
  }
  const id = newId();
  db.run("INSERT INTO credentials(id,ciphertext,iv,auth_tag,key_version,credential_type) VALUES (?,?,?,?,?,?)", id, s.ciphertext, s.iv, s.authTag, s.keyVersion, type);
  return id;
}
export function loadCredential<T = unknown>(id: string): T {
  const r = db.get<any>("SELECT * FROM credentials WHERE id = ?", id);
  if (!r) throw new ProviderError("Kredensial tidak ditemukan.", "auth");
  return open<T>({ ciphertext: r.ciphertext, iv: r.iv, authTag: r.auth_tag, keyVersion: r.key_version });
}

/** One refresh at a time per storage; the rotated token is persisted before it is used. */
export class TokenSource {
  private inflight: Promise<string> | null = null;
  constructor(private slug: OAuthSlug, private credentialId: string, private onAuthFailure: (msg: string) => void) {}

  async get(): Promise<string> {
    const cur = loadCredential<TokenBundle>(this.credentialId);
    if (cur.expiresAt > Date.now()) return cur.accessToken;
    return (this.inflight ??= this.doRefresh(cur).finally(() => { this.inflight = null; }));
  }
  /** Force a refresh (e.g. after a 401). */
  async invalidate(): Promise<string> {
    const cur = loadCredential<TokenBundle>(this.credentialId);
    return (this.inflight ??= this.doRefresh(cur).finally(() => { this.inflight = null; }));
  }
  private async doRefresh(cur: TokenBundle) {
    try {
      const next = await refresh(this.slug, cur);
      saveCredential("oauth", next, this.credentialId);
      return next.accessToken;
    } catch (e) {
      if (e instanceof ProviderError && e.kind === "auth") this.onAuthFailure(e.message);
      throw e;
    }
  }
}
