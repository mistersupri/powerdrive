import { StorageService } from "../services/storage.service.ts";
import { db } from "../db/index.ts";
import { SyncStatus } from "../types/index.ts";

export async function runStorageSelfTest(): Promise<{ success: boolean; details: Record<string, unknown> }> {
  try {
    const adminUser = (await db.user.findFirst({ where: { role: "ADMIN" as any } })) || undefined;
    const folder = (await db.folder.findMany())[0];

    if (!folder) {
      throw new Error("No application folder found for storage test");
    }

    // 1. Test Date-Partitioned Path Creation
    const { absoluteDir, relativeDir } = StorageService.getPartitionedPath();
    if (!absoluteDir || !relativeDir) {
      throw new Error("Failed to create or retrieve date-partitioned storage directory");
    }

    // 2. Test File Buffer Save & SHA-256 Checksum Calculation
    const testContent = Buffer.from("Cloud Drive Centralized File Upload Test Buffer");
    const testFileRecord = await StorageService.saveFile({
      originalName: "dokumen_verifikasi_cloud_2026.pdf",
      mimeType: "application/pdf",
      buffer: testContent,
      size: testContent.length,
      folderId: folder.id,
      user: adminUser,
      ipAddress: "127.0.0.1",
      userAgent: "SelfTest",
    });

    if (!testFileRecord.id || !testFileRecord.checksumSha256) {
      throw new Error("File record creation or SHA-256 computation failed");
    }

    if (testFileRecord.syncStatus !== SyncStatus.PENDING) {
      throw new Error("New file should have PENDING sync status");
    }

    // 3. Test File Integrity Check
    const isIntegrityValid = StorageService.verifyFileIntegrity(
      testFileRecord.storagePath,
      testFileRecord.checksumSha256
    );

    if (!isIntegrityValid) {
      throw new Error("SHA-256 File integrity verification check failed");
    }

    // 4. Test SyncJob Creation
    const syncJob = await db.syncJob.findFirst({ where: { fileId: testFileRecord.id } });
    if (!syncJob || syncJob.status !== SyncStatus.PENDING) {
      throw new Error("SyncJob was not automatically queued for newly uploaded file");
    }

    // 5. Test Storage Statistics
    const stats = await StorageService.getStorageStats();
    if (stats.totalFiles === 0 || stats.pendingSyncCount === 0) {
      throw new Error("Storage statistics calculation failed");
    }

    return {
      success: true,
      details: {
        partitionedDir: relativeDir,
        fileId: testFileRecord.id,
        storedName: testFileRecord.storedName,
        checksumSha256: testFileRecord.checksumSha256,
        sizeBytes: testFileRecord.size,
        isIntegrityValid,
        totalBufferFiles: stats.totalFiles,
        pendingSyncCount: stats.pendingSyncCount,
        totalStorageFormatted: stats.totalSizeFormatted,
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
