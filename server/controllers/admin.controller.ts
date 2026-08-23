import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.ts";
import { AuthService } from "../services/auth.service.ts";
import { db } from "../db/index.ts";
import { Role } from "../types/index.ts";
import { MailService } from "../services/mail.service.ts";

export class AdminController {
  public static async listUsers(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const users = await AuthService.listUsers();
      res.status(200).json({
        success: true,
        data: { users },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to list users",
      });
    }
  }

  public static async createUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { email, name, password, role } = req.body;
      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const newUser = await AuthService.createUser(
        { email, name, passwordPlain: password, role: role as Role },
        req.user,
        ipAddress,
        userAgent
      );

      res.status(201).json({
        success: true,
        message: "User created successfully",
        data: { user: newUser },
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to create user",
      });
    }
  }

  public static async updateUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { name, role, isActive, password } = req.body;
      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const updated = await AuthService.updateUser(
        id,
        { name, role: role as Role, isActive, passwordPlain: password },
        req.user,
        ipAddress,
        userAgent
      );

      res.status(200).json({
        success: true,
        message: "User updated successfully",
        data: { user: updated },
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to update user",
      });
    }
  }

  public static async listLogs(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = await db.activityLog.findMany({ take: limit });

      res.status(200).json({
        success: true,
        data: { logs },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to retrieve activity logs",
      });
    }
  }

  public static async getStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const totalUsers = (await db.user.findMany()).length;
      const totalFolders = (await db.folder.findMany()).length;
      const totalFiles = (await db.file.findMany()).length;
      const syncStatusCounts = {
        pending: await db.file.count({ where: { syncStatus: "PENDING" as any } }),
        processing: await db.file.count({ where: { syncStatus: "PROCESSING" as any } }),
        synced: await db.file.count({ where: { syncStatus: "SYNCED" as any } }),
        failed: await db.file.count({ where: { syncStatus: "FAILED" as any } }),
      };

      res.status(200).json({
        success: true,
        data: {
          totalUsers,
          totalFolders,
          totalFiles,
          syncStatusCounts,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get dashboard stats",
      });
    }
  }

  public static async getSmtpConfig(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const config = await MailService.getSmtpConfig();
      // Mask password for security
      const safeConfig = {
        ...config,
        pass: config.pass ? "********" : "",
      };
      res.status(200).json({
        success: true,
        data: { config: safeConfig },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to retrieve SMTP configuration",
      });
    }
  }

  public static async saveSmtpConfig(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { host, port, secure, user, pass, fromEmail, fromName } = req.body;
      const updated = await MailService.saveSmtpConfig({
        host,
        port: port ? parseInt(port, 10) : undefined,
        secure: secure === true || secure === "true",
        user,
        pass,
        fromEmail,
        fromName,
      });

      await db.activityLog.create({
        data: {
          userId: req.user?.id || null,
          action: "SMTP_CONFIG_UPDATED" as any,
          resourceType: "SYSTEM",
          resourceId: "SMTP_CONFIG",
          details: { host: updated.host, port: updated.port, fromEmail: updated.fromEmail },
          ipAddress: req.ip || req.socket.remoteAddress || "127.0.0.1",
          userAgent: req.headers["user-agent"] || "unknown",
          result: "SUCCESS",
          errorMessage: null,
        },
      });

      res.status(200).json({
        success: true,
        message: "Konfigurasi SMTP berhasil diperbarui",
        data: {
          config: {
            ...updated,
            pass: updated.pass ? "********" : "",
          },
        },
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to save SMTP configuration",
      });
    }
  }

  public static async testSmtpConfig(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { targetEmail } = req.body;
      const recipient = targetEmail || req.user?.email;
      if (!recipient) {
        throw new Error("Email penerima untuk uji coba SMTP wajib diisi");
      }

      const result = await MailService.sendTestEmail(recipient);
      res.status(200).json({
        success: true,
        message: result.message,
        data: { messageId: result.messageId },
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Gagal melakukan uji coba koneksi SMTP. Pastikan Host, Port, Username, dan Password sudah benar.",
      });
    }
  }

  public static async getSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const settings = await db.systemSetting.findMany();
      res.status(200).json({
        success: true,
        data: { settings },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to retrieve system settings",
      });
    }
  }

  public static async updateSetting(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { key, value, description } = req.body;
      if (!key || value === undefined) {
        throw new Error("Key and value are required");
      }

      const updated = await db.systemSetting.upsert({
        where: { key },
        update: { value: String(value), description },
        create: { key, value: String(value), description },
      });

      await db.activityLog.create({
        data: {
          userId: req.user?.id || null,
          action: "SYSTEM_SETTING_UPDATED" as any,
          resourceType: "SYSTEM",
          resourceId: key,
          details: { key, value },
          ipAddress: req.ip || req.socket.remoteAddress || "127.0.0.1",
          userAgent: req.headers["user-agent"] || "unknown",
          result: "SUCCESS",
          errorMessage: null,
        },
      });

      res.status(200).json({
        success: true,
        message: `Pengaturan ${key} berhasil diperbarui`,
        data: { setting: updated },
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to update system setting",
      });
    }
  }
}

