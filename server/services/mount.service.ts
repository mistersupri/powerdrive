import fs from "fs";
import path from "path";
import mime from "mime-types";
import crypto from "crypto";
import { execSync } from "child_process";
import { db } from "../db/index.ts";
import { ActivityAction, FileRecord, SyncStatus } from "../types/index.ts";

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

  /**
   * Ensures the /mnt directory exists without dummy/simulated default data
   */
  private ensureMountBaseDir() {
    try {
      if (!fs.existsSync(this.baseMountPath)) {
        fs.mkdirSync(this.baseMountPath, { recursive: true });
      }
    } catch (err) {
      console.warn("Notice in MountService.ensureMountBaseDir:", err);
    }
  }

  /**
   * Checks /proc/mounts if available to see which directories are mounted under /mnt
   */
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
   * Calculate directory size, file count and directory count
   */
  private getDirectoryStats(dirPath: string): { totalBytes: number; filesCount: number; dirsCount: number } {
    let totalBytes = 0;
    let filesCount = 0;
    let dirsCount = 0;
 
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const item of items) {
        const full = path.join(dirPath, item.name);
        try {
          if (item.isDirectory()) {
            dirsCount++;
            const sub = this.getDirectoryStats(full);
            totalBytes += sub.totalBytes;
            filesCount += sub.filesCount;
            dirsCount += sub.dirsCount;
          } else if (item.isFile()) {
            filesCount++;
            const stat = fs.statSync(full);
            totalBytes += stat.size;
          }
        } catch {
          // ignore inaccessible sub items
        }
      }
    } catch {
      // ignore
    }

    return { totalBytes, filesCount, dirsCount };
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
        const dirStats = this.getDirectoryStats(this.baseMountPath);
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
          filesCount: dirStats.filesCount,
          dirsCount: dirStats.dirsCount,
          createdAt: stat.birthtime.toISOString(),
          updatedAt: stat.mtime.toISOString(),
          isWritable: true,
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

          const dirStats = this.getDirectoryStats(mountPath);
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
            itemCount: dirStats.filesCount + dirStats.dirsCount,
            filesCount: dirStats.filesCount,
            dirsCount: dirStats.dirsCount,
            createdAt: stat.birthtime.toISOString(),
            updatedAt: stat.mtime.toISOString(),
            isWritable,
          });
        }
      }
    } catch (err) {
      console.error("Error listing mounts in MountService:", err);
    }

    return result;
  }

  /**
   * Find a mount by ID or mount point path
   */
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
   * Browse files and folders inside a mount point
   */
  public browseDirectory(mountPoint: string, subPath: string = ""): {
    mountPoint: string;
    currentPath: string;
    subPath: string;
    items: MountFileItem[];
    totalItems: number;
    breadcrumbs: { name: string; subPath: string }[];
  } {
    const targetPath = this.resolveSafePath(mountPoint, subPath);

    if (!fs.existsSync(targetPath)) {
      throw new Error(`Direktori tidak ditemukan: ${targetPath}`);
    }

    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      throw new Error(`Path bukan direktori: ${targetPath}`);
    }

    const mountFolder = this.listMounts().find((m) => m.mountPoint === mountPoint);
    const mountId = mountFolder?.id || "mount-default";

    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    const items: MountFileItem[] = [];

    for (const entry of entries) {
      const full = path.join(targetPath, entry.name);
      const isDirectory = entry.isDirectory();
      const relative = path.relative(mountPoint, full).replace(/\\/g, "/");

      let size = 0;
      let modifiedAt = new Date().toISOString();
      try {
        const itemStat = fs.statSync(full);
        size = itemStat.size;
        modifiedAt = itemStat.mtime.toISOString();
      } catch {
        // ignore
      }

      const ext = entry.name.split(".").pop()?.toLowerCase() || "";
      const mimeType = isDirectory ? "inode/directory" : (mime.lookup(entry.name) || "application/octet-stream");

      const isImage = !isDirectory && (mimeType.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|avif)$/i.test(entry.name));
      const isVideo = !isDirectory && (mimeType.startsWith("video/") || /\.(mp4|webm|ogg|mov|mkv|avi)$/i.test(entry.name));
      const isAudio = !isDirectory && (mimeType.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(entry.name));
      const isPdf = !isDirectory && (mimeType === "application/pdf" || /\.pdf$/i.test(entry.name));
      const isText = !isDirectory && (
        mimeType.startsWith("text/") ||
        mimeType.includes("json") ||
        mimeType.includes("javascript") ||
        mimeType.includes("typescript") ||
        mimeType.includes("xml") ||
        /\.(txt|md|csv|tsv|json|js|ts|tsx|jsx|html|css|scss|xml|yaml|yml|sql|log|env|py|sh|bat|ini|conf)$/i.test(entry.name)
      );
      const isOfficeDoc = !isDirectory && (
        /\.(docx?|xlsx?|pptx?|odt|ods|odp)$/i.test(entry.name) ||
        mimeType.includes("word") ||
        mimeType.includes("sheet") ||
        mimeType.includes("presentation")
      );
      const isArchive = !isDirectory && /\.(zip|rar|7z|tar|gz|bz2)$/i.test(entry.name);

      const itemId = "mnt-item-" + Buffer.from(relative).toString("hex");

      items.push({
        id: itemId,
        name: entry.name,
        relativePath: relative,
        fullPath: full,
        mountId,
        isDirectory,
        size,
        mimeType,
        modifiedAt,
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

    // Sort: directories first, then alphabetically
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    });

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

    return {
      mountPoint,
      currentPath: targetPath,
      subPath,
      items,
      totalItems: items.length,
      breadcrumbs,
    };
  }

  /**
   * Create a new folder inside a mount
   */
  public createFolder(mountPoint: string, subPath: string, folderName: string): string {
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
   * Delete a file or directory inside /mnt
   */
  public deleteItem(mountPoint: string, itemRelativePath: string): void {
    const target = this.resolveSafePath(mountPoint, itemRelativePath);
    if (!fs.existsSync(target)) {
      throw new Error("Item tidak ditemukan");
    }
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      fs.rmSync(target, { recursive: true, force: true });
    } else {
      fs.unlinkSync(target);
    }
  }

  /**
   * Read text content of a file in /mnt
   */
  public readFileContent(mountPoint: string, relativePath: string): { name: string; content: string; mimeType: string; size: number } {
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
   * Copy/Import a file from /mnt directly into the App's Google Drive Sync buffer
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

    // Partition local storage path: data/storage/YYYY/MM/DD/uuid-name
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, "0");
    const day = now.getDate().toString().padStart(2, "0");
    const targetStorageDir = path.join(process.cwd(), "data", "storage", year, month, day);
    fs.mkdirSync(targetStorageDir, { recursive: true });

    const safeFileId = crypto.randomUUID();
    const destFileName = `${safeFileId}-${originalName}`;
    const destinationPath = path.join(targetStorageDir, destFileName);

    // Copy file to local buffer
    fs.copyFileSync(sourcePath, destinationPath);

    // Create database file record
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
