import { ALL_PERMISSIONS, type Permission, type WorkspaceRole } from "@superdrive/shared";
import { db } from "../db.ts";
import { forbidden, notFound } from "../lib/errors.ts";

export interface AuthCtx { userId: string; userName: string; isSuperAdmin: boolean; workspaceId: string; role: WorkspaceRole; ip: string }

const DEFAULTS: Record<WorkspaceRole, Permission[]> = {
  OWNER: ALL_PERMISSIONS, ADMIN: ALL_PERMISSIONS,
  MEMBER: ["READ", "DOWNLOAD", "UPLOAD", "COPY", "MOVE", "RENAME"],
  VIEWER: ["READ", "DOWNLOAD"],
};

/** Owner/admin: everything. Otherwise a per-user grant wins over a per-role grant, which wins over role defaults. */
export function permissionsFor(ctx: Pick<AuthCtx, "userId" | "role">, storageId: string): Permission[] {
  if (ctx.role === "OWNER" || ctx.role === "ADMIN") return ALL_PERMISSIONS;
  const rows = db.all<{ user_id: string | null; role: string | null; permissions: string }>(
    "SELECT user_id, role, permissions FROM storage_permissions WHERE storage_id = ? AND (user_id = ? OR (user_id IS NULL AND role = ?))", storageId, ctx.userId, ctx.role);
  const own = rows.find((r) => r.user_id === ctx.userId) ?? rows.find((r) => r.role === ctx.role);
  if (!own) return DEFAULTS[ctx.role];
  // A viewer can never exceed read-only, whatever was granted.
  const granted = (JSON.parse(own.permissions) as Permission[]);
  return ctx.role === "VIEWER" ? granted.filter((p) => p === "READ" || p === "DOWNLOAD") : granted;
}

export function can(ctx: AuthCtx, storageId: string, perm: Permission) {
  const p = permissionsFor(ctx, storageId);
  return p.includes(perm) && (perm === "READ" || p.includes("READ"));
}

/** Load a storage row, checking it belongs to the caller's workspace and the caller holds `perm`. */
export function requireStorage(ctx: AuthCtx, storageId: string, perm: Permission) {
  const row = db.get<any>("SELECT * FROM storages WHERE id = ? AND workspace_id = ?", storageId, ctx.workspaceId);
  // Same response whether it exists elsewhere or not, so ids cannot be probed across workspaces.
  if (!row) throw notFound("Penyimpanan tidak ditemukan.");
  if (!can(ctx, storageId, perm)) throw forbidden();
  return row;
}

export function requireRole(ctx: AuthCtx, min: "ADMIN" | "OWNER") {
  const rank = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };
  if (rank[ctx.role] < rank[min]) throw forbidden("Hanya admin workspace yang dapat melakukan ini.");
}
