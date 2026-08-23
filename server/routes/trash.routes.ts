import { Router } from "express";
import { TrashController } from "../controllers/trash.controller.ts";
import { authenticate, requireAuth } from "../middleware/auth.ts";

export const trashRouter = Router();

trashRouter.use(authenticate, requireAuth);

trashRouter.get("/", TrashController.getTrash);
trashRouter.post("/restore", TrashController.restoreItems);
trashRouter.post("/permanent-delete", TrashController.permanentDeleteItems);
trashRouter.delete("/empty", TrashController.emptyTrash);
