import crypto from "crypto";
import { FolderPermission } from "../types/index.ts";

// Cryptographic secret for signing share links
const SHARE_SECRET = process.env.JWT_SECRET || "power-drive-secure-share-signature-secret-2026";

export class ShareTokenService {
  /**
   * Generates a tamper-proof HMAC-SHA256 signature for a specific folder and permission level
   */
  public static generateSignature(folderId: string, permission: FolderPermission | "VIEW" | "EDIT"): string {
    const payload = `power-drive:${folderId}:${permission}`;
    return crypto
      .createHmac("sha256", SHARE_SECRET)
      .update(payload)
      .digest("hex")
      .substring(0, 32); // 32 chars hex signature
  }

  /**
   * Validates whether a provided signature matches the given folderId and permission
   */
  public static verifySignature(folderId: string, permission: string, signature: string): boolean {
    if (!folderId || !permission || !signature) return false;
    const expected = this.generateSignature(folderId, permission as FolderPermission);
    try {
      const bufA = Buffer.from(signature.trim());
      const bufB = Buffer.from(expected);
      if (bufA.length !== bufB.length) return false;
      return crypto.timingSafeEqual(bufA, bufB);
    } catch {
      return signature.trim() === expected;
    }
  }

  /**
   * Generates both VIEW and EDIT secured shareable link bundles for a folder
   */
  public static getSecuredLinks(folderId: string, origin?: string) {
    const viewSig = this.generateSignature(folderId, FolderPermission.VIEW);
    const editSig = this.generateSignature(folderId, FolderPermission.EDIT);
    const base = origin || "";

    return {
      folderId,
      viewLink: {
        permission: FolderPermission.VIEW,
        signature: viewSig,
        url: `${base}?folderId=${encodeURIComponent(folderId)}&perm=VIEW&sig=${viewSig}`,
        name: "Tautan Hanya Lihat (VIEW)",
        description: "Penerima hanya dapat melihat pratinjau dan mengunduh berkas. Akses unggah dan kelola dikunci.",
      },
      editLink: {
        permission: FolderPermission.EDIT,
        signature: editSig,
        url: `${base}?folderId=${encodeURIComponent(folderId)}&perm=EDIT&sig=${editSig}`,
        name: "Tautan Bisa Mengedit (EDIT)",
        description: "Penerima diizinkan mengunggah dokumen baru, mengubah nama berkas, dan mengelola konten folder.",
      },
    };
  }
}
