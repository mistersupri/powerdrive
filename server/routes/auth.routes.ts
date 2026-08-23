import { Router } from "express";
import { AuthController } from "../controllers/auth.controller.ts";
import { authenticate, requireAuth } from "../middleware/auth.ts";

export const authRouter = Router();

authRouter.get("/config", AuthController.getPublicConfig);
authRouter.post("/login", AuthController.login);
authRouter.post("/register", AuthController.register);
authRouter.post("/google", AuthController.googleAuth);
authRouter.post("/forgot-password", AuthController.forgotPassword);
authRouter.post("/reset-password", AuthController.resetPassword);
authRouter.post("/logout", authenticate, AuthController.logout);
authRouter.get("/me", authenticate, requireAuth, AuthController.me);
