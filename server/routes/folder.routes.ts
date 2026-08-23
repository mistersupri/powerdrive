import { Router } from "express";
import { FolderController } from "../controllers/folder.controller.ts";
import { authenticate, requireAdmin, requireAuth } from "../middleware/auth.ts";

export const folderRouter = Router();

// Middleware to parse auth token (cookies, headers, or query)
folderRouter.use(authenticate);

// Public / Shared folder verification and read endpoints
folderRouter.post("/verify-share-token", FolderController.verifyShareToken);
folderRouter.get("/:id/activities", FolderController.getFolderActivities);
folderRouter.get("/:id", FolderController.getFolder);
folderRouter.get("/", FolderController.listFolders);

// Routes requiring active user authentication
folderRouter.use(requireAuth);

folderRouter.get("/tree/google", FolderController.getGoogleFolderTree);
folderRouter.get("/:id/share-links", FolderController.getShareLinks);

// Folder routes (ownership & permission validated in service)
folderRouter.post("/", FolderController.createFolder);
folderRouter.post("/bulk-delete", FolderController.bulkDeleteFolders);
folderRouter.post("/bulk-restore", FolderController.bulkRestoreFolders);
folderRouter.post("/:id/restore", FolderController.restoreFolder);
folderRouter.delete("/:id/permanent", FolderController.permanentlyDeleteFolder);
folderRouter.put("/:id", FolderController.updateFolder);
folderRouter.post("/:id/sync", FolderController.syncFolder);
folderRouter.delete("/:id", FolderController.deleteFolder);
folderRouter.post("/google/create", requireAdmin, FolderController.createGoogleDriveFolder);
folderRouter.post("/google/resolve-path", requireAdmin, FolderController.resolvePath);
