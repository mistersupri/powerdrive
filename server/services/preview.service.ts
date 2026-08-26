import fs from "fs";
import path from "path";
import { db } from "../db/index.ts";
import { PreviewStatus } from "../types/index.ts";
import { getMimeType } from "./storage.service.ts";
import { generateVideoThumbnailSvg, generateFileThumbnailSvg } from "../controllers/storage.controller.ts";

export class PreviewService {
  private static isProcessing = false;
  private static workerTimer: NodeJS.Timeout | null = null;
  private static thumbnailsDir = path.join(process.cwd(), "storage", "thumbnails");

  /**
   * Start periodic background preview worker
   */
  public static startWorker(intervalMs: number = 3000): void {
    if (this.workerTimer) {
      return;
    }

    // Ensure thumbnails directory exists
    if (!fs.existsSync(this.thumbnailsDir)) {
      fs.mkdirSync(this.thumbnailsDir, { recursive: true });
    }

    console.log(`[PreviewWorker] Starting background preview rendering worker (interval: ${intervalMs}ms)`);
    this.workerTimer = setInterval(() => {
      this.processQueue().catch((err) => {
        console.error("[PreviewWorker] Queue execution error:", err);
      });
    }, intervalMs);

    // Run first iteration immediately
    setTimeout(() => {
      this.processQueue().catch((err) => {
        console.error("[PreviewWorker] Initial queue execution error:", err);
      });
    }, 1000);
  }

  /**
   * Stop background preview worker
   */
  public static stopWorker(): void {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
      console.log("[PreviewWorker] Background preview worker stopped");
    }
  }

  /**
   * Run an on-demand process cycle immediately
   */
  public static triggerImmediateProcess(): void {
    this.processQueue().catch((err) => {
      console.warn("[PreviewWorker] Triggered immediate process error:", err);
    });
  }

  /**
   * Process all pending file preview rendering jobs
   */
  public static async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      // Find files that are PENDING preview status
      const pendingFiles = await db.file.findMany({
        where: {
          previewStatus: PreviewStatus.PENDING,
          isTrashed: false,
        },
        take: 10, // process in small batches
      });

      for (const file of pendingFiles) {
        try {
          await this.processFile(file.id);
        } catch (fileErr: any) {
          console.error(`[PreviewWorker] Error processing file ${file.id}:`, fileErr);
        }
      }
    } catch (dbErr: any) {
      console.error("[PreviewWorker] Failed to query database for pending files:", dbErr.message || dbErr);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single file's thumbnail preview rendering
   */
  private static async processFile(fileId: string): Promise<void> {
    // 1. Mark as processing
    await db.file.update({
      where: { id: fileId },
      data: { previewStatus: PreviewStatus.PROCESSING },
    });

    // Simulate rendering delay (1 second) so that frontend "processing" transitions can be visible
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Re-fetch file to get fresh metadata
    const file = await db.file.findUnique({ where: { id: fileId } });
    if (!file) {
      console.warn(`[PreviewWorker] File ${fileId} no longer exists.`);
      return;
    }

    const resolvedMime = getMimeType(file.originalName, file.mimeType);
    const isImage = resolvedMime.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|avif)$/i.test(file.originalName);
    const isVideo = resolvedMime.startsWith("video/") || /\.(mp4|webm|ogg|ogv|mov|m4v|mkv|avi|wmv|flv|3gp)$/i.test(file.originalName);

    // Ensure thumbnails directory is present
    if (!fs.existsSync(this.thumbnailsDir)) {
      fs.mkdirSync(this.thumbnailsDir, { recursive: true });
    }

    let thumbnailPath: string | null = null;

    // A. If file is a remote Google Drive file
    if (file.googleDriveFileId && !file.googleDriveFileId.startsWith("gdrive_") && !file.googleDriveFileId.startsWith("virtual_")) {
      // Google Drive manages its own previews/thumbnails. We mark as ready.
      await db.file.update({
        where: { id: fileId },
        data: {
          previewStatus: PreviewStatus.READY,
          thumbnailPath: "gdrive",
        },
      });
      console.log(`[PreviewWorker] File ${file.originalName} (${fileId}) remote Google Drive thumbnail marked as READY.`);
      return;
    }

    // B. Resolve local storage paths and generate thumbnail files
    const ext = file.originalName.split(".").pop()?.toLowerCase() || "bin";
    const thumbFileName = `${file.id}.${isImage ? ext : "svg"}`;
    const destPath = path.join(this.thumbnailsDir, thumbFileName);
    const relativeThumbPath = path.join("storage", "thumbnails", thumbFileName);

    if (isImage) {
      // Resolve the original physical file path
      let srcPath: string | null = null;
      if (path.isAbsolute(file.storagePath) && fs.existsSync(file.storagePath)) {
        srcPath = file.storagePath;
      } else {
        const pathsToTry = [
          path.join(process.cwd(), file.storagePath),
          path.join(process.cwd(), file.storagePath.replace(/^\/+/, "")),
        ];
        for (const p of pathsToTry) {
          if (fs.existsSync(p)) {
            srcPath = p;
            break;
          }
        }
      }

      if (srcPath && fs.existsSync(srcPath)) {
        // Copy original file to thumbnail path (acts as direct high-fidelity thumb)
        fs.copyFileSync(srcPath, destPath);
        thumbnailPath = relativeThumbPath;
      } else {
        // Fallback to SVG if original file is missing
        const svg = generateFileThumbnailSvg(file.originalName, resolvedMime, Number(file.size));
        fs.writeFileSync(destPath.replace(new RegExp(`\\.${ext}$`), ".svg"), svg);
        thumbnailPath = relativeThumbPath.replace(new RegExp(`\\.${ext}$`), ".svg");
      }
    } else if (isVideo) {
      // Generate a video SVG thumbnail
      const svg = generateVideoThumbnailSvg(file.originalName, resolvedMime, Number(file.size));
      fs.writeFileSync(destPath, svg);
      thumbnailPath = relativeThumbPath;
    } else {
      // Generate standard document SVG thumbnail
      const svg = generateFileThumbnailSvg(file.originalName, resolvedMime, Number(file.size));
      fs.writeFileSync(destPath, svg);
      thumbnailPath = relativeThumbPath;
    }

    // Update DB with thumbnail path and mark as ready
    await db.file.update({
      where: { id: file.id },
      data: {
        previewStatus: PreviewStatus.READY,
        thumbnailPath: thumbnailPath,
      },
    });

    console.log(`[PreviewWorker] File ${file.originalName} (${file.id}) thumbnail generated at: ${thumbnailPath}. Status: READY`);
  }
}
