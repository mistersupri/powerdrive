import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuditLogDto, DashboardDto, NotificationDto } from "@superdrive/shared";
import { db, now } from "../db.ts";
import { ok, requireAuth } from "../app.ts";
import { requireRole, permissionsFor } from "../modules/permissions.ts";
import { toDto } from "../modules/storages.ts";

const auditDto = (r: any): AuditLogDto => ({ id: r.id, action: r.action, resourceType: r.resource_type, resourceId: r.resource_id, userName: r.user_name ?? null, metadata: r.metadata ? JSON.parse(r.metadata) : null, ipAddress: r.ip_address, createdAt: r.created_at });

export async function miscRoutes(app: FastifyInstance) {
  app.get("/dashboard", async (req) => {
    const ctx = requireAuth(req);
    const rows = db.all<any>("SELECT * FROM storages WHERE workspace_id = ? ORDER BY created_at", ctx.workspaceId).filter((r) => permissionsFor(ctx, r.id).includes("READ"));
    const list = rows.map((r) => toDto(r, ctx));
    const admin = ctx.role === "OWNER" || ctx.role === "ADMIN";
    const t = db.get<any>(
      `SELECT SUM(status IN ('QUEUED','VALIDATING','RUNNING','RETRYING','VERIFYING','PAUSED')) active,
              SUM(status IN ('COMPLETED','COPY_COMPLETED_SOURCE_RETAINED')) completed, SUM(status='FAILED') failed
       FROM transfer_jobs WHERE workspace_id = ?${admin ? "" : " AND user_id = ?"}`, ...(admin ? [ctx.workspaceId] : [ctx.workspaceId, ctx.userId]))!;
    const activity = db.all<any>(
      "SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.workspace_id = ? ORDER BY a.created_at DESC LIMIT 8", ctx.workspaceId).map(auditDto);
    const data: DashboardDto = {
      storages: list.length, providers: new Set(list.map((s) => s.provider)).size,
      // Only storages that report a quota count; unknown is not zero.
      knownCapacity: list.reduce((n, s) => n + (s.quota?.total ?? 0), 0), knownUsage: list.reduce((n, s) => n + (s.quota?.used ?? 0), 0),
      transfers: { active: t.active ?? 0, completed: t.completed ?? 0, failed: t.failed ?? 0 }, recentActivity: activity, storageList: list,
    };
    return ok(req, data);
  });

  app.get("/audit-logs", async (req) => {
    const ctx = requireAuth(req); requireRole(ctx, "ADMIN");
    const q = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(50), action: z.string().optional(), q: z.string().optional() }).parse(req.query);
    const where = ["a.workspace_id = ?"]; const args: any[] = [ctx.workspaceId];
    if (q.action) { where.push("a.action LIKE ?"); args.push(`${q.action}%`); }
    if (q.q) { where.push("(a.metadata LIKE ? OR u.name LIKE ? OR a.action LIKE ?)"); args.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
    const total = db.get<{ n: number }>(`SELECT COUNT(*) n FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE ${where.join(" AND ")}`, ...args)!.n;
    const rows = db.all<any>(`SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE ${where.join(" AND ")} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`, ...args, q.limit, (q.page - 1) * q.limit);
    return ok(req, { items: rows.map(auditDto), total });
  });

  app.get("/notifications", async (req) => {
    const ctx = requireAuth(req);
    const rows = db.all<any>("SELECT * FROM notifications WHERE user_id = ? AND workspace_id = ? ORDER BY created_at DESC LIMIT 50", ctx.userId, ctx.workspaceId);
    const items: NotificationDto[] = rows.map((r) => ({ id: r.id, type: r.type, title: r.title, message: r.message, readAt: r.read_at, createdAt: r.created_at }));
    return ok(req, { items, unread: items.filter((i) => !i.readAt).length });
  });
  app.post("/notifications/read", async (req) => {
    const ctx = requireAuth(req);
    db.run("UPDATE notifications SET read_at = ? WHERE user_id = ? AND workspace_id = ? AND read_at IS NULL", now(), ctx.userId, ctx.workspaceId);
    return ok(req, {});
  });
}
