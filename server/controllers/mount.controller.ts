import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import mime from "mime-types";
import { mountService } from "../services/mount.service.ts";
import { mountIndexerService } from "../services/mount-indexer.service.ts";
import { AuthenticatedRequest } from "../middleware/auth.ts";

export class MountController {
  /**
   * List all mounted drives under /mnt with user permission scoping
   */
  async listMounts(req: AuthenticatedRequest, res: Response) {
    try {
      const user = req.user;
      const mounts = await mountService.listMountsForUser(user);
      const status = mountIndexerService.getStatus();
      res.status(200).json({
        success: true,
        data: {
          mounts,
          total: mounts.length,
          indexingStatus: status,
        },
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || "Gagal memindai direktori sistem mount",
      });
    }
  }

  /**
   * Update email access permissions for a mount point (Admin only)
   */
  async updatePermissions(req: AuthenticatedRequest, res: Response) {
    try {
      const { mountId } = req.params;
      const { allowedEmails } = req.body;
      let emails: string[] = [];
      if (Array.isArray(allowedEmails)) {
        emails = allowedEmails;
      } else if (typeof allowedEmails === "string") {
        emails = allowedEmails.split(",").map((e) => e.trim()).filter(Boolean);
      }
      const updated = await mountService.setMountPermissions(mountId, emails);
      res.status(200).json({
        success: true,
        data: { allowedEmails: updated },
        message: "Izin akses email untuk storage terpasang berhasil diperbarui",
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || "Gagal memperbarui izin akses storage terpasang",
      });
    }
  }

  /**
   * Create a new mount folder point under /mnt
   */
  async createMountPoint(req: AuthenticatedRequest, res: Response) {
    try {
      const { folderName } = req.body;
      if (!folderName) {
        return res.status(400).json({
          success: false,
          error: "Nama folder mount wajib diisi",
        });
      }
      const mount = mountService.createMountPoint(folderName);
      res.status(201).json({
        success: true,
        data: { mount },
        message: `Titik pasang (mount point) ${mount.mountPoint} berhasil dibuat`,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || "Gagal membuat titik pasang mount baru",
      });
    }
  }

  /**
   * Get specific mount info
   */
  async getMount(req: AuthenticatedRequest, res: Response) {
    try {
      const { mountId } = req.params;
      const isAllowed = await mountService.isUserAllowedForMount(req.user, mountId);
      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          error: "Akses ditolak: Anda tidak memiliki izin untuk mengakses storage terpasang ini",
        });
      }

      const mount = mountService.getMountById(mountId);
      if (!mount) {
        return res.status(404).json({
          success: false,
          error: "Drive sistem mount tidak ditemukan",
        });
      }
      const status = mountIndexerService.getStatus();
      const permissions = await mountService.getMountPermissions(mountId);
      res.status(200).json({
        success: true,
        data: { mount: { ...mount, allowedEmails: permissions }, indexingStatus: status },
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || "Gagal memuat informasi mount",
      });
    }
  }

  /**
   * Browse files and directories in a mount point
   */
  async browseDirectory(req: AuthenticatedRequest, res: Response) {
    try {
      const { mountId } = req.params;
      const isAllowed = await mountService.isUserAllowedForMount(req.user, mountId);
      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          error: "Akses ditolak: Anda tidak memiliki izin untuk mengakses storage terpasang ini",
        });
      }

      const subPath = typeof req.query.subPath === "string" ? req.query.subPath : "";
      const page = parseInt(String(req.query.page || "1"), 10) || 1;
      const limit = parseInt(String(req.query.limit || "100"), 10) || 100;
      const search = typeof req.query.search === "string" ? req.query.search : undefined;

      const mount = mountService.getMountById(mountId);
      if (!mount) {
        return res.status(404).json({
          success: false,
          error: "Drive sistem mount tidak ditemukan",
        });
      }

      const result = await mountService.browseDirectory(mount.mountPoint, subPath, {
        page,
        limit,
        search,
      });

      res.status(200).json({
        success: true,
        data: {
          mount,
          ...result,
        },
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || "Gagal membaca isi direktori mount",
      });
    }
  }

  /**
   * Trigger manual background re-index for a mount or all mounts
   */
  async syncMount(req: AuthenticatedRequest, res: Response) {
    try {
      const { mountId } = req.params;
      const mount = mountService.getMountById(mountId);
      if (!mount) {
        return res.status(404).json({
          success: false,
          error: "Drive sistem mount tidak ditemukan",
        });
      }

      // Run re-index asynchronously in the background so API responds immediately
      mountIndexerService.indexSingleMount(mount.mountPoint, mount.id).catch((err) => {
        console.error(`[MountController] Error in manual background sync for ${mount.name}:`, err);
      });

      res.status(200).json({
        success: true,
        message: `Sinkronisasi dan pengindeksan metadata untuk ${mount.name} sedang berjalan di latar belakang`,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || "Gagal memulai sinkronisasi mount",
      });
    }
  }

  /**
   * Get current background indexing status
   */
  async getSyncStatus(req: Request, res: Response) {
    try {
      const status = mountIndexerService.getStatus();
      res.status(200).json({
        success: true,
        data: status,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || "Gagal mendapatkan status pengindeksan",
      });
    }
  }

  /**
   * Create folder inside mount
   */
  async createFolder(req: AuthenticatedRequest, res: Response) {
    try {
      const { mountId } = req.params;
      const { subPath = "", folderName } = req.body;

      if (!folderName) {
        return res.status(400).json({
          success: false,
          error: "Nama folder wajib diisi",
        });
      }

      const mount = mountService.getMountById(mountId);
      if (!mount) {
        return res.status(404).json({
          success: false,
          error: "Drive sistem mount tidak ditemukan",
        });
      }

      const createdPath = await mountService.createFolder(mount.mountPoint, subPath, folderName);
      res.status(201).json({
        success: true,
        data: { createdPath },
        message: `Folder "${folderName}" berhasil dibuat di ${mount.name}`,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || "Gagal membuat folder di drive mount",
      });
    }
  }

  /**
   * Delete item from mount
   */
  async deleteItem(req: AuthenticatedRequest, res: Response) {
    try {
      const { mountId } = req.params;
      const { itemRelativePath } = req.body;

      if (!itemRelativePath) {
        return res.status(400).json({
          success: false,
          error: "Path item yang akan dihapus wajib dicantumkan",
        });
      }

      const mount = mountService.getMountById(mountId);
      if (!mount) {
        return res.status(404).json({
          success: false,
          error: "Drive sistem mount tidak ditemukan",
        });
      }

      await mountService.deleteItem(mount.mountPoint, itemRelativePath);
      res.status(200).json({
        success: true,
        message: "Item berhasil dihapus dari drive lokal terpasang",
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || "Gagal menghapus item dari sistem mount",
      });
    }
  }

  /**
   * Rename item in mount
   */
  async renameItem(req: AuthenticatedRequest, res: Response) {
    try {
      const { mountId } = req.params;
      const { itemRelativePath, newName } = req.body;

      if (!itemRelativePath || !newName) {
        return res.status(400).json({
          success: false,
          error: "Parameter itemRelativePath dan newName wajib diisi",
        });
      }

      const mount = mountService.getMountById(mountId);
      if (!mount) {
        return res.status(404).json({
          success: false,
          error: "Drive sistem mount tidak ditemukan",
        });
      }

      const result = await mountService.renameItem(mount.mountPoint, itemRelativePath, newName);
      res.status(200).json({
        success: true,
        data: result,
        message: `Item berhasil diubah namanya menjadi "${newName}"`,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || "Gagal mengubah nama item pada sistem mount",
      });
    }
  }

  /**
   * Upload file directly to mounted storage and save metadata to PostgreSQL
   */
  async uploadToMount(req: AuthenticatedRequest, res: Response) {
    try {
      const { mountId } = req.params;
      const subPath = typeof req.body.subPath === "string" ? req.body.subPath : "";

      const mount = mountService.getMountById(mountId);
      if (!mount) {
        return res.status(404).json({
          success: false,
          error: "Drive sistem mount tidak ditemukan",
        });
      }

      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Tidak ada berkas yang diunggah",
        });
      }

      const savedFiles: string[] = [];
      for (const file of files) {
        await mountService.saveUploadedFile(mount.mountPoint, subPath, {
          originalname: file.originalname,
          buffer: file.buffer,
          size: file.size,
          mimetype: file.mimetype,
        });
        savedFiles.push(file.originalname);
      }

      res.status(200).json({
        success: true,
        data: { savedFiles, count: savedFiles.length },
        message: `${savedFiles.length} berkas berhasil disimpan ke ${mount.name}`,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || "Gagal mengunggah berkas ke drive mount",
      });
    }
  }

  /**
   * Stream/View file in browser directly from physical storage
   */
  async viewFile(req: Request, res: Response) {
    try {
      const { mountId } = req.params;
      const subPath = String(req.query.subPath || "");

      const mount = mountService.getMountById(mountId);
      if (!mount) {
        return res.status(404).send("Drive mount tidak ditemukan");
      }

      const targetPath = mountService.resolveSafePath(mount.mountPoint, subPath);
      if (!fs.existsSync(targetPath)) {
        return res.status(404).send("Berkas tidak ditemukan");
      }

      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        return res.status(400).send("Path mengarah ke direktori");
      }

      const fileName = path.basename(targetPath);
      const mimeType = mime.lookup(fileName) || "application/octet-stream";

      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Length", stat.size);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(fileName)}"`);

      const stream = fs.createReadStream(targetPath);
      stream.pipe(res);
    } catch (err: any) {
      res.status(500).send(err.message || "Gagal menampilkan berkas");
    }
  }

  /**
   * Download file directly from physical storage
   */
  async downloadFile(req: Request, res: Response) {
    try {
      const { mountId } = req.params;
      const subPath = String(req.query.subPath || "");

      const mount = mountService.getMountById(mountId);
      if (!mount) {
        return res.status(404).send("Drive mount tidak ditemukan");
      }

      const targetPath = mountService.resolveSafePath(mount.mountPoint, subPath);
      if (!fs.existsSync(targetPath)) {
        return res.status(404).send("Berkas tidak ditemukan");
      }

      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        return res.status(400).send("Path mengarah ke direktori");
      }

      const fileName = path.basename(targetPath);
      const mimeType = mime.lookup(fileName) || "application/octet-stream";

      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Length", stat.size);
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);

      const stream = fs.createReadStream(targetPath);
      stream.pipe(res);
    } catch (err: any) {
      res.status(500).send(err.message || "Gagal mengunduh berkas");
    }
  }

  /**
   * Read text content of a code/text file in mount
   */
  async getFileContent(req: Request, res: Response) {
    try {
      const { mountId } = req.params;
      const subPath = String(req.query.subPath || "");

      const mount = mountService.getMountById(mountId);
      if (!mount) {
        return res.status(404).json({
          success: false,
          error: "Drive mount tidak ditemukan",
        });
      }

      const data = mountService.readFileContent(mount.mountPoint, subPath);
      res.status(200).json({
        success: true,
        data,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || "Gagal membaca konten teks berkas",
      });
    }
  }

  /**
   * Import file from mount into Google Drive synchronization queue
   */
  async importToGoogleDrive(req: AuthenticatedRequest, res: Response) {
    try {
      const { mountId } = req.params;
      const { relativePath, targetFolderId } = req.body;
      const userId = req.user?.id || "guest-user";

      if (!relativePath || !targetFolderId) {
        return res.status(400).json({
          success: false,
          error: "Parameter relativePath dan targetFolderId wajib diisi",
        });
      }

      const mount = mountService.getMountById(mountId);
      if (!mount) {
        return res.status(404).json({
          success: false,
          error: "Drive mount tidak ditemukan",
        });
      }

      const fileRecord = await mountService.importToGoogleDrive(
        mount.mountPoint,
        relativePath,
        targetFolderId,
        userId
      );

      res.status(201).json({
        success: true,
        data: { file: fileRecord },
        message: `Berkas "${fileRecord.originalName}" berhasil diimpor dan dimasukkan ke antrean sinkronisasi Google Drive`,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || "Gagal mengimpor berkas ke Google Drive",
      });
    }
  }

  /**
   * Bulk move files or folders inside a mount point
   */
  async bulkMoveItems(req: AuthenticatedRequest, res: Response) {
    try {
      const { mountId } = req.params;
      const { sourceRelativePaths, targetFolderRelativePath } = req.body;

      if (!sourceRelativePaths || !Array.isArray(sourceRelativePaths) || targetFolderRelativePath === undefined) {
        return res.status(400).json({
          success: false,
          error: "Parameter sourceRelativePaths (array) dan targetFolderRelativePath wajib diisi",
        });
      }

      const mount = mountService.getMountById(mountId);
      if (!mount) {
        return res.status(404).json({
          success: false,
          error: "Drive mount tidak ditemukan",
        });
      }

      const result = await mountService.bulkMoveMountItems(
        mount.mountPoint,
        sourceRelativePaths,
        targetFolderRelativePath
      );

      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || "Gagal memindahkan beberapa berkas di drive terpasang",
      });
    }
  }

  /**
   * Bulk copy files or folders inside a mount point
   */
  async bulkCopyItems(req: AuthenticatedRequest, res: Response) {
    try {
      const { mountId } = req.params;
      const { sourceRelativePaths, targetFolderRelativePath } = req.body;

      if (!sourceRelativePaths || !Array.isArray(sourceRelativePaths) || targetFolderRelativePath === undefined) {
        return res.status(400).json({
          success: false,
          error: "Parameter sourceRelativePaths (array) dan targetFolderRelativePath wajib diisi",
        });
      }

      const mount = mountService.getMountById(mountId);
      if (!mount) {
        return res.status(404).json({
          success: false,
          error: "Drive mount tidak ditemukan",
        });
      }

      const result = await mountService.bulkCopyMountItems(
        mount.mountPoint,
        sourceRelativePaths,
        targetFolderRelativePath
      );

      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || "Gagal menyalin beberapa berkas di drive terpasang",
      });
    }
  }
}

export const mountController = new MountController();
