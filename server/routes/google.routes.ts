import { Router } from "express";
import { GoogleController } from "../controllers/google.controller.ts";
import { authenticate, requireAdmin, requireAuth } from "../middleware/auth.ts";

export const googleRouter = Router();

// Public Google API config endpoint (returns GOOGLE_CLIENT_ID & dynamic redirect URI from app hostname)
googleRouter.get("/config", GoogleController.getConfig);

// Protect google endpoints: all google endpoints require authenticated user session
googleRouter.get("/status", authenticate, requireAuth, GoogleController.getStatus);
googleRouter.get("/drives", authenticate, requireAuth, GoogleController.listDrives);
googleRouter.get("/folders", authenticate, requireAuth, GoogleController.listFolders);
googleRouter.get("/folders/:folderId/contents", authenticate, requireAuth, GoogleController.getFolderContents);
googleRouter.post("/import-folder", authenticate, requireAuth, GoogleController.importFolder);
googleRouter.post("/connect", authenticate, requireAuth, GoogleController.connect);
googleRouter.post("/disconnect", authenticate, requireAuth, GoogleController.disconnect);
googleRouter.post("/select-drive", authenticate, requireAuth, GoogleController.selectDrive);
