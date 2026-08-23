import { FolderService } from "../services/folder.service.ts";
import { GoogleDriveService } from "../services/google-drive.service.ts";
import { DriveType } from "../types/index.ts";
import { db } from "../db/index.ts";

export async function runFolderSelfTest(): Promise<{ success: boolean; details: Record<string, unknown> }> {
  try {
    const adminUser = (await db.user.findFirst({ where: { role: "ADMIN" as any } })) || undefined;

    // 1. Test direct Google Drive Path Resolution & Nested Creation
    const pathResult = await GoogleDriveService.resolveOrCreatePath({
      pathString: "2026/Dokumen/KJP",
      driveType: DriveType.MY_DRIVE,
      userId: adminUser?.id,
      ipAddress: "127.0.0.1",
      userAgent: "SelfTest",
    });

    if (!pathResult.finalFolderId || pathResult.segments.length !== 3) {
      throw new Error("Failed to resolve or create nested Google Drive path segments");
    }

    // 2. Test Duplicate Check on Google Drive Folder Creation
    const dupCheck = await GoogleDriveService.createGoogleFolder({
      name: "Dokumen",
      parentId: "root",
      driveType: DriveType.MY_DRIVE,
      userId: adminUser?.id,
      ipAddress: "127.0.0.1",
      userAgent: "SelfTest",
    });

    if (!dupCheck.id) {
      throw new Error("Duplicate check folder validation failed");
    }

    // 3. Test Application Folder Creation with System-Managed GDrive ID
    const newFolder = await FolderService.createFolder({
      name: "Pendataan KJP 2026",
      description: "Folder unggahan berkas KJP Tahun 2026",
      targetFolderPath: "2026/Pendataan/KJP",
      targetDriveType: DriveType.MY_DRIVE,
      creator: adminUser,
      ipAddress: "127.0.0.1",
      userAgent: "SelfTest",
    });

    if (!newFolder.id || !newFolder.googleDriveFolderId) {
      throw new Error("Application folder creation failed to generate system-managed Google Drive ID");
    }

    // 4. Test Application Folder Update
    const updatedFolder = await FolderService.updateFolder({
      id: newFolder.id,
      name: "Pendataan KJP 2026 (Updated)",
      description: "Updated description",
      user: adminUser,
      ipAddress: "127.0.0.1",
      userAgent: "SelfTest",
    });

    if (updatedFolder.name !== "Pendataan KJP 2026 (Updated)") {
      throw new Error("Application folder update failed");
    }

    // 5. Test Folder Tree Fetch
    const folderTree = await GoogleDriveService.getFolderTree("root", DriveType.MY_DRIVE);
    if (!folderTree.id) {
      throw new Error("Google Drive folder tree generation failed");
    }

    // 6. Test Folder Listing
    const folderList = await FolderService.listFolders();
    if (folderList.length === 0) {
      throw new Error("Application folder listing returned empty");
    }

    return {
      success: true,
      details: {
        resolvedGdrivePath: pathResult.path,
        finalGdriveFolderId: pathResult.finalFolderId,
        applicationFolderId: newFolder.id,
        applicationFolderName: updatedFolder.name,
        systemManagedGdriveId: newFolder.googleDriveFolderId,
        totalApplicationFolders: folderList.length,
        treeRoot: folderTree.name,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      details: {
        error: error.message || String(error),
      },
    };
  }
}
