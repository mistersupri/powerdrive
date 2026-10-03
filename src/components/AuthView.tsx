import React, { useEffect, useState } from "react";
import { ArrowLeft, Eye, EyeOff, Lock, Mail, User as UserIcon } from "lucide-react";
import { useAuth } from "../context/AuthContext.tsx";
import { authenticateWithGoogleApi, connectGoogleDriveAccount } from "../lib/google-auth.ts";
import { api } from "../services/api.ts";
import { Button } from "../ui/Button.tsx";
import { Field, TextInput } from "../ui/Field.tsx";
import { ThemeToggle } from "../ui/ThemeToggle.tsx";
import { Wordmark } from "../ui/Wordmark.tsx";

interface AuthViewProps {
  onSuccess?: () => void;
  onBackToSharedFolder?: () => void;
}

type AuthMode = "login" | "register" | "forgot_password" | "reset_password";

const MIN_PASSWORD = 6;

/** Reset links from email look like ?tab=reset-password&token=...&email=... */
function readResetLink() {
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get("tab") !== "reset-password" || !p.get("token")) return null;
    return { token: p.get("token") || "", email: p.get("email") || "" };
  } catch {
    return null;
  }
}

function GoogleMark() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function PasswordInput({
  value,
  onChange,
  autoComplete,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <TextInput
      type={show ? "text" : "password"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      leading={<Lock className="w-4 h-4" />}
      trailing={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
          className="w-8 h-8 rounded-md flex items-center justify-center text-ink-500 hover:text-ink-900 hover:bg-ink-100"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      }
    />
  );
}

export const AuthView: React.FC<AuthViewProps> = ({ onSuccess, onBackToSharedFolder }) => {
  const { login, register, loginWithGoogle, forgotPassword, resetPassword } = useAuth();
  const [resetLink] = useState(readResetLink);
  const [mode, setMode] = useState<AuthMode>(resetLink ? "reset_password" : "login");
  const [allowRegistration, setAllowRegistration] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"form" | "google" | null>(null);

  const [email, setEmail] = useState(resetLink?.email || "");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState("");
  const [resetToken, setResetToken] = useState(resetLink?.token || "");

  useEffect(() => {
    let alive = true;
    api
      .getAuthConfig()
      .then((c) => alive && setAllowRegistration(c.allowRegistration ?? true))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Drop the reset token from the address bar once it is in the form.
  useEffect(() => {
    if (resetLink) window.history.replaceState(null, "", window.location.pathname);
  }, [resetLink]);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    setPassword("");
    setConfirm("");
  };

  const run = async (work: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    setBusy("form");
    try {
      await work();
    } catch (err: any) {
      setError(err?.message || "Terjadi kesalahan. Coba lagi.");
    } finally {
      setBusy(null);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "login") {
      if (!email.trim() || !password) return setError("Isi email dan kata sandi.");
      return run(async () => {
        await login(email.trim(), password);
        onSuccess?.();
      });
    }
    if (mode === "register") {
      if (!name.trim() || !email.trim() || !password) return setError("Isi nama, email, dan kata sandi.");
      if (password.length < MIN_PASSWORD) return setError(`Kata sandi minimal ${MIN_PASSWORD} karakter.`);
      if (password !== confirm) return setError("Kedua kata sandi tidak sama.");
      return run(async () => {
        await register({ name: name.trim(), email: email.trim(), password });
        onSuccess?.();
      });
    }
    if (mode === "forgot_password") {
      if (!email.trim()) return setError("Isi alamat email akun Anda.");
      return run(async () => {
        const res = await forgotPassword(email.trim());
        setNotice(res.message);
      });
    }
    if (!resetToken.trim() || !password) return setError("Isi kode reset dan kata sandi baru.");
    if (password.length < MIN_PASSWORD) return setError(`Kata sandi minimal ${MIN_PASSWORD} karakter.`);
    if (password !== confirm) return setError("Kedua kata sandi tidak sama.");
    return run(async () => {
      await resetPassword({ token: resetToken.trim(), password });
      switchMode("login");
      setNotice("Kata sandi diperbarui. Silakan masuk dengan kata sandi baru.");
    });
  };

  const googleLogin = async () => {
    setError(null);
    setNotice(null);
    setBusy("google");
    try {
      const g = await authenticateWithGoogleApi();
      await loginWithGoogle({ email: g.email, name: g.name, avatarUrl: g.avatarUrl, accessToken: g.accessToken });
      // Linking Drive is a convenience; signing in already succeeded.
      connectGoogleDriveAccount(g.accessToken, g.email, g.name).catch(() => undefined);
      onSuccess?.();
    } catch (err: any) {
      const msg = String(err?.message || "");
      setError(
        /popup|closed/i.test(msg)
          ? "Jendela masuk Google tertutup atau diblokir browser. Izinkan popup lalu coba lagi."
          : msg || "Gagal masuk dengan Google."
      );
    } finally {
      setBusy(null);
    }
  };

  const copy: Record<AuthMode, { title: string; lead: string; cta: string }> = {
    login: { title: "Masuk", lead: "Buka folder dan berkas Anda.", cta: "Masuk" },
    register: { title: "Buat akun", lead: "Akun baru langsung bisa membuat folder.", cta: "Buat akun" },
    forgot_password: {
      title: "Lupa kata sandi",
      lead: "Kami kirim tautan untuk mengatur ulang kata sandi ke email Anda.",
      cta: "Kirim tautan",
    },
    reset_password: { title: "Kata sandi baru", lead: "Masukkan kode dari email dan kata sandi baru Anda.", cta: "Simpan kata sandi" },
  };

  return (
    <div className="min-h-dvh bg-canvas text-ink-900 flex flex-col">
      <div className="flex items-center justify-between px-4 sm:px-6 h-14">
        <Wordmark className="text-lg" />
        <ThemeToggle />
      </div>

      <main className="flex-1 flex items-start sm:items-center justify-center px-4 pb-10 pt-6 sm:pt-0">
        <div className="w-full max-w-sm">
          {onBackToSharedFolder && (
            <button
              type="button"
              onClick={onBackToSharedFolder}
              className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-ink-900"
            >
              <ArrowLeft className="w-4 h-4" /> Kembali ke folder yang dibagikan
            </button>
          )}

          <div className="bg-surface border border-ink-200 rounded-2xl p-6 sm:p-7 animate-dialog-in">
            <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink-900">{copy[mode].title}</h1>
            <p className="text-sm text-ink-500 mt-1">{copy[mode].lead}</p>

            {(mode === "login" || mode === "register") && (
              <>
                <Button size="md" className="w-full mt-6" icon={<GoogleMark />} loading={busy === "google"} disabled={!!busy} onClick={googleLogin}>
                  Lanjutkan dengan Google
                </Button>
                <div className="flex items-center gap-3 my-5 text-xs text-ink-500">
                  <span className="h-px flex-1 bg-ink-200" />
                  atau dengan email
                  <span className="h-px flex-1 bg-ink-200" />
                </div>
              </>
            )}

            <form onSubmit={submit} noValidate className={mode === "login" || mode === "register" ? "space-y-4" : "space-y-4 mt-6"}>
              {mode === "register" && (
                <Field label="Nama">
                  <TextInput value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" leading={<UserIcon className="w-4 h-4" />} />
                </Field>
              )}

              {mode !== "reset_password" && (
                <Field label="Email">
                  <TextInput
                    type="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="nama@contoh.id"
                    leading={<Mail className="w-4 h-4" />}
                  />
                </Field>
              )}

              {mode === "reset_password" && (
                <Field label="Kode reset" hint="Dari email">
                  <TextInput value={resetToken} onChange={(e) => setResetToken(e.target.value)} autoComplete="one-time-code" className="font-mono" />
                </Field>
              )}

              {mode !== "forgot_password" && (
                <Field
                  label={mode === "login" ? "Kata sandi" : "Kata sandi baru"}
                  trailing={
                    mode === "login" ? (
                      <button type="button" onClick={() => switchMode("forgot_password")} className="text-xs font-semibold text-ink-600 hover:text-ink-900 underline-offset-2 hover:underline">
                        Lupa kata sandi?
                      </button>
                    ) : (
                      <span className="text-xs text-ink-500">Minimal {MIN_PASSWORD} karakter</span>
                    )
                  }
                >
                  <PasswordInput value={password} onChange={setPassword} autoComplete={mode === "login" ? "current-password" : "new-password"} />
                </Field>
              )}

              {(mode === "register" || mode === "reset_password") && (
                <Field label="Ulangi kata sandi">
                  <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
                </Field>
              )}

              {error && (
                <p role="alert" className="text-sm text-danger-700 bg-danger-50 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="text-sm text-ok-800 bg-ok-50 rounded-lg px-3 py-2">
                  {notice}
                </p>
              )}

              <Button type="submit" variant="primary" size="md" className="w-full" loading={busy === "form"} disabled={!!busy}>
                {copy[mode].cta}
              </Button>
            </form>

            <div className="mt-6 pt-5 border-t border-ink-100 text-sm text-ink-600 text-center">
              {mode === "login" && allowRegistration && (
                <>
                  Belum punya akun?{" "}
                  <button type="button" onClick={() => switchMode("register")} className="font-semibold text-ink-900 underline underline-offset-2">
                    Buat akun
                  </button>
                </>
              )}
              {mode === "login" && !allowRegistration && <span className="text-ink-500">Akun baru dibuat oleh administrator.</span>}
              {mode === "register" && (
                <>
                  Sudah punya akun?{" "}
                  <button type="button" onClick={() => switchMode("login")} className="font-semibold text-ink-900 underline underline-offset-2">
                    Masuk
                  </button>
                </>
              )}
              {mode === "forgot_password" && (
                <div className="flex flex-col gap-2 items-center">
                  <button type="button" onClick={() => switchMode("reset_password")} className="font-semibold text-ink-900 underline underline-offset-2">
                    Saya sudah punya kode reset
                  </button>
                  <button type="button" onClick={() => switchMode("login")} className="text-ink-500 hover:text-ink-900">
                    Kembali ke halaman masuk
                  </button>
                </div>
              )}
              {mode === "reset_password" && (
                <button type="button" onClick={() => switchMode("login")} className="text-ink-500 hover:text-ink-900">
                  Kembali ke halaman masuk
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
