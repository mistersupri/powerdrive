import { db } from "../db/index.ts";
import { ActivityAction } from "../types/index.ts";

export class AuditService {
  public static async log({
    userId,
    action,
    resourceType,
    resourceId,
    details,
    ipAddress,
    userAgent,
    result,
    errorMessage,
  }: {
    userId?: string | null;
    action: ActivityAction;
    resourceType: string;
    resourceId?: string | null;
    details?: Record<string, unknown> | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    result: "SUCCESS" | "FAILURE";
    errorMessage?: string | null;
  }) {
    try {
      return await db.activityLog.create({
        data: {
          userId: userId || null,
          action,
          resourceType,
          resourceId: resourceId || null,
          details: details || null,
          ipAddress: ipAddress || null,
          userAgent: userAgent || null,
          result,
          errorMessage: errorMessage || null,
        },
      });
    } catch (error) {
      console.error("[AuditService] Failed to write audit log:", error);
      return null;
    }
  }
}
