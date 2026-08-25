import fs from "fs";
import path from "path";
import mime from "mime-types";
import crypto from "crypto";
import { execSync } from "child_process";
import { db, prisma } from "../db/index.ts";
import { ActivityAction, FileRecord, SyncStatus } from "../types/index.ts";
import { mountIndexerService, IndexerStatus, IndexingState } from "./mount-indexer.service.ts";

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
    const indexerStatus = mountIndexerService.getStatus();

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
          isIndexing: indexerStatus.isIndexing,
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
            isIndexing: indexerStatus.isIndexing,
            indexingState: indexerStatus.state,
          });
        }
      }
    } catch (err) {
      console.error("[MountService] Error listing mounts:", err);
    }

    return result;
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
    // Instantly trigger background scan for this mount point
    mountIndexerService.indexSingleMount(mount.mountPoint, mount.id).catch((err) => {
      console.error(`[MountService] Failed to perform initial scan on mount:`, err);
    });
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
   * Browse files and folders inside a mount point - Reads from PostgreSQL Metadata Index
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

    // 1. Perform immediate on-demand indexing of this folder and its direct children
    await mountIndexerService.indexFolderOnDemand(targetPath, mountPoint, mountId);

    // 2. Identify current directory folder ID in DB
    const currentFolderId =
      subPath === ""
        ? mountId
        : "folder-" + crypto.createHash("md5").update(targetPath).digest("hex");

    const page = Math.max(1, options?.page || 1);
    const limit = Math.max(1, Math.min(200, options?.limit || 100));
    const search = options?.search?.trim();

    // Query db subfolders
    const folderWhere: any = {
      parentId: currentFolderId,
      storageId: mountId,
    };
    if (search) {
      folderWhere.name = { contains: search, mode: "insensitive" };
    }

    const dbFolders = await db.folder.findMany({
      where: folderWhere,
      orderBy: { name: "asc" },
    });

    // Query db files
    const fileWhere: any = {
      folderId: currentFolderId,
      storageId: mountId,
    };
    if (search) {
      fileWhere.originalName = { contains: search, mode: "insensitive" };
    }

    const dbFiles = await db.file.findMany({
      where: fileWhere,
      orderBy: { originalName: "asc" },
    });

    const allItems: MountFileItem[] = [];

    // Map subfolders
    for (const folder of dbFolders) {
      const full = folder.targetFolderPath;
      const relative = path.relative(mountPoint, full).replace(/\\/g, "/");

      allItems.push({
        id: folder.id,
        name: folder.name,
        relativePath: relative,
        fullPath: full,
        mountId,
        isDirectory: true,
        size: 0,
        mimeType: "inode/directory",
        modifiedAt: folder.updatedAt.toISOString(),
        extension: "",
        isImage: false,
        isVideo: false,
        isAudio: false,
        isPdf: false,
        isText: false,
        isOfficeDoc: false,
        isArchive: false,
      });
    }

    // Map files
    for (const file of dbFiles) {
      const full = file.storagePath;
      const relative = file.storageKey || path.relative(mountPoint, full).replace(/\\/g, "/");
      const ext = file.originalName.split(".").pop()?.toLowerCase() || "";
      const mimeType = file.mimeType;

      const isImage =
        mimeType.startsWith("image/") ||
        /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|avif)$/i.test(file.originalName);
      const isVideo =
        mimeType.startsWith("video/") ||
        /\.(mp4|webm|ogg|mov|mkv|avi|m4v)$/i.test(file.originalName);
      const isAudio =
        mimeType.startsWith("audio/") ||
        /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.originalName);
      const isPdf =
        mimeType === "application/pdf" || /\.pdf$/i.test(file.originalName);
      const isText =
        mimeType.startsWith("text/") ||
        mimeType.includes("json") ||
        mimeType.includes("javascript") ||
        mimeType.includes("typescript") ||
        mimeType.includes("xml") ||
        /\.(txt|md|csv|tsv|json|js|ts|tsx|jsx|html|css|scss|xml|yaml|yml|sql|log|env|py|sh|bat|ini|conf)$/i.test(
          file.originalName
        );
      const isOfficeDoc =
        /\.(docx?|xlsx?|pptx?|odt|ods|odp)$/i.test(file.originalName) ||
        mimeType.includes("word") ||
        mimeType.includes("sheet") ||
        mimeType.includes("presentation");
      const isArchive = /\.(zip|rar|7z|tar|gz|bz2)$/i.test(file.originalName);

      allItems.push({
        id: file.id,
        name: file.originalName,
        relativePath: relative,
        fullPath: full,
        mountId,
        isDirectory: false,
        size: Number(file.size),
        mimeType,
        modifiedAt: file.updatedAt.toISOString(),
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

    const indexerStatus = mountIndexerService.getStatus();

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
      isIndexing: indexerStatus.isIndexing,
      indexingStatus: indexerStatus,
    };
  }

  /**
   * Create a new folder inside a mount and update PostgreSQL metadata
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

    // Write metadata immediately to PostgreSQL
    const mountFolder = this.listMounts().find((m) => m.mountPoint === mountPoint);
    const mountId = mountFolder?.id || "mount-default";
    const parentId =
      subPath === ""
        ? mountId
        : "folder-" + crypto.createHash("md5").update(targetParent).digest("hex");
    const folderId = "folder-" + crypto.createHash("md5").update(newDirPath).digest("hex");

    await prisma.folder.upsert({
      where: { id: folderId },
      update: {
        name: sanitized,
        parentId,
        targetFolderPath: newDirPath,
        storageId: mountId,
        source: "MOUNT",
      },
      create: {
        id: folderId,
        name: sanitized,
        parentId,
        targetFolderPath: newDirPath,
        storageId: mountId,
        source: "MOUNT",
      },
    });

    return newDirPath;
  }

  /**
   * Rename a file or directory inside /mnt and re-index metadata
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

    const stat = fs.statSync(sourcePath);
    await fs.promises.rename(sourcePath, destPath);

    const mount = this.listMounts().find((m) => m.mountPoint === mountPoint);
    const mountId = mount?.id || "mount-default";

    // Clean old metadata
    if (stat.isDirectory()) {
      const oldFolderId = "folder-" + crypto.createHash("md5").update(sourcePath).digest("hex");
      await prisma.folder.delete({ where: { id: oldFolderId } }).catch(() => {});
    } else {
      const oldFileId = "file-" + crypto.createHash("md5").update(sourcePath).digest("hex");
      await prisma.file.delete({ where: { id: oldFileId } }).catch(() => {});
    }

    // Re-index parent folder
    await mountIndexerService.indexFolderOnDemand(dir, mountPoint, mountId);

    return { oldPath: sourcePath, newPath: destPath };
  }

  /**
   * Delete a file or directory inside /mnt and update PostgreSQL metadata
   */
  public async deleteItem(mountPoint: string, itemRelativePath: string): Promise<void> {
    const target = this.resolveSafePath(mountPoint, itemRelativePath);
    if (!fs.existsSync(target)) {
      throw new Error("Item tidak ditemukan pada penyimpanan fisik");
    }
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      fs.rmSync(target, { recursive: true, force: true });
      const folderId = "folder-" + crypto.createHash("md5").update(target).digest("hex");
      await prisma.file.deleteMany({ where: { folderId } }).catch(() => {});
      await prisma.folder.delete({ where: { id: folderId } }).catch(() => {});
    } else {
      fs.unlinkSync(target);
      const fileId = "file-" + crypto.createHash("md5").update(target).digest("hex");
      await prisma.file.delete({ where: { id: fileId } }).catch(() => {});
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
   * Save uploaded binary file directly to mount storage and update PostgreSQL metadata
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

    const parentId =
      subPath === ""
        ? mountId
        : "folder-" + crypto.createHash("md5").update(targetDir).digest("hex");

    const md5 = crypto.createHash("md5").update(destPath).digest("hex");
    const fileId = "file-" + md5;
    const relativePath = path.relative(mountPoint, destPath).replace(/\\/g, "/");
    const checksum = crypto
      .createHash("sha256")
      .update(destPath + stat.size + stat.mtime.toISOString())
      .digest("hex");

    await prisma.file.upsert({
      where: { id: fileId },
      update: {
        originalName: file.originalname,
        storedName: file.originalname,
        storagePath: destPath,
        mimeType: file.mimetype || mime.lookup(file.originalname) || "application/octet-stream",
        size: BigInt(stat.size),
        checksumSha256: checksum,
        storageId: mountId,
        storageKey: relativePath,
        updatedAt: new Date(),
      },
      create: {
        id: fileId,
        userId: "usr_admin_001",
        folderId: parentId,
        originalName: file.originalname,
        storedName: file.originalname,
        storagePath: destPath,
        mimeType: file.mimetype || mime.lookup(file.originalname) || "application/octet-stream",
        size: BigInt(stat.size),
        checksumSha256: checksum,
        storageId: mountId,
        storageKey: relativePath,
      },
    });

    const ext = file.originalname.split(".").pop()?.toLowerCase() || "";
    const mimeType = file.mimetype;

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
}

export const mountService = new MountService();
