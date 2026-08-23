import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext.tsx";
import {
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Lock,
  Mail,
  User as UserIcon,
  KeyRound,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  Zap,
  Check,
  Cloud,
  HelpCircle,
  UserPlus,
  LogIn,
  RefreshCw,
  Info,
} from "lucide-react";
import { authenticateWithGoogleApi, connectGoogleDriveAccount } from "../lib/google-auth.ts";
import { api } from "../services/api.ts";

interface AuthViewProps {
  onSuccess?: () => void;
  onBackToSharedFolder?: () => void;
}

type AuthMode = "login" | "register" | "forgot_password" | "reset_password";
type LoginMethod = "password" | "google";

export const AuthView: React.FC<AuthViewProps> = ({ onSuccess, onBackToSharedFolder }) => {
  const { login, register, loginWithGoogle, forgotPassword, resetPassword } = useAuth();

  // Mode state
  const [mode, setMode] = useState<AuthMode>("login");
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("password");

  // System Auth Configuration (Public)
  const [allowRegistration, setAllowRegistration] = useState<boolean>(true);
  const [isConfigLoading, setIsConfigLoading] = useState<boolean>(true);

  // Common Feedback State
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form Fields - Login
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Form Fields - Register
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);

  // Form Fields - Forgot Password
  const [forgotEmail, setForgotEmail] = useState("");
  const [generatedResetToken, setGeneratedResetToken] = useState<string | null>(null);

  // Form Fields - Reset Password
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);

  // Load Auth Configuration on Mount
  useEffect(() => {
    let isMounted = true;
    const fetchConfig = async () => {
      try {
        const config = await api.getAuthConfig();
        if (isMounted) {
          setAllowRegistration(config.allowRegistration ?? true);
        }
      } catch (err) {
        console.warn("[AuthView] Failed to load auth config:", err);
      } finally {
        if (isMounted) setIsConfigLoading(false);
      }
    };
    fetchConfig();
    return () => {
      isMounted = false;
    };
  }, []);

  const clearMessages = () => {
    setError(null);
    setSuccessMessage(null);
  };

  /**
   * 1. EMAIL & PASSWORD LOGIN
   */
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();

    if (!loginEmail.trim() || !loginPassword) {
      setError("Email dan kata sandi wajib diisi.");
      return;
    }

    setIsSubmitting(true);
    try {
      await login(loginEmail.trim(), loginPassword);
      setSuccessMessage("Berhasil masuk! Mengalihkan ke dashboard...");
      onSuccess?.();
    } catch (err: any) {
      setError(err.message || "Gagal masuk. Periksa kembali email dan kata sandi Anda.");
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * 2. REGISTRATION FLOW
   */
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();

    if (!allowRegistration) {
      setError("Pendaftaran akun baru dinonaktifkan oleh administrator.");
      return;
    }

    if (!regName.trim() || !regEmail.trim() || !regPassword) {
      setError("Nama, email, dan kata sandi wajib diisi.");
      return;
    }

    if (regPassword.length < 6) {
      setError("Kata sandi minimal harus 6 karakter.");
      return;
    }

    if (regPassword !== regConfirmPassword) {
      setError("Konfirmasi kata sandi tidak cocok.");
      return;
    }

    setIsSubmitting(true);
    try {
      await register({
        name: regName.trim(),
        email: regEmail.trim(),
        password: regPassword,
      });
      setSuccessMessage("Pendaftaran akun berhasil! Anda langsung dialihkan ke dashboard.");
      onSuccess?.();
    } catch (err: any) {
      setError(err.message || "Gagal mendaftarkan akun baru.");
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * 3. FORGOT PASSWORD FLOW
   */
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();

    if (!forgotEmail.trim()) {
      setError("Masukkan alamat email yang terdaftar.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await forgotPassword(forgotEmail.trim());
      setSuccessMessage(res.message);
      if (res.resetToken) {
        setGeneratedResetToken(res.resetToken);
        setResetToken(res.resetToken);
      }
    } catch (err: any) {
      setError(err.message || "Gagal memproses permintaan lupa kata sandi.");
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * 4. RESET PASSWORD FLOW
   */
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();

    if (!resetToken.trim() || !newPassword) {
      setError("Token dan kata sandi baru wajib diisi.");
      return;
    }

    if (newPassword.length < 6) {
      setError("Kata sandi baru minimal harus 6 karakter.");
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setError("Konfirmasi kata sandi baru tidak cocok.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await resetPassword({
        token: resetToken.trim(),
        password: newPassword,
      });
      setSuccessMessage(`${res.message} Silakan masuk dengan kata sandi baru Anda.`);
      setTimeout(() => {
        setMode("login");
        setLoginMethod("password");
        setLoginEmail(forgotEmail || "");
        setLoginPassword("");
        setGeneratedResetToken(null);
      }, 1500);
    } catch (err: any) {
      setError(err.message || "Gagal mengatur ulang kata sandi. Token mungkin sudah kedaluwarsa.");
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * 5. GOOGLE OAUTH POPUP SIGN-IN
   */
  const handleGoogleApiLogin = async () => {
    clearMessages();
    setIsSubmitting(true);

    try {
      const googleAuthResult = await authenticateWithGoogleApi();
      await loginWithGoogle({
        email: googleAuthResult.email,
        name: googleAuthResult.name,
        avatarUrl: googleAuthResult.avatarUrl,
        accessToken: googleAuthResult.accessToken,
      });

      try {
        await connectGoogleDriveAccount(
          googleAuthResult.accessToken,
          googleAuthResult.email,
          googleAuthResult.name
        );
      } catch (driveErr) {
        console.warn("[AuthView] Background drive connect note:", driveErr);
      }

      setSuccessMessage("Berhasil masuk dengan akun Google!");
      onSuccess?.();
    } catch (err: any) {
      console.warn("[AuthView] Google API auth error:", err);
      const errorMsg = err.message || "Gagal masuk dengan akun Google.";
      setError(
        errorMsg.includes("popup") || errorMsg.includes("client") || errorMsg.includes("closed")
          ? "Jendela popup autentikasi Google ditutup atau diblokir oleh peramban. Silakan coba lagi."
          : errorMsg
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-10 sm:px-6 lg:px-8 relative overflow-hidden font-sans text-slate-100">
      {/* Background Decorative Glows */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />

      {/* Header Branding */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 text-center px-4">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-600 shadow-xl shadow-blue-500/25 mb-3 border border-blue-400/40">
          <Zap className="w-7 h-7 text-amber-300 fill-amber-300" />
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
          Power Drive
        </h2>
        <p className="mt-1 text-xs sm:text-sm text-slate-400 max-w-sm mx-auto">
          Portal Manajemen Berkas &amp; Sinkronisasi Cloud
        </p>
      </div>

      {/* Main Auth Container */}
      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4">
        {onBackToSharedFolder && (
          <button
            type="button"
            onClick={onBackToSharedFolder}
            className="mb-3 inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Kembali ke Folder Dibagikan</span>
          </button>
        )}
        <div className="bg-slate-800/95 backdrop-blur-md border border-slate-700/80 py-7 px-6 shadow-2xl rounded-2xl sm:px-9">
          
          {/* Top Mode Header / Navigation */}
          {mode === "login" && (
            <div className="mb-6">
              {/* Login Method Segmented Control */}
              <div className="grid grid-cols-2 p-1 bg-slate-900/90 rounded-xl border border-slate-700/80 mb-4">
                <button
                  type="button"
                  onClick={() => {
                    setLoginMethod("password");
                    clearMessages();
                  }}
                  className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    loginMethod === "password"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Email &amp; Sandi</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoginMethod("google");
                    clearMessages();
                  }}
                  className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    loginMethod === "google"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z" />
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z" />
                    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                  </svg>
                  <span>Google SSO</span>
                </button>
              </div>

              <div className="text-center">
                <h3 className="text-base font-bold text-slate-100">
                  {loginMethod === "password" ? "Masuk dengan Email & Kata Sandi" : "Masuk dengan Akun Google"}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {loginMethod === "password"
                    ? "Gunakan akun resmi yang terdaftar di sistem"
                    : "Autentikasi aman melalui Single Sign-On (SSO) Google"}
                </p>
              </div>
            </div>
          )}

          {mode === "register" && (
            <div className="mb-6 text-center">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 mb-2">
                <UserPlus className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-100">Pendaftaran Akun Baru</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Buat akun pengguna baru untuk mengelola dan menyinkronkan berkas
              </p>
            </div>
          )}

          {mode === "forgot_password" && (
            <div className="mb-6 text-center">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 mb-2">
                <HelpCircle className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-100">Lupa Kata Sandi?</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Masukkan email Anda untuk menerima tautan atau token reset kata sandi
              </p>
            </div>
          )}

          {mode === "reset_password" && (
            <div className="mb-6 text-center">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 mb-2">
                <KeyRound className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-100">Atur Ulang Kata Sandi</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Masukkan token pemulihan dan buat kata sandi baru Anda
              </p>
            </div>
          )}

          {/* Alert / Feedback Messages */}
          {error && (
            <div className="mb-5 p-3.5 bg-rose-500/15 border border-rose-500/30 rounded-xl flex items-start gap-3 text-rose-300 text-xs animate-fadeIn">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed">{error}</div>
            </div>
          )}

          {successMessage && (
            <div className="mb-5 p-3.5 bg-emerald-500/15 border border-emerald-500/30 rounded-xl flex items-start gap-3 text-emerald-300 text-xs animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed">{successMessage}</div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 1. LOGIN MODE */}
          {/* ========================================================================= */}
          {mode === "login" && (
            <>
              {loginMethod === "password" ? (
                /* Email & Password Form */
                <form onSubmit={handlePasswordLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
                      <span>Alamat Email</span>
                      <span className="text-[10px] text-slate-500 font-normal">Wajib diisi</span>
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                        <Mail className="w-4 h-4" />
                      </div>
                      <input
                        id="input-login-email"
                        type="email"
                        required
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        placeholder="contoh: admin@clouddrive.local"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-slate-300">
                        Kata Sandi
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setMode("forgot_password");
                          clearMessages();
                          setForgotEmail(loginEmail);
                        }}
                        className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors font-medium cursor-pointer"
                      >
                        Lupa kata sandi?
                      </button>
                    </div>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                        <Lock className="w-4 h-4" />
                      </div>
                      <input
                        id="input-login-password"
                        type={showLoginPassword ? "text" : "password"}
                        required
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="Masukkan kata sandi akun"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-10 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword(!showLoginPassword)}
                        className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                      >
                        {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <button
                    id="btn-login-submit"
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full mt-2 py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-500/20 active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Memverifikasi Akun...</span>
                      </>
                    ) : (
                      <>
                        <LogIn className="w-4 h-4" />
                        <span>Masuk ke Akun</span>
                      </>
                    )}
                  </button>
                </form>
              ) : (
                /* Google SSO Button & Flow */
                <div className="space-y-4">
                  <button
                    id="btn-google-login"
                    type="button"
                    onClick={handleGoogleApiLogin}
                    disabled={isSubmitting}
                    className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl bg-white text-slate-900 hover:bg-slate-100 font-semibold text-xs transition-all shadow-md active:scale-[0.99] border border-slate-300 disabled:opacity-60 cursor-pointer"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                        <span>Menghubungkan Google SSO...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z" />
                          <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z" />
                          <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                        </svg>
                        <span>Lanjutkan dengan Akun Google</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Registration Link / Status footer */}
              <div className="mt-6 pt-4 border-t border-slate-700/60 text-center text-xs text-slate-400">
                {allowRegistration ? (
                  <span>
                    Belum memiliki akun?{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setMode("register");
                        clearMessages();
                      }}
                      className="text-blue-400 hover:text-blue-300 font-bold transition-colors underline cursor-pointer"
                    >
                      Daftar Akun Baru
                    </button>
                  </span>
                ) : (
                  <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                    <Lock className="w-3 h-3 text-slate-500" />
                    <span>Pendaftaran akun baru ditutup oleh Administrator</span>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ========================================================================= */}
          {/* 2. REGISTRATION MODE */}
          {/* ========================================================================= */}
          {mode === "register" && (
            <div>
              {!allowRegistration ? (
                /* Registration Disabled by Admin Notice */
                <div className="space-y-4 text-center py-4">
                  <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-left space-y-2">
                    <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>Pendaftaran Mandiri Dinonaktifkan</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Administrator sistem saat ini menonaktifkan fitur pendaftaran akun baru secara publik.
                    </p>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Jika Anda memerlukan akses ke portal Power Drive, silakan hubungi Administrator Sistem untuk pembuatan akun pengguna resmi.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setMode("login");
                      clearMessages();
                    }}
                    className="w-full py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Kembali ke Halaman Masuk</span>
                  </button>
                </div>
              ) : (
                /* Registration Form */
                <form onSubmit={handleRegister} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Nama Lengkap
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                        <UserIcon className="w-4 h-4" />
                      </div>
                      <input
                        id="input-reg-name"
                        type="text"
                        required
                        value={regName}
                        onChange={(e) => setRegName(e.target.value)}
                        placeholder="Nama Lengkap / Instansi"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Alamat Email
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                        <Mail className="w-4 h-4" />
                      </div>
                      <input
                        id="input-reg-email"
                        type="email"
                        required
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="nama@example.com"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Kata Sandi (Min. 6 Karakter)
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                        <Lock className="w-4 h-4" />
                      </div>
                      <input
                        id="input-reg-password"
                        type={showRegPassword ? "text" : "password"}
                        required
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        placeholder="Minimal 6 karakter"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-10 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegPassword(!showRegPassword)}
                        className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                      >
                        {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Konfirmasi Kata Sandi
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                        <KeyRound className="w-4 h-4" />
                      </div>
                      <input
                        id="input-reg-confirm-password"
                        type={showRegPassword ? "text" : "password"}
                        required
                        value={regConfirmPassword}
                        onChange={(e) => setRegConfirmPassword(e.target.value)}
                        placeholder="Ulangi kata sandi di atas"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                      />
                    </div>
                  </div>

                  <button
                    id="btn-register-submit"
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full mt-3 py-2.5 px-4 bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-500/20 active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Mendaftarkan Akun...</span>
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4" />
                        <span>Buat Akun Baru</span>
                      </>
                    )}
                  </button>

                  <div className="pt-3 border-t border-slate-700/60 text-center text-xs text-slate-400">
                    <span>Sudah memiliki akun? </span>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("login");
                        clearMessages();
                      }}
                      className="text-blue-400 hover:text-blue-300 font-bold transition-colors underline cursor-pointer"
                    >
                      Masuk di sini
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* 3. FORGOT PASSWORD MODE */}
          {/* ========================================================================= */}
          {mode === "forgot_password" && (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Email Akun Terdaftar
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    id="input-forgot-email"
                    type="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="nama@example.com"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                  />
                </div>
              </div>

              <button
                id="btn-forgot-submit"
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-500/20 active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Mengirimkan Permintaan...</span>
                  </>
                ) : (
                  <>
                    <Mail className="w-4 h-4" />
                    <span>Kirim Token Pemulihan Sandi</span>
                  </>
                )}
              </button>

              {/* Direct Link to Enter Reset Token if already generated */}
              {generatedResetToken && (
                <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl space-y-2 text-xs">
                  <div className="text-emerald-400 font-bold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Token Pemulihan Siap:</span>
                  </div>
                  <div className="font-mono bg-slate-950 p-2 rounded-lg text-emerald-300 text-center text-xs tracking-wider break-all select-all">
                    {generatedResetToken}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("reset_password");
                      setResetToken(generatedResetToken);
                      clearMessages();
                    }}
                    className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>Lanjutkan Atur Ulang Kata Sandi</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="pt-3 border-t border-slate-700/60 flex items-center justify-between text-xs text-slate-400">
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    clearMessages();
                  }}
                  className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Kembali ke Masuk</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMode("reset_password");
                    clearMessages();
                  }}
                  className="text-blue-400 hover:text-blue-300 font-medium transition-colors cursor-pointer"
                >
                  Sudah punya token?
                </button>
              </div>
            </form>
          )}

          {/* ========================================================================= */}
          {/* 4. RESET PASSWORD MODE */}
          {/* ========================================================================= */}
          {mode === "reset_password" && (
            <form onSubmit={handleResetPassword} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Token Pemulihan Kata Sandi
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <input
                    id="input-reset-token"
                    type="text"
                    required
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    placeholder="Tempelkan token pemulihan dari email"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Kata Sandi Baru (Min. 6 Karakter)
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="input-new-password"
                    type={showResetPassword ? "text" : "password"}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimal 6 karakter"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-10 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPassword(!showResetPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                  >
                    {showResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Konfirmasi Kata Sandi Baru
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="input-confirm-new-password"
                    type={showResetPassword ? "text" : "password"}
                    required
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Ulangi kata sandi baru"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                  />
                </div>
              </div>

              <button
                id="btn-reset-password-submit"
                type="submit"
                disabled={isSubmitting}
                className="w-full mt-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-500/20 active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Memperbarui Kata Sandi...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Simpan Kata Sandi Baru</span>
                  </>
                )}
              </button>

              <div className="pt-3 border-t border-slate-700/60 text-center text-xs text-slate-400">
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    clearMessages();
                  }}
                  className="flex items-center justify-center gap-1 mx-auto text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Kembali ke Halaman Masuk</span>
                </button>
              </div>
            </form>
          )}

          {/* Security Features Bullet Footer */}
          <div className="mt-6 space-y-2 pt-4 border-t border-slate-700/60 text-[11px] text-slate-400">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Autentikasi Terenkripsi &amp; Keamanan Berlapis</span>
            </div>
            <div className="flex items-center gap-2">
              <Cloud className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span>Penyimpanan Lokal Pertama + Sinkronisasi Otomatis Google Drive</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
