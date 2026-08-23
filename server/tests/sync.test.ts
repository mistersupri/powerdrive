import { SyncEngineService } from "../services/sync-engine.service.ts";
import { StorageService } from "../services/storage.service.ts";
import { db } from "../db/index.ts";
import { SyncStatus } from "../types/index.ts";

export async function runSyncSelfTest(): Promise<{ success: boolean; details: Record<string, unknown> }> {
  try {
    const adminUser = (await db.user.findFirst({ where: { role: "ADMIN" as any } })) || undefined;
    const folder = (await db.folder.findMany())[0];

    if (!folder) {
      throw new Error("No application folder available for sync test");
    }

    // 1. Create a file in storage buffer
    const testContent = Buffer.from("Jakarta Education Data Synchronization Verification Payload");
    const testFile = await StorageService.saveFile({
      originalName: "sk_penetapan_penerima_kjp_2026.pdf",
      mimeType: "application/pdf",
      buffer: testContent,
      size: testContent.length,
      folderId: folder.id,
      user: adminUser,
      ipAddress: "127.0.0.1",
      userAgent: "SelfTest",
    });

    if (!testFile.id) {
      throw new Error("File creation failed before sync test");
    }

    // 2. Trigger Queue Processing
    const queueResult = await SyncEngineService.processQueue();
    if (queueResult.processedCount === 0) {
      throw new Error("Sync engine queue failed to pick up pending job");
    }

    // 3. Verify File status updated to SYNCED
    const syncedFile = await db.file.findUnique({ where: { id: testFile.id } });
    if (!syncedFile || syncedFile.syncStatus !== SyncStatus.SYNCED) {
      throw new Error(`File sync status expected SYNCED but got ${syncedFile?.syncStatus}`);
    }

    if (!syncedFile.googleDriveFileId || !syncedFile.syncedAt) {
      throw new Error("File missing googleDriveFileId or syncedAt timestamp after sync");
    }

    // 4. Test Single File Sync execution
    const singleSyncResult = await SyncEngineService.syncSingleFile(testFile.id);
    if (!singleSyncResult || singleSyncResult.status !== SyncStatus.SYNCED) {
      throw new Error("Direct single file sync execution failed");
    }

    // 5. Test Manual Retry mechanism
    const retryResult = await SyncEngineService.retryJob(singleSyncResult.id, adminUser);
    if (!retryResult || retryResult.status !== SyncStatus.SYNCED) {
      throw new Error("Manual job retry execution failed");
    }

    // 6. Test Sync Engine Stats
    const stats = await SyncEngineService.getStats();
    if (stats.syncedJobs === 0) {
      throw new Error("Sync engine statistics calculation failed");
    }

    return {
      success: true,
      details: {
        fileId: syncedFile.id,
        googleDriveFileId: syncedFile.googleDriveFileId,
        googleDriveWebViewLink: syncedFile.googleDriveWebViewLink,
        syncStatus: syncedFile.syncStatus,
        syncedAt: syncedFile.syncedAt,
        processedQueueJobs: queueResult.processedCount,
        totalSyncedJobs: stats.syncedJobs,
        workerActive: stats.workerActive,
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
