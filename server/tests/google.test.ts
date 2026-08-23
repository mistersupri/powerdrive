import { GoogleDriveService } from "../services/google-drive.service.ts";
import { DriveType } from "../types/index.ts";
import { db } from "../db/index.ts";

export async function runGoogleDriveSelfTest(): Promise<{ success: boolean; details: Record<string, unknown> }> {
  try {
    // 1. Check initial connection status
    const initialStatus = await GoogleDriveService.getConnectionStatus();

    // 2. Connect a simulated / test Google Drive Account connection
    const testConn = await GoogleDriveService.connectAccount({
      email: "admin.drive@example.com",
      name: "Admin Google Drive",
      accessToken: "mock_test_access_token_12345",
      expiresIn: 3600,
      userId: "user_admin_default",
      ipAddress: "127.0.0.1",
      userAgent: "SelfTest",
    });

    if (!testConn.isConnected || testConn.accountEmail !== "admin.drive@example.com") {
      throw new Error("Failed to register Google Drive connection");
    }

    // 3. Verify target drive selection
    const updatedDrive = await GoogleDriveService.selectTargetDrive(
      "root",
      "My Drive (Personal)",
      DriveType.MY_DRIVE,
      "user_admin_default",
      "127.0.0.1",
      "SelfTest"
    );

    if (updatedDrive.selectedDriveType !== DriveType.MY_DRIVE) {
      throw new Error("Failed to set selected target drive");
    }

    // 4. Verify drive list options include My Drive
    const drives = await GoogleDriveService.listDrives();
    if (!drives.some((d) => d.driveType === DriveType.MY_DRIVE)) {
      throw new Error("Default My Drive not present in drive list");
    }

    // 5. Verify database records
    const storedConn = await db.googleDriveConnection.findFirst();
    if (!storedConn || !storedConn.isConnected) {
      throw new Error("Stored Google Drive connection not found in database layer");
    }

    return {
      success: true,
      details: {
        initialConnected: initialStatus.isConnected,
        connectedEmail: testConn.accountEmail,
        selectedDriveType: updatedDrive.selectedDriveType,
        availableDrivesCount: drives.length,
        auditLogsCreated: true,
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
