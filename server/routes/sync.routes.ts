import { Router } from "express";
import { SyncController } from "../controllers/sync.controller.ts";
import { authenticate, requireAdmin, requireAuth } from "../middleware/auth.ts";

export const syncRouter = Router();

// Authentication required for all sync operations
syncRouter.use(authenticate, requireAuth);

syncRouter.get("/jobs", SyncController.listJobs);
syncRouter.get("/jobs/:id", SyncController.getJob);
syncRouter.get("/stats", SyncController.getStats);
syncRouter.post("/trigger", SyncController.triggerQueue);
syncRouter.post("/retry-failed", SyncController.retryFailedJobs);
syncRouter.post("/jobs/:id/retry", SyncController.retryJob);
syncRouter.post("/files/:id/sync", SyncController.syncFile);
