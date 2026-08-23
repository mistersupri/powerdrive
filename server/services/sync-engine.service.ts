import { db } from "../db/index.ts";
import { ActivityAction, DriveType, SyncJobRecord, SyncStatus, UserRecord } from "../types/index.ts";
import { AuditService } from "./audit.service.ts";
import { GoogleDriveService } from "./google-drive.service.ts";
import { StorageService } from "./storage.service.ts";

export interface SyncEngineStats {
  workerActive: boolean;
  lastTickAt: Date | null;
  totalJobs: number;
  pendingJobs: number;
  processingJobs: number;
  syncedJobs: number;
  failedJobs: number;
  retryingJobs: number;
}

export class SyncEngineService {
  private static isProcessing = false;
  private static workerTimer: NodeJS.Timeout | null = null;
  private static lastTickAt: Date | null = null;

  private static async safeUpdateJob(id: string, data: any): Promise<void> {
    try {
      await db.syncJob.update({ where: { id }, data });
    } catch (err: any) {
      console.warn(`[SyncEngine] safeUpdateJob: Failed to update SyncJob ${id}:`, err.message || err);
    }
  }

  private static async safeDeleteJob(id: string): Promise<void> {
    try {
      await db.syncJob.delete({ where: { id } });
    } catch (err: any) {
      console.warn(`[SyncEngine] safeDeleteJob: Failed to delete SyncJob ${id}:`, err.message || err);
    }
  }

  private static async safeUpdateFile(id: string, data: any): Promise<void> {
    try {
      await db.file.update({ where: { id }, data });
    } catch (err: any) {
      console.warn(`[SyncEngine] safeUpdateFile: Failed to update File ${id}:`, err.message || err);
    }
  }

  private static async safeUpdateFolder(id: string, data: any): Promise<void> {
    try {
      await db.folder.update({ where: { id }, data });
    } catch (err: any) {
      console.warn(`[SyncEngine] safeUpdateFolder: Failed to update Folder ${id}:`, err.message || err);
    }
  }

  /**
   * Start periodic background queue worker
   */
  public static startWorker(intervalMs: number = 5000): void {
    if (this.workerTimer) {
      return;
    }
    console.log(`[SyncEngine] Starting background sync worker (interval: ${intervalMs}ms)`);
    this.workerTimer = setInterval(() => {
      this.processQueue().catch((err) => {
        console.error("[SyncEngine] Worker queue execution error:", err);
      });
    }, intervalMs);
  }

  /**
   * Stop background sync worker
   */
  public static stopWorker(): void {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
      console.log("[SyncEngine] Background sync worker stopped");
    }
  }

  /**
   * Process all pending or retrying sync jobs in the queue
   */
  public static async processQueue(): Promise<{ processedCount: number; results: Array<{ jobId: string; status: SyncStatus; error?: string }> }> {
    if (this.isProcessing) {
      return { processedCount: 0, results: [] };
    }

    this.isProcessing = true;
    this.lastTickAt = new Date();
    const results: Array<{ jobId: string; status: SyncStatus; error?: string }> = [];

    try {
      const now = new Date();
      // Find jobs that are PENDING or RETRYING and ready to execute
      let allJobs: SyncJobRecord[] = [];
      try {
        allJobs = await db.syncJob.findMany();
      } catch (dbErr: any) {
        console.error("[SyncEngine] Failed to retrieve sync jobs from database:", dbErr.message || dbErr);
        return { processedCount: 0, results: [] };
      }

      const readyJobs = allJobs.filter((job) => {
        const isScheduled = !job.scheduledAt || new Date(job.scheduledAt).getTime() <= now.getTime();
        return (job.status === SyncStatus.PENDING || job.status === SyncStatus.RETRYING) && isScheduled;
      });

      for (const job of readyJobs) {
        try {
          const result = await this.executeJob(job);
          results.push(result);
        } catch (jobErr: any) {
          console.error(`[SyncEngine] Unhandled error during job ${job.id} execution:`, jobErr);
          results.push({
            jobId: job.id,
            status: SyncStatus.FAILED,
            error: jobErr.message || String(jobErr),
          });
        }
      }

      return { processedCount: readyJobs.length, results };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Execute a single sync job
   */
  public static async executeJob(job: SyncJobRecord): Promise<{ jobId: string; status: SyncStatus; error?: string }> {
    try {
      // A. Verify that the sync job still exists
      const existingJob = await db.syncJob.findUnique({ where: { id: job.id } });
      if (!existingJob) {
        return { jobId: job.id, status: SyncStatus.FAILED, error: `Sync job with id ${job.id} not found` };
      }

      // If the job is already processing or synced, skip it to avoid race conditions or duplicates
      if (existingJob.status === SyncStatus.PROCESSING || existingJob.status === SyncStatus.SYNCED) {
        return { jobId: job.id, status: existingJob.status as SyncStatus, error: `Sync job is already ${existingJob.status.toLowerCase()}` };
      }

      // B. Verify that the associated file still exists
      const file = await db.file.findUnique({ where: { id: job.fileId } });
      if (!file) {
        // If the file is missing, delete the orphaned sync job gracefully to clean up the queue
        await this.safeDeleteJob(job.id);
        return { jobId: job.id, status: SyncStatus.FAILED, error: `File with id ${job.fileId} not found` };
      }

      // 1. Mark job as PROCESSING
      await this.safeUpdateJob(job.id, {
        status: SyncStatus.PROCESSING,
        startedAt: new Date(),
      });

      await this.safeUpdateFile(job.fileId, {
        syncStatus: SyncStatus.PROCESSING,
      });

      const folder = await db.folder.findUnique({ where: { id: file.folderId } });
      if (!folder) {
        throw new Error(`Target folder with id ${file.folderId} not found`);
      }

      // Check if folder is configured for Google Drive sync
      if (folder.syncToGoogleDrive === false) {
        await this.safeUpdateFile(file.id, {
          syncStatus: SyncStatus.LOCAL_ONLY,
          lastError: null,
        });
        await this.safeDeleteJob(job.id);
        return { jobId: job.id, status: SyncStatus.LOCAL_ONLY };
      }

      // 3. Resolve destination Google Drive Folder ID
      let targetGdriveFolderId = file.googleDriveFolderId || folder.googleDriveFolderId;
      if (!targetGdriveFolderId) {
        const resolved = await GoogleDriveService.resolveOrCreatePath({
          pathString: folder.targetFolderPath,
          rootParentId: folder.targetDriveId || "root",
          driveType: (folder.targetDriveType as DriveType) || DriveType.MY_DRIVE,
          userId: file.userId,
        });
        targetGdriveFolderId = resolved.finalFolderId;
        // Cache resolved folder ID in folder record
        await this.safeUpdateFolder(folder.id, { googleDriveFolderId: targetGdriveFolderId });
      }

      // 4. Stream file from local storage buffer to Google Drive
      const physicalPath = StorageService.resolveStoragePath(file.storagePath);
      if (!physicalPath) {
        throw new Error(`Local file buffer missing at: ${file.storagePath}`);
      }

      const fileStream = StorageService.getFileStream(physicalPath);
      const uploadResult = await GoogleDriveService.uploadFileStream({
        fileName: file.originalName,
        mimeType: file.mimeType,
        fileStream,
        targetFolderId: targetGdriveFolderId,
        driveType: folder.targetDriveType as DriveType,
        userId: file.userId,
      });

      const now = new Date();

      // 5. Update File Record to SYNCED
      await this.safeUpdateFile(file.id, {
        syncStatus: SyncStatus.SYNCED,
        googleDriveFileId: uploadResult.id,
        googleDriveWebViewLink: uploadResult.webViewLink || null,
        googleDriveFolderId: targetGdriveFolderId,
        syncedAt: now,
        syncAttempts: job.attempts + 1,
        lastError: null,
      });

      // 6. Update SyncJob to SYNCED
      await this.safeUpdateJob(job.id, {
        status: SyncStatus.SYNCED,
        completedAt: now,
        lastError: null,
      });

      // 7. Update Folder lastSyncedAt
      await this.safeUpdateFolder(folder.id, { lastSyncedAt: now });

      // 8. Audit Log
      await AuditService.log({
        userId: file.userId,
        action: ActivityAction.SYNC_COMPLETED,
        resourceType: "FILE",
        resourceId: file.id,
        details: {
          originalName: file.originalName,
          googleDriveFileId: uploadResult.id,
          googleDriveWebViewLink: uploadResult.webViewLink,
          folderName: folder.name,
          attempts: job.attempts + 1,
        },
        result: "SUCCESS",
      });

      return { jobId: job.id, status: SyncStatus.SYNCED };
    } catch (error: any) {
      const newAttempts = job.attempts + 1;
      const errorMessage = error.message || String(error);

      if (newAttempts < job.maxAttempts) {
        // Exponential backoff: 5s, 10s, 20s, 40s, 80s
        const backoffSeconds = Math.pow(2, newAttempts - 1) * 5;
        const nextScheduledAt = new Date(Date.now() + backoffSeconds * 1000);

        await this.safeUpdateJob(job.id, {
          status: SyncStatus.RETRYING,
          attempts: newAttempts,
          scheduledAt: nextScheduledAt,
          lastError: errorMessage,
        });

        await this.safeUpdateFile(job.fileId, {
          syncStatus: SyncStatus.RETRYING,
          syncAttempts: newAttempts,
          lastError: errorMessage,
        });

        await AuditService.log({
          action: ActivityAction.SYNC_RETRY,
          resourceType: "SYNC_JOB",
          resourceId: job.id,
          details: {
            fileId: job.fileId,
            attempt: newAttempts,
            nextRetryAt: nextScheduledAt.toISOString(),
            error: errorMessage,
          },
          result: "SUCCESS",
        });

        return { jobId: job.id, status: SyncStatus.RETRYING, error: errorMessage };
      } else {
        // Max attempts reached, mark as FAILED
        await this.safeUpdateJob(job.id, {
          status: SyncStatus.FAILED,
          attempts: newAttempts,
          completedAt: new Date(),
          lastError: errorMessage,
        });

        await this.safeUpdateFile(job.fileId, {
          syncStatus: SyncStatus.FAILED,
          syncAttempts: newAttempts,
          lastError: errorMessage,
        });

        await AuditService.log({
          action: ActivityAction.SYNC_FAILED,
          resourceType: "SYNC_JOB",
          resourceId: job.id,
          details: {
            fileId: job.fileId,
            totalAttempts: newAttempts,
            error: errorMessage,
          },
          result: "FAILURE",
        });

        return { jobId: job.id, status: SyncStatus.FAILED, error: errorMessage };
      }
    }
  }

  /**
   * Immediately trigger sync for a specific file
   */
  public static async syncSingleFile(fileId: string): Promise<SyncJobRecord> {
    const file = await db.file.findUnique({ where: { id: fileId } });
    if (!file) {
      throw new Error(`File with id ${fileId} not found`);
    }

    // Find or create sync job
    let syncJob = await db.syncJob.findFirst({ where: { fileId } });
    if (!syncJob) {
      syncJob = await db.syncJob.create({
        data: {
          fileId,
          status: SyncStatus.PENDING,
          attempts: 0,
          maxAttempts: 5,
          scheduledAt: new Date(),
          startedAt: null,
          completedAt: null,
          lastError: null,
        },
      });
    } else {
      syncJob = await db.syncJob.update({
        where: { id: syncJob.id },
        data: {
          status: SyncStatus.PENDING,
          scheduledAt: new Date(),
        },
      });
    }

    // Execute immediately
    await this.executeJob(syncJob);

    const updatedJob = await db.syncJob.findUnique({ where: { id: syncJob.id } });
    return updatedJob!;
  }

  /**
   * Reset a failed or retrying job to PENDING and retry immediately
   */
  public static async retryJob(jobId: string, user?: UserRecord): Promise<SyncJobRecord> {
    const job = await db.syncJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new Error(`Sync job with id ${jobId} not found`);
    }

    await this.safeUpdateJob(jobId, {
      status: SyncStatus.PENDING,
      attempts: 0,
      scheduledAt: new Date(),
      lastError: null,
    });

    await this.safeUpdateFile(job.fileId, {
      syncStatus: SyncStatus.PENDING,
      lastError: null,
    });

    await AuditService.log({
      userId: user?.id,
      action: ActivityAction.SYNC_RETRY,
      resourceType: "SYNC_JOB",
      resourceId: jobId,
      details: { manualRetryBy: user?.email || "system" },
      result: "SUCCESS",
    });

    // Retrieve the reset job
    const resetJob = await db.syncJob.findUnique({ where: { id: jobId } });
    if (resetJob) {
      // Run execution immediately
      await this.executeJob(resetJob);
    }

    return (await db.syncJob.findUnique({ where: { id: jobId } })) || job;
  }

  /**
   * Reset and retry all failed sync jobs
   */
  public static async retryAllFailed(user?: UserRecord): Promise<{ retriedCount: number; message: string }> {
    const failedJobs = await db.syncJob.findMany({ where: { status: SyncStatus.FAILED } });
    let count = 0;
    for (const job of failedJobs) {
      try {
        await this.safeUpdateJob(job.id, {
          status: SyncStatus.PENDING,
          attempts: 0,
          scheduledAt: new Date(),
          lastError: null,
        });
        await this.safeUpdateFile(job.fileId, {
          syncStatus: SyncStatus.PENDING,
          lastError: null,
        });
        count++;
      } catch (err) {
        console.error(`Failed to reset job ${job.id}:`, err);
      }
    }

    if (count > 0) {
      // Trigger background processing
      this.processQueue().catch((e) => console.error("Error processing queue after retryAllFailed:", e));
    }

    return {
      retriedCount: count,
      message: `${count} berkas gagal berhasil diantrekan ulang untuk sinkronisasi.`,
    };
  }

  /**
   * Retrieve aggregate sync engine metrics
   */
  public static async getStats(): Promise<SyncEngineStats> {
    const jobs = await db.syncJob.findMany();

    let pending = 0;
    let processing = 0;
    let synced = 0;
    let failed = 0;
    let retrying = 0;

    for (const j of jobs) {
      if (j.status === SyncStatus.PENDING) pending++;
      else if (j.status === SyncStatus.PROCESSING) processing++;
      else if (j.status === SyncStatus.SYNCED) synced++;
      else if (j.status === SyncStatus.FAILED) failed++;
      else if (j.status === SyncStatus.RETRYING) retrying++;
    }

    return {
      workerActive: this.workerTimer !== null,
      lastTickAt: this.lastTickAt,
      totalJobs: jobs.length,
      pendingJobs: pending,
      processingJobs: processing,
      syncedJobs: synced,
      failedJobs: failed,
      retryingJobs: retrying,
    };
  }
}
