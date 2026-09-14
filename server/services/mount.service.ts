import fs from "fs";
import path from "path";
import mime from "mime-types";
import crypto from "crypto";
import { execSync } from "child_process";
import { db, prisma } from "../db/index.ts";
import { ActivityAction, FileRecord, SyncStatus } from "../types/index.ts";

export type IndexingState = "pending" | "indexing" | "ready" | "error";

export interface IndexerStatus {
  state: IndexingState;
  isIndexing: boolean;
  lastIndexedAt: string | null;
  totalIndexedFiles: number;
  totalIndexedFolders: number;
  currentlyIndexingFolder: string | null;
  queueLength: number;
  lastError: string | null;
  reconciliationCount: number;
}

export interface MountInfo {
  id: string;
  name: string;
  mountPoint: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  isMounted: boolean;
  itemCount: number;
  filesCount: number;
  dirsCount: number;
  createdAt: string;
  updatedAt: string;
  isWritable: boolean;
  isIndexing?: boolean;
  indexingState?: IndexingState;
  allowedEmails?: string[];
}

export interface MountFileItem {
  id: string;
  name: string;
  relativePath: string;
  fullPath: string;
  mountId: string;
  isDirectory: boolean;
  size: number;
  mimeType: string;
  modifiedAt: string;
  extension: string;
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
  isPdf: boolean;
  isText: boolean;
  isOfficeDoc: boolean;
  isArchive: boolean;
}

export class MountService {
  private baseMountPath: string = "/mnt";

  constructor() {
    this.ensureMountBaseDir();
  }

  /**
   * Helper to query dynamic Linux partition storage usage
   */
  private getDiskSpace(mountPath: string): { totalBytes: number; usedBytes: number; freeBytes: number } {
    try {
      const output = execSync(`df -Pk "${mountPath}"`, { encoding: "utf-8" });
      const lines = output.trim().split("\n");
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        if (parts.length >= 4) {
          const totalKB = parseInt(parts[1], 10);
          const usedKB = parseInt(parts[2], 10);
          const freeKB = parseInt(parts[3], 10);
          if (!isNaN(totalKB) && !isNaN(usedKB) && !isNaN(freeKB)) {
            return {
              totalBytes: totalKB * 1024,
              usedBytes: usedKB * 1024,
              freeBytes: freeKB * 1024,
            };
          }
        }
      }
    } catch (e) {
      // fallback
    }
    return {
      totalBytes: 50 * 1024 * 1024 * 1024, // 50 GB default fallback
      usedBytes: 5 * 1024 * 1024 * 1024,   // 5 GB default fallback
      freeBytes: 45 * 1024 * 1024 * 1024,  // 45 GB default fallback
    };
  }

  private ensureMountBaseDir() {
    try {
      if (!fs.existsSync(this.baseMountPath)) {
        fs.mkdirSync(this.baseMountPath, { recursive: true });
      }
    } catch (err) {
      console.warn("[MountService] Notice in ensureMountBaseDir:", err);
    }
  }

  private getSystemMountPoints(): Set<string> {
    const mounts = new Set<string>();
    try {
      if (fs.existsSync("/proc/mounts")) {
        const lines = fs.readFileSync("/proc/mounts", "utf-8").split("\n");
        for (const line of lines) {
          const parts = line.split(" ");
          if (parts.length >= 2) {
            const mountTarget = parts[1];
            if (mountTarget === "/mnt" || mountTarget.startsWith("/mnt/")) {
              mounts.add(mountTarget);
            }
          }
        }
      }
    } catch {
      // ignore
    }
    return mounts;
  }

  /**
   * Scans and lists all mounts inside /mnt
   */
  public listMounts(): MountInfo[] {
    this.ensureMountBaseDir();
    const systemMounts = this.getSystemMountPoints();
    const result: MountInfo[] = [];

    try {
      if (!fs.existsSync(this.baseMountPath)) {
        return [];
      }

      const entries = fs.readdirSync(this.baseMountPath, { withFileTypes: true });

      // If /mnt itself has files directly or is a mount
      const directFiles = entries.filter((e) => !e.isDirectory());
      if (directFiles.length > 0 || systemMounts.has("/mnt")) {
        const stat = fs.statSync(this.baseMountPath);
        const diskSpace = this.getDiskSpace(this.baseMountPath);
        result.push({
          id: "mnt-root",
          name: "Root Mount (/mnt)",
          mountPoint: "/mnt",
          totalBytes: diskSpace.totalBytes,
          usedBytes: diskSpace.usedBytes,
          freeBytes: diskSpace.freeBytes,
          isMounted: true,
          itemCount: entries.length,
          filesCount: directFiles.length,
          dirsCount: entries.length - directFiles.length,
          createdAt: stat.birthtime.toISOString(),
          updatedAt: stat.mtime.toISOString(),
          isWritable: true,
          isIndexing: false,
        });
      }

      // Loop through all subdirectories in /mnt
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const mountPath = path.join(this.baseMountPath, entry.name);
          const safeId = "mount-" + Buffer.from(entry.name).toString("hex").substring(0, 16);
          const formattedName = entry.name
            .split(/[-_]/)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");

          let stat: fs.Stats;
          try {
            stat = fs.statSync(mountPath);
          } catch {
            continue;
          }

          const diskSpace = this.getDiskSpace(mountPath);

          let isWritable = false;
          try {
            fs.accessSync(mountPath, fs.constants.W_OK);
            isWritable = true;
          } catch {
            isWritable = false;
          }

          result.push({
            id: safeId,
            name: formattedName,
            mountPoint: mountPath,
            totalBytes: diskSpace.totalBytes,
            usedBytes: diskSpace.usedBytes,
            freeBytes: diskSpace.freeBytes,
            isMounted: true,
            itemCount: 0,
            filesCount: 0,
            dirsCount: 0,
            createdAt: stat.birthtime.toISOString(),
            updatedAt: stat.mtime.toISOString(),
            isWritable,
            isIndexing: false,
            indexingState: "ready",
          });
        }
      }
    } catch (err) {
      console.error("[MountService] Error listing mounts:", err);
    }

    return result;
  }

  /**
   * Get allowed emails for a specific mount ID
   */
  public async getMountPermissions(mountId: string): Promise<string[]> {
    try {
      const key = `MOUNT_PERM_${mountId}`;
      const setting = await db.systemSetting.findUnique({ where: { key } });
      if (!setting || !setting.value) return [];
      const parsed = JSON.parse(setting.value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Get all mount permissions mapping
   */
  public async getAllMountPermissions(): Promise<Record<string, string[]>> {
    try {
      const settings = await db.systemSetting.findMany();
      const result: Record<string, string[]> = {};
      for (const s of settings) {
        if (s.key.startsWith("MOUNT_PERM_")) {
          const mountId = s.key.replace("MOUNT_PERM_", "");
          try {
            result[mountId] = JSON.parse(s.value);
          } catch {
            result[mountId] = [];
          }
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  /**
   * Set allowed emails for a mount
   */
  public async setMountPermissions(mountId: string, allowedEmails: string[]): Promise<string[]> {
    const key = `MOUNT_PERM_${mountId}`;
    const cleanEmails = allowedEmails
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    await db.systemSetting.upsert({
      where: { key },
      create: {
        key,
        value: JSON.stringify(cleanEmails),
        description: `Allowed user emails for mount ${mountId}`,
      },
      update: {
        value: JSON.stringify(cleanEmails),
      },
    });

    return cleanEmails;
  }

  /**
   * Check if a user is permitted to access a mount
   */
  public async isUserAllowedForMount(
    user: { email?: string; role?: string } | null | undefined,
    mountId: string
  ): Promise<boolean> {
    if (!user) return false;
    if (user.role === "ADMIN") return true;

    const allowed = await this.getMountPermissions(mountId);
    if (allowed.length === 0 || allowed.includes("*")) {
      return true;
    }
    if (!user.email) return false;
    return allowed.includes(user.email.toLowerCase().trim());
  }

  /**
   * List mounts filtered and populated with permission metadata for a given user
   */
  public async listMountsForUser(user?: { email?: string; role?: string } | null): Promise<MountInfo[]> {
    const allMounts = this.listMounts();
    const permissionsMap = await this.getAllMountPermissions();

    const populatedMounts = allMounts.map((m) => ({
      ...m,
      allowedEmails: permissionsMap[m.id] || [],
    }));

    if (!user || user.role === "ADMIN") {
      return populatedMounts;
    }

    const userEmail = (user.email || "").toLowerCase().trim();
    return populatedMounts.filter((m) => {
      const allowed = m.allowedEmails || [];
      if (allowed.length === 0 || allowed.includes("*")) {
        return true;
      }
      return allowed.includes(userEmail);
    });
  }

  public getMountById(mountId: string): MountInfo | null {
    const all = this.listMounts();
    return all.find((m) => m.id === mountId || m.mountPoint === mountId) || null;
  }

  /**
   * Create a new mount point folder in /mnt
   */
  public createMountPoint(folderName: string): MountInfo {
    const sanitized = folderName.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
    const targetPath = path.join(this.baseMountPath, sanitized);
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }
    const mount = this.listMounts().find((m) => m.mountPoint === targetPath);
    if (!mount) {
      throw new Error(`Gagal membuat titik pasang (mount point) pada ${targetPath}`);
    }
    return mount;
  }

  /**
   * Resolve and validate a safe file or directory path inside /mnt
   */
  public resolveSafePath(mountPoint: string, subPath: string = ""): string {
    const normalizedMount = path.resolve(mountPoint);
    if (!normalizedMount.startsWith(path.resolve(this.baseMountPath))) {
      throw new Error("Akses ditolak: Titik pasang di luar lingkup /mnt");
    }

    const cleanSub = subPath.replace(/^(\.\.[\/\\])+/, "").trim();
    const target = path.resolve(normalizedMount, cleanSub);

    if (!target.startsWith(normalizedMount)) {
      throw new Error("Akses ditolak: Upaya pelanggaran direktori (Path Traversal)");
    }

    return target;
  }

  /**
   * Browse files and folders inside a mount point - Reads directly from the physical filesystem
   */
  public async browseDirectory(
    mountPoint: string,
    subPath: string = "",
    options?: { page?: number; limit?: number; search?: string }
  ): Promise<{
    mountPoint: string;
    currentPath: string;
    subPath: string;
    items: MountFileItem[];
    totalItems: number;
    page: number;
    limit: number;
    totalPages: number;
    breadcrumbs: { name: string; subPath: string }[];
    isIndexing: boolean;
    indexingStatus: IndexerStatus;
  }> {
    const targetPath = this.resolveSafePath(mountPoint, subPath);

    const mountFolder = this.listMounts().find((m) => m.mountPoint === mountPoint);
    const mountId = mountFolder?.id || "mount-default";

    const page = Math.max(1, options?.page || 1);
    const limit = Math.max(1, Math.min(200, options?.limit || 100));
    const search = options?.search?.trim()?.toLowerCase();

    const allItems: MountFileItem[] = [];

    if (fs.existsSync(targetPath)) {
      try {
        const entries = fs.readdirSync(targetPath, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;

          if (search && !entry.name.toLowerCase().includes(search)) {
            continue;
          }

          const full = path.join(targetPath, entry.name);
          const relative = path.relative(mountPoint, full).replace(/\\/g, "/");
          const entryId = crypto.createHash("md5").update(full).digest("hex");

          try {
            const stat = fs.statSync(full);
            const isDirectory = entry.isDirectory();

            if (isDirectory) {
              allItems.push({
                id: "folder-" + entryId,
                name: entry.name,
                relativePath: relative,
                fullPath: full,
                mountId,
                isDirectory: true,
                size: 0,
                mimeType: "inode/directory",
                modifiedAt: stat.mtime.toISOString(),
                extension: "",
                isImage: false,
                isVideo: false,
                isAudio: false,
                isPdf: false,
                isText: false,
                isOfficeDoc: false,
                isArchive: false,
              });
            } else {
              const ext = entry.name.split(".").pop()?.toLowerCase() || "";
              const mimeType = mime.lookup(entry.name) || "application/octet-stream";

              const isImage =
                mimeType.startsWith("image/") ||
                /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|avif)$/i.test(entry.name);
              const isVideo =
                mimeType.startsWith("video/") ||
                /\.(mp4|webm|ogg|mov|mkv|avi|m4v)$/i.test(entry.name);
              const isAudio =
                mimeType.startsWith("audio/") ||
                /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(entry.name);
              const isPdf =
                mimeType === "application/pdf" || /\.pdf$/i.test(entry.name);
              const isText =
                mimeType.startsWith("text/") ||
                mimeType.includes("json") ||
                mimeType.includes("javascript") ||
                mimeType.includes("typescript") ||
                mimeType.includes("xml") ||
                /\.(txt|md|csv|tsv|json|js|ts|tsx|jsx|html|css|scss|xml|yaml|yml|sql|log|env|py|sh|bat|ini|conf)$/i.test(
                  entry.name
                );
              const isOfficeDoc =
                /\.(docx?|xlsx?|pptx?|odt|ods|odp)$/i.test(entry.name) ||
                mimeType.includes("word") ||
                mimeType.includes("sheet") ||
                mimeType.includes("presentation");
              const isArchive = /\.(zip|rar|7z|tar|gz|bz2)$/i.test(entry.name);

              allItems.push({
                id: "file-" + entryId,
                name: entry.name,
                relativePath: relative,
                fullPath: full,
                mountId,
                isDirectory: false,
                size: stat.size,
                mimeType,
                modifiedAt: stat.mtime.toISOString(),
                extension: ext,
                isImage,
                isVideo,
                isAudio,
                isPdf,
                isText,
                isOfficeDoc,
                isArchive,
              });
            }
          } catch (err: any) {
            console.warn(`[MountService] Error statting entry ${entry.name} inside browseDirectory:`, err.message);
          }
        }
      } catch (err: any) {
        console.error(`[MountService] Error reading directory ${targetPath}:`, err);
      }
    }

    // Sort: directories first, then alphabetical
    allItems.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    });

    const totalItems = allItems.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const skip = (page - 1) * limit;
    const paginatedItems = allItems.slice(skip, skip + limit);

    // Generate breadcrumbs
    const parts = subPath.split("/").filter(Boolean);
    const breadcrumbs: { name: string; subPath: string }[] = [
      { name: mountFolder?.name || "Drive Utama", subPath: "" },
    ];
    let accumulated = "";
    for (const part of parts) {
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      breadcrumbs.push({ name: part, subPath: accumulated });
    }

    const indexerStatus = {
      state: "ready" as IndexingState,
      isIndexing: false,
      totalIndexedFolders: 0,
      totalIndexedFiles: 0,
      lastIndexedAt: new Date().toISOString(),
      lastError: null as string | null,
      currentlyIndexingFolder: null as string | null,
      queueLength: 0,
      reconciliationCount: 0,
    };

    return {
      mountPoint,
      currentPath: targetPath,
      subPath,
      items: paginatedItems,
      totalItems,
      page,
      limit,
      totalPages,
      breadcrumbs,
      isIndexing: false,
      indexingStatus: indexerStatus,
    };
  }

  /**
   * Create a new folder inside a mount directly on the physical filesystem
   */
  public async createFolder(mountPoint: string, subPath: string, folderName: string): Promise<string> {
    const targetParent = this.resolveSafePath(mountPoint, subPath);
    const sanitized = folderName.replace(/[\/\\:*?"<>|]/g, "_").trim();
    if (!sanitized) {
      throw new Error("Nama folder tidak valid");
    }
    const newDirPath = path.join(targetParent, sanitized);
    if (fs.existsSync(newDirPath)) {
      throw new Error("Folder dengan nama tersebut sudah ada");
    }
    fs.mkdirSync(newDirPath, { recursive: true });

    return newDirPath;
  }

  /**
   * Rename a file or directory inside /mnt
   */
  public async renameItem(
    mountPoint: string,
    itemRelativePath: string,
    newName: string
  ): Promise<{ oldPath: string; newPath: string }> {
    const sourcePath = this.resolveSafePath(mountPoint, itemRelativePath);
    if (!fs.existsSync(sourcePath)) {
      throw new Error("Item tidak ditemukan pada penyimpanan fisik");
    }
    const dir = path.dirname(sourcePath);
    const sanitized = newName.replace(/[\/\\:*?"<>|]/g, "_").trim();
    if (!sanitized) {
      throw new Error("Nama baru tidak valid");
    }
    const destPath = path.join(dir, sanitized);
    if (fs.existsSync(destPath)) {
      throw new Error(`Item dengan nama "${sanitized}" sudah ada`);
    }

    await fs.promises.rename(sourcePath, destPath);

    return { oldPath: sourcePath, newPath: destPath };
  }

  /**
   * Delete a file or directory inside /mnt
   */
  public async deleteItem(mountPoint: string, itemRelativePath: string): Promise<void> {
    const target = this.resolveSafePath(mountPoint, itemRelativePath);
    if (!fs.existsSync(target)) {
      throw new Error("Item tidak ditemukan pada penyimpanan fisik");
    }
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      fs.rmSync(target, { recursive: true, force: true });
    } else {
      fs.unlinkSync(target);
    }
  }

  /**
   * Read text content directly from physical storage
   */
  public readFileContent(
    mountPoint: string,
    relativePath: string
  ): { name: string; content: string; mimeType: string; size: number } {
    const target = this.resolveSafePath(mountPoint, relativePath);
    if (!fs.existsSync(target)) {
      throw new Error("Berkas tidak ditemukan");
    }
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      throw new Error("Path mengarah ke direktori, bukan berkas");
    }
    if (stat.size > 5 * 1024 * 1024) {
      throw new Error("Berkas terlalu besar untuk pratinjau teks (Maksimum 5MB)");
    }
    const content = fs.readFileSync(target, "utf-8");
    const name = path.basename(target);
    const mimeType = mime.lookup(name) || "text/plain";
    return { name, content, mimeType, size: stat.size };
  }

  /**
   * Save uploaded binary file directly to mount storage
   */
  public async saveUploadedFile(
    mountPoint: string,
    subPath: string,
    file: { originalname: string; buffer: Buffer; size: number; mimetype: string }
  ): Promise<MountFileItem> {
    const targetDir = this.resolveSafePath(mountPoint, subPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const destPath = path.join(targetDir, file.originalname);
    fs.writeFileSync(destPath, file.buffer);

    const stat = fs.statSync(destPath);
    const mountFolder = this.listMounts().find((m) => m.mountPoint === mountPoint);
    const mountId = mountFolder?.id || "mount-default";

    const md5 = crypto.createHash("md5").update(destPath).digest("hex");
    const fileId = "file-" + md5;
    const relativePath = path.relative(mountPoint, destPath).replace(/\\/g, "/");

    const ext = file.originalname.split(".").pop()?.toLowerCase() || "";
    const mimeType = file.mimetype || mime.lookup(file.originalname) || "application/octet-stream";

    return {
      id: fileId,
      name: file.originalname,
      relativePath,
      fullPath: destPath,
      mountId,
      isDirectory: false,
      size: stat.size,
      mimeType,
      modifiedAt: stat.mtime.toISOString(),
      extension: ext,
      isImage: mimeType.startsWith("image/"),
      isVideo: mimeType.startsWith("video/"),
      isAudio: mimeType.startsWith("audio/"),
      isPdf: mimeType === "application/pdf",
      isText: mimeType.startsWith("text/"),
      isOfficeDoc: false,
      isArchive: false,
    };
  }

  /**
   * Copy/Import a file from mounted storage directly into the App's Google Drive Sync buffer
   */
  public async importToGoogleDrive(
    mountPoint: string,
    relativePath: string,
    targetFolderId: string,
    userId: string
  ): Promise<FileRecord> {
    const sourcePath = this.resolveSafePath(mountPoint, relativePath);
    if (!fs.existsSync(sourcePath)) {
      throw new Error("Berkas sumber pada sistem mount tidak ditemukan");
    }
    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
      throw new Error("Tidak dapat mengimpor folder sebagai satu berkas; pilih berkas di dalamnya");
    }

    const folder = await db.folder.findUnique({ where: { id: targetFolderId } });
    if (!folder) {
      throw new Error("Folder tujuan aplikasi tidak ditemukan");
    }

    const originalName = path.basename(sourcePath);
    const mimeType = mime.lookup(originalName) || "application/octet-stream";

    // Read buffer and compute checksum
    const buffer = fs.readFileSync(sourcePath);
    const checksumSha256 = crypto.createHash("sha256").update(buffer).digest("hex");

    // Partition local storage path: storage/uploads/YYYY/MM/DD/uuid-name
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, "0");
    const day = now.getDate().toString().padStart(2, "0");
    const targetStorageDir = path.join(process.cwd(), "storage", "uploads", year, month, day);
    fs.mkdirSync(targetStorageDir, { recursive: true });

    const safeFileId = crypto.randomUUID();
    const destFileName = `${safeFileId}-${originalName}`;
    const destinationPath = path.join(targetStorageDir, destFileName);

    // Copy binary file to local storage buffer
    fs.copyFileSync(sourcePath, destinationPath);

    // Create database file metadata record
    const fileRecord = await db.file.create({
      data: {
        folderId: targetFolderId,
        userId,
        originalName,
        storedName: destFileName,
        storagePath: destinationPath,
        size: stat.size,
        mimeType,
        checksumSha256,
        syncStatus: SyncStatus.PENDING,
        syncAttempts: 0,
      },
    });

    // Create SyncJob in database
    await db.syncJob.create({
      data: {
        fileId: fileRecord.id,
        status: SyncStatus.PENDING,
        attempts: 0,
        maxAttempts: 5,
        scheduledAt: new Date(),
      },
    });

    // Log audit
    await db.activityLog.create({
      data: {
        userId,
        action: ActivityAction.MOUNT_ITEM_IMPORTED,
        resourceType: "FILE",
        resourceId: fileRecord.id,
        result: "SUCCESS",
        details: {
          sourceMountPoint: mountPoint,
          sourceRelativePath: relativePath,
          importedFileName: originalName,
          targetFolderId,
          sizeBytes: stat.size,
        },
      },
    });

    return fileRecord;
  }

  /**
   * Bulk move files or folders inside a mount point directly on the physical filesystem
   */
  public async bulkMoveMountItems(
    mountPoint: string,
    sourceRelativePaths: string[],
    targetFolderRelativePath: string
  ): Promise<{ success: boolean; message: string }> {
    const targetFolderAbs = this.resolveSafePath(mountPoint, targetFolderRelativePath);
    if (!fs.existsSync(targetFolderAbs) || !fs.statSync(targetFolderAbs).isDirectory()) {
      throw new Error("Folder tujuan tidak ditemukan atau bukan merupakan direktori.");
    }

    let movedCount = 0;
    for (const sourceRel of sourceRelativePaths) {
      const sourceAbs = this.resolveSafePath(mountPoint, sourceRel);
      if (!fs.existsSync(sourceAbs)) continue;

      const name = path.basename(sourceAbs);
      const destAbs = path.join(targetFolderAbs, name);

      if (sourceAbs === destAbs) continue;

      // Prevent moving a directory into itself or its descendants
      if (destAbs.startsWith(sourceAbs)) {
        throw new Error("Tidak dapat memindahkan folder ke dalam dirinya sendiri atau subfoldernya.");
      }

      await fs.promises.rename(sourceAbs, destAbs);
      movedCount++;
    }

    return {
      success: true,
      message: `Berhasil memindahkan ${movedCount} item ke folder tujuan.`,
    };
  }

  /**
   * Bulk copy files or folders inside a mount point directly on the physical filesystem
   */
  public async bulkCopyMountItems(
    mountPoint: string,
    sourceRelativePaths: string[],
    targetFolderRelativePath: string
  ): Promise<{ success: boolean; message: string }> {
    const targetFolderAbs = this.resolveSafePath(mountPoint, targetFolderRelativePath);
    if (!fs.existsSync(targetFolderAbs) || !fs.statSync(targetFolderAbs).isDirectory()) {
      throw new Error("Folder tujuan tidak ditemukan atau bukan merupakan direktori.");
    }

    let copiedCount = 0;
    for (const sourceRel of sourceRelativePaths) {
      const sourceAbs = this.resolveSafePath(mountPoint, sourceRel);
      if (!fs.existsSync(sourceAbs)) continue;

      const name = path.basename(sourceAbs);
      const destAbs = path.join(targetFolderAbs, name);

      if (sourceAbs === destAbs) continue;

      if (destAbs.startsWith(sourceAbs)) {
        throw new Error("Tidak dapat menyalin folder ke dalam dirinya sendiri atau subfoldernya.");
      }

      // Check if directory or file
      const stat = fs.statSync(sourceAbs);
      if (stat.isDirectory()) {
        fs.cpSync(sourceAbs, destAbs, { recursive: true });
      } else {
        fs.copyFileSync(sourceAbs, destAbs);
      }
      copiedCount++;
    }

    return {
      success: true,
      message: `Berhasil menyalin ${copiedCount} item ke folder tujuan.`,
    };
  }
}

export const mountService = new MountService();
