import crypto from "crypto";
import { FolderPermission } from "../types/index.ts";

// Cryptographic secret for signing share links
const SHARE_SECRET = process.env.JWT_SECRET || "power-drive-secure-share-signature-secret-2026";

export class ShareTokenService {
  /**
   * Generates a tamper-proof HMAC-SHA256 signature for a specific folder/file, permission level, and optional settings
   */
  public static generateSignature(
    itemId: string,
    permission: FolderPermission | "VIEW" | "EDIT" | string,
    pwdHash?: string,
    emails?: string
  ): string {
    let payload = `power-drive:${itemId}:${permission}`;
    if (pwdHash) {
      payload += `:${pwdHash}`;
    }
    if (emails) {
      payload += `:${emails}`;
    }
    return crypto
      .createHmac("sha256", SHARE_SECRET)
      .update(payload)
      .digest("hex")
      .substring(0, 32); // 32 chars hex signature
  }

  /**
   * Validates whether a provided signature matches the given itemId, permission, and options
   */
  public static verifySignature(
    itemId: string,
    permission: string,
    signature: string,
    pwdHash?: string,
    emails?: string
  ): boolean {
    if (!itemId || !permission || !signature) return false;
    const expected = this.generateSignature(itemId, permission, pwdHash, emails);
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
   * Generates both VIEW and EDIT secured shareable link bundles for a folder with password and email filters
   */
  public static getSecuredLinks(folderId: string, origin?: string, pwdHash?: string, emails?: string) {
    const viewSig = this.generateSignature(folderId, FolderPermission.VIEW, pwdHash, emails);
    const editSig = this.generateSignature(folderId, FolderPermission.EDIT, pwdHash, emails);
    const base = origin || "";

    let suffix = "";
    if (pwdHash) suffix += `&pwdHash=${encodeURIComponent(pwdHash)}`;
    if (emails) suffix += `&emails=${encodeURIComponent(emails)}`;

    return {
      folderId,
      viewLink: {
        permission: FolderPermission.VIEW,
        signature: viewSig,
        url: `${base}?folderId=${encodeURIComponent(folderId)}&perm=VIEW&sig=${viewSig}${suffix}`,
        name: "Tautan Hanya Lihat (VIEW)",
        description: "Penerima hanya dapat melihat pratinjau dan mengunduh berkas. Akses unggah dan kelola dikunci.",
      },
      editLink: {
        permission: FolderPermission.EDIT,
        signature: editSig,
        url: `${base}?folderId=${encodeURIComponent(folderId)}&perm=EDIT&sig=${editSig}${suffix}`,
        name: "Tautan Bisa Mengedit (EDIT)",
        description: "Penerima diizinkan mengunggah dokumen baru, mengubah nama berkas, dan mengelola konten folder.",
      },
    };
  }

  /**
   * Generates a VIEW secured shareable link bundle for a file with password and email filters
   */
  public static getFileSecuredLinks(fileId: string, origin?: string, pwdHash?: string, emails?: string) {
    const viewSig = this.generateSignature(fileId, "VIEW", pwdHash, emails);
    const base = origin || "";

    let suffix = "";
    if (pwdHash) suffix += `&pwdHash=${encodeURIComponent(pwdHash)}`;
    if (emails) suffix += `&emails=${encodeURIComponent(emails)}`;

    return {
      fileId,
      viewLink: {
        permission: "VIEW",
        signature: viewSig,
        url: `${base}?fileId=${encodeURIComponent(fileId)}&perm=VIEW&sig=${viewSig}${suffix}`,
        name: "Tautan Pratinjau Berkas (VIEW)",
        description: "Penerima dapat melihat pratinjau langsung dan mengunduh berkas.",
      },
    };
  }
}

