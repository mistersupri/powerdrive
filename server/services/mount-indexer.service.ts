import fs from "fs";
import path from "path";
import crypto from "crypto";
import mime from "mime-types";
import { prisma } from "../db/index.ts";

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

interface IndexTask {
  folderPath: string;
  mountPoint: string;
  mountId: string;
  priority: number; // 1 = high (user accessed), 2 = background deep scan
}

interface FolderCacheEntry {
  lastIndexedAt: number;
  mtimeMs: number;
  filesCount: number;
  subfoldersCount: number;
}

export class MountIndexerService {
  private baseMountPath: string = "/mnt";
  private state: IndexingState = "ready";
  private isIndexing: boolean = false;
  private lastIndexedAt: string | null = null;
  private totalIndexedFiles: number = 0;
  private totalIndexedFolders: number = 0;
  private currentlyIndexingFolder: string | null = null;
  private lastError: string | null = null;
  private reconciliationCount: number = 0;
  private reconciliationTimer: NodeJS.Timeout | null = null;

  // In-memory cache to prevent redundant re-indexing of unchanged folders
  private folderCache: Map<string, FolderCacheEntry> = new Map();
  // Queue for progressive background indexing
  private taskQueue: IndexTask[] = [];
  private queuedPaths: Set<string> = new Set();
  private isWorkerRunning: boolean = false;

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

  /**
   * Get overall real-time indexing status
   */
  public getStatus(): IndexerStatus {
    return {
      state: this.state,
      isIndexing: this.isIndexing,
      lastIndexedAt: this.lastIndexedAt,
      totalIndexedFiles: this.totalIndexedFiles,
      totalIndexedFolders: this.totalIndexedFolders,
      currentlyIndexingFolder: this.currentlyIndexingFolder,
      queueLength: this.taskQueue.length,
      lastError: this.lastError,
      reconciliationCount: this.reconciliationCount,
    };
  }

  /**
   * Resolve mount ID and mount point from a folder or file system path
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
   * Fast On-Demand Folder Indexing:
   * Prioritizes indexing the exact folder the user opened and its direct children.
   * Upserts metadata to PostgreSQL immediately in parallel batches so UI displays items instantly.
   * Discovered child directories are enqueued for background indexing.
   */
  public async indexFolderOnDemand(
    targetPath: string,
    mountPoint: string,
    mountId: string
  ): Promise<{ filesCount: number; foldersCount: number }> {
    const normalizedTarget = path.resolve(targetPath);
    const normalizedMount = path.resolve(mountPoint);

    if (!fs.existsSync(normalizedTarget)) {
      return { filesCount: 0, foldersCount: 0 };
    }

    try {
      const stat = await fs.promises.stat(normalizedTarget);
      if (!stat.isDirectory()) {
        return { filesCount: 0, foldersCount: 0 };
      }

      // Check cache: if indexed within 15 seconds and mtime hasn't changed, skip heavy I/O
      const cached = this.folderCache.get(normalizedTarget);
      const now = Date.now();
      if (cached && now - cached.lastIndexedAt < 15000 && cached.mtimeMs === stat.mtimeMs) {
        return { filesCount: cached.filesCount, foldersCount: cached.subfoldersCount };
      }

      // Index the single directory direct children
      const result = await this.indexDirectFolderContents(normalizedTarget, normalizedMount, mountId);

      // Cache result
      this.folderCache.set(normalizedTarget, {
        lastIndexedAt: now,
        mtimeMs: stat.mtimeMs,
        filesCount: result.filesCount,
        subfoldersCount: result.foldersCount,
      });

      // Update aggregate metrics
      this.totalIndexedFiles = Math.max(this.totalIndexedFiles, this.folderCache.size);

      return result;
    } catch (err: any) {
      console.warn(`[MountIndexer] Warning during on-demand indexing of ${targetPath}:`, err.message);
      return { filesCount: 0, foldersCount: 0 };
    }
  }

  /**
   * Directly indexes one directory's immediate files and folders with batch database operations
   */
  private async indexDirectFolderContents(
    targetDir: string,
    mountPoint: string,
    mountId: string
  ): Promise<{ filesCount: number; foldersCount: number }> {
    const isRoot = targetDir === mountPoint;
    const currentFolderId = isRoot
      ? mountId
      : "folder-" + crypto.createHash("md5").update(targetDir).digest("hex");

    const parentPath = path.dirname(targetDir);
    const parentId = isRoot
      ? null
      : parentPath === mountPoint
      ? mountId
      : "folder-" + crypto.createHash("md5").update(parentPath).digest("hex");

    const folderName = path.basename(targetDir) || "Storage Mount";

    // 1. Ensure current folder metadata exists in PostgreSQL
    await prisma.folder.upsert({
      where: { id: currentFolderId },
      update: {
        name: folderName,
        targetFolderPath: targetDir,
        storageId: mountId,
        parentId,
      },
      create: {
        id: currentFolderId,
        name: folderName,
        parentId,
        targetFolderPath: targetDir,
        storageId: mountId,
        ownerId: "usr_admin_001",
      },
    });

    // 2. Read direct directory entries
    const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });

    const dirEntries: fs.Dirent[] = [];
    const fileEntries: fs.Dirent[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue; // Skip hidden system files (.DS_Store, etc.)
      if (entry.isDirectory()) {
        dirEntries.push(entry);
      } else if (entry.isFile()) {
        fileEntries.push(entry);
      }
    }

    const childFolderIds = new Set<string>();
    const childFolderPaths: string[] = [];

    // 3. Process direct subfolders in parallel
    const subfolderPromises = dirEntries.map(async (entry) => {
      const fullPath = path.join(targetDir, entry.name);
      const subFolderId = "folder-" + crypto.createHash("md5").update(fullPath).digest("hex");
      childFolderIds.add(subFolderId);
      childFolderPaths.push(fullPath);

      return prisma.folder.upsert({
        where: { id: subFolderId },
        update: {
          name: entry.name,
          parentId: currentFolderId,
          targetFolderPath: fullPath,
          storageId: mountId,
        },
        create: {
          id: subFolderId,
          name: entry.name,
          parentId: currentFolderId,
          targetFolderPath: fullPath,
          storageId: mountId,
          ownerId: "usr_admin_001",
        },
      });
    });

    await Promise.all(subfolderPromises);

    // 4. Gather file stats in parallel chunks with bounded concurrency
    const childFileIds = new Set<string>();
    const CHUNK_SIZE = 30;

    for (let i = 0; i < fileEntries.length; i += CHUNK_SIZE) {
      const chunk = fileEntries.slice(i, i + CHUNK_SIZE);
      const filePromises = chunk.map(async (entry) => {
        try {
          const fullPath = path.join(targetDir, entry.name);
          const stat = await fs.promises.stat(fullPath);
          const fileId = "file-" + crypto.createHash("md5").update(fullPath).digest("hex");
          childFileIds.add(fileId);

          const relativePath = path.relative(mountPoint, fullPath).replace(/\\/g, "/");
          const checksum = crypto
            .createHash("sha256")
            .update(fullPath + stat.size + stat.mtime.toISOString())
            .digest("hex");
          const mimeType = String(mime.lookup(entry.name) || "application/octet-stream");

          return prisma.file.upsert({
            where: { id: fileId },
            update: {
              originalName: entry.name,
              storedName: entry.name,
              storagePath: fullPath,
              mimeType,
              size: BigInt(stat.size),
              checksumSha256: checksum,
              storageId: mountId,
              storageKey: relativePath,
              folderId: currentFolderId,
              updatedAt: new Date(),
            },
            create: {
              id: fileId,
              userId: "usr_admin_001",
              folderId: currentFolderId,
              originalName: entry.name,
              storedName: entry.name,
              storagePath: fullPath,
              mimeType,
              size: BigInt(stat.size),
              checksumSha256: checksum,
              storageId: mountId,
              storageKey: relativePath,
            },
          });
        } catch (err: any) {
          console.warn(`[MountIndexer] Warning statting file ${entry.name}:`, err.message);
          return null;
        }
      });

      await Promise.all(filePromises);
    }

    // 5. Delta reconciliation for removed direct files / subfolders in this folder
    try {
      // Find deleted files in DB for this folder
      const dbFiles = await prisma.file.findMany({
        where: { folderId: currentFolderId, storageId: mountId },
        select: { id: true },
      });
      const orphanedFileIds = dbFiles.filter((f) => !childFileIds.has(f.id)).map((f) => f.id);
      if (orphanedFileIds.length > 0) {
        await prisma.file.deleteMany({ where: { id: { in: orphanedFileIds } } });
      }

      // Find deleted subfolders in DB for this folder
      const dbFolders = await prisma.folder.findMany({
        where: { parentId: currentFolderId, storageId: mountId },
        select: { id: true },
      });
      const orphanedFolderIds = dbFolders.filter((f) => !childFolderIds.has(f.id)).map((f) => f.id);
      if (orphanedFolderIds.length > 0) {
        await prisma.file.deleteMany({ where: { folderId: { in: orphanedFolderIds } } });
        for (const orphanId of orphanedFolderIds) {
          await prisma.folder.delete({ where: { id: orphanId } }).catch(() => {});
        }
      }
    } catch (cleanupErr) {
      console.warn("[MountIndexer] Minor cleanup warning:", cleanupErr);
    }

    // 6. Enqueue discovered subfolders for progressive background indexing
    for (const subPath of childFolderPaths) {
      this.enqueueTask(subPath, mountPoint, mountId, 1);
    }

    return {
      filesCount: fileEntries.length,
      foldersCount: dirEntries.length,
    };
  }

  /**
   * Enqueue a folder for background progressive indexing
   */
  public enqueueTask(folderPath: string, mountPoint: string, mountId: string, priority: number = 2): void {
    const normalized = path.resolve(folderPath);
    if (this.queuedPaths.has(normalized)) return;

    this.queuedPaths.add(normalized);
    if (priority === 1) {
      // High priority: insert at front
      this.taskQueue.unshift({ folderPath: normalized, mountPoint, mountId, priority });
    } else {
      // Normal background priority: insert at back
      this.taskQueue.push({ folderPath: normalized, mountPoint, mountId, priority });
    }

    if (this.state !== "indexing") {
      this.state = "indexing";
      this.isIndexing = true;
    }

    this.triggerWorker();
  }

  /**
   * Asynchronous background worker loop
   */
  private async triggerWorker(): Promise<void> {
    if (this.isWorkerRunning) return;
    this.isWorkerRunning = true;

    while (this.taskQueue.length > 0) {
      const task = this.taskQueue.shift();
      if (!task) break;

      this.queuedPaths.delete(task.folderPath);
      this.currentlyIndexingFolder = task.folderPath;
      this.state = "indexing";
      this.isIndexing = true;

      try {
        if (fs.existsSync(task.folderPath)) {
          const stat = await fs.promises.stat(task.folderPath);
          if (stat.isDirectory()) {
            await this.indexDirectFolderContents(task.folderPath, task.mountPoint, task.mountId);
            this.totalIndexedFolders++;
          }
        }
      } catch (err: any) {
        console.warn(`[MountIndexer] Background indexing error on ${task.folderPath}:`, err.message);
        this.lastError = err.message;
      }

      // Cooperative delay to yield event loop and keep CPU/IO ultra-responsive
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    this.currentlyIndexingFolder = null;
    this.isWorkerRunning = false;
    this.isIndexing = false;
    this.state = this.lastError ? "ready" : "ready";
    this.lastIndexedAt = new Date().toISOString();
  }

  /**
   * Trigger initial or manual background scan for a single mount
   */
  public async indexSingleMount(mountPoint: string, mountId: string): Promise<void> {
    this.state = "indexing";
    this.isIndexing = true;
    this.lastError = null;

    console.log(`[MountIndexer] Queuing progressive background scan for mount ${mountPoint}...`);
    // Immediately index root folder on-demand so root files show up right away
    await this.indexFolderOnDemand(mountPoint, mountPoint, mountId);
  }

  /**
   * Trigger scan for all mounts under /mnt
   */
  public async indexAllMounts(): Promise<void> {
    this.ensureMountBaseDir();
    if (!fs.existsSync(this.baseMountPath)) return;

    this.state = "indexing";
    this.isIndexing = true;
    this.lastError = null;

    try {
      const entries = await fs.promises.readdir(this.baseMountPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const mountPath = path.join(this.baseMountPath, entry.name);
          const mountId = "mount-" + Buffer.from(entry.name).toString("hex").substring(0, 16);
          // On-demand index root of this mount point
          await this.indexFolderOnDemand(mountPath, mountPath, mountId);
        }
      }

      // If /mnt itself has direct files
      const directFiles = entries.filter((e) => !e.isDirectory());
      if (directFiles.length > 0) {
        const rootMountId = "mnt-root";
        await this.indexFolderOnDemand(this.baseMountPath, this.baseMountPath, rootMountId);
      }
    } catch (err: any) {
      console.error("[MountIndexer] Error during initial indexing loop:", err);
      this.lastError = err.message;
    }
  }

  /**
   * Periodic reconciliation job in background
   */
  public startPeriodicReconciliation(intervalMs: number = 180000): void {
    if (this.reconciliationTimer) return;

    console.log(`[MountIndexer] Periodic reconciliation scheduled every ${Math.round(intervalMs / 1000)}s.`);

    // Quick initial indexing run after 2 seconds
    setTimeout(() => {
      this.indexAllMounts().catch((err) => {
        console.error("[MountIndexer] Initial background index failed:", err);
      });
    }, 2000);

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
