import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.ts";
import { db } from "../db/index.ts";
import { StorageService } from "../services/storage.service.ts";
import { AuditService } from "../services/audit.service.ts";
import { ActivityAction } from "../types/index.ts";

export class TrashController {
  /**
   * Get all trashed files and folders
   */
  public static async getTrash(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const isAdmin = req.user?.role === "ADMIN";
      const userId = req.user?.id;

      const trashData = await db.trash.list({ userId, isAdmin });

      res.status(200).json({
        success: true,
        data: trashData,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Gagal mengambil data sampah",
      });
    }
  }

  /**
   * Restore items from trash (files and/or folders)
   */
  public static async restoreItems(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { fileIds = [], folderIds = [] } = req.body;
      const isAdmin = req.user?.role === "ADMIN";
      const userId = req.user?.id;

      let restoredFiles = 0;
      let restoredFolders = 0;

      // Restore files
      if (Array.isArray(fileIds) && fileIds.length > 0) {
        for (const id of fileIds) {
          const file = await db.file.findUnique({ where: { id } });
          if (file && (isAdmin || file.userId === userId)) {
            await db.file.restore({ where: { id } });
            restoredFiles++;
          }
        }
      }

      // Restore folders
      if (Array.isArray(folderIds) && folderIds.length > 0) {
        for (const id of folderIds) {
          const folder = await db.folder.findUnique({ where: { id } });
          if (folder && (isAdmin || folder.ownerId === userId)) {
            await db.folder.restore({ where: { id } });
            restoredFolders++;
          }
        }
      }

      await AuditService.log({
        userId,
        action: ActivityAction.FILE_RESTORED,
        resourceType: "FILE",
        details: { restoredFiles, restoredFolders, bulk: true },
        ipAddress: req.ip || req.socket.remoteAddress || "127.0.0.1",
        userAgent: req.headers["user-agent"] || "unknown",
        result: "SUCCESS",
      });

      res.status(200).json({
        success: true,
        message: `Berhasil memulihkan ${restoredFiles} berkas dan ${restoredFolders} folder`,
        data: { restoredFiles, restoredFolders },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Gagal memulihkan item dari sampah",
      });
    }
  }

  /**
   * Permanently delete selected items from trash
   */
  public static async permanentDeleteItems(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { fileIds = [], folderIds = [] } = req.body;
      const isAdmin = req.user?.role === "ADMIN";
      const userId = req.user?.id;

      let deletedFiles = 0;
      let deletedFolders = 0;

      // Permanently delete files
      if (Array.isArray(fileIds) && fileIds.length > 0) {
        for (const id of fileIds) {
          const file = await db.file.findUnique({ where: { id } });
          if (file && (isAdmin || file.userId === userId)) {
            StorageService.deleteLocalFile(file.storagePath);
            await db.file.delete({ where: { id } });
            deletedFiles++;
          }
        }
      }

      // Permanently delete folders
      if (Array.isArray(folderIds) && folderIds.length > 0) {
        for (const id of folderIds) {
          const folder = await db.folder.findUnique({ where: { id } });
          if (folder && (isAdmin || folder.ownerId === userId)) {
            // Delete trashed child files
            const childFiles = await db.file.findMany({ where: { folderId: id, isTrashed: true }, includeTrashed: true });
            for (const child of childFiles) {
              StorageService.deleteLocalFile(child.storagePath);
              await db.file.delete({ where: { id: child.id } });
            }
            if (folder.isTrashed) {
              await db.folder.delete({ where: { id } });
              deletedFolders++;
            }
          }
        }
      }

      await AuditService.log({
        userId,
        action: ActivityAction.FILE_DELETED,
        resourceType: "FILE",
        details: { deletedFiles, deletedFolders, permanent: true },
        ipAddress: req.ip || req.socket.remoteAddress || "127.0.0.1",
        userAgent: req.headers["user-agent"] || "unknown",
        result: "SUCCESS",
      });

      res.status(200).json({
        success: true,
        message: `Berhasil menghapus permanen ${deletedFiles} berkas dan ${deletedFolders} folder`,
        data: { deletedFiles, deletedFolders },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Gagal menghapus item secara permanen",
      });
    }
  }

  /**
   * Empty trash completely
   */
  public static async emptyTrash(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const isAdmin = req.user?.role === "ADMIN";
      const userId = req.user?.id;

      const trashData = await db.trash.list({ userId, isAdmin });

      let deletedFiles = 0;
      let deletedFolders = 0;

      for (const file of trashData.files) {
        try {
          StorageService.deleteLocalFile(file.storagePath);
          await db.file.delete({ where: { id: file.id } });
          deletedFiles++;
        } catch (e) {
          console.warn(`[TrashController] Error deleting file ${file.id}:`, e);
        }
      }

      for (const folder of trashData.folders) {
        try {
          if (folder.isTrashed) {
            await db.folder.delete({ where: { id: folder.id } });
            deletedFolders++;
          }
        } catch (e) {
          console.warn(`[TrashController] Error deleting folder ${folder.id}:`, e);
        }
      }

      await AuditService.log({
        userId,
        action: ActivityAction.TRASH_EMPTIED,
        resourceType: "STORAGE",
        details: { deletedFiles, deletedFolders },
        ipAddress: req.ip || req.socket.remoteAddress || "127.0.0.1",
        userAgent: req.headers["user-agent"] || "unknown",
        result: "SUCCESS",
      });

      res.status(200).json({
        success: true,
        message: `Sampah berhasil dikosongkan (${deletedFiles} berkas, ${deletedFolders} folder dihapus)`,
        data: { deletedFiles, deletedFolders },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Gagal mengosongkan sampah",
      });
    }
  }
}
