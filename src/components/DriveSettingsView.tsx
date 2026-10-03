import React, { useState, useEffect } from "react";
import {
  Folder,
  HardDrive,
  RefreshCw,
  FolderOpen,
  Database,
  CheckCircle2,
  AlertCircle,
  Clock,
  Activity,
  ShieldCheck,
  RotateCw,
  Mail,
  Send,
  ToggleLeft,
  ToggleRight,
  Save,
  Server,
  UserCheck,
  Loader2,
  Info,
  Globe,
  Unlink,
  Check,
  X,
  AlertTriangle,
  FolderPlus,
  Plus,
  Users,
  Key,
  Shield,
} from "lucide-react";
import { Folder as FolderType, MountDrive, SyncStats, StorageStats, GoogleDriveStatus } from "../types/frontend.ts";
import { api } from "../services/api.ts";
import { useAuth } from "../context/AuthContext.tsx";
import {
  requestGoogleOAuthToken,
  connectGoogleDriveAccount,
  disconnectGoogleDriveAccount,
} from "../lib/google-auth.ts";

interface DriveSettingsViewProps {
  googleStatus?: GoogleDriveStatus | any;
  storageStats?: StorageStats | any;
  syncStats?: SyncStats | any;
  folders: FolderType[];
  mounts: MountDrive[];
  onRefreshAll: () => void;
}

export const DriveSettingsView: React.FC<DriveSettingsViewProps> = ({
  googleStatus,
  storageStats,
  syncStats,
  folders = [],
  mounts = [],
  onRefreshAll,
}) => {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [isRetryingAll, setIsRetryingAll] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  // System Settings State
  const [allowRegistration, setAllowRegistration] = useState<boolean>(true);
  const [isUpdatingSetting, setIsUpdatingSetting] = useState<boolean>(false);
  const [settingMessage, setSettingMessage] = useState<string | null>(null);

  // SMTP Settings State
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFromEmail, setSmtpFromEmail] = useState("");
  const [smtpFromName, setSmtpFromName] = useState("");
  const [isSavingSmtp, setIsSavingSmtp] = useState(false);
  const [isTestingSmtp, setIsTestingSmtp] = useState(false);
  const [testEmailRecipient, setTestEmailRecipient] = useState(user?.email || "admin@clouddrive.local");
  const [smtpMessage, setSmtpMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Google Account Integration State
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [isDisconnectingGoogle, setIsDisconnectingGoogle] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [googleSuccess, setGoogleSuccess] = useState<string | null>(null);

  // Mounted Drive Admin State
  const [newMountName, setNewMountName] = useState("");
  const [isCreatingMount, setIsCreatingMount] = useState(false);
  const [mountPermInputs, setMountPermInputs] = useState<Record<string, string>>({});
  const [savingPermId, setSavingPermId] = useState<string | null>(null);
  const [mountNotice, setMountNotice] = useState<{ mountId?: string; type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (mounts && mounts.length > 0) {
      const initialPerms: Record<string, string> = {};
      mounts.forEach((m) => {
        if (m.allowedEmails && Array.isArray(m.allowedEmails)) {
          initialPerms[m.id] = m.allowedEmails.join(", ");
        } else {
          initialPerms[m.id] = "";
        }
      });
      setMountPermInputs((prev) => ({ ...initialPerms, ...prev }));
    }
  }, [mounts]);

  const handleCreateMountPoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMountName.trim()) return;
    setIsCreatingMount(true);
    setMountNotice(null);
    try {
      const res = await api.createMountPoint(newMountName.trim());
      setMountNotice({
        type: "success",
        text: res.message || `Titik pasang baru "${newMountName}" berhasil ditambahkan!`,
      });
      setNewMountName("");
      onRefreshAll();
    } catch (err: any) {
      setMountNotice({
        type: "error",
        text: err.message || "Gagal membuat mounted drive baru.",
      });
    } finally {
      setIsCreatingMount(false);
    }
  };

  const handleSaveMountPermissions = async (mountId: string) => {
    setSavingPermId(mountId);
    setMountNotice(null);
    try {
      const rawEmails = mountPermInputs[mountId] || "";
      const emailList = rawEmails.split(",").map((e) => e.trim()).filter(Boolean);
      const res = await api.updateMountPermissions(mountId, emailList);
      setMountNotice({
        mountId,
        type: "success",
        text: res.message || "Izin akses email untuk storage ini berhasil diperbarui!",
      });
      onRefreshAll();
    } catch (err: any) {
      setMountNotice({
        mountId,
        type: "error",
        text: err.message || "Gagal memperbarui izin akses email.",
      });
    } finally {
      setSavingPermId(null);
    }
  };

  // Load System Settings and SMTP Config
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [authCfg, smtpRes] = await Promise.all([
          api.getAuthConfig().catch(() => null),
          isAdmin ? api.getSmtpConfig().catch(() => null) : Promise.resolve(null),
        ]);

        if (authCfg) {
          setAllowRegistration(authCfg.allowRegistration ?? true);
        }

        if (smtpRes && smtpRes.config) {
          setSmtpHost(smtpRes.config.host || "");
          setSmtpPort(smtpRes.config.port || 587);
          setSmtpSecure(Boolean(smtpRes.config.secure));
          setSmtpUser(smtpRes.config.user || "");
          setSmtpPassword(smtpRes.config.pass || "");
          setSmtpFromEmail(smtpRes.config.fromEmail || "");
          setSmtpFromName(smtpRes.config.fromName || "");
        }
      } catch (err) {
        console.warn("[DriveSettingsView] Error loading configurations:", err);
      }
    };

    loadSettings();
  }, [isAdmin, user?.email]);

  const formatBytes = (bytes?: number) => {
    if (bytes === undefined || bytes === null || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const hasMounts = mounts.length > 0;

  // Calculate sync totals
  const totalFiles = storageStats?.totalFiles || 0;
  const syncedFiles = storageStats?.syncedCount ?? storageStats?.syncStatusBreakdown?.synced ?? 0;
  const pendingFiles = storageStats?.pendingSyncCount ?? ((storageStats?.syncStatusBreakdown?.pending || 0) + (storageStats?.syncStatusBreakdown?.processing || 0)) ?? 0;
  const failedFiles = storageStats?.failedSyncCount ?? storageStats?.syncStatusBreakdown?.failed ?? 0;

  const syncRate = totalFiles > 0 ? Math.round((syncedFiles / totalFiles) * 100) : 100;

  const handleRetryFailed = async () => {
    setIsRetryingAll(true);
    setRetryMessage(null);
    try {
      await api.retryFailedSyncJobs();
      setRetryMessage("Semua antrean sinkronisasi yang gagal telah dijadwalkan ulang!");
      onRefreshAll();
      setTimeout(() => setRetryMessage(null), 4000);
    } catch (err: any) {
      setRetryMessage(`Gagal menjadwalkan ulang: ${err.message}`);
    } finally {
      setIsRetryingAll(false);
    }
  };

  /**
   * Toggle Public Registration Setting (Admin only)
   */
  const handleToggleRegistration = async () => {
    const nextState = !allowRegistration;
    setIsUpdatingSetting(true);
    setSettingMessage(null);

    try {
      await api.updateSystemSetting(
        "ALLOW_PUBLIC_REGISTRATION",
        nextState ? "true" : "false",
        "Izinkan pengguna umum mendaftar akun baru melalui form registrasi"
      );
      setAllowRegistration(nextState);
      setSettingMessage(
        nextState
          ? "Pendaftaran akun publik kini DIAKTIFKAN. Halaman registrasi dapat diakses oleh semua pengguna."
          : "Pendaftaran akun publik kini DINONAKTIFKAN. Hanya akun resmi yang dibuat oleh Admin yang dapat masuk."
      );
      setTimeout(() => setSettingMessage(null), 5000);
    } catch (err: any) {
      setSettingMessage(`Gagal memperbarui pengaturan: ${err.message}`);
    } finally {
      setIsUpdatingSetting(false);
    }
  };

  /**
   * Save SMTP Config (Admin only)
   */
  const handleSaveSmtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSmtp(true);
    setSmtpMessage(null);

    try {
      const res = await api.saveSmtpConfig({
        host: smtpHost.trim(),
        port: Number(smtpPort),
        secure: smtpSecure,
        user: smtpUser.trim(),
        pass: smtpPassword,
        fromEmail: smtpFromEmail.trim() || smtpUser.trim(),
        fromName: smtpFromName.trim() || "Power Drive",
      });

      setSmtpMessage({
        type: "success",
        text: res.message || "Konfigurasi SMTP berhasil disimpan!",
      });
      setTimeout(() => setSmtpMessage(null), 5000);
    } catch (err: any) {
      setSmtpMessage({
        type: "error",
        text: err.message || "Gagal menyimpan konfigurasi SMTP.",
      });
    } finally {
      setIsSavingSmtp(false);
    }
  };

  /**
   * Test SMTP Connection (Admin only)
   */
  const handleTestSmtp = async () => {
    if (!testEmailRecipient.trim()) {
      setSmtpMessage({
        type: "error",
        text: "Masukkan alamat email penerima untuk pengujian.",
      });
      return;
    }

    setIsTestingSmtp(true);
    setSmtpMessage(null);

    try {
      const res = await api.testSmtpConfig(testEmailRecipient.trim());
      setSmtpMessage({
        type: "success",
        text: `Email uji coba berhasil dikirim ke ${testEmailRecipient}! Periksa kotak masuk / spam email Anda.`,
      });
    } catch (err: any) {
      setSmtpMessage({
        type: "error",
        text: `Uji coba koneksi SMTP gagal: ${err.message}`,
      });
    } finally {
      setIsTestingSmtp(false);
    }
  };

  /**
   * Connect Google Account using Google OAuth Popup flow
   * Strict validation: Google account email must match logged in user email
   */
  const handleConnectGoogleWithOAuth = async () => {
    setIsConnectingGoogle(true);
    setGoogleError(null);
    setGoogleSuccess(null);
    try {
      const { tokenResponse, profile } = await requestGoogleOAuthToken();
      
      // Strict client-side validation against current logged-in user email
      if (user?.email && profile.email) {
        const normUserEmail = user.email.trim().toLowerCase();
        const normGoogleEmail = profile.email.trim().toLowerCase();
        if (normUserEmail !== normGoogleEmail) {
          throw new Error(
            `Email akun Google (${normGoogleEmail}) tidak sama dengan email akun Anda (${normUserEmail}). Anda hanya dapat menghubungkan akun Google dengan alamat email yang sama persis.`
          );
        }
      }

      await connectGoogleDriveAccount(
        tokenResponse.access_token,
        profile.email || user?.email,
        profile.name || user?.name
      );

      setGoogleSuccess(`Akun Google Drive (${profile.email || user?.email}) berhasil dikoneksikan! Token dan hak akses sinkronisasi telah disimpan ke database.`);
      onRefreshAll();
      setTimeout(() => setGoogleSuccess(null), 6000);
    } catch (err: any) {
      console.error("[DriveSettingsView] Google Connect Error:", err);
      setGoogleError(err.message || "Gagal menghubungkan akun Google.");
    } finally {
      setIsConnectingGoogle(false);
    }
  };

  /**
   * Disconnect Google Account
   */
  const handleDisconnectGoogle = async () => {
    if (!window.confirm("Apakah Anda yakin ingin memutuskan sambungan akun Google Drive? Tombol sinkronisasi berkas akan disembunyikan sampai Anda menghubungkan kembali akun Google.")) {
      return;
    }

    setIsDisconnectingGoogle(true);
    setGoogleError(null);
    setGoogleSuccess(null);
    try {
      await api.disconnectGoogle();
      await disconnectGoogleDriveAccount();
      setGoogleSuccess("Akun Google Drive berhasil diputuskan. Tombol sinkronisasi kini dinonaktifkan.");
      onRefreshAll();
      setTimeout(() => setGoogleSuccess(null), 5000);
    } catch (err: any) {
      setGoogleError(err.message || "Gagal memutuskan sambungan akun Google.");
    } finally {
      setIsDisconnectingGoogle(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      
      {/* Header Panel */}
      <div className="bg-surface rounded-xl border border-ink-200 p-5 shadow-card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-ink-900 tracking-tight flex items-center gap-2">
            <Database className="w-5 h-5 text-accent-600" />
            Pengaturan &amp; Pemantauan Sistem Power Drive
          </h2>
          <p className="text-xs text-ink-500 mt-1">
            Status koneksi Google Drive, antrean sinkronisasi berkas otomatis, hak akses registrasi, dan konfigurasi server email SMTP.
          </p>
        </div>

        <button
          onClick={onRefreshAll}
          className="px-3.5 py-2 text-xs font-semibold text-ink-700 bg-ink-100 hover:bg-ink-200 rounded-lg transition flex items-center gap-1.5 self-start sm:self-auto shadow-card cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Segarkan Data</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 0. INTEGRASI AKUN GOOGLE DRIVE DENGAN VALIDASI EMAIL SAMA */}
      {/* ========================================================================= */}
      <div className="bg-surface rounded-xl border border-ink-200 p-5 shadow-card space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-ink-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent-50 text-accent-600 flex items-center justify-center shadow-card">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink-900 flex items-center gap-2">
                Integrasi Akun Google Drive
                {googleStatus?.isConnected ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-ok-50 text-ok-700 border border-ok-200">
                    <Check className="w-3 h-3 text-ok-600" />
                    Terhubung
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-warn-50 text-warn-700 border border-warn-200">
                    <AlertTriangle className="w-3 h-3 text-warn-600" />
                    Belum Terkoneksi
                  </span>
                )}
              </h3>
              <p className="text-xs text-ink-500">
                Koneksikan akun Google Drive Anda dengan validasi email yang sama (<span className="font-mono text-ink-800 font-semibold">{user?.email || "Email Akun"}</span>) untuk mengaktifkan sinkronisasi berkas.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {googleStatus?.isConnected ? (
              <button
                type="button"
                onClick={handleDisconnectGoogle}
                disabled={isDisconnectingGoogle}
                className="px-3 py-1.5 bg-danger-50 hover:bg-danger-100 text-danger-700 border border-danger-200 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isDisconnectingGoogle ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
                <span>Putuskan Sambungan</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConnectGoogleWithOAuth}
                disabled={isConnectingGoogle}
                className="px-3.5 py-2 bg-accent-600 hover:bg-accent-700 text-accent-fg rounded-lg text-xs font-bold transition flex items-center gap-2 shadow-card cursor-pointer disabled:opacity-50"
              >
                {isConnectingGoogle ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                )}
                <span>Koneksikan Akun Google</span>
              </button>
            )}
          </div>
        </div>

        {/* Feedback alerts */}
        {googleSuccess && (
          <div className="p-3.5 bg-ok-50 border border-ok-200 rounded-xl text-ok-800 text-xs font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-ok-600 shrink-0" />
            <span>{googleSuccess}</span>
          </div>
        )}

        {googleError && (
          <div className="p-3.5 bg-danger-50 border border-danger-200 rounded-xl text-danger-800 text-xs font-medium flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-danger-600 shrink-0" />
            <span>{googleError}</span>
          </div>
        )}

        {/* Connection status content */}
        {googleStatus?.isConnected ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-ink-50 border border-ink-200 space-y-1">
              <div className="text-[11px] font-semibold text-ink-500">Email Google Terhubung</div>
              <div className="text-sm font-bold text-ink-900 truncate font-mono">
                {googleStatus?.connection?.accountEmail || user?.email}
              </div>
              <div className="text-[10px] text-ok-600 font-medium flex items-center gap-1">
                <Check className="w-3 h-3" /> Validasi email cocok dengan akun lokal
              </div>
            </div>

            <div className="p-4 rounded-xl bg-ink-50 border border-ink-200 space-y-1">
              <div className="text-[11px] font-semibold text-ink-500">Nama Akun / Profil</div>
              <div className="text-sm font-bold text-ink-900 truncate">
                {googleStatus?.connection?.accountName || user?.name || "Pengguna Google"}
              </div>
              <div className="text-[10px] text-ink-500">
                Akses Google Drive API aktif
              </div>
            </div>

            <div className="p-4 rounded-xl bg-ink-50 border border-ink-200 space-y-1">
              <div className="text-[11px] font-semibold text-ink-500">Token &amp; Refresh Token</div>
              <div className="text-xs font-bold text-ok-700 flex items-center gap-1">
                <ShieldCheck className="w-4 h-4 text-ok-600" />
                Tersimpan di Database
              </div>
              <div className="text-[10px] text-ink-500">
                Siap digunakan untuk sinkronisasi otomatis
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-warn-50/80 border border-warn-200 text-xs text-warn-900 space-y-2">
              <div className="font-bold flex items-center gap-1.5 text-warn-800">
                <Info className="w-4 h-4 text-warn-600" />
                Aturan &amp; Persyaratan Koneksi Google Drive:
              </div>
              <ul className="list-disc list-inside space-y-1 text-warn-800 text-[11px]">
                <li>
                  Akun Google yang Anda hubungkan <strong>harus memiliki alamat email yang sama persis</strong> dengan email akun Anda saat ini (<span className="font-mono font-bold">{user?.email}</span>).
                </li>
                <li>
                  Setelah berhasil terhubung, token otorisasi dan refresh token akan disimpan di database secara aman untuk sinkronisasi background.
                </li>
                <li>
                  Tombol sinkronisasi pada daftar berkas, menu konteks klik kanan, dan laci rincian hanya akan dimunculkan setelah akun Google terhubung.
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 1. DETAIL SINKRONISASI GOOGLE DRIVE (BACKGROUND SYNC ENGINE) */}
      {/* ========================================================================= */}
      <div className="bg-surface rounded-xl border border-ink-200 p-5 shadow-card space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-ink-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent-50 text-accent-600 flex items-center justify-center shadow-card">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink-900 flex items-center gap-2">
                Detail Sinkronisasi Google Drive
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-ok-50 text-ok-700 border border-ok-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-ok-500 animate-pulse"></span>
                  Layanan Aktif
                </span>
              </h3>
              <p className="text-xs text-ink-400">
                Otomatisasi pengunggahan berkas lokal ke Google Drive di latar belakang (Background Sync Engine)
              </p>
            </div>
          </div>

          {failedFiles > 0 && (
            <button
              onClick={handleRetryFailed}
              disabled={isRetryingAll}
              className="px-3.5 py-2 bg-danger-50 hover:bg-danger-100 text-danger-700 border border-danger-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isRetryingAll ? "animate-spin" : ""}`} />
              <span>Coba Sinkronisasi Ulang ({failedFiles} Berkas Gagal)</span>
            </button>
          )}
        </div>

        {retryMessage && (
          <div className="p-3 bg-accent-50 border border-accent-200 rounded-xl text-accent-800 text-xs font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-accent-600 shrink-0" />
            <span>{retryMessage}</span>
          </div>
        )}

        {/* Sync Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          <div className="p-4 rounded-xl bg-ink-50 border border-ink-200/80 space-y-1">
            <div className="flex items-center justify-between text-ink-500 text-xs">
              <span className="font-semibold">Total Berkas</span>
              <Database className="w-4 h-4 text-ink-400" />
            </div>
            <div className="text-xl font-extrabold text-ink-900">{totalFiles}</div>
            <div className="text-[10px] text-ink-400 font-mono">
              {formatBytes(storageStats?.totalSizeBytes || 0)}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-ok-50/60 border border-ok-200 space-y-1">
            <div className="flex items-center justify-between text-ok-800 text-xs">
              <span className="font-semibold">Tersinkron di Drive</span>
              <CheckCircle2 className="w-4 h-4 text-ok-600" />
            </div>
            <div className="text-xl font-extrabold text-ok-900">{syncedFiles}</div>
            <div className="text-[10px] text-ok-700 font-medium">{syncRate}% dari total berkas</div>
          </div>

          <div className="p-4 rounded-xl bg-warn-50/60 border border-warn-200 space-y-1">
            <div className="flex items-center justify-between text-warn-800 text-xs">
              <span className="font-semibold">Dalam Antrean</span>
              <Clock className="w-4 h-4 text-warn-600" />
            </div>
            <div className="text-xl font-extrabold text-warn-900">{pendingFiles}</div>
            <div className="text-[10px] text-warn-700 font-medium">Menunggu giliran upload</div>
          </div>

          <div className="p-4 rounded-xl bg-danger-50/60 border border-danger-200 space-y-1">
            <div className="flex items-center justify-between text-danger-800 text-xs">
              <span className="font-semibold">Gagal Sinkron</span>
              <AlertCircle className="w-4 h-4 text-danger-600" />
            </div>
            <div className="text-xl font-extrabold text-danger-900">{failedFiles}</div>
            <div className="text-[10px] text-danger-700 font-medium">
              {failedFiles > 0 ? "Perlu dicoba ulang" : "Semua berkas aman"}
            </div>
          </div>
        </div>

        {/* Sync Progress Bar */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-ink-700">Rasio Kelengkapan Sinkronisasi Google Drive</span>
            <span className="font-bold text-ink-900">{syncRate}% Selesai</span>
          </div>
          <div className="w-full h-2.5 bg-ink-100 rounded-full overflow-hidden flex">
            <div
              className="bg-ok-500 h-full transition duration-500"
              style={{ width: `${(syncedFiles / (totalFiles || 1)) * 100}%` }}
              title={`Tersinkron: ${syncedFiles}`}
            />
            <div
              className="bg-warn-400 h-full transition duration-500"
              style={{ width: `${(pendingFiles / (totalFiles || 1)) * 100}%` }}
              title={`Dalam antrean: ${pendingFiles}`}
            />
            <div
              className="bg-danger-500 h-full transition duration-500"
              style={{ width: `${(failedFiles / (totalFiles || 1)) * 100}%` }}
              title={`Gagal: ${failedFiles}`}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[11px] text-ink-500 pt-0.5">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-ok-500"></span> Tersinkron ({syncedFiles})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-warn-400"></span> Dalam Antrean ({pendingFiles})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-danger-500"></span> Gagal ({failedFiles})
            </span>
          </div>
        </div>

        {/* Background Worker Diagnostics Info */}
        <div className="p-3.5 rounded-xl bg-ink-50 border border-ink-200/80 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <span className="text-ink-400 block text-[10px] uppercase font-bold">Status Background Worker</span>
            <span className="font-bold text-ink-800 flex items-center gap-1.5 mt-0.5">
              <span className="w-2 h-2 rounded-full bg-ok-500"></span>
              {syncStats?.workerActive !== false ? "Berjalan Normal (Loop 3s)" : "Tidak Aktif"}
            </span>
          </div>
          <div>
            <span className="text-ink-400 block text-[10px] uppercase font-bold">Sinkronisasi Terakhir</span>
            <span className="font-medium text-ink-700 mt-0.5 block">
              {syncStats?.lastTickAt ? new Date(syncStats.lastTickAt).toLocaleTimeString("id-ID") : "Baru saja"}
            </span>
          </div>
          <div>
            <span className="text-ink-400 block text-[10px] uppercase font-bold">Penyimpanan Lokal Server</span>
            <span className="font-mono text-ink-700 text-[11px] mt-0.5 block truncate">
              {storageStats?.storageBasePath || "./storage"}
            </span>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. PENGATURAN ADMINISTRATOR: REGISTRASI & HAK AKSES PENGGUNA */}
      {/* ========================================================================= */}
      <div className="bg-surface rounded-xl border border-ink-200 p-5 shadow-card space-y-5">
        <div className="flex items-center gap-3 pb-3 border-b border-ink-100">
          <div className="w-10 h-10 rounded-xl bg-accent-50 text-accent-600 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-ink-900 flex items-center gap-2">
              Pengaturan Akses Pengguna &amp; Registrasi Akun
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-accent-50 text-accent-700 border border-accent-200">
                Administrator Control
              </span>
            </h3>
            <p className="text-xs text-ink-400">
              Kelola ketersediaan form pendaftaran akun baru bagi pengguna umum
            </p>
          </div>
        </div>

        {settingMessage && (
          <div className="p-3 bg-accent-50 border border-accent-200 rounded-xl text-accent-800 text-xs font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-accent-600 shrink-0" />
            <span>{settingMessage}</span>
          </div>
        )}

        <div className="p-4 rounded-xl bg-ink-50/80 border border-ink-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-xs text-ink-900">
                Ketersediaan Pendaftaran Publik (Public Registration)
              </span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-extrabold ${
                  allowRegistration
                    ? "bg-ok-100 text-ok-800 border border-ok-300"
                    : "bg-danger-100 text-danger-800 border border-danger-300"
                }`}
              >
                {allowRegistration ? "ENABLE (DIBUKA)" : "DISABLE (DITUTUP)"}
              </span>
            </div>
            <p className="text-xs text-ink-500 max-w-xl leading-relaxed">
              Jika diaktifkan (Enable), pengunjung dapat membuka halaman pendaftaran akun baru. Jika dinonaktifkan (Disable), halaman registrasi akan terkunci dan hanya administrator yang dapat membuat akun.
            </p>
          </div>

          <button
            type="button"
            onClick={handleToggleRegistration}
            disabled={isUpdatingSetting}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-card shrink-0 ${
              allowRegistration
                ? "bg-danger-50 hover:bg-danger-100 text-danger-700 border border-danger-300"
                : "bg-ok-600 hover:bg-ok-500 text-white"
            }`}
          >
            {isUpdatingSetting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : allowRegistration ? (
              <>
                <ToggleRight className="w-4 h-4 text-danger-600" />
                <span>Nonaktifkan Registrasi</span>
              </>
            ) : (
              <>
                <ToggleLeft className="w-4 h-4" />
                <span>Aktifkan Registrasi (Enable)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. KONFIGURASI SERVER EMAIL SMTP (SMTP EMAIL API) */}
      {/* ========================================================================= */}
      {isAdmin && (
        <div className="bg-surface rounded-xl border border-ink-200 p-5 shadow-card space-y-5">
          <div className="flex items-center gap-3 pb-3 border-b border-ink-100">
            <div className="w-10 h-10 rounded-xl bg-accent-50 text-accent-600 flex items-center justify-center">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink-900 flex items-center gap-2">
                Konfigurasi Server Email SMTP (Email API)
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-accent-50 text-accent-700 border border-accent-200">
                  SMTP Mailer
                </span>
              </h3>
              <p className="text-xs text-ink-400">
                Pengaturan SMTP untuk pengiriman token lupa kata sandi (Forgot Password) dan notifikasi sistem
              </p>
            </div>
          </div>

          {smtpMessage && (
            <div
              className={`p-3.5 rounded-xl border text-xs font-medium flex items-center gap-2 ${
                smtpMessage.type === "success"
                  ? "bg-ok-50 border-ok-200 text-ok-800"
                  : "bg-danger-50 border-danger-200 text-danger-800"
              }`}
            >
              {smtpMessage.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-ok-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-danger-600 shrink-0" />
              )}
              <span>{smtpMessage.text}</span>
            </div>
          )}

          <form onSubmit={handleSaveSmtp} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-ink-700 mb-1">
                  SMTP Host
                </label>
                <input
                  type="text"
                  required
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.gmail.com"
                  className="w-full bg-ink-50 border border-ink-300 rounded-lg px-3 py-2 text-xs text-ink-900 focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-700 mb-1">
                  SMTP Port
                </label>
                <input
                  type="number"
                  required
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(Number(e.target.value))}
                  placeholder="587"
                  className="w-full bg-ink-50 border border-ink-300 rounded-lg px-3 py-2 text-xs text-ink-900 focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-700 mb-1">
                  Koneksi Aman (SSL/TLS)
                </label>
                <select
                  value={smtpSecure ? "true" : "false"}
                  onChange={(e) => setSmtpSecure(e.target.value === "true")}
                  className="w-full bg-ink-50 border border-ink-300 rounded-lg px-3 py-2 text-xs text-ink-900 focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent-500"
                >
                  <option value="false">STARTTLS (Port 587)</option>
                  <option value="true">SSL / TLS (Port 465)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-ink-700 mb-1">
                  SMTP Username / Email Pengirim
                </label>
                <input
                  type="text"
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  placeholder="admin@clouddrive.local"
                  className="w-full bg-ink-50 border border-ink-300 rounded-lg px-3 py-2 text-xs text-ink-900 focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-700 mb-1">
                  SMTP Password / App Password
                </label>
                <input
                  type="password"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-ink-50 border border-ink-300 rounded-lg px-3 py-2 text-xs text-ink-900 focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent-500 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-ink-700 mb-1">
                  Alamat Email Pengirim (From Email)
                </label>
                <input
                  type="email"
                  value={smtpFromEmail}
                  onChange={(e) => setSmtpFromEmail(e.target.value)}
                  placeholder="admin@clouddrive.local"
                  className="w-full bg-ink-50 border border-ink-300 rounded-lg px-3 py-2 text-xs text-ink-900 focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-700 mb-1">
                  Nama Tampilan Pengirim (From Name)
                </label>
                <input
                  type="text"
                  value={smtpFromName}
                  onChange={(e) => setSmtpFromName(e.target.value)}
                  placeholder="Power Drive Official"
                  className="w-full bg-ink-50 border border-ink-300 rounded-lg px-3 py-2 text-xs text-ink-900 focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent-500"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <button
                type="submit"
                disabled={isSavingSmtp}
                className="px-4 py-2 bg-accent-600 hover:bg-accent-500 text-accent-fg rounded-lg text-xs font-bold transition shadow-card flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isSavingSmtp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>Simpan Konfigurasi SMTP</span>
              </button>
            </div>
          </form>

          {/* Test SMTP Email Box */}
          <div className="p-4 rounded-xl bg-ink-50 border border-ink-200 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-ink-800">
              <Send className="w-4 h-4 text-accent-600" />
              <span>Uji Coba Pengiriman Email (SMTP Test Mail)</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="email"
                value={testEmailRecipient}
                onChange={(e) => setTestEmailRecipient(e.target.value)}
                placeholder="Email penerima uji coba..."
                className="flex-1 bg-surface border border-ink-300 rounded-lg px-3 py-2 text-xs text-ink-900 focus:outline-none focus:ring-1 focus:ring-accent-500"
              />
              <button
                type="button"
                onClick={handleTestSmtp}
                disabled={isTestingSmtp}
                className="px-4 py-2 bg-accent-600 hover:bg-accent-500 text-accent-fg rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
              >
                {isTestingSmtp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>Kirim Email Percobaan</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. STORAGE MOUNTS (/mnt) */}
      {/* ========================================================================= */}
      <div className="bg-surface rounded-xl border border-ink-200 p-5 shadow-card space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-ink-100 flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-ok-50 text-ok-600 flex items-center justify-center">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink-900">Sistem Drive Terpasang (/mnt)</h3>
              <p className="text-[11px] text-ink-400">Storage terpasang lokal & konfigurasi izin akses email</p>
            </div>
          </div>
          {isAdmin && (
            <span className="px-2.5 py-1 rounded-full bg-accent-50 text-accent-700 text-[10px] font-bold border border-accent-100 flex items-center gap-1">
              <Shield className="w-3 h-3" /> Akun Admin
            </span>
          )}
        </div>

        {/* Global Notice Alert */}
        {mountNotice && !mountNotice.mountId && (
          <div
            className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
              mountNotice.type === "success"
                ? "bg-ok-50 text-ok-700 border border-ok-200"
                : "bg-danger-50 text-danger-700 border border-danger-200"
            }`}
          >
            {mountNotice.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{mountNotice.text}</span>
          </div>
        )}

        {/* ADMIN: Form Tambah Mounted Drive Baru */}
        {isAdmin && (
          <div className="p-4 rounded-xl border border-accent-100 bg-accent-50/30 space-y-3">
            <div className="flex items-center gap-2">
              <FolderPlus className="w-4 h-4 text-accent-600" />
              <h4 className="text-xs font-bold text-accent-950">Tambah Mounted Drive Baru (/mnt)</h4>
            </div>
            <p className="text-[11px] text-ink-500">
              Buat titik pasang (mount point) direktori baru di dalam folder <code className="bg-accent-100/70 text-accent-800 px-1 py-0.5 rounded font-mono">/mnt</code> untuk memisahkan ruang penyimpanan terpasang.
            </p>
            <form onSubmit={handleCreateMountPoint} className="flex items-center gap-2 pt-1">
              <div className="relative flex-1">
                <span className="absolute left-3 top-2.5 text-xs font-mono text-ink-400">/mnt/</span>
                <input
                  type="text"
                  value={newMountName}
                  onChange={(e) => setNewMountName(e.target.value)}
                  placeholder="nama-folder-mount (cth: data-shared, storage-backup)"
                  className="w-full pl-16 pr-3 py-2 bg-surface border border-ink-200 rounded-lg text-xs text-ink-800 font-mono focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500"
                  disabled={isCreatingMount}
                />
              </div>
              <button
                type="submit"
                disabled={isCreatingMount || !newMountName.trim()}
                className="px-4 py-2 bg-accent-600 hover:bg-accent-700 text-accent-fg rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
              >
                {isCreatingMount ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                <span>Tambah Drive</span>
              </button>
            </form>
          </div>
        )}

        {/* List of Mounts */}
        <div className="space-y-3">
          {mounts.length === 0 ? (
            <div className="text-center py-6 text-ink-400 text-xs font-medium bg-ink-50 rounded-xl border border-dashed border-ink-200">
              Belum ada drive terpasang di <code className="font-mono text-ink-600">/mnt</code>.
            </div>
          ) : (
            <div className="max-h-[500px] overflow-y-auto space-y-3 pr-1">
              {mounts.map((mount) => {
                const usedPercent = mount.totalBytes > 0
                  ? Math.round(((mount.totalBytes - mount.freeBytes) / mount.totalBytes) * 100)
                  : 0;

                const isSavingThis = savingPermId === mount.id;
                const noticeForThis = mountNotice?.mountId === mount.id ? mountNotice : null;

                return (
                  <div
                    key={mount.id}
                    className="p-4 rounded-xl border border-ink-200/80 bg-ink-50/30 hover:bg-ink-50/80 transition space-y-3.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="font-bold text-xs text-ink-800 block truncate">
                          {mount.name}
                        </span>
                        <span className="text-[10px] text-ink-400 font-mono block mt-0.5 truncate">
                          {mount.mountPoint}
                        </span>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-ok-50 text-ok-700 border border-ok-200">
                          Terpasang
                        </span>
                      </div>
                    </div>

                    {/* Disk usage bar */}
                    <div className="space-y-1">
                      <div className="w-full h-2 bg-ink-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition duration-500 ${
                            usedPercent > 90
                              ? "bg-danger-500"
                              : usedPercent > 75
                              ? "bg-warn-500"
                              : "bg-ok-500"
                          }`}
                          style={{ width: `${Math.min(100, Math.max(2, usedPercent))}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-ink-500 font-medium">
                        <span>Terpakai: {usedPercent}%</span>
                        <span className="font-mono">
                          Sisa: {formatBytes(mount.freeBytes)} / Total: {formatBytes(mount.totalBytes)}
                        </span>
                      </div>
                    </div>

                    {/* ADMIN: Permission Email Access Configuration */}
                    {isAdmin && (
                      <div className="pt-3 border-t border-ink-200/60 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-[11px] font-bold text-ink-700 flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5 text-accent-600" />
                            <span>Izin Akses Email (Mounted Storage Permission)</span>
                          </label>
                          {mountPermInputs[mount.id]?.trim() ? (
                            <span className="text-[10px] text-accent-600 font-medium bg-accent-50 px-2 py-0.5 rounded border border-accent-100">
                              Dibatasi Email
                            </span>
                          ) : (
                            <span className="text-[10px] text-ok-600 font-medium bg-ok-50 px-2 py-0.5 rounded border border-ok-100">
                              Publik (Semua Pengguna)
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={mountPermInputs[mount.id] ?? ""}
                            onChange={(e) =>
                              setMountPermInputs({
                                ...mountPermInputs,
                                [mount.id]: e.target.value,
                              })
                            }
                            placeholder="user1@example.com, user2@domain.com (kosongkan / '*' untuk semua)"
                            className="flex-1 px-3 py-1.5 bg-surface border border-ink-200 rounded-lg text-xs text-ink-800 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveMountPermissions(mount.id)}
                            disabled={isSavingThis}
                            className="px-3 py-1.5 bg-accent-600 hover:bg-accent-700 text-accent-fg rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer disabled:opacity-50 shrink-0"
                          >
                            {isSavingThis ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Save className="w-3 h-3" />
                            )}
                            <span>Simpan</span>
                          </button>
                        </div>

                        <p className="text-[10px] text-ink-400">
                          Ketik alamat email yang diperbolehkan mengakses storage ini (pisahkan dengan koma). Kosongkan atau beri <code className="font-mono bg-ink-100 px-1 rounded text-ink-600">*</code> agar dapat diakses oleh semua pengguna.
                        </p>

                        {noticeForThis && (
                          <div
                            className={`p-2 rounded text-[11px] font-medium flex items-center gap-1.5 mt-1 ${
                              noticeForThis.type === "success"
                                ? "bg-ok-50 text-ok-700 border border-ok-200"
                                : "bg-danger-50 text-danger-700 border border-danger-200"
                            }`}
                          >
                            {noticeForThis.type === "success" ? (
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span>{noticeForThis.text}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
