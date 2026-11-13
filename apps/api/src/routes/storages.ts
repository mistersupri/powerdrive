import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.ts";
import { db, now } from "../db.ts";
import { ok, requireAuth } from "../app.ts";
import { audit } from "../lib/audit.ts";
import { newId } from "../lib/crypto.ts";
import { AppError, badRequest, conflict, notFound } from "../lib/errors.ts";
import { assertSafeEndpoint } from "../lib/ssrf.ts";
import { requireRole, requireStorage, permissionsFor, type AuthCtx } from "../modules/permissions.ts";
import { assertLocalRoot, createConnection, deleteConnection, dropProvider, mapProviderError, setStatus, testConnection, toDto, uniqueMountPath } from "../modules/storages.ts";
import { buildAuthUrl, consumeState, exchangeCode, oauthConfigured, oauthDef, saveCredential, SLUG_TO_PROVIDER, type OAuthSlug } from "../providers/oauth.ts";
import { providerFor } from "../modules/storages.ts";
import { ALL_PERMISSIONS } from "@superdrive/shared";
import { indexInfo, scheduleIndex } from "../modules/indexer.ts";
import { smbAvailable } from "../providers/smb.ts";
import { assertSafeHost } from "../lib/ssrf.ts";

const slugSchema = z.enum(["google-drive", "onedrive", "dropbox"]);

export async function storageRoutes(app: FastifyInstance) {
  app.get("/storages", async (req) => {
    const ctx = requireAuth(req);
    const rows = db.all<any>("SELECT * FROM storages WHERE workspace_id = ? ORDER BY created_at", ctx.workspaceId);
    return ok(req, rows.filter((r) => permissionsFor(ctx, r.id).includes("READ")).map((r) => toDto(r, ctx)));
  });

  app.get("/storages/providers", async (req) => {
    requireAuth(req);
    const smb = await smbAvailable();
    return ok(req, [
      ...(["google-drive", "onedrive", "dropbox"] as const).map((slug) => ({ slug, provider: SLUG_TO_PROVIDER[slug], label: oauthDef(slug).label, kind: "oauth", configured: oauthConfigured(slug), available: true })),
      { slug: "local", provider: "LOCAL", label: "Folder server", kind: "local", configured: true, available: true, roots: config.localRoots },
      { slug: "s3", provider: "S3", label: "S3 / MinIO / R2 / B2", kind: "s3", configured: true, available: true },
      { slug: "sftp", provider: "SFTP", label: "SFTP", kind: "sftp", configured: true, available: true },
      { slug: "webdav", provider: "WEBDAV", label: "WebDAV", kind: "webdav", configured: true, available: true },
      { slug: "smb", provider: "SMB", label: "SMB / NAS", kind: "smb", configured: smb, available: smb, note: smb ? undefined : "Butuh paket smbclient di server SuperDrive" },
    ]);
  });

  // Start OAuth: returns the provider URL for the browser to visit.
  app.post("/storages/:provider/connect", async (req) => {
    const ctx = requireAuth(req); requireRole(ctx, "ADMIN");
    const slug = slugSchema.parse((req.params as any).provider);
    const b = z.object({ name: z.string().trim().min(1).max(80).optional(), reconnectStorageId: z.string().optional() }).parse(req.body ?? {});
    if (b.reconnectStorageId) requireStorage(ctx, b.reconnectStorageId, "MANAGE_STORAGE");
    try { return ok(req, { url: buildAuthUrl(slug, { userId: ctx.userId, workspaceId: ctx.workspaceId, name: b.name, reconnectStorageId: b.reconnectStorageId }) }); }
    catch (e) { mapProviderError(e); }
  });

  // OAuth callback. The state value ties it to the user and workspace that started the flow.
  app.get("/storages/:provider/callback", async (req, reply) => {
    const slug = slugSchema.parse((req.params as any).provider) as OAuthSlug;
    const q = req.query as Record<string, string>;
    const back = (params: Record<string, string>) => reply.redirect(`${config.appUrl}/storage?${new URLSearchParams(params)}`);
    if (q.error) return back({ error: q.error_description || q.error });
    const st = q.state ? consumeState(q.state) : null;
    if (!st || st.provider !== slug || !q.code) return back({ error: "Sesi otorisasi tidak valid atau sudah kedaluwarsa. Coba lagi." });
    // The browser that returns must be the same logged-in user who started it.
    const ctx = (() => { try { return requireAuth(req); } catch { return null; } })();
    if (!ctx || ctx.userId !== st.user_id) return back({ error: "Masuk dengan akun yang sama yang memulai penghubungan." });
    try {
      const tokens = await exchangeCode(slug, q.code, st.code_verifier);
      const ws: AuthCtx = { ...ctx, workspaceId: st.workspace_id, role: db.get<any>("SELECT role FROM memberships WHERE user_id = ? AND workspace_id = ?", ctx.userId, st.workspace_id)?.role ?? "VIEWER" };
      requireRole(ws, "ADMIN");
      if (st.reconnect_storage_id) {
        const row = db.get<any>("SELECT * FROM storages WHERE id = ? AND workspace_id = ?", st.reconnect_storage_id, st.workspace_id);
        if (!row) throw notFound();
        saveCredential("oauth", tokens, row.credential_id);
        dropProvider(row.id);
        await testConnection(row.id);
        audit({ workspaceId: ws.workspaceId, userId: ws.userId, action: "storage.reconnect", resourceType: "storage", resourceId: row.id, ip: ctx.ip });
        return back({ connected: row.id });
      }
      const label = oauthDef(slug).label;
      const name = st.name || `${label} ${db.get<{ n: number }>("SELECT COUNT(*) n FROM storages WHERE workspace_id = ? AND provider = ?", st.workspace_id, SLUG_TO_PROVIDER[slug])!.n + 1}`;
      const row = await createConnection(ws, { provider: SLUG_TO_PROVIDER[slug], name, credential: { type: "oauth", payload: tokens } });
      return back({ connected: row.id });
    } catch (e) {
      return back({ error: e instanceof AppError || e instanceof Error ? e.message : "Gagal menghubungkan penyimpanan." });
    }
  });

  // Local folder and S3-compatible connections (credentials typed in by an admin).
  app.post("/storages", async (req) => {
    const ctx = requireAuth(req); requireRole(ctx, "ADMIN");
    const b = z.discriminatedUnion("provider", [
      z.object({ provider: z.literal("LOCAL"), name: z.string().trim().min(1).max(80), root: z.string().min(1) }),
      z.object({ provider: z.literal("SFTP"), name: z.string().trim().min(1).max(80), host: z.string().min(1), port: z.number().int().min(1).max(65535).default(22), username: z.string().min(1),
        password: z.string().optional(), privateKey: z.string().optional(), passphrase: z.string().optional(), baseDir: z.string().default("/"), hostKey: z.string().regex(/^SHA256:[A-Za-z0-9+/]+$/, "Sidik jari harus berformat SHA256:…").optional().or(z.literal("")) }),
      z.object({ provider: z.literal("WEBDAV"), name: z.string().trim().min(1).max(80), url: z.string().url(), username: z.string().optional(), password: z.string().optional() }),
      z.object({ provider: z.literal("SMB"), name: z.string().trim().min(1).max(80), host: z.string().min(1), port: z.number().int().min(1).max(65535).default(445), share: z.string().min(1).regex(/^[^\\/:*?"<>|]+$/, "Nama share tidak valid"),
        baseDir: z.string().default(""), domain: z.string().optional(), username: z.string().min(1), password: z.string().min(1), encrypt: z.boolean().optional() }),
      z.object({
        provider: z.literal("S3"), name: z.string().trim().min(1).max(80), endpoint: z.string().url().optional().or(z.literal("")), region: z.string().min(1).default("auto"),
        bucket: z.string().min(1), prefix: z.string().optional(), accessKeyId: z.string().min(1), secretAccessKey: z.string().min(1), forcePathStyle: z.boolean().optional(),
      }),
    ]).parse(req.body);
    if (b.provider === "LOCAL") {
      const root = assertLocalRoot(b.root);
      const row = await createConnection(ctx, { provider: "LOCAL", name: b.name, config: { root } });
      return ok(req, toDto(row, ctx));
    }
    if (b.provider === "SFTP") {
      if (!b.password && !b.privateKey) throw badRequest("Isi password atau kunci privat.");
      await assertSafeHost(b.host, b.port);
      const row = await createConnection(ctx, { provider: "SFTP", name: b.name, config: { host: b.host, port: b.port, username: b.username, baseDir: b.baseDir, hostKey: b.hostKey || undefined },
        credential: { type: "sftp", payload: { password: b.password || undefined, privateKey: b.privateKey || undefined, passphrase: b.passphrase || undefined } } });
      return ok(req, toDto(db.get<any>("SELECT * FROM storages WHERE id = ?", row.id), ctx));
    }
    if (b.provider === "WEBDAV") {
      await assertSafeEndpoint(b.url);
      const row = await createConnection(ctx, { provider: "WEBDAV", name: b.name, config: { url: b.url }, credential: { type: "webdav", payload: { username: b.username || undefined, password: b.password || undefined } } });
      return ok(req, toDto(row, ctx));
    }
    if (b.provider === "SMB") {
      if (!(await smbAvailable())) throw badRequest("Paket smbclient belum terpasang di server SuperDrive.", "SMB_UNAVAILABLE");
      await assertSafeHost(b.host, b.port);
      const row = await createConnection(ctx, { provider: "SMB", name: b.name, config: { host: b.host, port: b.port, share: b.share, baseDir: b.baseDir, domain: b.domain || undefined, encrypt: b.encrypt },
        credential: { type: "smb", payload: { username: b.username, password: b.password } } });
      return ok(req, toDto(db.get<any>("SELECT * FROM storages WHERE id = ?", row.id), ctx));
    }
    if (b.endpoint) await assertSafeEndpoint(b.endpoint);
    const row = await createConnection(ctx, {
      provider: "S3", name: b.name, config: { endpoint: b.endpoint || undefined, region: b.region, bucket: b.bucket, prefix: b.prefix, forcePathStyle: b.forcePathStyle ?? !!b.endpoint },
      credential: { type: "s3", payload: { accessKeyId: b.accessKeyId, secretAccessKey: b.secretAccessKey } },
    });
    return ok(req, toDto(row, ctx));
  });

  app.get("/storages/:id", async (req) => {
    const ctx = requireAuth(req);
    const row = requireStorage(ctx, (req.params as any).id, "READ");
    return ok(req, toDto(row, ctx));
  });

  app.patch("/storages/:id", async (req) => {
    const ctx = requireAuth(req);
    const id = (req.params as any).id;
    const row = requireStorage(ctx, id, "MANAGE_STORAGE");
    const b = z.object({ name: z.string().trim().min(1).max(80).optional(), enabled: z.boolean().optional() }).parse(req.body);
    if (b.name) db.run("UPDATE storages SET name = ?, updated_at = ? WHERE id = ?", b.name, now(), id);
    if (row.is_default && (b.enabled === false)) throw badRequest("Penyimpanan bawaan tidak dapat dinonaktifkan.");
    if (b.enabled === false) { setStatus(id, "DISABLED"); dropProvider(id); }
    if (b.enabled === true && row.status === "DISABLED") { db.run("UPDATE storages SET status = 'DISCONNECTED' WHERE id = ?", id); await testConnection(id).catch(() => {}); }
    audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "storage.update", resourceType: "storage", resourceId: id, metadata: b, ip: ctx.ip });
    return ok(req, toDto(db.get<any>("SELECT * FROM storages WHERE id = ?", id), ctx));
  });

  // Re-crawl a storage so global search sees everything in it.
  app.post("/storages/:id/reindex", async (req) => {
    const ctx = requireAuth(req); requireRole(ctx, "ADMIN");
    const id = (req.params as any).id; requireStorage(ctx, id, "MANAGE_STORAGE");
    scheduleIndex(id);
    return ok(req, indexInfo(id));
  });

  app.post("/storages/:id/test", async (req) => {
    const ctx = requireAuth(req);
    const id = (req.params as any).id;
    requireStorage(ctx, id, "MANAGE_STORAGE");
    await testConnection(id);
    return ok(req, toDto(db.get<any>("SELECT * FROM storages WHERE id = ?", id), ctx));
  });

  app.post("/storages/:id/reconnect", async (req) => {
    const ctx = requireAuth(req);
    const row = requireStorage(ctx, (req.params as any).id, "MANAGE_STORAGE");
    const slug = ({ GOOGLE_DRIVE: "google-drive", ONEDRIVE: "onedrive", DROPBOX: "dropbox" } as Record<string, OAuthSlug>)[row.provider];
    if (!slug) { await testConnection(row.id); return ok(req, { url: null, storage: toDto(db.get<any>("SELECT * FROM storages WHERE id = ?", row.id), ctx) }); }
    return ok(req, { url: buildAuthUrl(slug, { userId: ctx.userId, workspaceId: ctx.workspaceId, reconnectStorageId: row.id }) });
  });

  // Removes the connection only. Nothing on the provider is deleted.
  app.delete("/storages/:id", async (req) => {
    const ctx = requireAuth(req);
    requireStorage(ctx, (req.params as any).id, "MANAGE_STORAGE");
    deleteConnection(ctx, (req.params as any).id);
    return ok(req, {});
  });

  /* ---- per-storage permissions ---- */
  app.get("/storages/:id/permissions", async (req) => {
    const ctx = requireAuth(req); requireRole(ctx, "ADMIN");
    requireStorage(ctx, (req.params as any).id, "MANAGE_STORAGE");
    return ok(req, db.all<any>("SELECT id, user_id AS userId, role, permissions FROM storage_permissions WHERE storage_id = ?", (req.params as any).id).map((r) => ({ ...r, permissions: JSON.parse(r.permissions) })));
  });
  app.put("/storages/:id/permissions", async (req) => {
    const ctx = requireAuth(req); requireRole(ctx, "ADMIN");
    const id = (req.params as any).id;
    requireStorage(ctx, id, "MANAGE_STORAGE");
    const b = z.object({ userId: z.string().nullable().optional(), role: z.enum(["MEMBER", "VIEWER"]).nullable().optional(), permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])) }).parse(req.body);
    if (!b.userId && !b.role) throw badRequest("Pilih pengguna atau peran.");
    if (b.userId && !db.get("SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?", ctx.workspaceId, b.userId)) throw notFound("Pengguna bukan anggota workspace.");
    db.tx(() => {
      if (b.userId) db.run("DELETE FROM storage_permissions WHERE storage_id = ? AND user_id = ?", id, b.userId);
      else db.run("DELETE FROM storage_permissions WHERE storage_id = ? AND user_id IS NULL AND role = ?", id, b.role!);
      db.run("INSERT INTO storage_permissions(id,storage_id,user_id,role,permissions) VALUES (?,?,?,?,?)", newId(), id, b.userId ?? null, b.userId ? null : b.role!, JSON.stringify([...new Set(b.permissions)]));
    });
    audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "permission.change", resourceType: "storage", resourceId: id, metadata: { target: b.userId ?? b.role, permissions: b.permissions }, ip: ctx.ip });
    return ok(req, {});
  });
  app.delete("/storages/:id/permissions/:permId", async (req) => {
    const ctx = requireAuth(req); requireRole(ctx, "ADMIN");
    requireStorage(ctx, (req.params as any).id, "MANAGE_STORAGE");
    db.run("DELETE FROM storage_permissions WHERE id = ? AND storage_id = ?", (req.params as any).permId, (req.params as any).id);
    return ok(req, {});
  });

  /* ---- virtual mounts ---- */
  const mountDto = (m: any) => ({ id: m.id, storageId: m.storage_id, name: m.name, virtualPath: m.virtual_path, rootFolderId: m.root_folder_id, enabled: !!m.enabled, isFavorite: !!m.is_favorite, createdAt: m.created_at });
  app.get("/mounts", async (req) => {
    const ctx = requireAuth(req);
    return ok(req, db.all<any>("SELECT * FROM mounts WHERE workspace_id = ? ORDER BY name", ctx.workspaceId).filter((m) => permissionsFor(ctx, m.storage_id).includes("READ")).map(mountDto));
  });
  app.post("/mounts", async (req) => {
    const ctx = requireAuth(req);
    const b = z.object({ storageId: z.string(), name: z.string().trim().min(1).max(80), virtualPath: z.string().regex(/^\/storage\/[a-z0-9-]+$/).optional(), rootFolderId: z.string().optional() }).parse(req.body);
    requireStorage(ctx, b.storageId, "MOUNT");
    const path = b.virtualPath ?? uniqueMountPath(ctx.workspaceId, b.name);
    if (db.get("SELECT 1 FROM mounts WHERE workspace_id = ? AND virtual_path = ?", ctx.workspaceId, path)) throw conflict("Path virtual sudah dipakai.", "PATH_TAKEN");
    const id = newId();
    db.run("INSERT INTO mounts(id,workspace_id,storage_id,name,virtual_path,root_folder_id) VALUES (?,?,?,?,?,?)", id, ctx.workspaceId, b.storageId, b.name, path, b.rootFolderId ?? "root");
    audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "mount.create", resourceType: "mount", resourceId: id, metadata: { path }, ip: ctx.ip });
    return ok(req, mountDto(db.get("SELECT * FROM mounts WHERE id = ?", id)));
  });
  const mountOf = (ctx: AuthCtx, id: string) => {
    const m = db.get<any>("SELECT * FROM mounts WHERE id = ? AND workspace_id = ?", id, ctx.workspaceId);
    if (!m) throw notFound("Mount tidak ditemukan.");
    requireStorage(ctx, m.storage_id, "MOUNT");
    return m;
  };
  app.get("/mounts/:id", async (req) => ok(req, mountDto(mountOf(requireAuth(req), (req.params as any).id))));
  app.patch("/mounts/:id", async (req) => {
    const ctx = requireAuth(req); const m = mountOf(ctx, (req.params as any).id);
    const b = z.object({ name: z.string().trim().min(1).max(80).optional(), isFavorite: z.boolean().optional() }).parse(req.body);
    db.run("UPDATE mounts SET name = COALESCE(?, name), is_favorite = COALESCE(?, is_favorite), updated_at = ? WHERE id = ?", b.name ?? null, b.isFavorite === undefined ? null : +b.isFavorite, now(), m.id);
    return ok(req, mountDto(db.get("SELECT * FROM mounts WHERE id = ?", m.id)));
  });
  for (const [verb, val] of [["enable", 1], ["disable", 0]] as const) {
    app.post(`/mounts/:id/${verb}`, async (req) => {
      const ctx = requireAuth(req); const m = mountOf(ctx, (req.params as any).id);
      db.run("UPDATE mounts SET enabled = ?, updated_at = ? WHERE id = ?", val, now(), m.id);
      return ok(req, mountDto(db.get("SELECT * FROM mounts WHERE id = ?", m.id)));
    });
  }
  // Removing a mount only removes the shortcut, never remote files.
  app.delete("/mounts/:id", async (req) => { const ctx = requireAuth(req); const m = mountOf(ctx, (req.params as any).id); db.run("DELETE FROM mounts WHERE id = ?", m.id); return ok(req, {}); });
}
