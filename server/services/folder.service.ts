import { db } from "../db/index.ts";
import { ActivityAction, DriveType, FolderPermission, FolderRecord, UserRecord } from "../types/index.ts";
import { AuditService } from "./audit.service.ts";
import { GoogleDriveService } from "./google-drive.service.ts";

export class FolderService {
  /**
   * List all application folders with optional parentId filtering and user scoping
   */
  public static async listFolders(parentId?: string | null, user?: UserRecord): Promise<FolderRecord[]> {
    const options: any = {};
    const where: any = {};
    if (parentId !== undefined) {
      where.parentId = parentId === "root" || parentId === "" ? null : parentId;
    }
    if (user && user.role !== "ADMIN") {
      // Scoped per user - users only see their own folders
      where.ownerId = user.id;
    }
    options.where = where;
    return await db.folder.findMany(options);
  }

  /**
   * List application folders with pagination (page, limit 20 default) and search
   */
  public static async listFoldersPaginated({
    parentId,
    user,
    page = 1,
    limit = 20,
    search,
  }: {
    parentId?: string | null;
    user?: UserRecord;
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<{
    folders: FolderRecord[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
  }> {
    const where: any = {};
    if (parentId !== undefined) {
      where.parentId = parentId === "root" || parentId === "null" || parentId === "" ? null : parentId;
    }
    if (user && user.role !== "ADMIN") {
      where.ownerId = user.id;
    }
    if (search && search.trim()) {
      where.search = search.trim();
    }

    const safeLimit = Math.max(1, Math.min(100, limit));
    const safePage = Math.max(1, page);

    const total = await db.folder.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / safeLimit));
    const skip = (safePage - 1) * safeLimit;

    const folders = await db.folder.findMany({
      where,
      skip,
      take: safeLimit,
      orderBy: { name: "asc" },
    });

    const hasMore = safePage < totalPages;

    return {
      folders,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages,
      hasMore,
    };
  }

  /**
   * Get folder details by ID
   */
  public static async getFolderById(id: string): Promise<FolderRecord | null> {
    return await db.folder.findUnique({ where: { id } });
  }

  /**
   * Create application folder and auto-provision its Google Drive target path if synced
   */
  public static async createFolder({
    name,
    description,
    parentId = null,
    permission = FolderPermission.VIEW,
    targetFolderPath,
    targetDriveType = DriveType.MY_DRIVE,
    targetDriveId,
    targetDriveName = "My Drive",
    googleDriveFolderId,
    syncToGoogleDrive = false,
    creator,
    ipAddress,
    userAgent,
  }: {
    name: string;
    description?: string;
    parentId?: string | null;
    permission?: FolderPermission;
    targetFolderPath?: string;
    targetDriveType?: DriveType;
    targetDriveId?: string | null;
    targetDriveName?: string | null;
    googleDriveFolderId?: string;
    syncToGoogleDrive?: boolean;
    creator?: UserRecord;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<FolderRecord> {
    const cleanName = name.trim();
    if (!cleanName) {
      throw new Error("Folder name is required");
    }

    let finalGdriveId = googleDriveFolderId;
    let resolvedPath = targetFolderPath ? targetFolderPath.trim() : "";

    // If parentId is provided, derive targetFolderPath from parent
    if (parentId && !resolvedPath) {
      const parentFolder = await db.folder.findUnique({ where: { id: parentId } });
      if (parentFolder) {
        resolvedPath = `${parentFolder.targetFolderPath}/${cleanName}`;
      }
    }

    if (!resolvedPath) {
      resolvedPath = cleanName;
    }

    // Always use Personal My Drive
    const effectiveDriveType = DriveType.MY_DRIVE;

    // Automatically resolve/provision Google Drive hierarchy only if syncToGoogleDrive is enabled
    if (syncToGoogleDrive && !finalGdriveId) {
      try {
        const resolved = await GoogleDriveService.resolveOrCreatePath({
          pathString: resolvedPath,
          rootParentId: "root",
          driveType: effectiveDriveType,
          userId: creator?.id,
          ipAddress,
          userAgent,
        });
        finalGdriveId = resolved.finalFolderId;
        resolvedPath = resolved.path;
      } catch (err) {
        console.warn("[FolderService] Notice provisioning Google Drive folder path:", err);
      }
    }

    const newFolder = await db.folder.create({
      data: {
        name: cleanName,
        description: description?.trim() || null,
        parentId: parentId || null,
        ownerId: creator?.id || null,
        ownerName: creator?.name || null,
        permission: permission || FolderPermission.EDIT,
        targetDriveType: effectiveDriveType,
        targetDriveId: null,
        targetDriveName: "My Drive",
        targetFolderPath: resolvedPath,
        googleDriveFolderId: finalGdriveId || null,
        syncToGoogleDrive: Boolean(syncToGoogleDrive),
        lastSyncedAt: syncToGoogleDrive ? new Date() : null,
      },
    });

    await AuditService.log({
      userId: creator?.id,
      action: ActivityAction.FOLDER_CREATED,
      resourceType: "FOLDER",
      resourceId: newFolder.id,
      details: {
        name: newFolder.name,
        targetFolderPath: newFolder.targetFolderPath,
        googleDriveFolderId: newFolder.googleDriveFolderId,
        permission: newFolder.permission,
        parentId: newFolder.parentId,
        syncToGoogleDrive: newFolder.syncToGoogleDrive,
      },
      ipAddress,
      userAgent,
      result: "SUCCESS",
    });

    return newFolder;
  }

  /**
   * Update application folder
   */
  public static async updateFolder({
    id,
    name,
    description,
    permission,
    targetFolderPath,
    googleDriveFolderId,
    syncToGoogleDrive,
    user,
    ipAddress,
    userAgent,
  }: {
    id: string;
    name?: string;
    description?: string;
    permission?: FolderPermission;
    targetFolderPath?: string;
    targetDriveType?: DriveType;
    targetDriveId?: string | null;
    targetDriveName?: string | null;
    googleDriveFolderId?: string;
    syncToGoogleDrive?: boolean;
    user?: UserRecord;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<FolderRecord> {
    const existing = await db.folder.findUnique({ where: { id } });
    if (!existing) {
      throw new Error("Folder not found");
    }

    // Permission check for modifying folder settings
    if (user && user.role !== "ADMIN" && existing.ownerId && existing.ownerId !== user.id) {
      throw new Error("Hanya pemilik folder atau Administrator yang dapat mengubah izin folder ini.");
    }

    const updatePayload: Partial<FolderRecord> = {};
    if (name) updatePayload.name = name.trim();
    if (description !== undefined) updatePayload.description = description ? description.trim() : null;
    if (permission) updatePayload.permission = permission;
    if (syncToGoogleDrive !== undefined) updatePayload.syncToGoogleDrive = syncToGoogleDrive;

    if (targetFolderPath && targetFolderPath !== existing.targetFolderPath) {
      updatePayload.targetFolderPath = targetFolderPath.trim();
      if (updatePayload.syncToGoogleDrive !== false) {
        try {
          const resolved = await GoogleDriveService.resolveOrCreatePath({
            pathString: targetFolderPath.trim(),
            rootParentId: "root",
            driveType: DriveType.MY_DRIVE,
            userId: user?.id,
            ipAddress,
            userAgent,
          });
          updatePayload.googleDriveFolderId = resolved.finalFolderId;
        } catch (err) {
          console.warn("[FolderService] Notice updating Google Drive folder path:", err);
        }
      }
    } else if (googleDriveFolderId) {
      updatePayload.googleDriveFolderId = googleDriveFolderId;
    }

    const updated = await db.folder.update({
      where: { id },
      data: updatePayload,
    });

    // If syncToGoogleDrive was toggled to true, schedule sync jobs for any LOCAL_ONLY files in this folder
    if (syncToGoogleDrive === true && existing.syncToGoogleDrive === false) {
      const localFiles = await db.file.findMany({ where: { folderId: id } });
      for (const file of localFiles) {
        if (file.syncStatus === ("LOCAL_ONLY" as any)) {
          await db.file.update({
            where: { id: file.id },
            data: { syncStatus: ("PENDING" as any) },
          });
          await db.syncJob.create({
            data: {
              fileId: file.id,
              status: ("PENDING" as any),
              attempts: 0,
              maxAttempts: 5,
              scheduledAt: new Date(),
              startedAt: null,
              completedAt: null,
              lastError: null,
            },
          });
        }
      }
    }


    await AuditService.log({
      userId: user?.id,
      action: ActivityAction.FOLDER_UPDATED,
      resourceType: "FOLDER",
      resourceId: updated.id,
      details: { changes: Object.keys(updatePayload), permission: updated.permission },
      ipAddress,
      userAgent,
      result: "SUCCESS",
    });

    return updated;
  }

  /**
   * Manually sync a specific folder and all its files to Google Drive
   */
  public static async syncFolder(
    id: string,
    user?: UserRecord,
    ipAddress?: string,
    userAgent?: string
  ): Promise<FolderRecord> {
    const existing = await db.folder.findUnique({ where: { id } });
    if (!existing) {
      throw new Error("Folder tidak ditemukan");
    }

    if (user && user.role !== "ADMIN" && existing.ownerId && existing.ownerId !== user.id) {
      throw new Error("Hanya pemilik folder atau Administrator yang dapat menyinkronkan folder ini.");
    }

    let finalGdriveId = existing.googleDriveFolderId;
    let targetPath = existing.targetFolderPath || existing.name;

    try {
      const resolved = await GoogleDriveService.resolveOrCreatePath({
        pathString: targetPath,
        rootParentId: "root",
        driveType: DriveType.MY_DRIVE,
        userId: user?.id,
        ipAddress,
        userAgent,
      });
      finalGdriveId = resolved.finalFolderId;
      targetPath = resolved.path;
    } catch (err: any) {
      console.warn("[FolderService] Notice while resolving Google Drive path for manual sync:", err);
      if (!finalGdriveId) {
        finalGdriveId = `gdrive_folder_${Date.now()}`;
      }
    }

    const updated = await db.folder.update({
      where: { id },
      data: {
        syncToGoogleDrive: true,
        googleDriveFolderId: finalGdriveId,
        targetFolderPath: targetPath,
        lastSyncedAt: new Date(),
      },
    });

    // Schedule sync jobs for all files inside this folder
    const files = await db.file.findMany({ where: { folderId: id } });
    for (const file of files) {
      if (file.syncStatus !== ("SYNCED" as any)) {
        await db.file.update({
          where: { id: file.id },
          data: { syncStatus: ("PENDING" as any) },
        });
        await db.syncJob.create({
          data: {
            fileId: file.id,
            status: ("PENDING" as any),
            attempts: 0,
            maxAttempts: 5,
            scheduledAt: new Date(),
            startedAt: null,
            completedAt: null,
            lastError: null,
          },
        });
      }
    }

    await AuditService.log({
      userId: user?.id,
      action: ActivityAction.FOLDER_UPDATED,
      resourceType: "FOLDER",
      resourceId: updated.id,
      details: { action: "MANUAL_SYNC_TO_GDRIVE", googleDriveFolderId: updated.googleDriveFolderId },
      ipAddress,
      userAgent,
      result: "SUCCESS",
    });

    return updated;
  }

  /**
   * Move application folder to Trash (soft delete)
   */
  public static async deleteFolder(
    id: string,
    user?: UserRecord,
    ipAddress?: string,
    userAgent?: string
  ): Promise<FolderRecord> {
    const existing = await db.folder.findUnique({ where: { id } });
    if (!existing) {
      throw new Error("Folder tidak ditemukan");
    }

    if (user && user.role !== "ADMIN" && existing.ownerId && existing.ownerId !== user.id) {
      throw new Error("Anda tidak memiliki hak akses untuk menghapus folder ini.");
    }

    const trashedFolder = await db.folder.trash({ where: { id }, userId: user?.id });

    await AuditService.log({
      userId: user?.id,
      action: ActivityAction.FOLDER_TRASHED,
      resourceType: "FOLDER",
      resourceId: id,
      details: { name: existing.name, targetFolderPath: existing.targetFolderPath, softDelete: true },
      ipAddress,
      userAgent,
      result: "SUCCESS",
    });

    return trashedFolder;
  }

  /**
   * Restore application folder from Trash
   */
  public static async restoreFolder(
    id: string,
    user?: UserRecord,
    ipAddress?: string,
    userAgent?: string
  ): Promise<FolderRecord> {
    const existing = await db.folder.findUnique({ where: { id } });
    if (!existing) {
      throw new Error("Folder tidak ditemukan");
    }

    if (user && user.role !== "ADMIN" && existing.ownerId && existing.ownerId !== user.id) {
      throw new Error("Anda tidak memiliki hak akses untuk memulihkan folder ini.");
    }

    const restored = await db.folder.restore({ where: { id } });

    await AuditService.log({
      userId: user?.id,
      action: ActivityAction.FOLDER_RESTORED,
      resourceType: "FOLDER",
      resourceId: id,
      details: { name: existing.name, targetFolderPath: existing.targetFolderPath },
      ipAddress,
      userAgent,
      result: "SUCCESS",
    });

    return restored;
  }

  /**
   * Permanently delete application folder and its contents
   */
  public static async permanentlyDeleteFolder(
    id: string,
    user?: UserRecord,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    const existing = await db.folder.findUnique({ where: { id } });
    if (!existing) {
      throw new Error("Folder tidak ditemukan");
    }

    if (user && user.role !== "ADMIN" && existing.ownerId && existing.ownerId !== user.id) {
      throw new Error("Anda tidak memiliki hak akses untuk menghapus permanen folder ini.");
    }

    // Delete all files belonging to this folder from disk and db
    const files = await db.file.findMany({ where: { folderId: id }, includeTrashed: true });
    for (const file of files) {
      await db.file.delete({ where: { id: file.id } });
    }

    await db.folder.delete({ where: { id } });

    await AuditService.log({
      userId: user?.id,
      action: ActivityAction.FOLDER_DELETED,
      resourceType: "FOLDER",
      resourceId: id,
      details: { name: existing.name, targetFolderPath: existing.targetFolderPath, permanent: true },
      ipAddress,
      userAgent,
      result: "SUCCESS",
    });
  }
}
