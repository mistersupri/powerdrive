import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import {
  ActivityAction,
  ActivityLogRecord,
  DriveType,
  FileRecord,
  FileVersionRecord,
  FolderPermission,
  FolderRecord,
  GoogleDriveConnectionRecord,
  Role,
  SyncJobRecord,
  SyncStatus,
  SystemSettingRecord,
  UserRecord,
} from "../types/index.ts";

export const prisma = new PrismaClient();

class DatabaseService {
  private passwordResetTokens: Map<string, { email: string; token: string; expiresAt: Date }> = new Map();
  private initialized = false;

  constructor() {
    this.initializeDefaultData();
  }

  public async initializeDefaultData(): Promise<void> {
    if (this.initialized) return;
    try {
      // 1. Initialize Seed Administrator if not exists
      const envAdminEmail = (process.env.ADMIN_EMAIL || "admin@clouddrive.local").trim().toLowerCase();
      const existingAdmin = await prisma.user.findUnique({ where: { email: envAdminEmail } });
      if (!existingAdmin) {
        const envAdminPassword = process.env.ADMIN_PASSWORD || "AdminPassword2026!";
        const adminPasswordHash = bcrypt.hashSync(envAdminPassword, 10);
        await prisma.user.create({
          data: {
            id: "usr_admin_001",
            email: envAdminEmail,
            name: "Administrator",
            passwordHash: adminPasswordHash,
            role: "ADMIN",
            isActive: true,
          },
        });
      }

      // 2. Initialize System Settings
      const defaultSettings = [
        {
          key: "ALLOW_PUBLIC_REGISTRATION",
          value: "true",
          description: "Mengizinkan pengguna baru melakukan pendaftaran akun mandiri dari halaman login",
        },
        {
          key: "MAX_FILE_SIZE_MB",
          value: "200",
          description: "Maximum allowable upload size per file in megabytes",
        },
        {
          key: "DEFAULT_DRIVE_TYPE",
          value: "MY_DRIVE",
          description: "Default Google Drive target space (MY_DRIVE or SHARED_DRIVE)",
        },
        {
          key: "ALLOWED_EXTENSIONS",
          value: "pdf,doc,docx,xls,xlsx,ppt,pptx,csv,zip,rar,7z,jpg,jpeg,png,gif,webp,txt,json",
          description: "Whitelisted file upload extensions",
        },
        {
          key: "MAX_SYNC_ATTEMPTS",
          value: "5",
          description: "Maximum automatic retry attempts for failed sync jobs",
        },
      ];

      for (const setting of defaultSettings) {
        await prisma.systemSetting.upsert({
          where: { key: setting.key },
          update: {},
          create: setting,
        });
      }

      this.initialized = true;
    } catch (err) {
      console.error("[DatabaseService] Failed to initialize default database data:", err);
    }
  }

  // --- USER OPERATIONS ---
  public user = {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
      if (where.id) {
        return prisma.user.findUnique({ where: { id: where.id } });
      }
      if (where.email) {
        return prisma.user.findUnique({ where: { email: where.email.toLowerCase().trim() } });
      }
      return null;
    },
    findFirst: async (options?: { where?: { isActive?: boolean; role?: Role; email?: string } }) => {
      return prisma.user.findFirst({
        where: {
          isActive: options?.where?.isActive,
          role: options?.where?.role,
          email: options?.where?.email ? options.where.email.toLowerCase().trim() : undefined,
        },
      });
    },
    findMany: async (options?: { where?: { isActive?: boolean; role?: Role } }) => {
      return prisma.user.findMany({
        where: {
          isActive: options?.where?.isActive,
          role: options?.where?.role,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    },
    create: async ({ data }: { data: Omit<UserRecord, "id" | "createdAt" | "updatedAt"> }) => {
      return prisma.user.create({
        data: {
          ...data,
          email: data.email.toLowerCase().trim(),
        },
      });
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<UserRecord> }) => {
      return prisma.user.update({
        where: { id: where.id },
        data,
      });
    },
    delete: async ({ where }: { where: { id: string } }) => {
      return prisma.user.delete({
        where: { id: where.id },
      });
    },
  };

  // --- FOLDER OPERATIONS ---
  public folder = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const folder = await prisma.folder.findUnique({ where: { id: where.id } });
      if (!folder) return null;

      const fileWhere = folder.isTrashed
        ? { folderId: folder.id }
        : { folderId: folder.id, isTrashed: false };
      const subfolderWhere = folder.isTrashed
        ? { parentId: folder.id }
        : { parentId: folder.id, isTrashed: false };

      const files = await prisma.file.findMany({
        where: fileWhere,
      });
      const totalSizeBytes = files.reduce((sum, f) => sum + Number(f.size), 0);
      const filesCount = files.length;
      const subfoldersCount = await prisma.folder.count({
        where: subfolderWhere,
      });

      return {
        ...folder,
        permission: (folder.permission as FolderPermission) || "EDIT",
        filesCount,
        totalSizeBytes,
        subfoldersCount,
      };
    },
    count: async (options?: {
      where?: {
        parentId?: string | null;
        ownerId?: string;
        isTrashed?: boolean;
        name?: string;
        search?: string;
      };
      includeTrashed?: boolean;
    }) => {
      const whereClause: any = {};
      if (options?.where?.isTrashed !== undefined) {
        whereClause.isTrashed = options.where.isTrashed;
      } else if (!options?.includeTrashed) {
        whereClause.isTrashed = false;
      }

      if (options?.where?.parentId !== undefined) {
        whereClause.parentId = options.where.parentId;
      }

      if (options?.where?.ownerId) {
        whereClause.ownerId = options.where.ownerId;
      }

      const search = options?.where?.search || options?.where?.name;
      if (search && search.trim()) {
        whereClause.name = { contains: search.trim(), mode: "insensitive" };
      }

      return prisma.folder.count({
        where: whereClause,
      });
    },
    findMany: async (options?: {
      where?: {
        parentId?: string | null;
        ownerId?: string;
        isTrashed?: boolean;
        name?: string;
        search?: string;
      };
      includeTrashed?: boolean;
      skip?: number;
      take?: number;
      orderBy?: any;
    }) => {
      const whereClause: any = {};
      if (options?.where?.isTrashed !== undefined) {
        whereClause.isTrashed = options.where.isTrashed;
      } else if (!options?.includeTrashed) {
        whereClause.isTrashed = false;
      }

      if (options?.where?.parentId !== undefined) {
        whereClause.parentId = options.where.parentId;
      }

      if (options?.where?.ownerId) {
        whereClause.ownerId = options.where.ownerId;
      }

      const search = options?.where?.search || options?.where?.name;
      if (search && search.trim()) {
        whereClause.name = { contains: search.trim(), mode: "insensitive" };
      }

      const queryOptions: any = {
        where: whereClause,
        orderBy: options?.orderBy || { name: "asc" },
      };

      if (options?.skip !== undefined) {
        queryOptions.skip = options.skip;
      }
      if (options?.take !== undefined) {
        queryOptions.take = options.take;
      }

      const folders = await prisma.folder.findMany(queryOptions);

      return Promise.all(
        folders.map(async (folder) => {
          const fileWhere = folder.isTrashed
            ? { folderId: folder.id }
            : { folderId: folder.id, isTrashed: false };
          const subfolderWhere = folder.isTrashed
            ? { parentId: folder.id }
            : { parentId: folder.id, isTrashed: false };

          const files = await prisma.file.findMany({
            where: fileWhere,
          });
          const totalSizeBytes = files.reduce((sum, f) => sum + Number(f.size), 0);
          const filesCount = files.length;
          const subfoldersCount = await prisma.folder.count({
            where: subfolderWhere,
          });

          return {
            ...folder,
            permission: (folder.permission as FolderPermission) || "EDIT",
            filesCount,
            totalSizeBytes,
            subfoldersCount,
          };
        })
      );
    },
    create: async ({ data }: { data: Omit<FolderRecord, "id" | "createdAt" | "updatedAt"> }) => {
      return prisma.folder.create({
        data: {
          ...data,
          isTrashed: false,
          trashedAt: null,
          trashedBy: null,
        },
      });
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<FolderRecord> }) => {
      return prisma.folder.update({
        where: { id: where.id },
        data,
      });
    },
    trash: async ({ where, userId }: { where: { id: string }; userId?: string }) => {
      const now = new Date();
      const updated = await prisma.folder.update({
        where: { id: where.id },
        data: {
          isTrashed: true,
          trashedAt: now,
          trashedBy: userId || null,
        },
      });

      // Find all descendant folders recursively
      const folderIds = [where.id];
      const queue = [where.id];
      while (queue.length > 0) {
        const curId = queue.shift()!;
        const children = await prisma.folder.findMany({
          where: { parentId: curId },
          select: { id: true },
        });
        for (const child of children) {
          folderIds.push(child.id);
          queue.push(child.id);
        }
      }

      // Mark all descendant folders as trashed
      await prisma.folder.updateMany({
        where: { id: { in: folderIds } },
        data: {
          isTrashed: true,
          trashedAt: now,
          trashedBy: userId || null,
        },
      });

      // Mark contained files in all descendant folders as trashed
      await prisma.file.updateMany({
        where: { folderId: { in: folderIds }, isTrashed: false },
        data: {
          isTrashed: true,
          trashedAt: now,
          trashedBy: userId || null,
        },
      });

      return updated;
    },
    restore: async ({ where }: { where: { id: string } }) => {
      const now = new Date();
      const updated = await prisma.folder.update({
        where: { id: where.id },
        data: {
          isTrashed: false,
          trashedAt: null,
          trashedBy: null,
        },
      });

      // Restore all ancestor folders if any are trashed
      let parentId = updated.parentId;
      while (parentId) {
        const parent = await prisma.folder.findUnique({ where: { id: parentId } });
        if (parent && parent.isTrashed) {
          await prisma.folder.update({
            where: { id: parent.id },
            data: { isTrashed: false, trashedAt: null, trashedBy: null },
          });
          parentId = parent.parentId;
        } else {
          break;
        }
      }

      // Find all descendant folders recursively
      const folderIds = [where.id];
      const queue = [where.id];
      while (queue.length > 0) {
        const curId = queue.shift()!;
        const children = await prisma.folder.findMany({
          where: { parentId: curId },
          select: { id: true },
        });
        for (const child of children) {
          folderIds.push(child.id);
          queue.push(child.id);
        }
      }

      // Restore all descendant folders
      await prisma.folder.updateMany({
        where: { id: { in: folderIds } },
        data: {
          isTrashed: false,
          trashedAt: null,
          trashedBy: null,
        },
      });

      // Restore direct and descendant trashed files
      await prisma.file.updateMany({
        where: { folderId: { in: folderIds }, isTrashed: true },
        data: {
          isTrashed: false,
          trashedAt: null,
          trashedBy: null,
        },
      });

      return updated;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      return prisma.folder.delete({
        where: { id: where.id },
      });
    },
  };

  // --- PASSWORD RESET OPERATIONS ---
  public passwordReset = {
    createToken: async (email: string) => {
      const token = `rst_${Math.random().toString(36).substring(2, 10)}_${Date.now().toString(36)}`;
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry
      this.passwordResetTokens.set(token, { email: email.toLowerCase().trim(), token, expiresAt });
      return { token, expiresAt };
    },
    verifyToken: async (token: string) => {
      const record = this.passwordResetTokens.get(token);
      if (!record) return null;
      if (record.expiresAt < new Date()) {
        this.passwordResetTokens.delete(token);
        return null;
      }
      return record;
    },
    consumeToken: async (token: string) => {
      this.passwordResetTokens.delete(token);
    },
  };

  // --- FILE OPERATIONS ---
  public file = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const f = await prisma.file.findUnique({
        where: { id: where.id },
        include: {
          user: true,
          folder: true,
        },
      });
      if (!f) return null;
      return {
        ...f,
        size: Number(f.size),
        folder: f.folder ? { ...f.folder, permission: (f.folder.permission as FolderPermission) || "EDIT" } : undefined,
        versionHistory: f.versionHistory as unknown as FileVersionRecord[] || undefined,
      };
    },
    findFirst: async (options?: {
      where?: {
        id?: string;
        folderId?: string;
        originalName?: string;
        userId?: string;
        syncStatus?: SyncStatus;
        checksumSha256?: string;
      };
    }) => {
      const f = (await prisma.file.findFirst({
        where: {
          id: options?.where?.id,
          folderId: options?.where?.folderId,
          originalName: options?.where?.originalName,
          userId: options?.where?.userId,
          syncStatus: options?.where?.syncStatus as any,
          checksumSha256: options?.where?.checksumSha256,
        },
        include: {
          user: true,
          folder: true,
        },
      })) as any;
      if (!f) return null;
      return {
        ...f,
        size: Number(f.size),
        folder: f.folder ? { ...f.folder, permission: (f.folder.permission as FolderPermission) || "EDIT" } : undefined,
        versionHistory: f.versionHistory as unknown as FileVersionRecord[] || undefined,
      };
    },
    findMany: async (options?: {
      where?: {
        id?: string | { in: string[] };
        ids?: string[];
        userId?: string;
        folderId?: string;
        syncStatus?: SyncStatus;
        checksumSha256?: string;
        isTrashed?: boolean;
        originalName?: string;
        search?: string;
      };
      includeTrashed?: boolean;
      skip?: number;
      take?: number;
      orderBy?: any;
    }) => {
      const whereClause: any = {};
      if (options?.where?.isTrashed !== undefined) {
        whereClause.isTrashed = options.where.isTrashed;
      } else if (!options?.includeTrashed) {
        whereClause.isTrashed = false;
      }

      if (options?.where?.id) {
        if (typeof options.where.id === "string") {
          whereClause.id = options.where.id;
        } else if (Array.isArray(options.where.id.in)) {
          whereClause.id = { in: options.where.id.in };
        }
      }
      if (options?.where?.ids && Array.isArray(options.where.ids)) {
        whereClause.id = { in: options.where.ids };
      }
      if (options?.where?.userId) {
        whereClause.userId = options.where.userId;
      }
      if (options?.where?.folderId !== undefined) {
        whereClause.folderId = options.where.folderId;
      }
      if (options?.where?.syncStatus) {
        whereClause.syncStatus = options.where.syncStatus;
      }
      if (options?.where?.checksumSha256) {
        whereClause.checksumSha256 = options.where.checksumSha256;
      }

      const search = options?.where?.search || options?.where?.originalName;
      if (search && search.trim()) {
        whereClause.originalName = { contains: search.trim(), mode: "insensitive" };
      }

      const queryOptions: any = {
        where: whereClause,
        include: {
          user: true,
          folder: true,
        },
        orderBy: options?.orderBy || {
          createdAt: "desc",
        },
      };

      if (options?.skip !== undefined) {
        queryOptions.skip = options.skip;
      }
      if (options?.take !== undefined) {
        queryOptions.take = options.take;
      }

      const files = await prisma.file.findMany(queryOptions);

      return files.map((f: any) => ({
        ...f,
        size: Number(f.size),
        folder: f.folder ? { ...f.folder, permission: (f.folder.permission as FolderPermission) || "EDIT" } : undefined,
        versionHistory: f.versionHistory as unknown as FileVersionRecord[] || undefined,
      }));
    },
    create: async ({ data }: { data: Omit<FileRecord, "id" | "createdAt" | "updatedAt"> }) => {
      const createData: any = { ...data };
      delete createData.user;
      delete createData.folder;

      const created = (await prisma.file.create({
        data: {
          ...createData,
          size: BigInt(data.size),
          isTrashed: false,
          trashedAt: null,
          trashedBy: null,
        },
        include: {
          user: true,
          folder: true,
        },
      })) as any;
      return {
        ...created,
        size: Number(created.size),
        folder: created.folder ? { ...created.folder, permission: (created.folder.permission as FolderPermission) || "EDIT" } : undefined,
        versionHistory: created.versionHistory as unknown as FileVersionRecord[] || undefined,
      };
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<FileRecord> }) => {
      const updateData: any = { ...data };
      if (data.size !== undefined) {
        updateData.size = BigInt(data.size);
      }
      // Remove relations if provided to avoid prisma nested write errors
      delete updateData.user;
      delete updateData.folder;

      const updated = await prisma.file.update({
        where: { id: where.id },
        data: updateData,
        include: {
          user: true,
          folder: true,
        },
      });
      return {
        ...updated,
        size: Number(updated.size),
        folder: updated.folder ? { ...updated.folder, permission: (updated.folder.permission as FolderPermission) || "EDIT" } : undefined,
        versionHistory: updated.versionHistory as unknown as FileVersionRecord[] || undefined,
      };
    },
    trash: async ({ where, userId }: { where: { id: string }; userId?: string }) => {
      const updated = await prisma.file.update({
        where: { id: where.id },
        data: {
          isTrashed: true,
          trashedAt: new Date(),
          trashedBy: userId || null,
        },
        include: {
          user: true,
          folder: true,
        },
      });
      return {
        ...updated,
        size: Number(updated.size),
        folder: updated.folder ? { ...updated.folder, permission: (updated.folder.permission as FolderPermission) || "EDIT" } : undefined,
        versionHistory: updated.versionHistory as unknown as FileVersionRecord[] || undefined,
      };
    },
    restore: async ({ where }: { where: { id: string } }) => {
      const updated = await prisma.file.update({
        where: { id: where.id },
        data: {
          isTrashed: false,
          trashedAt: null,
          trashedBy: null,
        },
        include: {
          user: true,
          folder: true,
        },
      });

      // If the file belongs to a folder, and that folder (or any parent folder) is currently trashed,
      // restore the parent folder chain so the file appears in "Drive Saya".
      // NOTE: Other sibling files in that folder that are still trashed will remain trashed.
      if (updated.folderId) {
        let currentFolderId: string | null = updated.folderId;
        while (currentFolderId) {
          const parentFolder = await prisma.folder.findUnique({
            where: { id: currentFolderId },
          });
          if (parentFolder && parentFolder.isTrashed) {
            await prisma.folder.update({
              where: { id: parentFolder.id },
              data: {
                isTrashed: false,
                trashedAt: null,
                trashedBy: null,
              },
            });
            currentFolderId = parentFolder.parentId;
          } else {
            break;
          }
        }
      }

      return {
        ...updated,
        size: Number(updated.size),
        folder: updated.folder ? { ...updated.folder, permission: (updated.folder.permission as FolderPermission) || "EDIT" } : undefined,
        versionHistory: updated.versionHistory as unknown as FileVersionRecord[] || undefined,
      };
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const deleted = await prisma.file.delete({
        where: { id: where.id },
      });
      return {
        ...deleted,
        size: Number(deleted.size),
        versionHistory: deleted.versionHistory as unknown as FileVersionRecord[] || undefined,
      };
    },
    count: async (options?: {
      where?: {
        id?: string | { in: string[] };
        ids?: string[];
        syncStatus?: SyncStatus;
        userId?: string;
        folderId?: string;
        isTrashed?: boolean;
        originalName?: string;
        search?: string;
      };
      includeTrashed?: boolean;
    }) => {
      const whereClause: any = {};
      if (options?.where?.isTrashed !== undefined) {
        whereClause.isTrashed = options.where.isTrashed;
      } else if (!options?.includeTrashed) {
        whereClause.isTrashed = false;
      }
      if (options?.where?.syncStatus) {
        whereClause.syncStatus = options.where.syncStatus;
      }
      if (options?.where?.userId) {
        whereClause.userId = options.where.userId;
      }
      if (options?.where?.folderId !== undefined) {
        whereClause.folderId = options.where.folderId;
      }
      if (options?.where?.id) {
        if (typeof options.where.id === "string") {
          whereClause.id = options.where.id;
        } else if (Array.isArray(options.where.id.in)) {
          whereClause.id = { in: options.where.id.in };
        }
      }
      if (options?.where?.ids && Array.isArray(options.where.ids)) {
        whereClause.id = { in: options.where.ids };
      }
      const search = options?.where?.search || options?.where?.originalName;
      if (search && search.trim()) {
        whereClause.originalName = { contains: search.trim(), mode: "insensitive" };
      }
      return prisma.file.count({
        where: whereClause,
      });
    },
  };

  // --- TRASH OPERATIONS ---
  public trash = {
    list: async (options?: { userId?: string; isAdmin?: boolean }) => {
      const folderWhere: any = { isTrashed: true };
      const fileWhere: any = { isTrashed: true };

      if (!options?.isAdmin && options?.userId) {
        folderWhere.OR = [
          { ownerId: options.userId },
          { trashedBy: options.userId },
        ];
        fileWhere.OR = [
          { userId: options.userId },
          { trashedBy: options.userId },
        ];
      }

      const [trashedFolders, trashedFiles] = await Promise.all([
        prisma.folder.findMany({
          where: folderWhere,
          orderBy: { updatedAt: "desc" },
        }),
        prisma.file.findMany({
          where: fileWhere,
          include: {
            user: true,
            folder: true,
          },
          orderBy: { updatedAt: "desc" },
        }),
      ]);

      const mappedFiles = trashedFiles.map((f) => ({
        ...f,
        size: Number(f.size),
        folder: f.folder ? { ...f.folder, permission: (f.folder.permission as FolderPermission) || "EDIT" } : undefined,
      }));

      // Collect all candidate folders:
      // 1. Folders that are explicitly trashed
      // 2. Folders containing trashed files (even if the folder was un-trashed when a sibling file was restored)
      const folderMap = new Map<string, any>();
      for (const fld of trashedFolders) {
        folderMap.set(fld.id, fld);
      }

      for (const file of trashedFiles) {
        if (file.folderId && !folderMap.has(file.folderId)) {
          const folderObj = await prisma.folder.findUnique({ where: { id: file.folderId } });
          if (folderObj) {
            folderMap.set(folderObj.id, folderObj);
          }
        }
      }

      const allCandidateFolders = Array.from(folderMap.values());

      const mappedFolders = (
        await Promise.all(
          allCandidateFolders.map(async (fld) => {
            // Find all descendant folder IDs to count files recursively
            const folderIds = [fld.id];
            const queue = [fld.id];
            while (queue.length > 0) {
              const curId = queue.shift()!;
              const children = await prisma.folder.findMany({
                where: { parentId: curId },
                select: { id: true },
              });
              for (const child of children) {
                folderIds.push(child.id);
                queue.push(child.id);
              }
            }

            // ONLY COUNT TRASHED FILES
            const containedFiles = await prisma.file.findMany({
              where: {
                folderId: { in: folderIds },
                isTrashed: true,
              },
            });
            const totalSizeBytes = containedFiles.reduce((sum, f) => sum + Number(f.size), 0);
            const filesCount = containedFiles.length;
            const subfoldersCount = folderIds.length - 1;

            // If the folder is active (isTrashed: false) and has NO trashed files, do not show it in trash
            if (!fld.isTrashed && filesCount === 0) {
              return null;
            }

            return {
              ...fld,
              permission: (fld.permission as FolderPermission) || "EDIT",
              filesCount,
              totalSizeBytes,
              subfoldersCount,
            };
          })
        )
      ).filter(Boolean);

      return {
        folders: mappedFolders as any[],
        files: mappedFiles,
        total: mappedFolders.length + mappedFiles.length,
      };
    },
    count: async (options?: { userId?: string; isAdmin?: boolean }) => {
      const folderWhere: any = { isTrashed: true };
      const fileWhere: any = { isTrashed: true };

      if (!options?.isAdmin && options?.userId) {
        folderWhere.OR = [
          { ownerId: options.userId },
          { trashedBy: options.userId },
        ];
        fileWhere.OR = [
          { userId: options.userId },
          { trashedBy: options.userId },
        ];
      }

      const folderCount = await prisma.folder.count({ where: folderWhere });
      const fileCount = await prisma.file.count({ where: fileWhere });

      return folderCount + fileCount;
    },
  };

  // --- SYNC JOB OPERATIONS ---
  public syncJob = {
    findUnique: async ({ where }: { where: { id: string } }): Promise<SyncJobRecord | null> => {
      const j = await prisma.syncJob.findUnique({
        where: { id: where.id },
        include: {
          file: {
            include: {
              user: true,
              folder: true,
            },
          },
        },
      });
      if (!j) return null;
      return {
        ...j,
        file: j.file
          ? {
              ...j.file,
              size: Number(j.file.size),
              folder: j.file.folder
                ? { ...j.file.folder, permission: (j.file.folder.permission as FolderPermission) || "EDIT" }
                : undefined,
            }
          : undefined,
      } as unknown as SyncJobRecord;
    },
    findFirst: async (options?: { where?: { status?: SyncStatus; fileId?: string } }): Promise<SyncJobRecord | null> => {
      const j = (await prisma.syncJob.findFirst({
        where: {
          status: options?.where?.status as any,
          fileId: options?.where?.fileId,
        },
        include: {
          file: {
            include: {
              user: true,
              folder: true,
            },
          },
        },
      })) as any;
      if (!j) return null;
      return {
        ...j,
        file: j.file
          ? {
              ...j.file,
              size: Number(j.file.size),
              folder: j.file.folder
                ? { ...j.file.folder, permission: (j.file.folder.permission as FolderPermission) || "EDIT" }
                : undefined,
            }
          : undefined,
      } as unknown as SyncJobRecord;
    },
    findMany: async (options?: {
      where?: { status?: SyncStatus; fileId?: string };
      take?: number;
    }): Promise<SyncJobRecord[]> => {
      const jobs = (await prisma.syncJob.findMany({
        where: {
          status: options?.where?.status as any,
          fileId: options?.where?.fileId,
        },
        include: {
          file: {
            include: {
              user: true,
              folder: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: options?.take,
      })) as any[];

      return jobs.map((j) => ({
        ...j,
        file: j.file
          ? {
              ...j.file,
              size: Number(j.file.size),
              folder: j.file.folder
                ? { ...j.file.folder, permission: (j.file.folder.permission as FolderPermission) || "EDIT" }
                : undefined,
            }
          : undefined,
      })) as unknown as SyncJobRecord[];
    },
    create: async ({ data }: { data: Omit<SyncJobRecord, "id" | "createdAt" | "updatedAt"> }): Promise<SyncJobRecord> => {
      const createData: any = { ...data };
      delete createData.file;

      const created = (await prisma.syncJob.create({
        data: createData,
        include: {
          file: {
            include: {
              user: true,
              folder: true,
            },
          },
        },
      })) as any;
      return {
        ...created,
        file: created.file
          ? {
              ...created.file,
              size: Number(created.file.size),
              folder: created.file.folder
                ? { ...created.file.folder, permission: (created.file.folder.permission as FolderPermission) || "EDIT" }
                : undefined,
            }
          : undefined,
      } as unknown as SyncJobRecord;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<SyncJobRecord> }): Promise<SyncJobRecord> => {
      const updateData: any = { ...data };
      delete updateData.file;

      const updated = (await prisma.syncJob.update({
        where: { id: where.id },
        data: updateData,
        include: {
          file: {
            include: {
              user: true,
              folder: true,
            },
          },
        },
      })) as any;
      return {
        ...updated,
        file: updated.file
          ? {
              ...updated.file,
              size: Number(updated.file.size),
              folder: updated.file.folder
                ? { ...updated.file.folder, permission: (updated.file.folder.permission as FolderPermission) || "EDIT" }
                : undefined,
            }
          : undefined,
      } as unknown as SyncJobRecord;
    },
    delete: async ({ where }: { where: { id: string } }): Promise<SyncJobRecord> => {
      const deleted = (await prisma.syncJob.delete({
        where: { id: where.id },
        include: {
          file: {
            include: {
              user: true,
              folder: true,
            },
          },
        },
      })) as any;
      return {
        ...deleted,
        file: deleted.file
          ? {
              ...deleted.file,
              size: Number(deleted.file.size),
              folder: deleted.file.folder
                ? { ...deleted.file.folder, permission: (deleted.file.folder.permission as FolderPermission) || "EDIT" }
                : undefined,
            }
          : undefined,
      } as unknown as SyncJobRecord;
    },
  };

  // --- GOOGLE DRIVE CONNECTION OPERATIONS ---
  public googleDriveConnection = {
    findFirst: async (options?: {
      where?: {
        userId?: string | null;
        accountEmail?: string;
        isConnected?: boolean;
      };
    }) => {
      const whereClause: any = {};
      if (options?.where?.userId !== undefined) {
        whereClause.userId = options.where.userId;
      }
      if (options?.where?.accountEmail) {
        whereClause.accountEmail = options.where.accountEmail.toLowerCase().trim();
      }
      if (options?.where?.isConnected !== undefined) {
        whereClause.isConnected = options.where.isConnected;
      }
      const record = await prisma.googleDriveConnection.findFirst({
        where: whereClause,
      });
      if (!record) return null;
      return {
        ...record,
        selectedDriveType: (record.selectedDriveType as DriveType) || "MY_DRIVE",
      };
    },
    findMany: async (options?: {
      where?: {
        userId?: string | null;
        isConnected?: boolean;
      };
    }) => {
      const whereClause: any = {};
      if (options?.where?.userId !== undefined) {
        whereClause.userId = options.where.userId;
      }
      if (options?.where?.isConnected !== undefined) {
        whereClause.isConnected = options.where.isConnected;
      }
      const records = await prisma.googleDriveConnection.findMany({
        where: whereClause,
      });
      return records.map((record) => ({
        ...record,
        selectedDriveType: (record.selectedDriveType as DriveType) || "MY_DRIVE",
      }));
    },
    upsert: async ({
      where,
      data,
    }: {
      where?: { id?: string; userId?: string | null; accountEmail?: string };
      data: Omit<GoogleDriveConnectionRecord, "id" | "createdAt" | "updatedAt">;
    }) => {
      let existing: any = null;
      if (where?.id) {
        existing = await prisma.googleDriveConnection.findUnique({ where: { id: where.id } });
      } else if (where?.userId || data.userId) {
        existing = await prisma.googleDriveConnection.findFirst({
          where: { userId: where?.userId || data.userId },
        });
      } else if (where?.accountEmail || data.accountEmail) {
        existing = await prisma.googleDriveConnection.findFirst({
          where: { accountEmail: (where?.accountEmail || data.accountEmail).toLowerCase().trim() },
        });
      }

      const mappedData: any = {
        ...data,
        accountEmail: data.accountEmail.toLowerCase().trim(),
        selectedDriveType: data.selectedDriveType || "MY_DRIVE",
      };

      if (existing) {
        const record = await prisma.googleDriveConnection.update({
          where: { id: existing.id },
          data: mappedData,
        });
        return {
          ...record,
          selectedDriveType: (record.selectedDriveType as DriveType) || "MY_DRIVE",
        };
      } else {
        const record = await prisma.googleDriveConnection.create({
          data: mappedData,
        });
        return {
          ...record,
          selectedDriveType: (record.selectedDriveType as DriveType) || "MY_DRIVE",
        };
      }
    },
    create: async ({ data }: { data: Omit<GoogleDriveConnectionRecord, "id" | "createdAt" | "updatedAt"> }) => {
      const mappedData: any = {
        ...data,
        accountEmail: data.accountEmail.toLowerCase().trim(),
        selectedDriveType: data.selectedDriveType || "MY_DRIVE",
      };
      const record = await prisma.googleDriveConnection.create({
        data: mappedData,
      });
      return {
        ...record,
        selectedDriveType: (record.selectedDriveType as DriveType) || "MY_DRIVE",
      };
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const record = await prisma.googleDriveConnection.findUnique({
        where: { id: where.id },
      });
      if (!record) return null;
      return {
        ...record,
        selectedDriveType: (record.selectedDriveType as DriveType) || "MY_DRIVE",
      };
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<GoogleDriveConnectionRecord> }) => {
      const updateData: any = { ...data };
      const record = await prisma.googleDriveConnection.update({
        where: { id: where.id },
        data: updateData,
      });
      return {
        ...record,
        selectedDriveType: (record.selectedDriveType as DriveType) || "MY_DRIVE",
      };
    },
    deleteMany: async (options?: { where?: { userId?: string | null; accountEmail?: string } }) => {
      const whereClause: any = {};
      if (options?.where?.userId !== undefined) {
        whereClause.userId = options.where.userId;
      }
      if (options?.where?.accountEmail) {
        whereClause.accountEmail = options.where.accountEmail.toLowerCase().trim();
      }
      return prisma.googleDriveConnection.deleteMany({
        where: whereClause,
      });
    },
  };

  // --- ACTIVITY LOG OPERATIONS ---
  public activityLog = {
    create: async ({ data }: { data: Omit<ActivityLogRecord, "id" | "createdAt"> }) => {
      const createData: any = { ...data };
      delete createData.user;
      return prisma.activityLog.create({
        data: {
          ...createData,
          details: data.details as any || undefined,
        } as any,
      });
    },
    findMany: async (options?: {
      where?: { userId?: string; action?: ActivityAction };
      take?: number;
    }) => {
      const logs = await prisma.activityLog.findMany({
        where: {
          userId: options?.where?.userId,
          action: options?.where?.action as any,
        },
        include: {
          user: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: options?.take,
      });
      return logs.map((log) => ({
        ...log,
        action: log.action as ActivityAction,
      }));
    },
  };

  // --- SYSTEM SETTINGS OPERATIONS ---
  public systemSetting = {
    findUnique: async ({ where }: { where: { key: string } }) => {
      return prisma.systemSetting.findUnique({
        where: { key: where.key },
      });
    },
    findMany: async () => {
      return prisma.systemSetting.findMany();
    },
    upsert: async ({
      where,
      update,
      create,
    }: {
      where: { key: string };
      update: { value: string; description?: string };
      create: { key: string; value: string; description?: string };
    }) => {
      return prisma.systemSetting.upsert({
        where: { key: where.key },
        update,
        create,
      });
    },
  };
}

export const db = new DatabaseService();
