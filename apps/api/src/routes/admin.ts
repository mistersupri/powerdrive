import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { z } from "zod";
import { clearSessionCache, ok, requireAuth } from "../app.ts";
import { config } from "../config.ts";
import { audit } from "../lib/audit.ts";
import { forbidden, badRequest, notFound } from "../lib/errors.ts";
import { sendTestMail } from "../lib/mailer.ts";
import { sweepRetention } from "../modules/retention.ts";
import { getSettings, publicBranding, setIconVersion, settingsDto, updateSettings } from "../modules/settings.ts";

const dir = () => path.join(config.dataDir, "branding");
const SIZES = [32, 192, 512] as const;

export async function adminRoutes(app: FastifyInstance) {
  const superAdmin = (req: any) => { const ctx = requireAuth(req); if (!ctx.isSuperAdmin) throw forbidden("Hanya administrator sistem yang bisa mengubah pengaturan ini."); return ctx; };

  /* ---- public: what the sign-in page, favicon and install manifest need ---- */
  app.get("/branding", async (req, reply) => { reply.header("cache-control", "no-cache"); return ok(req, publicBranding()); });
  app.get("/branding/icon/:size", async (req, reply) => {
    const size = Number((req.params as any).size); if (!SIZES.includes(size as any)) throw notFound("Ikon tidak ditemukan.");
    const file = path.join(dir(), `icon-${size}.png`); if (!fs.existsSync(file)) throw notFound("Belum ada ikon kustom.");
    return reply.header("content-type", "image/png").header("cache-control", "public, max-age=31536000, immutable").header("x-content-type-options", "nosniff").send(fs.createReadStream(file));
  });

  /* ---- super admin ---- */
  app.get("/admin/settings", async (req) => { superAdmin(req); return ok(req, settingsDto()); });
  app.patch("/admin/settings", async (req) => {
    const ctx = superAdmin(req); const before = getSettings();
    const next = updateSettings(req.body); clearSessionCache();
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(before[k]));
    audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "admin.settings", resourceType: "settings", metadata: { sections: changed }, ip: ctx.ip });
    return ok(req, settingsDto(next));
  });
  app.post("/admin/email/test", async (req) => { superAdmin(req); await sendTestMail(z.object({ to: z.string().email() }).parse(req.body).to); return ok(req, {}); });
  app.post("/admin/retention/run", async (req) => { const ctx = superAdmin(req); const r = sweepRetention(); audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "admin.retention_run", resourceType: "settings", metadata: r, ip: ctx.ip }); return ok(req, r); });

  // App icon: any common image, normalised to square PNGs (favicon, install icon). The decode is the validation.
  app.addContentTypeParser(["image/png", "image/jpeg", "image/webp", "image/x-icon", "image/vnd.microsoft.icon"], { parseAs: "buffer", bodyLimit: 2 * 1024 * 1024 }, (_req, body, done) => done(null, body));
  app.put("/admin/branding/icon", async (req) => {
    const ctx = superAdmin(req); const buf = req.body as Buffer; if (!Buffer.isBuffer(buf) || buf.length < 100) throw badRequest("Kirim berkas gambar PNG, JPG, WebP, atau ICO (maks. 2 MB).");
    let meta; try { meta = await sharp(buf, { failOn: "error", limitInputPixels: 50_000_000 }).metadata(); } catch { throw badRequest("Berkas ini bukan gambar yang valid."); }
    if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < 128) throw badRequest("Gambar terlalu kecil. Minimal 128 × 128 piksel.");
    await fsp.mkdir(dir(), { recursive: true });
    for (const s of SIZES) await sharp(buf).resize(s, s, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toFile(path.join(dir(), `icon-${s}.png`));
    setIconVersion(Date.now());
    audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "admin.icon_set", resourceType: "settings", ip: ctx.ip });
    return ok(req, publicBranding());
  });
  app.delete("/admin/branding/icon", async (req) => {
    const ctx = superAdmin(req); await fsp.rm(dir(), { recursive: true, force: true }); setIconVersion(0);
    audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "admin.icon_reset", resourceType: "settings", ip: ctx.ip });
    return ok(req, publicBranding());
  });
}
