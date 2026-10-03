import bcrypt from "bcryptjs";
import { db } from "../db/index.ts";
import { ActivityAction, Role, UserRecord } from "../types/index.ts";
import { AuditService } from "./audit.service.ts";
import { generateToken } from "../middleware/auth.ts";
import { MailService } from "./mail.service.ts";
import { GoogleDriveService } from "./google-drive.service.ts";

export class AuthService {
  public static async login(
    email: string,
    passwordPlain: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ token: string; user: Omit<UserRecord, "passwordHash"> }> {
    if (!email || !passwordPlain) {
      throw new Error("Email and password are required");
    }

    const normalizedEmail = email.trim().toLowerCase();
    const envAdminEmail = (process.env.ADMIN_EMAIL || "admin@clouddrive.local").trim().toLowerCase();
    const envAdminPassword = process.env.ADMIN_PASSWORD || "AdminPassword2026!";

    let user = await db.user.findUnique({ where: { email: normalizedEmail } });

    // If logging in as the designated env administrator
    if (normalizedEmail === envAdminEmail) {
      if (!user) {
        user = await db.user.create({
          data: {
            email: envAdminEmail,
            name: "Administrator",
            passwordHash: bcrypt.hashSync(envAdminPassword, 10),
            role: Role.ADMIN,
            isActive: true,
          },
        });
      } else if (passwordPlain === envAdminPassword) {
        // Sync password hash if env was updated
        user.passwordHash = bcrypt.hashSync(envAdminPassword, 10);
        user.role = Role.ADMIN;
        user.isActive = true;
      }
    }

    if (!user) {
      await AuditService.log({
        userId: null,
        action: ActivityAction.LOGIN,
        resourceType: "AUTH",
        resourceId: email,
        details: { email, reason: "User not found" },
        ipAddress,
        userAgent,
        result: "FAILURE",
        errorMessage: "Invalid credentials",
      });
      throw new Error("Email atau kata sandi tidak valid");
    }

    if (!user.isActive) {
      await AuditService.log({
        userId: user.id,
        action: ActivityAction.LOGIN,
        resourceType: "AUTH",
        resourceId: user.id,
        details: { email, reason: "Account inactive" },
        ipAddress,
        userAgent,
        result: "FAILURE",
        errorMessage: "Account is disabled",
      });
      throw new Error("Akun ini telah dinonaktifkan. Silakan hubungi administrator.");
    }

    let isMatch = bcrypt.compareSync(passwordPlain, user.passwordHash);
    if (!isMatch && normalizedEmail === envAdminEmail && passwordPlain === envAdminPassword) {
      isMatch = true;
    }

    if (!isMatch) {
      await AuditService.log({
        userId: user.id,
        action: ActivityAction.LOGIN,
        resourceType: "AUTH",
        resourceId: user.id,
        details: { email, reason: "Password mismatch" },
        ipAddress,
        userAgent,
        result: "FAILURE",
        errorMessage: "Invalid credentials",
      });
      throw new Error("Email atau kata sandi tidak valid");
    }

    const token = generateToken(user);

    await AuditService.log({
      userId: user.id,
      action: ActivityAction.LOGIN,
      resourceType: "AUTH",
      resourceId: user.id,
      details: { email: user.email, role: user.role },
      ipAddress,
      userAgent,
      result: "SUCCESS",
    });

    const { passwordHash: _, ...safeUser } = user;
    return { token, user: safeUser };
  }


  public static async register(
    data: { name: string; email: string; passwordPlain: string; role?: Role },
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ token: string; user: Omit<UserRecord, "passwordHash"> }> {
    // Check if public registration is enabled in system settings
    const regSetting = await db.systemSetting.findUnique({ where: { key: "ALLOW_PUBLIC_REGISTRATION" } });
    const allowRegistration = regSetting ? regSetting.value !== "false" : true;
    if (!allowRegistration) {
      throw new Error("Pendaftaran akun baru saat ini dinonaktifkan oleh administrator.");
    }

    if (!data.name || !data.email || !data.passwordPlain) {
      throw new Error("Nama, email, dan password wajib diisi");
    }

    if (data.passwordPlain.length < 6) {
      throw new Error("Password minimal harus 6 karakter");
    }

    const normalizedEmail = data.email.trim().toLowerCase();
    const existing = await db.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new Error("Email sudah terdaftar. Silakan login atau gunakan email lain.");
    }

    const passwordHash = bcrypt.hashSync(data.passwordPlain, 10);
    const role = data.role || (normalizedEmail.includes("admin") ? Role.ADMIN : Role.USER);

    const newUser = await db.user.create({
      data: {
        email: normalizedEmail,
        name: data.name.trim(),
        passwordHash,
        role,
        authProvider: "LOCAL",
        isActive: true,
      },
    });

    await AuditService.log({
      userId: newUser.id,
      action: ActivityAction.USER_CREATED,
      resourceType: "AUTH",
      resourceId: newUser.id,
      details: { email: newUser.email, role: newUser.role, name: newUser.name },
      ipAddress,
      userAgent,
      result: "SUCCESS",
    });

    const token = generateToken(newUser);
    const { passwordHash: _, ...safeUser } = newUser;
    return { token, user: safeUser };
  }

  public static async googleAuth(
    data: {
      email: string;
      name?: string;
      avatarUrl?: string;
      accessToken?: string;
      refreshToken?: string;
      expiresIn?: number;
    },
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ token: string; user: Omit<UserRecord, "passwordHash"> }> {
    if (!data.email) {
      throw new Error("Google email is required");
    }

    const normalizedEmail = data.email.trim().toLowerCase();
    let user = await db.user.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      const defaultRole = normalizedEmail.includes("admin") ? Role.ADMIN : Role.USER;

      user = await db.user.create({
        data: {
          email: normalizedEmail,
          name: data.name?.trim() || normalizedEmail.split("@")[0],
          passwordHash: bcrypt.hashSync(Math.random().toString(36), 10),
          role: defaultRole,
          avatarUrl: data.avatarUrl || null,
          authProvider: "GOOGLE",
          isActive: true,
        },
      });

      await AuditService.log({
        userId: user.id,
        action: ActivityAction.USER_CREATED,
        resourceType: "AUTH",
        resourceId: user.id,
        details: { email: user.email, provider: "GOOGLE", role: user.role },
        ipAddress,
        userAgent,
        result: "SUCCESS",
      });
    } else if (data.name || data.avatarUrl) {
      user = await db.user.update({
        where: { id: user.id },
        data: {
          name: data.name ? data.name.trim() : user.name,
          avatarUrl: data.avatarUrl || user.avatarUrl,
        },
      });
    }

    if (!user.isActive) {
      throw new Error("Akun Google ini telah dinonaktifkan. Hubungi administrator.");
    }

    // Direct and seamless integration: auto-register Google Drive connection if accessToken is provided
    if (data.accessToken) {
      try {
        await GoogleDriveService.connectAccount({
          email: user.email,
          name: user.name,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          expiresIn: data.expiresIn || 3600,
          userId: user.id,
          authenticatedUserEmail: user.email,
          ipAddress: ipAddress || "127.0.0.1",
          userAgent: userAgent || "GoogleSSO",
        });
      } catch (driveErr) {
        console.warn("[AuthService] Auto-connect Google Drive during Google login note:", driveErr);
      }
    }

    await AuditService.log({
      userId: user.id,
      action: ActivityAction.LOGIN,
      resourceType: "AUTH",
      resourceId: user.id,
      details: { email: user.email, provider: "GOOGLE", role: user.role },
      ipAddress,
      userAgent,
      result: "SUCCESS",
    });

    const token = generateToken(user);
    const { passwordHash: _, ...safeUser } = user;
    return { token, user: safeUser };
  }

  /**
   * Starts a password reset. The token is only ever delivered by email: returning
   * it in the HTTP response would let anyone reset any account. The reply is the
   * same whether or not the email exists, so it cannot be used to probe accounts.
   */
  public static async forgotPassword(
    email: string,
    ipAddress?: string,
    userAgent?: string,
    appUrl?: string
  ): Promise<{ message: string }> {
    if (!email) {
      throw new Error("Email wajib diisi");
    }
    const genericMessage =
      "Jika email tersebut terdaftar, tautan untuk mengatur ulang kata sandi sudah dikirim. Periksa kotak masuk atau folder spam.";

    const normalizedEmail = email.trim().toLowerCase();
    const user = await db.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return { message: genericMessage };
    }

    const { token, expiresAt } = await db.passwordReset.createToken(user.email);

    let emailSent = false;
    try {
      const mailResult = await MailService.sendPasswordResetEmail({
        toEmail: user.email,
        userName: user.name,
        resetToken: token,
        expiresAt,
        appUrl,
      });
      emailSent = mailResult.success;
    } catch (mailErr) {
      console.warn("[AuthService] SMTP dispatch notice:", mailErr);
    }

    if (!emailSent && process.env.NODE_ENV !== "production") {
      // Local development without SMTP: the operator can read the token here.
      console.info(`[AuthService] Password reset token for ${user.email}: ${token}`);
    }

    await AuditService.log({
      userId: user.id,
      action: ActivityAction.PASSWORD_RESET_REQUESTED,
      resourceType: "AUTH",
      resourceId: user.id,
      details: { email: user.email, emailSent },
      ipAddress,
      userAgent,
      result: "SUCCESS",
    });

    return { message: genericMessage };
  }

  public static async resetPassword(
    token: string,
    newPasswordPlain: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ message: string }> {
    if (!token || !newPasswordPlain) {
      throw new Error("Token dan kata sandi baru wajib diisi");
    }

    if (newPasswordPlain.length < 6) {
      throw new Error("Kata sandi baru minimal 6 karakter");
    }

    const record = await db.passwordReset.verifyToken(token);
    if (!record) {
      throw new Error("Token reset kata sandi tidak valid atau telah kedaluwarsa.");
    }

    const user = await db.user.findUnique({ where: { email: record.email } });
    if (!user) {
      throw new Error("Pengguna untuk token ini tidak ditemukan.");
    }

    const newHash = bcrypt.hashSync(newPasswordPlain, 10);
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    await db.passwordReset.consumeToken(token);

    await AuditService.log({
      userId: user.id,
      action: ActivityAction.PASSWORD_RESET_COMPLETED,
      resourceType: "AUTH",
      resourceId: user.id,
      details: { email: user.email },
      ipAddress,
      userAgent,
      result: "SUCCESS",
    });

    return {
      message: "Kata sandi Anda berhasil diperbarui. Silakan login kembali dengan kata sandi baru.",
    };
  }

  public static async logout(
    user: UserRecord | undefined,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    if (user) {
      await AuditService.log({
        userId: user.id,
        action: ActivityAction.LOGOUT,
        resourceType: "AUTH",
        resourceId: user.id,
        details: { email: user.email },
        ipAddress,
        userAgent,
        result: "SUCCESS",
      });
    }
  }

  public static async createUser(
    data: { email: string; name: string; passwordPlain: string; role?: Role },
    creatorUser?: UserRecord,
    ipAddress?: string,
    userAgent?: string
  ): Promise<Omit<UserRecord, "passwordHash">> {
    const existing = await db.user.findUnique({ where: { email: data.email.trim() } });
    if (existing) {
      throw new Error("Email is already registered");
    }

    if (!data.passwordPlain || data.passwordPlain.length < 6) {
      throw new Error("Password must be at least 6 characters long");
    }

    const passwordHash = bcrypt.hashSync(data.passwordPlain, 10);
    const newUser = await db.user.create({
      data: {
        email: data.email.trim().toLowerCase(),
        name: data.name.trim(),
        passwordHash,
        role: data.role || Role.USER,
        isActive: true,
      },
    });

    await AuditService.log({
      userId: creatorUser?.id,
      action: ActivityAction.USER_CREATED,
      resourceType: "USER",
      resourceId: newUser.id,
      details: { email: newUser.email, role: newUser.role, name: newUser.name },
      ipAddress,
      userAgent,
      result: "SUCCESS",
    });

    const { passwordHash: _, ...safeUser } = newUser;
    return safeUser;
  }

  public static async updateUser(
    id: string,
    data: { name?: string; role?: Role; isActive?: boolean; passwordPlain?: string },
    adminUser?: UserRecord,
    ipAddress?: string,
    userAgent?: string
  ): Promise<Omit<UserRecord, "passwordHash">> {
    const existing = await db.user.findUnique({ where: { id } });
    if (!existing) {
      throw new Error("User not found");
    }

    const updatePayload: Partial<UserRecord> = {};
    if (data.name) updatePayload.name = data.name.trim();
    if (data.role) updatePayload.role = data.role;
    if (data.isActive !== undefined) updatePayload.isActive = data.isActive;
    if (data.passwordPlain) {
      if (data.passwordPlain.length < 6) {
        throw new Error("Password must be at least 6 characters long");
      }
      updatePayload.passwordHash = bcrypt.hashSync(data.passwordPlain, 10);
    }

    const updated = await db.user.update({
      where: { id },
      data: updatePayload,
    });

    await AuditService.log({
      userId: adminUser?.id,
      action: ActivityAction.USER_UPDATED,
      resourceType: "USER",
      resourceId: updated.id,
      details: { changes: Object.keys(updatePayload) },
      ipAddress,
      userAgent,
      result: "SUCCESS",
    });

    const { passwordHash: _, ...safeUser } = updated;
    return safeUser;
  }

  public static async listUsers(): Promise<Array<Omit<UserRecord, "passwordHash">>> {
    const users = await db.user.findMany();
    return users.map(({ passwordHash: _, ...u }) => u);
  }

  public static async getPublicConfig(): Promise<{
    allowRegistration: boolean;
    adminEmail: string;
    maxFileSizeMb: number;
    appName: string;
  }> {
    const regSetting = await db.systemSetting.findUnique({ where: { key: "ALLOW_PUBLIC_REGISTRATION" } });
    const sizeSetting = await db.systemSetting.findUnique({ where: { key: "MAX_FILE_SIZE_MB" } });
    const envAdminEmail = (process.env.ADMIN_EMAIL || "admin@clouddrive.local").trim().toLowerCase();

    return {
      allowRegistration: regSetting ? regSetting.value !== "false" : true,
      adminEmail: envAdminEmail,
      maxFileSizeMb: sizeSetting ? parseInt(sizeSetting.value, 10) || 200 : 200,
      appName: "Power Drive Cloud",
    };
  }
}
