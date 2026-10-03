import { Response } from "express";
import { AuthenticatedRequest, generateRefreshToken } from "../middleware/auth.ts";
import { AuthService } from "../services/auth.service.ts";
import { db } from "../db/index.ts";

export class AuthController {
  public static async login(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;
      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const { token, user } = await AuthService.login(email, password, ipAddress, userAgent);
      const refreshToken = generateRefreshToken(user);

      // Set secure HTTP-only access token cookie
      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 15 * 60 * 1000, // 15 minutes
      });

      // Set secure HTTP-only refresh token cookie
      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      res.status(200).json({
        success: true,
        message: "Login successful",
        data: {
          user,
          token,
        },
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to authenticate",
      });
    }
  }

  public static async register(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { name, email, password, role } = req.body;
      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const { token, user } = await AuthService.register(
        { name, email, passwordPlain: password, role },
        ipAddress,
        userAgent
      );
      const refreshToken = generateRefreshToken(user);

      // Set secure HTTP-only access token cookie
      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 15 * 60 * 1000, // 15 minutes
      });

      // Set secure HTTP-only refresh token cookie
      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      res.status(201).json({
        success: true,
        message: "Registration successful",
        data: {
          user,
          token,
        },
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to register account",
      });
    }
  }

  public static async googleAuth(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { email, name, avatarUrl, accessToken, refreshToken: googleRefreshToken, expiresIn } = req.body;
      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const { token, user } = await AuthService.googleAuth(
        { email, name, avatarUrl, accessToken, refreshToken: googleRefreshToken, expiresIn },
        ipAddress,
        userAgent
      );
      const refreshToken = generateRefreshToken(user);

      // Set secure HTTP-only access token cookie
      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 15 * 60 * 1000, // 15 minutes
      });

      // Set secure HTTP-only refresh token cookie
      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      res.status(200).json({
        success: true,
        message: "Google login successful",
        data: {
          user,
          token,
        },
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to authenticate with Google",
      });
    }
  }

  public static async forgotPassword(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { email } = req.body;
      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";
      const appUrl = (req.headers["origin"] as string) || (req.headers["referer"] as string) || process.env.APP_URL;

      const result = await AuthService.forgotPassword(email, ipAddress, userAgent, appUrl);

      res.status(200).json({
        success: true,
        message: result.message,
        data: { message: result.message },
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to process forgot password request",
      });
    }
  }


  public static async resetPassword(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { token, password } = req.body;
      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const result = await AuthService.resetPassword(token, password, ipAddress, userAgent);

      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to reset password",
      });
    }
  }

  public static async logout(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      await AuthService.logout(req.user, ipAddress, userAgent);

      res.clearCookie("token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });

      res.clearCookie("refreshToken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });

      res.status(200).json({
        success: true,
        message: "Logged out successfully",
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to logout",
      });
    }
  }

  public static async me(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: "Not authenticated",
        });
        return;
      }

      const { passwordHash: _, ...safeUser } = req.user;

      const conn =
        (await db.googleDriveConnection.findFirst({
          where: { userId: safeUser.id, isConnected: true },
        })) ||
        (await db.googleDriveConnection.findFirst({
          where: { accountEmail: safeUser.email, isConnected: true },
        }));

      const isConnected = Boolean(conn && conn.isConnected) || safeUser.authProvider === "GOOGLE";
      const googleAccountEmail = conn ? conn.accountEmail : safeUser.authProvider === "GOOGLE" ? safeUser.email : null;
      const googleAccountName = conn ? conn.accountName : safeUser.authProvider === "GOOGLE" ? safeUser.name : null;

      res.status(200).json({
        success: true,
        data: {
          user: {
            ...safeUser,
            isGoogleConnected: isConnected,
            googleAccountEmail,
            googleAccountName,
          },
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get user profile",
      });
    }
  }

  public static async getPublicConfig(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const config = await AuthService.getPublicConfig();
      res.status(200).json({
        success: true,
        data: config,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to load auth configuration",
      });
    }
  }
}
