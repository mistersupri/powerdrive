import fs from "fs";
import path from "path";
import crypto from "crypto";
import mime from "mime-types";
import { prisma } from "../db/index.ts";

export interface IndexerStatus {
  isIndexing: boolean;
  lastIndexedAt: string | null;
  totalIndexedFiles: number;
  totalIndexedFolders: number;
  lastError: string | null;
  reconciliationCount: number;
}

export class MountIndexerService {
  private baseMountPath: string = "/mnt";
  private isIndexing: boolean = false;
  private lastIndexedAt: string | null = null;
  private totalIndexedFiles: number = 0;
  private totalIndexedFolders: number = 0;
  private lastError: string | null = null;
  private reconciliationCount: number = 0;
  private reconciliationTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.ensureMountBaseDir();
  }

  private ensureMountBaseDir() {
    try {
      if (!fs.existsSync(this.baseMountPath)) {
        fs.mkdirSync(this.baseMountPath, { recursive: true });
      }
    } catch (err) {
      console.warn("[MountIndexer] Warning creating base mount path:", err);
    }
  }

  public getStatus(): IndexerStatus {
    return {
      isIndexing: this.isIndexing,
      lastIndexedAt: this.lastIndexedAt,
      totalIndexedFiles: this.totalIndexedFiles,
      totalIndexedFolders: this.totalIndexedFolders,
      lastError: this.lastError,
      reconciliationCount: this.reconciliationCount,
    };
  }

  /**
   * Resolve mount ID from a folder/file system path
   */
  public getMountPointByFullPath(fullPath: string): { mountPoint: string; mountId: string } {
    const normalized = path.resolve(fullPath);
    const parts = normalized.split(path.sep);
    if (parts.length >= 3 && parts[1] === "mnt") {
      const mountPoint = path.sep + path.join(parts[1], parts[2]);
      const safeId = "mount-" + Buffer.from(parts[2]).toString("hex").substring(0, 16);
      return { mountPoint, mountId: safeId };
    }
    return { mountPoint: "/mnt", mountId: "mnt-root" };
  }

  /**
   * Asynchronously indexes all mounts in the background without blocking API requests
   */
  public async indexAllMounts(): Promise<void> {
    if (this.isIndexing) {
      console.log("[MountIndexer] Indexing already in progress. Skipping concurrent run.");
      return;
    }

    this.isIndexing = true;
    this.lastError = null;
    console.log("[MountIndexer] Starting background indexing of mounted storage...");

    try {
      this.ensureMountBaseDir();
      if (!fs.existsSync(this.baseMountPath)) {
        this.isIndexing = false;
        return;
      }

      const entries = fs.readdirSync(this.baseMountPath, { withFileTypes: true });
      const visitedFolderIds = new Set<string>();
      const visitedFileIds = new Set<string>();

      // Loop subdirectories under /mnt
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const mountPath = path.join(this.baseMountPath, entry.name);
          const mountId = "mount-" + Buffer.from(entry.name).toString("hex").substring(0, 16);
          await this.indexSingleMount(mountPath, mountId, visitedFolderIds, visitedFileIds);
        }
      }

      // If /mnt itself has direct files
      const directFiles = entries.filter((e) => !e.isDirectory());
      if (directFiles.length > 0) {
        const rootMountId = "mnt-root";
        await this.indexSingleMount(this.baseMountPath, rootMountId, visitedFolderIds, visitedFileIds);
      }

      const filesCount = visitedFileIds.size;
      const foldersCount = visitedFolderIds.size;

      this.totalIndexedFiles = filesCount;
      this.totalIndexedFolders = foldersCount;
      this.lastIndexedAt = new Date().toISOString();

      // Run reconciliation to remove deleted files from PostgreSQL metadata
      await this.reconcileDatabase(visitedFolderIds, visitedFileIds);

      console.log(
        `[MountIndexer] Indexing complete. Indexed ${foldersCount} folders and ${filesCount} files into PostgreSQL.`
      );
    } catch (err: any) {
      console.error("[MountIndexer] Error during background mount indexing:", err);
      this.lastError = err.message || "Unknown indexing error";
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Recursively scan a specific mount point and upsert metadata to PostgreSQL
   */
  public async indexSingleMount(
    mountPoint: string,
    mountId: string,
    visitedFolderIds: Set<string> = new Set(),
    visitedFileIds: Set<string> = new Set()
  ): Promise<void> {
    const mountName = path.basename(mountPoint) || "Storage Mount";

    // Ensure root folder entry for this mount in DB
    await prisma.folder.upsert({
      where: { id: mountId },
      update: {
        name: mountName,
        targetFolderPath: mountPoint,
        storageId: mountId,
      },
      create: {
        id: mountId,
        name: mountName,
        parentId: null,
        targetFolderPath: mountPoint,
        storageId: mountId,
        ownerId: "usr_admin_001",
      },
    });
    visitedFolderIds.add(mountId);

    // Recursively scan subdirectories and files
    await this.recursiveScan(mountPoint, mountPoint, mountId, visitedFolderIds, visitedFileIds);
  }

  private async recursiveScan(
    currentDir: string,
    mountPoint: string,
    mountId: string,
    visitedFolderIds: Set<string>,
    visitedFileIds: Set<string>
  ): Promise<void> {
    try {
      if (!fs.existsSync(currentDir)) return;
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        // Ignore hidden system dotfiles (.DS_Store, .git, etc.)
        if (entry.name.startsWith(".")) continue;

        const fullPath = path.join(currentDir, entry.name);
        const md5 = crypto.createHash("md5").update(fullPath).digest("hex");

        const parentPath = path.dirname(fullPath);
        const parentId =
          parentPath === path.resolve(mountPoint)
            ? mountId
            : "folder-" + crypto.createHash("md5").update(parentPath).digest("hex");

        if (entry.isDirectory()) {
          const folderId = "folder-" + md5;
          await prisma.folder.upsert({
            where: { id: folderId },
            update: {
              name: entry.name,
              parentId,
              targetFolderPath: fullPath,
              storageId: mountId,
            },
            create: {
              id: folderId,
              name: entry.name,
              parentId,
              targetFolderPath: fullPath,
              storageId: mountId,
              ownerId: "usr_admin_001",
            },
          });
          visitedFolderIds.add(folderId);

          // Recurse into subfolder
          await this.recursiveScan(fullPath, mountPoint, mountId, visitedFolderIds, visitedFileIds);
        } else if (entry.isFile()) {
          const fileId = "file-" + md5;
          const stat = await fs.promises.stat(fullPath);
          const size = stat.size;
          const mtime = stat.mtime.toISOString();
          const relativePath = path.relative(mountPoint, fullPath).replace(/\\/g, "/");
          const checksum = crypto.createHash("sha256").update(fullPath + size + mtime).digest("hex");

          await prisma.file.upsert({
            where: { id: fileId },
            update: {
              originalName: entry.name,
              storedName: entry.name,
              storagePath: fullPath,
              mimeType: String(mime.lookup(entry.name) || "application/octet-stream"),
              size: BigInt(size),
              checksumSha256: checksum,
              storageId: mountId,
              storageKey: relativePath,
            },
            create: {
              id: fileId,
              userId: "usr_admin_001",
              folderId: parentId,
              originalName: entry.name,
              storedName: entry.name,
              storagePath: fullPath,
              mimeType: String(mime.lookup(entry.name) || "application/octet-stream"),
              size: BigInt(size),
              checksumSha256: checksum,
              storageId: mountId,
              storageKey: relativePath,
            },
          });
          visitedFileIds.add(fileId);
        }
      }
    } catch (err) {
      console.warn(`[MountIndexer] Warning scanning directory ${currentDir}:`, err);
    }
  }

  /**
   * Periodic reconciliation: removes orphaned DB records if files or folders were deleted from disk
   */
  private async reconcileDatabase(visitedFolderIds: Set<string>, visitedFileIds: Set<string>): Promise<void> {
    try {
      this.reconciliationCount++;

      // 1. Remove orphaned files
      const orphanedFiles = await prisma.file.findMany({
        where: {
          storageId: { not: null },
          id: { notIn: Array.from(visitedFileIds) },
        },
        select: { id: true },
      });

      if (orphanedFiles.length > 0) {
        const ids = orphanedFiles.map((f) => f.id);
        console.log(`[MountIndexer] Removing ${ids.length} orphaned files from PostgreSQL metadata...`);
        await prisma.file.deleteMany({
          where: { id: { in: ids } },
        });
      }

      // 2. Remove orphaned folders
      const orphanedFolders = await prisma.folder.findMany({
        where: {
          storageId: { not: null },
          id: { notIn: Array.from(visitedFolderIds) },
        },
        select: { id: true, parentId: true },
      });

      if (orphanedFolders.length > 0) {
        console.log(`[MountIndexer] Removing ${orphanedFolders.length} orphaned folders from PostgreSQL metadata...`);
        let remaining = [...orphanedFolders];
        let loopLimit = 10;
        while (remaining.length > 0 && loopLimit > 0) {
          const parentIds = new Set(remaining.map((f) => f.parentId).filter(Boolean));
          const leafFolders = remaining.filter((f) => !parentIds.has(f.id));
          if (leafFolders.length === 0) {
            for (const f of remaining) {
              await prisma.folder.delete({ where: { id: f.id } }).catch(() => {});
            }
            break;
          }
          for (const f of leafFolders) {
            await prisma.folder.delete({ where: { id: f.id } }).catch(() => {});
          }
          remaining = remaining.filter((f) => !leafFolders.some((lf) => lf.id === f.id));
          loopLimit--;
        }
      }
    } catch (err) {
      console.warn("[MountIndexer] Warning during database reconciliation:", err);
    }
  }

  /**
   * Starts automatic periodic reconciliation job in the background (default: every 3 minutes)
   */
  public startPeriodicReconciliation(intervalMs: number = 180000): void {
    if (this.reconciliationTimer) {
      return;
    }

    console.log(`[MountIndexer] Periodic reconciliation scheduled every ${Math.round(intervalMs / 1000)}s.`);
    // Trigger first indexing run after 3 seconds startup delay
    setTimeout(() => {
      this.indexAllMounts().catch((err) => {
        console.error("[MountIndexer] Initial background index failed:", err);
      });
    }, 3000);

    this.reconciliationTimer = setInterval(() => {
      this.indexAllMounts().catch((err) => {
        console.error("[MountIndexer] Periodic background index failed:", err);
      });
    }, intervalMs);
  }

  public stopPeriodicReconciliation(): void {
    if (this.reconciliationTimer) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }
  }
}

export const mountIndexerService = new MountIndexerService();
