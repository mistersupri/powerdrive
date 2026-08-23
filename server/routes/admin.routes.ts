import { Router } from "express";
import { AdminController } from "../controllers/admin.controller.ts";
import { authenticate, requireAdmin } from "../middleware/auth.ts";

export const adminRouter = Router();

// Protect all admin endpoints with authentication & requireAdmin
adminRouter.use(authenticate, requireAdmin);

adminRouter.get("/users", AdminController.listUsers);
adminRouter.post("/users", AdminController.createUser);
adminRouter.put("/users/:id", AdminController.updateUser);
adminRouter.get("/logs", AdminController.listLogs);
adminRouter.get("/stats", AdminController.getStats);

// SMTP Configuration & Testing
adminRouter.get("/smtp", AdminController.getSmtpConfig);
adminRouter.post("/smtp", AdminController.saveSmtpConfig);
adminRouter.post("/smtp/test", AdminController.testSmtpConfig);

// System Settings Management
adminRouter.get("/settings", AdminController.getSettings);
adminRouter.post("/settings", AdminController.updateSetting);

