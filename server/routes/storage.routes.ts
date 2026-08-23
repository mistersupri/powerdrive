import { Router } from "express";
import { StorageController } from "../controllers/storage.controller.ts";
import { authenticate, requireAuth } from "../middleware/auth.ts";
import { uploadMiddleware } from "../middleware/upload.ts";

export const storageRouter = Router();

// Middleware to parse auth token (cookies, headers, or query ?token=)
storageRouter.use(authenticate);

// Publicly readable preview & download endpoints with authenticate middleware
storageRouter.get("/files/:id/view", StorageController.viewFile);
storageRouter.get("/files/:id/thumbnail", StorageController.getThumbnail);
storageRouter.get("/files/:id/download", StorageController.downloadFile);
storageRouter.get("/files/:id/content", StorageController.getFileContent);
storageRouter.get("/bulk-download/part/:sessionId/:partIndex", StorageController.downloadArchivePart);
storageRouter.get("/bulk-download/session/:sessionId", StorageController.getArchiveSession);

// File listing & inspection (accessible for shared folders)
storageRouter.get("/files", StorageController.listFiles);
storageRouter.get("/files/:id", StorageController.getFile);

// Bulk Multi-Part Archive & Direct ZIP endpoints (accessible for shared folders)
storageRouter.post("/bulk-download/prepare", StorageController.prepareBulkArchive);
storageRouter.post("/bulk-download/direct-zip", StorageController.downloadDirectZip);

// Standard and Chunked upload routes (accessible for shared folders with EDIT permission)
storageRouter.post(
  "/upload",
  (req, res, next) => {
    uploadMiddleware.any()(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          error: err.message || "Gagal memproses berkas unggahan.",
        });
      }
      next();
    });
  },
  StorageController.uploadFiles
);

storageRouter.post("/conflicts/check", StorageController.checkConflicts);
storageRouter.post("/upload/chunk/init", StorageController.initChunkUpload);
storageRouter.post(
  "/upload/chunk",
  (req, res, next) => {
    uploadMiddleware.any()(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          error: err.message || "Gagal memproses chunk berkas.",
        });
      }
      if (!req.file && req.files && Array.isArray(req.files) && req.files.length > 0) {
        req.file = req.files[0];
      }
      next();
    });
  },
  StorageController.uploadChunk
);
storageRouter.get("/upload/chunk/status/:uploadId", StorageController.getChunkStatus);
storageRouter.post("/upload/chunk/complete", StorageController.completeChunkUpload);
storageRouter.post("/upload/chunk/cancel", StorageController.cancelChunkUpload);

// Authentication required for destructive management and admin storage routes
storageRouter.use(requireAuth);

// Bulk operations
storageRouter.post("/files/bulk-delete", StorageController.bulkDeleteFiles);
storageRouter.post("/files/bulk-restore", StorageController.bulkRestoreFiles);
storageRouter.post("/files/bulk-sync", StorageController.bulkSyncFiles);
storageRouter.post("/files/bulk-move", StorageController.bulkMoveFiles);
storageRouter.post("/files/bulk-copy", StorageController.bulkCopyFiles);

// File management routes
storageRouter.get("/stats", StorageController.getStorageStats);
storageRouter.put("/files/:id/rename", StorageController.renameFile);
storageRouter.get("/files/:id/verify", StorageController.verifyIntegrity);
storageRouter.post("/files/:id/restore", StorageController.restoreFile);
storageRouter.delete("/files/:id/permanent", StorageController.permanentlyDeleteFile);
storageRouter.delete("/files/:id", StorageController.deleteFile);
