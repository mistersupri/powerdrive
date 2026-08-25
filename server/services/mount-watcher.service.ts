import fs from "fs";
import path from "path";
import crypto from "crypto";
import mime from "mime-types";
import { prisma } from "../db/index.ts";

export class MountWatcherService {
  private baseMountPath: string = "/mnt";
  private watcher: any = null;
  private isWatching: boolean = false;
  private pendingEvents: Map<string, { type: "add" | "addDir" | "change" | "unlink" | "unlinkDir"; path: string; timestamp: number }> = new Map();
  private batchFlushTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.ensureMountBaseDir();
  }

  private ensureMountBaseDir() {
    try {
      if (!fs.existsSync(this.baseMountPath)) {
        fs.mkdirSync(this.baseMountPath, { recursive: true });
      }
    } catch (err) {
      console.warn("[MountWatcher] Warning creating base mount path:", err);
    }
  }

  /**
   * Resolve mount ID from a folder/file system path
   */
  private getMountInfo(fullPath: string): { mountPoint: string; mountId: string } {
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
   * Starts real-time chokidar filesystem watcher on /mnt
   */
  public startWatcher(): void {
    if (this.isWatching || this.watcher) {
      console.log("[MountWatcher] Filesystem watcher is already active.");
      return;
    }

    this.ensureMountBaseDir();

    import("chokidar")
      .then((chokidar) => {
        console.log("[MountWatcher] Initializing Chokidar filesystem watcher on /mnt...");
        this.watcher = chokidar.watch(this.baseMountPath, {
          ignored: /(^|[\/\\])\../, // ignore hidden dotfiles (.git, .DS_Store, etc.)
          persistent: true,
          ignoreInitial: true, // initial indexing is handled cleanly by MountIndexerService
          depth: 99,
          usePolling: true,
          interval: 1500,
          awaitWriteFinish: {
            stabilityThreshold: 1000,
            pollInterval: 200,
          },
        });

        this.isWatching = true;

        this.watcher.on("add", (filePath: string) => this.queueEvent("add", filePath));
        this.watcher.on("addDir", (dirPath: string) => this.queueEvent("addDir", dirPath));
        this.watcher.on("change", (filePath: string) => this.queueEvent("change", filePath));
        this.watcher.on("unlink", (filePath: string) => this.queueEvent("unlink", filePath));
        this.watcher.on("unlinkDir", (dirPath: string) => this.queueEvent("unlinkDir", dirPath));

        this.watcher.on("error", (err: any) => {
          console.error("[MountWatcher] Watcher error:", err);
        });

        console.log("[MountWatcher] Filesystem watcher running successfully on /mnt.");
      })
      .catch((err) => {
        console.error("[MountWatcher] Failed to load chokidar module:", err);
      });
  }

  private queueEvent(type: "add" | "addDir" | "change" | "unlink" | "unlinkDir", targetPath: string) {
    if (path.basename(targetPath).startsWith(".")) return;
    this.pendingEvents.set(targetPath, { type, path: targetPath, timestamp: Date.now() });

    if (!this.batchFlushTimer) {
      this.batchFlushTimer = setTimeout(() => {
        this.flushPendingEvents().catch((err) => {
          console.error("[MountWatcher] Error flushing filesystem events:", err);
        });
      }, 500);
    }
  }

  /**
   * Batches and synchronizes queued filesystem events into PostgreSQL
   */
  private async flushPendingEvents(): Promise<void> {
    this.batchFlushTimer = null;
    const events = Array.from(this.pendingEvents.values());
    this.pendingEvents.clear();

    if (events.length === 0) return;

    for (const evt of events) {
      try {
        const { mountPoint, mountId } = this.getMountInfo(evt.path);

        if (evt.type === "add" || evt.type === "change") {
          if (!fs.existsSync(evt.path)) continue;
          const stat = await fs.promises.stat(evt.path).catch(() => null);
          if (!stat || stat.isDirectory()) continue;

          const md5 = crypto.createHash("md5").update(evt.path).digest("hex");
          const fileId = "file-" + md5;
          const relativePath = path.relative(mountPoint, evt.path).replace(/\\/g, "/");
          const checksum = crypto
            .createHash("sha256")
            .update(evt.path + stat.size + stat.mtime.toISOString())
            .digest("hex");

          const parentPath = path.dirname(evt.path);
          const parentId =
            parentPath === path.resolve(mountPoint)
              ? mountId
              : "folder-" + crypto.createHash("md5").update(parentPath).digest("hex");

          await prisma.file.upsert({
            where: { id: fileId },
            update: {
              originalName: path.basename(evt.path),
              storedName: path.basename(evt.path),
              storagePath: evt.path,
              mimeType: String(mime.lookup(evt.path) || "application/octet-stream"),
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
              originalName: path.basename(evt.path),
              storedName: path.basename(evt.path),
              storagePath: evt.path,
              mimeType: String(mime.lookup(evt.path) || "application/octet-stream"),
              size: BigInt(stat.size),
              checksumSha256: checksum,
              storageId: mountId,
              storageKey: relativePath,
            },
          });
        } else if (evt.type === "addDir") {
          if (!fs.existsSync(evt.path)) continue;
          const md5 = crypto.createHash("md5").update(evt.path).digest("hex");
          const folderId = "folder-" + md5;

          const parentPath = path.dirname(evt.path);
          const parentId =
            parentPath === path.resolve(mountPoint)
              ? mountId
              : "folder-" + crypto.createHash("md5").update(parentPath).digest("hex");

          await prisma.folder.upsert({
            where: { id: folderId },
            update: {
              name: path.basename(evt.path),
              parentId,
              targetFolderPath: evt.path,
              storageId: mountId,
            },
            create: {
              id: folderId,
              name: path.basename(evt.path),
              parentId,
              targetFolderPath: evt.path,
              storageId: mountId,
              ownerId: "usr_admin_001",
            },
          });
        } else if (evt.type === "unlink") {
          const md5 = crypto.createHash("md5").update(evt.path).digest("hex");
          const fileId = "file-" + md5;
          await prisma.file.delete({ where: { id: fileId } }).catch(() => {});
        } else if (evt.type === "unlinkDir") {
          const md5 = crypto.createHash("md5").update(evt.path).digest("hex");
          const folderId = "folder-" + md5;
          await prisma.file.deleteMany({ where: { folderId } }).catch(() => {});
          await prisma.folder.delete({ where: { id: folderId } }).catch(() => {});
        }
      } catch (err) {
        console.warn(`[MountWatcher] Warning synchronizing event (${evt.type}) on ${evt.path}:`, err);
      }
    }
  }

  public stopWatcher(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.isWatching = false;
      console.log("[MountWatcher] Filesystem watcher stopped.");
    }
  }
}

export const mountWatcherService = new MountWatcherService();
