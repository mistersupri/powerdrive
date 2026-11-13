import path from "node:path";
import fs from "node:fs";
import type { ConnectionStatus, Permission, ProviderType, StorageConnectionDto } from "@superdrive/shared";
import { config } from "../config.ts";
import { db, now } from "../db.ts";
import { audit, notify } from "../lib/audit.ts";
import { newId } from "../lib/crypto.ts";
import { AppError, badRequest, conflict, notFound } from "../lib/errors.ts";
import { assertSafeEndpoint } from "../lib/ssrf.ts";
import { DropboxProvider } from "../providers/dropbox.ts";
import { GoogleDriveProvider } from "../providers/google.ts";
import { LocalProvider } from "../providers/local.ts";
import { loadCredential, saveCredential, TokenSource, type OAuthSlug } from "../providers/oauth.ts";
import { OneDriveProvider } from "../providers/onedrive.ts";
import { S3Provider, type S3Config, type S3Credentials } from "../providers/s3.ts";
import { ProviderError, ROOT, type StorageProvider } from "../providers/types.ts";
import { permissionsFor, type AuthCtx } from "./permissions.ts";
import { slugify } from "./auth.ts";

const providers = new Map<string, StorageProvider>();
export const dropProvider = (id: string) => providers.delete(id);

export function setStatus(storageId: string, status: ConnectionStatus, error: string | null = null) {
  const row = db.get<any>("SELECT workspace_id, name, status FROM storages WHERE id = ?", storageId);
  if (!row) return;
  db.run("UPDATE storages SET status = ?, last_error = ?, updated_at = ? WHERE id = ?", status, error, now(), storageId);
  if (status === "REAUTH_REQUIRED" && row.status !== status) {
    for (const m of db.all<any>("SELECT user_id FROM memberships WHERE workspace_id = ? AND role IN ('OWNER','ADMIN')", row.workspace_id)) {
      notify(row.workspace_id, m.user_id, "oauth.expired", "Otorisasi penyimpanan berakhir", `“${row.name}” perlu dihubungkan ulang.`, { storageId });
    }
  }
}

/** Build (and cache) the adapter for a storage row. */
export function providerFor(row: any): StorageProvider {
  if (row.status === "DISABLED") throw new AppError(409, "STORAGE_DISABLED", "Penyimpanan ini dinonaktifkan.");
  if (row.status === "REAUTH_REQUIRED") throw new AppError(409, "STORAGE_CONNECTION_EXPIRED", "Otorisasi penyimpanan telah berakhir. Hubungkan ulang.");
  const cached = providers.get(row.id);
  if (cached) return cached;
  const cfg = row.config ? JSON.parse(row.config) : {};
  let p: StorageProvider;
  const onAuthFailure = (m: string) => { providers.delete(row.id); setStatus(row.id, "REAUTH_REQUIRED", m); };
  switch (row.provider as ProviderType) {
    case "LOCAL": p = new LocalProvider(assertLocalRoot(cfg.root), row.name); break;
    case "S3": p = new S3Provider(cfg as S3Config, loadCredential<S3Credentials>(row.credential_id)); break;
    case "GOOGLE_DRIVE": p = new GoogleDriveProvider(new TokenSource("google-drive", row.credential_id, onAuthFailure)); break;
    case "ONEDRIVE": p = new OneDriveProvider(new TokenSource("onedrive", row.credential_id, onAuthFailure)); break;
    case "DROPBOX": p = new DropboxProvider(new TokenSource("dropbox", row.credential_id, onAuthFailure)); break;
    default: throw new AppError(400, "PROVIDER_UNSUPPORTED", `Penyedia ${row.provider} belum didukung.`);
  }
  providers.set(row.id, p);
  return p;
}

/** Translate adapter failures into API errors without leaking provider internals. */
export function mapProviderError(e: unknown, storageId?: string): never {
  if (e instanceof AppError) throw e;
  if (e instanceof ProviderError) {
    switch (e.kind) {
      case "not_found": throw new AppError(404, "NOT_FOUND", "File atau folder tidak ditemukan di penyimpanan.");
      case "auth":
        if (storageId) { providers.delete(storageId); const r = db.get<any>("SELECT provider FROM storages WHERE id = ?", storageId); if (r && r.provider !== "LOCAL") setStatus(storageId, "REAUTH_REQUIRED", e.message); }
        throw new AppError(409, "STORAGE_CONNECTION_EXPIRED", e.message);
      case "conflict": throw new AppError(409, "NAME_CONFLICT", e.message);
      case "quota": throw new AppError(507, "DESTINATION_QUOTA_EXCEEDED", e.message);
      case "rate": throw new AppError(429, "PROVIDER_RATE_LIMITED", "Penyedia penyimpanan membatasi permintaan. Coba lagi sebentar lagi.");
      case "unsupported": throw new AppError(400, "UNSUPPORTED", e.message);
      case "network": throw new AppError(502, "PROVIDER_UNAVAILABLE", "Tidak dapat menghubungi penyedia penyimpanan.");
      default: throw new AppError(502, "PROVIDER_ERROR", e.message);
    }
  }
  throw e;
}

export function assertLocalRoot(root: unknown): string {
  if (typeof root !== "string" || !root.trim()) throw badRequest("Folder wajib diisi.");
  const abs = path.resolve(config.localRoots[0]!, root);
  const ok = config.localRoots.some((r) => abs === r || abs.startsWith(r + path.sep));
  if (!ok) throw badRequest(`Folder harus berada di dalam direktori yang diizinkan: ${config.localRoots.join(", ")}`, "PATH_NOT_ALLOWED");
  fs.mkdirSync(abs, { recursive: true });
  // Resolve symlinks so a link inside an allowed root cannot point outside it.
  const real = fs.realpathSync(abs);
  const realRoots = config.localRoots.map((r) => { try { return fs.realpathSync(r); } catch { return r; } });
  if (!realRoots.some((r) => real === r || real.startsWith(r + path.sep))) throw badRequest("Folder keluar dari direktori yang diizinkan.", "PATH_NOT_ALLOWED");
  return real;
}

export function toDto(row: any, ctx: AuthCtx): StorageConnectionDto {
  const mount = db.get<any>("SELECT id, virtual_path, enabled FROM mounts WHERE storage_id = ? ORDER BY created_at LIMIT 1", row.id);
  return {
    id: row.id, workspaceId: row.workspace_id, provider: row.provider, name: row.name, accountEmail: row.account_email, status: row.status,
    lastError: row.last_error, lastConnectedAt: row.last_connected_at, capabilities: row.capabilities ? JSON.parse(row.capabilities) : ({} as any),
    // Unknown quota stays null — it must never be shown as zero.
    quota: row.quota_used === null && row.quota_total === null ? null : { used: row.quota_used, total: row.quota_total },
    mount: mount ? { id: mount.id, virtualPath: mount.virtual_path, enabled: !!mount.enabled } : null,
    rootFolderId: ROOT, permissions: permissionsFor(ctx, row.id) as Permission[],
  };
}

export function uniqueMountPath(workspaceId: string, name: string) {
  const base = `/storage/${slugify(name)}`; let p = base; let i = 1;
  while (db.get("SELECT 1 FROM mounts WHERE workspace_id = ? AND virtual_path = ?", workspaceId, p)) p = `${base}-${++i}`;
  return p;
}

/** Inserts a connection plus its default mount in one transaction. */
export async function createConnection(ctx: AuthCtx, input: {
  provider: ProviderType; name: string; config?: unknown; credential?: { type: string; payload: unknown } | { id: string };
}) {
  const id = newId();
  const credentialId = input.credential ? ("id" in input.credential ? input.credential.id : saveCredential(input.credential.type, input.credential.payload)) : null;
  db.run("INSERT INTO storages(id,workspace_id,provider,name,status,credential_id,config) VALUES (?,?,?,?,?,?,?)",
    id, ctx.workspaceId, input.provider, input.name, "DISCONNECTED", credentialId, input.config ? JSON.stringify(input.config) : null);
  try { await testConnection(id); }
  catch (e) {
    db.run("DELETE FROM storages WHERE id = ?", id);
    if (credentialId && !(input.credential && "id" in input.credential)) db.run("DELETE FROM credentials WHERE id = ?", credentialId);
    throw e;
  }
  db.run("INSERT INTO mounts(id,workspace_id,storage_id,name,virtual_path,root_folder_id) VALUES (?,?,?,?,?,?)",
    newId(), ctx.workspaceId, id, input.name, uniqueMountPath(ctx.workspaceId, input.name), ROOT);
  audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "storage.connect", resourceType: "storage", resourceId: id, metadata: { provider: input.provider, name: input.name }, ip: ctx.ip });
  return db.get<any>("SELECT * FROM storages WHERE id = ?", id)!;
}

/** Contacts the provider, then records account info, quota and capabilities. */
export async function testConnection(storageId: string) {
  const row = db.get<any>("SELECT * FROM storages WHERE id = ?", storageId);
  if (!row) throw notFound();
  providers.delete(storageId);
  const probe = { ...row, status: row.status === "DISABLED" ? "DISABLED" : "DISCONNECTED" };
  try {
    if (row.provider === "S3") await assertSafeEndpoint(JSON.parse(row.config).endpoint ?? "https://s3.amazonaws.com");
    const p = providerFor(probe);
    const acct = await p.account();
    db.run(
      `UPDATE storages SET status = 'CONNECTED', last_error = NULL, account_id = ?, account_email = ?, quota_used = ?, quota_total = ?,
        capabilities = ?, last_connected_at = ?, updated_at = ? WHERE id = ?`,
      acct.id, acct.email, acct.quota?.used ?? null, acct.quota?.total ?? null, JSON.stringify(p.capabilities), now(), now(), storageId);
    return acct;
  } catch (e) {
    providers.delete(storageId);
    const msg = e instanceof Error ? e.message : String(e);
    const reauth = e instanceof ProviderError && e.kind === "auth" && row.provider !== "LOCAL" && row.provider !== "S3";
    db.run("UPDATE storages SET status = ?, last_error = ?, updated_at = ? WHERE id = ?", reauth ? "REAUTH_REQUIRED" : "ERROR", msg, now(), storageId);
    mapProviderError(e);
  }
}

export function deleteConnection(ctx: AuthCtx, storageId: string) {
  const row = db.get<any>("SELECT * FROM storages WHERE id = ? AND workspace_id = ?", storageId, ctx.workspaceId);
  if (!row) throw notFound("Penyimpanan tidak ditemukan.");
  const busy = db.get("SELECT 1 FROM transfer_jobs WHERE (source_storage_id = ? OR destination_storage_id = ?) AND status IN ('QUEUED','VALIDATING','RUNNING','RETRYING','VERIFYING')", storageId, storageId);
  if (busy) throw conflict("Masih ada transfer aktif pada penyimpanan ini.", "STORAGE_BUSY");
  // Only local records are removed. Files on the provider are never touched.
  db.tx(() => {
    db.run("DELETE FROM storages WHERE id = ?", storageId);
    if (row.credential_id) db.run("DELETE FROM credentials WHERE id = ?", row.credential_id);
  });
  providers.delete(storageId);
  audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "storage.disconnect", resourceType: "storage", resourceId: storageId, metadata: { provider: row.provider, name: row.name }, ip: ctx.ip });
}

