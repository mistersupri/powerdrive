import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.ts";
import { GoogleDriveService } from "../services/google-drive.service.ts";
import { DriveType } from "../types/index.ts";

export class GoogleController {
  public static async getConfig(req: Request, res: Response): Promise<void> {
    try {
      const forwardedProto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
      const forwardedHost = (req.headers["x-forwarded-host"] as string) || req.headers.host || "localhost:3000";
      const appUrl = `${forwardedProto}://${forwardedHost}`;
      const redirectUri = GoogleDriveService.getRedirectUri(appUrl);

      res.status(200).json({
        success: true,
        data: {
          clientId: (process.env.GOOGLE_CLIENT_ID || "").trim(),
          hasClientSecret: Boolean((process.env.GOOGLE_CLIENT_SECRET || "").trim()),
          redirectUri,
          appUrl,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to fetch Google configuration",
      });
    }
  }

  public static async getStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const status = await GoogleDriveService.getConnectionStatus(req.user?.id, req.user?.email);
      res.status(200).json({
        success: true,
        data: status,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to fetch Google connection status",
      });
    }
  }

  public static async connect(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { email, name, accessToken, refreshToken, expiresIn } = req.body;
      if (!accessToken || !email) {
        res.status(400).json({
          success: false,
          error: "AccessToken and Email are required",
        });
        return;
      }

      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const conn = await GoogleDriveService.connectAccount({
        email,
        name,
        accessToken,
        refreshToken,
        expiresIn,
        userId: req.user?.id,
        authenticatedUserEmail: req.user?.email,
        ipAddress,
        userAgent,
      });

      const { accessToken: _, refreshToken: __, ...safeConn } = conn;

      res.status(200).json({
        success: true,
        message: "Google Drive account connected successfully",
        data: {
          connection: safeConn,
        },
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to register Google connection",
      });
    }
  }

  public static async disconnect(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      await GoogleDriveService.disconnectAccount(req.user?.id, req.user?.email, ipAddress, userAgent);

      res.status(200).json({
        success: true,
        message: "Google Drive account disconnected successfully",
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to disconnect Google account",
      });
    }
  }

  public static async listDrives(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const drives = await GoogleDriveService.listDrives();
      res.status(200).json({
        success: true,
        data: { drives },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to retrieve drives",
      });
    }
  }

  public static async selectDrive(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { driveId, driveName, driveType } = req.body;
      if (!driveId || !driveName || !driveType) {
        res.status(400).json({
          success: false,
          error: "driveId, driveName, and driveType are required",
        });
        return;
      }

      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const updated = await GoogleDriveService.selectTargetDrive(
        driveId,
        driveName,
        driveType as DriveType,
        req.user?.id,
        ipAddress,
        userAgent
      );

      const { accessToken: _, refreshToken: __, ...safeConn } = updated;

      res.status(200).json({
        success: true,
        message: "Target Google Drive space selected",
        data: { connection: safeConn },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to select drive",
      });
    }
  }

  public static async listFolders(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const parentId = (req.query.parentId as string) || "root";
      const q = (req.query.q as string) || "";
      const customToken = (req.headers["x-google-access-token"] as string) || (req.query.accessToken as string) || undefined;

      const folders = await GoogleDriveService.listGoogleFolders(
        parentId,
        DriveType.MY_DRIVE,
        customToken,
        q,
        req.user?.id || req.user?.email
      );

      res.status(200).json({
        success: true,
        data: { folders },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to list Google Drive folders",
      });
    }
  }

  public static async getFolderContents(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { folderId } = req.params;
      const customToken = (req.headers["x-google-access-token"] as string) || (req.query.accessToken as string) || undefined;

      if (!folderId) {
        res.status(400).json({ success: false, error: "folderId parameter is required" });
        return;
      }

      const details = await GoogleDriveService.getGoogleFolderDetails(
        folderId,
        customToken,
        req.user?.id || req.user?.email
      );

      res.status(200).json({
        success: true,
        data: details,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get Google Drive folder contents",
      });
    }
  }

  public static async importFolder(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { googleFolderId, parentAppFolderId, permission, customName, accessToken } = req.body;
      const customToken = (req.headers["x-google-access-token"] as string) || accessToken || undefined;

      if (!googleFolderId) {
        res.status(400).json({
          success: false,
          error: "googleFolderId is required",
        });
        return;
      }

      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const result = await GoogleDriveService.importGoogleFolderTree({
        googleFolderId,
        parentAppFolderId: parentAppFolderId || null,
        permission,
        customName,
        user: req.user,
        ipAddress,
        userAgent,
        explicitToken: customToken,
      });

      res.status(201).json({
        success: true,
        message: `Folder Google Drive berhasil diimpor (${result.totalFoldersImported} folder, ${result.totalFilesImported} berkas).`,
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to import folder from Google Drive",
      });
    }
  }
}
