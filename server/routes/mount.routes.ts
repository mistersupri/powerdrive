import { Router } from "express";
import { mountController } from "../controllers/mount.controller.ts";
import { authenticate, requireAdmin } from "../middleware/auth.ts";
import { uploadMiddleware } from "../middleware/upload.ts";

export const mountRouter = Router();

// Public / Authenticated mount list
mountRouter.get("/", authenticate, (req, res) => mountController.listMounts(req, res));
mountRouter.post("/create", authenticate, requireAdmin, (req, res) => mountController.createMountPoint(req, res));

// Specific mount operations
mountRouter.get("/:mountId", authenticate, (req, res) => mountController.getMount(req, res));
mountRouter.get("/:mountId/browse", authenticate, (req, res) => mountController.browseDirectory(req, res));
mountRouter.post("/:mountId/sync", authenticate, (req, res) => mountController.syncMount(req, res));
mountRouter.get("/:mountId/sync-status", authenticate, (req, res) => mountController.getSyncStatus(req, res));
mountRouter.post("/:mountId/mkdir", authenticate, (req, res) => mountController.createFolder(req, res));
mountRouter.post("/:mountId/delete", authenticate, (req, res) => mountController.deleteItem(req, res));
mountRouter.post("/:mountId/upload", authenticate, uploadMiddleware.array("files", 10), (req, res) =>
  mountController.uploadToMount(req, res)
);
mountRouter.post("/:mountId/import-to-drive", authenticate, (req, res) =>
  mountController.importToGoogleDrive(req, res)
);

// File viewing, downloading, text content (support token in query)
mountRouter.get("/:mountId/file/view", authenticate, (req, res) => mountController.viewFile(req, res));
mountRouter.get("/:mountId/file/download", authenticate, (req, res) => mountController.downloadFile(req, res));
mountRouter.get("/:mountId/file/content", authenticate, (req, res) => mountController.getFileContent(req, res));
