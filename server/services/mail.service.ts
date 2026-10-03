import nodemailer from "nodemailer";
import { db } from "../db/index.ts";
import { SmtpConfig } from "../types/index.ts";

export class MailService {
  /**
   * Get current SMTP configuration from database settings or environment variables
   */
  public static async getSmtpConfig(): Promise<SmtpConfig> {
    const hostSetting = await db.systemSetting.findUnique({ where: { key: "SMTP_HOST" } });
    const portSetting = await db.systemSetting.findUnique({ where: { key: "SMTP_PORT" } });
    const secureSetting = await db.systemSetting.findUnique({ where: { key: "SMTP_SECURE" } });
    const userSetting = await db.systemSetting.findUnique({ where: { key: "SMTP_USER" } });
    const passSetting = await db.systemSetting.findUnique({ where: { key: "SMTP_PASS" } });
    const fromEmailSetting = await db.systemSetting.findUnique({ where: { key: "SMTP_FROM_EMAIL" } });
    const fromNameSetting = await db.systemSetting.findUnique({ where: { key: "SMTP_FROM_NAME" } });

    const host = hostSetting?.value || process.env.SMTP_HOST || "smtp.gmail.com";
    const port = parseInt(portSetting?.value || process.env.SMTP_PORT || "587", 10);
    const secure = (secureSetting?.value ?? process.env.SMTP_SECURE) === "true";
    const user = userSetting?.value || process.env.SMTP_USER || "";
    const pass = passSetting?.value || process.env.SMTP_PASS || "";
    const fromEmail = fromEmailSetting?.value || process.env.SMTP_FROM_EMAIL || "no-reply@clouddrive.local";
    const fromName = fromNameSetting?.value || process.env.SMTP_FROM_NAME || "Power Drive Cloud";

    const isConfigured = Boolean(host && port && user && pass);

    return {
      host,
      port,
      secure,
      user,
      pass,
      fromEmail,
      fromName,
      isConfigured,
    };
  }

  /**
   * Update SMTP configuration in system settings
   */
  public static async saveSmtpConfig(config: Partial<SmtpConfig>): Promise<SmtpConfig> {
    if (config.host !== undefined) {
      await db.systemSetting.upsert({
        where: { key: "SMTP_HOST" },
        update: { value: config.host.trim(), description: "SMTP server host" },
        create: { key: "SMTP_HOST", value: config.host.trim(), description: "SMTP server host" },
      });
    }

    if (config.port !== undefined) {
      await db.systemSetting.upsert({
        where: { key: "SMTP_PORT" },
        update: { value: String(config.port), description: "SMTP server port" },
        create: { key: "SMTP_PORT", value: String(config.port), description: "SMTP server port" },
      });
    }

    if (config.secure !== undefined) {
      await db.systemSetting.upsert({
        where: { key: "SMTP_SECURE" },
        update: { value: config.secure ? "true" : "false", description: "SMTP SSL/TLS enabled" },
        create: { key: "SMTP_SECURE", value: config.secure ? "true" : "false", description: "SMTP SSL/TLS enabled" },
      });
    }

    if (config.user !== undefined) {
      await db.systemSetting.upsert({
        where: { key: "SMTP_USER" },
        update: { value: config.user.trim(), description: "SMTP authentication username/email" },
        create: { key: "SMTP_USER", value: config.user.trim(), description: "SMTP authentication username/email" },
      });
    }

    if (config.pass !== undefined && config.pass !== "********") {
      await db.systemSetting.upsert({
        where: { key: "SMTP_PASS" },
        update: { value: config.pass, description: "SMTP authentication password/app password" },
        create: { key: "SMTP_PASS", value: config.pass, description: "SMTP authentication password/app password" },
      });
    }

    if (config.fromEmail !== undefined) {
      await db.systemSetting.upsert({
        where: { key: "SMTP_FROM_EMAIL" },
        update: { value: config.fromEmail.trim(), description: "SMTP sender email address" },
        create: { key: "SMTP_FROM_EMAIL", value: config.fromEmail.trim(), description: "SMTP sender email address" },
      });
    }

    if (config.fromName !== undefined) {
      await db.systemSetting.upsert({
        where: { key: "SMTP_FROM_NAME" },
        update: { value: config.fromName.trim(), description: "SMTP sender display name" },
        create: { key: "SMTP_FROM_NAME", value: config.fromName.trim(), description: "SMTP sender display name" },
      });
    }

    return await this.getSmtpConfig();
  }

  /**
   * Create Nodemailer transport based on current config
   */
  private static async createTransport() {
    const config = await this.getSmtpConfig();
    if (!config.host || !config.port || !config.user || !config.pass) {
      throw new Error(
        "Konfigurasi SMTP belum lengkap. Silakan lengkapi pengaturan SMTP (Host, Port, Username, Password) di Pengaturan Administrator."
      );
    }

    return {
      transporter: nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
          user: config.user,
          pass: config.pass,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      }),
      config,
    };
  }

  /**
   * Send test email to verify SMTP configuration
   */
  public static async sendTestEmail(toEmail: string): Promise<{ success: boolean; messageId: string; message: string }> {
    const { transporter, config } = await this.createTransport();

    // Verify SMTP connection
    await transporter.verify();

    const info = await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to: toEmail,
      subject: "Uji Coba Pengaturan SMTP - Power Drive",
      text: `Halo,\n\nIni adalah email uji coba untuk memverifikasi bahwa konfigurasi SMTP pada sistem Power Drive berhasil terhubung dan berfungsi dengan baik.\n\nHost: ${config.host}:${config.port}\nPengirim: ${config.fromEmail}\nWaktu: ${new Date().toLocaleString("id-ID")}\n\nSalam,\nAdministrator Power Drive`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
          <div style="background: #2563eb; padding: 20px; border-radius: 8px; text-align: center; color: #ffffff; margin-bottom: 24px;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 700;">Power Drive</h1>
            <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9;">Uji Coba Pengaturan Server Email (SMTP)</p>
          </div>
          <div style="background: #ffffff; padding: 24px; border-radius: 8px; border: 1px solid #e2e8f0; color: #1e293b;">
            <h2 style="margin-top: 0; font-size: 16px; color: #0f172a;">Koneksi SMTP Berhasil! 🎉</h2>
            <p style="font-size: 14px; line-height: 1.6; color: #475569;">
              Email ini mengonfirmasi bahwa server email SMTP Anda telah berhasil dikonfigurasi dan dapat mengirimkan pesan keluar dengan sukses.
            </p>
            <div style="background: #f1f5f9; padding: 14px; border-radius: 6px; font-size: 12px; color: #334155; margin: 16px 0;">
              <div><strong>Host SMTP:</strong> ${config.host}:${config.port}</div>
              <div><strong>SSL / TLS:</strong> ${config.secure ? "Aktif (SSL/TLS)" : "STARTTLS"}</div>
              <div><strong>Email Pengirim:</strong> ${config.fromEmail}</div>
              <div><strong>Waktu Verifikasi:</strong> ${new Date().toLocaleString("id-ID")}</div>
            </div>
            <p style="font-size: 12px; color: #64748b; margin-bottom: 0;">
              Fitur pemulihan kata sandi (Forgot Password) dan notifikasi email kini siap digunakan.
            </p>
          </div>
        </div>
      `,
    });

    return {
      success: true,
      messageId: info.messageId,
      message: `Email uji coba berhasil dikirim ke ${toEmail}`,
    };
  }

  /**
   * Send Password Reset Email with interactive link & token
   */
  public static async sendPasswordResetEmail({
    toEmail,
    userName,
    resetToken,
    expiresAt,
    appUrl,
  }: {
    toEmail: string;
    userName?: string;
    resetToken: string;
    expiresAt: Date;
    appUrl?: string;
  }): Promise<{ success: boolean; messageId?: string }> {
    const config = await this.getSmtpConfig();
    
    // If SMTP is not fully configured, log warning and return without throwing so the system flow is graceful
    if (!config.isConfigured) {
      console.warn(
        `[MailService] SMTP not configured; password reset email for ${toEmail} was not sent.`
      );
      return { success: false };
    }

    const { transporter } = await this.createTransport();

    const baseUrl = appUrl || process.env.APP_URL || "http://localhost:3000";
    const resetUrl = `${baseUrl}?tab=reset-password&token=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(toEmail)}`;

    const formattedExpiry = new Date(expiresAt).toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const info = await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to: toEmail,
      subject: "Permintaan Pengaturan Ulang Kata Sandi - Power Drive",
      text: `Halo ${userName || "Pengguna"},\n\nKami menerima permintaan untuk mengatur ulang kata sandi akun Power Drive Anda (${toEmail}).\n\nGunakan token reset berikut:\n${resetToken}\n\nAtau buka tautan berikut untuk membuat kata sandi baru:\n${resetUrl}\n\nTautan dan token ini hanya berlaku selama 1 jam (hingga pukul ${formattedExpiry}).\n\nJika Anda tidak meminta pengaturan ulang kata sandi, abaikan email ini.\n\nSalam,\nTim Administrator Power Drive`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
          <div style="background: #2563eb; padding: 20px; border-radius: 8px; text-align: center; color: #ffffff; margin-bottom: 24px;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 700;">Power Drive</h1>
            <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9;">Pengaturan Ulang Kata Sandi Akun</p>
          </div>
          <div style="background: #ffffff; padding: 24px; border-radius: 8px; border: 1px solid #e2e8f0; color: #1e293b;">
            <h2 style="margin-top: 0; font-size: 16px; color: #0f172a;">Halo, ${userName || "Pengguna"}</h2>
            <p style="font-size: 14px; line-height: 1.6; color: #475569;">
              Kami menerima permintaan untuk mengatur ulang kata sandi untuk akun Anda (<strong>${toEmail}</strong>). Silakan klik tombol di bawah ini untuk membuat kata sandi baru:
            </p>
            <div style="text-align: center; margin: 24px 0;">
              <a href="${resetUrl}" style="display: inline-block; background: #2563eb; color: #ffffff; font-weight: 600; font-size: 14px; padding: 12px 28px; text-decoration: none; border-radius: 8px; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);">
                Atur Ulang Kata Sandi Saya
              </a>
            </div>
            <div style="background: #f1f5f9; padding: 14px; border-radius: 6px; font-size: 12px; color: #334155; margin: 16px 0;">
              <div><strong>Kode Token Manual:</strong> <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-weight: bold;">${resetToken}</code></div>
              <div style="margin-top: 4px;"><strong>Batas Waktu:</strong> Berlaku 1 jam (hingga ${formattedExpiry})</div>
            </div>
            <p style="font-size: 12px; color: #64748b; line-height: 1.5;">
              Jika tombol di atas tidak berfungsi, salin dan tempel URL berikut ke browser Anda:<br />
              <a href="${resetUrl}" style="color: #2563eb; word-break: break-all;">${resetUrl}</a>
            </p>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
            <p style="font-size: 11px; color: #94a3b8; margin-bottom: 0;">
              Jika Anda tidak meminta perubahan kata sandi ini, akun Anda tetap aman dan Anda dapat mengabaikan email ini.
            </p>
          </div>
        </div>
      `,
    });

    return {
      success: true,
      messageId: info.messageId,
    };
  }
}
