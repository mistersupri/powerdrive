import { db } from "./index.ts";
import { ActivityAction, DriveType, Role, SyncStatus } from "../types/index.ts";

export async function runDatabaseSelfTest(): Promise<{ success: boolean; details: Record<string, unknown> }> {
  try {
    await db.initializeDefaultData();

    // 1. Test User Retrieval
    const admin = await db.user.findUnique({ where: { email: "admin@example.com" } });
    if (!admin || admin.role !== Role.ADMIN) {
      throw new Error("Admin user seed verification failed");
    }

    const user = await db.user.findUnique({ where: { email: "user@example.com" } });
    if (!user || user.role !== Role.USER) {
      throw new Error("Regular user seed verification failed");
    }

    // 2. Test Settings (200MB max file size check)
    const maxFileSize = await db.systemSetting.findUnique({ where: { key: "MAX_FILE_SIZE_MB" } });
    if (!maxFileSize || maxFileSize.value !== "200") {
      throw new Error("MAX_FILE_SIZE_MB setting mismatch");
    }

    // 3. Test Folder Retrieval & Defaults
    const folders = await db.folder.findMany();
    if (folders.length < 3) {
      throw new Error("Initial application folders count mismatch");
    }

    // 4. Test Activity Log Insertion
    const log = await db.activityLog.create({
      data: {
        userId: admin.id,
        action: ActivityAction.USER_CREATED,
        resourceType: "SELF_TEST",
        resourceId: "DB_VERIFY",
        details: { test: true },
        ipAddress: "127.0.0.1",
        userAgent: "Database Validator",
        result: "SUCCESS",
      },
    });

    if (!log.id) {
      throw new Error("Activity log creation failed");
    }

    return {
      success: true,
      details: {
        adminUser: admin.email,
        regularUser: user.email,
        folderCount: folders.length,
        maxFileSizeMB: maxFileSize.value,
        defaultDriveType: DriveType.MY_DRIVE,
        testLogId: log.id,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      details: {
        error: error.message || String(error),
      },
    };
  }
}
