import { AuthService } from "../services/auth.service.ts";
import { generateToken, verifyToken } from "../middleware/auth.ts";
import { db } from "../db/index.ts";
import { Role } from "../types/index.ts";

export async function runAuthSelfTest(): Promise<{ success: boolean; details: Record<string, unknown> }> {
  try {
    await db.initializeDefaultData();

    // 1. Test Admin Login
    const adminLogin = await AuthService.login(
      "admin@example.com",
      "admin123",
      "127.0.0.1",
      "SelfTest"
    );
    if (!adminLogin.token || adminLogin.user.role !== Role.ADMIN) {
      throw new Error("Admin login failed");
    }

    // 2. Test User Login
    const userLogin = await AuthService.login(
      "user@example.com",
      "user123",
      "127.0.0.1",
      "SelfTest"
    );
    if (!userLogin.token || userLogin.user.role !== Role.USER) {
      throw new Error("User login failed");
    }

    // 3. Test Invalid Password
    let invalidPassBlocked = false;
    try {
      await AuthService.login("admin@example.com", "wrongpassword", "127.0.0.1", "SelfTest");
    } catch {
      invalidPassBlocked = true;
    }
    if (!invalidPassBlocked) {
      throw new Error("Invalid password was not rejected");
    }

    // 4. Test Token Generation and Verification
    const tokenPayload = verifyToken(adminLogin.token);
    if (!tokenPayload || tokenPayload.email !== "admin@example.com") {
      throw new Error("Token payload validation failed");
    }

    // 5. Test User Creation by Admin
    const testNewEmail = `test_${Date.now()}@example.com`;
    const adminUser = await db.user.findUnique({ where: { id: adminLogin.user.id } });
    const createdUser = await AuthService.createUser(
      {
        email: testNewEmail,
        name: "Test Staff",
        passwordPlain: "secret123",
        role: Role.USER,
      },
      adminUser || undefined,
      "127.0.0.1",
      "SelfTest"
    );
    if (!createdUser.id || createdUser.email !== testNewEmail) {
      throw new Error("User creation failed");
    }

    // 6. Test User Update by Admin
    const updatedUser = await AuthService.updateUser(
      createdUser.id,
      { name: "Test Staff Updated", isActive: true },
      adminUser || undefined,
      "127.0.0.1",
      "SelfTest"
    );
    if (updatedUser.name !== "Test Staff Updated") {
      throw new Error("User update failed");
    }

    // 7. Verify Activity Logs recorded
    const logs = await db.activityLog.findMany({ take: 10 });
    if (logs.length === 0) {
      throw new Error("Activity logs were not created during auth operations");
    }

    return {
      success: true,
      details: {
        adminAuthenticated: adminLogin.user.email,
        regularUserAuthenticated: userLogin.user.email,
        invalidPasswordRejected: true,
        jwtVerification: "PASSED",
        userCreated: createdUser.email,
        userUpdated: updatedUser.name,
        recentLogsCount: logs.length,
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
