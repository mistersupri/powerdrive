import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import mime from "mime-types";
import { mountService } from "../services/mount.service.ts";
import { AuthenticatedRequest } from "../middleware/auth.ts";

export class MountController {
  /**
   * List all mounted drives under /mnt
   */
  async listMounts(req: Request, res: Response) {
    try {
      const mounts = mountService.listMounts();
      res.status(200).json({
        success: true,
        data: {
          mounts,
          total: mounts.length,
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
  async getMount(req: Request, res: Response) {
    try {
      const { mountId } = req.params;
      const mount = mountService.getMountById(mountId);
      if (!mount) {
        return res.status(404).json({
          success: false,
          error: "Drive sistem mount tidak ditemukan",
        });
      }
      res.status(200).json({
        success: true,
        data: { mount },
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
  async browseDirectory(req: Request, res: Response) {
    try {
      const { mountId } = req.params;
      const subPath = typeof req.query.subPath === "string" ? req.query.subPath : "";

      const mount = mountService.getMountById(mountId);
      if (!mount) {
        return res.status(404).json({
          success: false,
          error: "Drive sistem mount tidak ditemukan",
        });
      }

      const result = mountService.browseDirectory(mount.mountPoint, subPath);
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

      const createdPath = mountService.createFolder(mount.mountPoint, subPath, folderName);
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

      mountService.deleteItem(mount.mountPoint, itemRelativePath);
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
   * Upload file directly to mounted drive
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

      const targetDir = mountService.resolveSafePath(mount.mountPoint, subPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const savedFiles: string[] = [];
      for (const file of files) {
        const destPath = path.join(targetDir, file.originalname);
        fs.writeFileSync(destPath, file.buffer);
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
   * Stream/View file in browser
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
   * Download file
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
}

export const mountController = new MountController();
