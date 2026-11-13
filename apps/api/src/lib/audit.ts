import { db } from "../db.ts";
import { newId } from "./crypto.ts";

export interface AuditInput {
  workspaceId: string; userId?: string | null; action: string; resourceType: string;
  resourceId?: string | null; metadata?: Record<string, unknown>; ip?: string | null;
}
/** Never pass file contents or credentials in metadata. */
export function audit(a: AuditInput) {
  db.run(
    "INSERT INTO audit_logs(id, workspace_id, user_id, action, resource_type, resource_id, metadata, ip_address) VALUES (?,?,?,?,?,?,?,?)",
    newId(), a.workspaceId, a.userId ?? null, a.action, a.resourceType, a.resourceId ?? null,
    a.metadata ? JSON.stringify(a.metadata) : null, a.ip ?? null,
  );
}

export function notify(workspaceId: string, userId: string, type: string, title: string, message: string, data?: unknown) {
  db.run(
    "INSERT INTO notifications(id, workspace_id, user_id, type, title, message, data) VALUES (?,?,?,?,?,?,?)",
    newId(), workspaceId, userId, type, title, message, data ? JSON.stringify(data) : null,
  );
}
