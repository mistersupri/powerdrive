import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.ts";
import { SyncEngineService } from "../services/sync-engine.service.ts";
import { db } from "../db/index.ts";
import { SyncStatus } from "../types/index.ts";

export class SyncController {
  /**
   * List sync jobs with optional status filter
   */
  public static async listJobs(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { status, fileId } = req.query;

      const where: any = {};
      if (status) where.status = status as SyncStatus;
      if (fileId) where.fileId = String(fileId);

      const jobs = await db.syncJob.findMany({ where });

      res.status(200).json({
        success: true,
        data: {
          jobs,
          total: jobs.length,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to list sync jobs",
      });
    }
  }

  /**
   * Get single sync job details
   */
  public static async getJob(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const job = await db.syncJob.findUnique({ where: { id } });
      if (!job) {
        res.status(404).json({
          success: false,
          error: "Sync job not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: { job },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to retrieve sync job",
      });
    }
  }

  /**
   * Trigger immediate processing of all pending and ready sync jobs in queue
   */
  public static async triggerQueue(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const result = await SyncEngineService.processQueue();
      res.status(200).json({
        success: true,
        message: `Queue processed ${result.processedCount} jobs`,
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to trigger sync queue",
      });
    }
  }

  /**
   * Trigger manual retry for a specific failed sync job
   */
  public static async retryJob(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const updatedJob = await SyncEngineService.retryJob(id, req.user);

      res.status(200).json({
        success: true,
        message: "Job reset and queued for immediate retry",
        data: { job: updatedJob },
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to retry sync job",
      });
    }
  }

  /**
   * Trigger retry for all failed sync jobs
   */
  public static async retryFailedJobs(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const result = await SyncEngineService.retryAllFailed(req.user);
      res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to retry failed sync jobs",
      });
    }
  }

  /**
   * Trigger sync for a specific file directly
   */
  public static async syncFile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const job = await SyncEngineService.syncSingleFile(id);

      res.status(200).json({
        success: true,
        message: "File sync triggered",
        data: { job },
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to sync file",
      });
    }
  }

  /**
   * Get sync engine statistics
   */
  public static async getStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const stats = await SyncEngineService.getStats();
      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to retrieve sync engine statistics",
      });
    }
  }
}
