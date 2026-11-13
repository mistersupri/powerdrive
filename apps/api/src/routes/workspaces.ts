import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.ts";
import { db, now } from "../db.ts";
import { ok, requireAuth } from "../app.ts";
import { audit } from "../lib/audit.ts";
import { newId, randomToken, sha256 } from "../lib/crypto.ts";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.ts";
import { createWorkspace, roleRank } from "../modules/auth.ts";
import { requireRole } from "../modules/permissions.ts";
import type { MemberDto, WorkspaceRole } from "@superdrive/shared";

const roleEnum = z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);

export async function workspaceRoutes(app: FastifyInstance) {
  // Workspace-scoped routes act on the id in the URL, which must be one the caller belongs to.
  const member = (req: any) => {
    req.headers["x-workspace-id"] = req.params.id;
    return requireAuth(req);
  };

  app.get("/", async (req) => {
    const ctx = requireAuth(req);
    return ok(req, db.all("SELECT w.id, w.name, w.slug, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY m.created_at", ctx.userId));
  });

  app.post("/", async (req) => {
    const ctx = requireAuth(req);
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
    const id = createWorkspace(name, ctx.userId);
    audit({ workspaceId: id, userId: ctx.userId, action: "workspace.create", resourceType: "workspace", resourceId: id, ip: ctx.ip });
    return ok(req, db.get("SELECT id, name, slug, 'OWNER' AS role FROM workspaces WHERE id = ?", id));
  });

  app.get("/:id", async (req) => {
    const ctx = member(req);
    return ok(req, { ...db.get<any>("SELECT id, name, slug FROM workspaces WHERE id = ?", ctx.workspaceId), role: ctx.role });
  });

  app.patch("/:id", async (req) => {
    const ctx = member(req); requireRole(ctx, "ADMIN");
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
    db.run("UPDATE workspaces SET name = ? WHERE id = ?", name, ctx.workspaceId);
    return ok(req, db.get("SELECT id, name, slug FROM workspaces WHERE id = ?", ctx.workspaceId));
  });

  app.get("/:id/members", async (req) => {
    const ctx = member(req);
    const rows = db.all<any>("SELECT u.id, u.name, u.email, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.created_at", ctx.workspaceId);
    const members: MemberDto[] = rows.map((r) => ({ userId: r.id, name: r.name, email: r.email, role: r.role, createdAt: r.created_at }));
    const invitations = ctx.role === "OWNER" || ctx.role === "ADMIN"
      ? db.all("SELECT id, email, role, expires_at AS expiresAt, created_at AS createdAt FROM invitations WHERE workspace_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC", ctx.workspaceId, now()) : [];
    return ok(req, { members, invitations });
  });

  app.post("/:id/invitations", async (req) => {
    const ctx = member(req); requireRole(ctx, "ADMIN");
    const b = z.object({ email: z.string().email(), role: roleEnum.default("MEMBER") }).parse(req.body);
    if (b.role === "OWNER" && ctx.role !== "OWNER") throw forbidden("Hanya pemilik yang dapat mengundang pemilik lain.");
    if (db.get("SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND u.email = ?", ctx.workspaceId, b.email.toLowerCase()))
      throw conflict("Pengguna ini sudah menjadi anggota.", "ALREADY_MEMBER");
    const token = randomToken(24);
    db.run("INSERT INTO invitations(id,workspace_id,email,role,token_hash,expires_at) VALUES (?,?,?,?,?,?)",
      newId(), ctx.workspaceId, b.email.toLowerCase(), b.role, sha256(token), new Date(Date.now() + 7 * 86_400_000).toISOString());
    audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "member.invite", resourceType: "invitation", metadata: { email: b.email, role: b.role }, ip: ctx.ip });
    // The link is shown once to the inviter; only its hash is stored.
    return ok(req, { link: `${config.appUrl}/register?invitation=${token}&email=${encodeURIComponent(b.email)}`, expiresInDays: 7 });
  });

  app.delete("/:id/invitations/:inviteId", async (req) => {
    const ctx = member(req); requireRole(ctx, "ADMIN");
    db.run("DELETE FROM invitations WHERE id = ? AND workspace_id = ?", (req.params as any).inviteId, ctx.workspaceId);
    return ok(req, {});
  });

  app.patch("/:id/members/:userId", async (req) => {
    const ctx = member(req); requireRole(ctx, "ADMIN");
    const { userId } = req.params as any;
    const { role } = z.object({ role: roleEnum }).parse(req.body);
    const target = db.get<any>("SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?", ctx.workspaceId, userId);
    if (!target) throw notFound("Anggota tidak ditemukan.");
    // Admins cannot touch owners or grant ownership — that would be privilege escalation.
    if ((roleRank[target.role as WorkspaceRole] >= roleRank.OWNER || role === "OWNER") && ctx.role !== "OWNER") throw forbidden("Hanya pemilik yang dapat mengubah peran pemilik.");
    if (target.role === "OWNER" && role !== "OWNER" && db.get<{ n: number }>("SELECT COUNT(*) n FROM memberships WHERE workspace_id = ? AND role = 'OWNER'", ctx.workspaceId)!.n <= 1)
      throw badRequest("Workspace harus memiliki minimal satu pemilik.");
    db.run("UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?", role, ctx.workspaceId, userId);
    audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "member.role_change", resourceType: "user", resourceId: userId, metadata: { from: target.role, to: role }, ip: ctx.ip });
    return ok(req, {});
  });

  app.delete("/:id/members/:userId", async (req) => {
    const ctx = member(req);
    const { userId } = req.params as any;
    if (userId !== ctx.userId) requireRole(ctx, "ADMIN");
    const target = db.get<any>("SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?", ctx.workspaceId, userId);
    if (!target) throw notFound("Anggota tidak ditemukan.");
    if (target.role === "OWNER" && (ctx.role !== "OWNER" || db.get<{ n: number }>("SELECT COUNT(*) n FROM memberships WHERE workspace_id = ? AND role = 'OWNER'", ctx.workspaceId)!.n <= 1))
      throw badRequest("Pemilik terakhir tidak dapat dikeluarkan.");
    db.run("DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?", ctx.workspaceId, userId);
    db.run("DELETE FROM storage_permissions WHERE user_id = ? AND storage_id IN (SELECT id FROM storages WHERE workspace_id = ?)", userId, ctx.workspaceId);
    audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "member.remove", resourceType: "user", resourceId: userId, ip: ctx.ip });
    return ok(req, {});
  });
}
