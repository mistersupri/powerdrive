import { ArrowRight, CloudCog, Layers, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, ApiError, setWorkspaceId } from "@/lib/api";
import { queryClient } from "@/lib/query";
import { Button } from "@/ui/Button";
import { Field, Input } from "@/ui/Field";
import { Logo } from "@/features/layout/Logo";
import { useBranding } from "@/lib/branding";

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(420px,1fr)_1.1fr]">
      <main className="flex flex-col justify-center px-6 py-10 sm:px-14">
        <div className="mx-auto w-full max-w-sm">
          <Logo className="mb-10" />
          <h1 className="text-[26px] font-bold tracking-tight balance">{title}</h1>
          <p className="mt-1.5 mb-7 text-[14px] text-muted">{subtitle}</p>
          {children}
          <p className="mt-6 text-center text-[13px] text-muted">{footer}</p>
        </div>
      </main>
      <aside className="relative hidden overflow-hidden bg-navy p-14 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -top-24 -right-24 size-96 rounded-full bg-primary/30 blur-3xl" aria-hidden />
        <div className="relative max-w-md">
          <h2 className="text-[40px] leading-[1.1] font-bold tracking-tight balance">Semua penyimpanan Anda. Satu tempat.</h2>
          <p className="mt-4 text-[15px] text-white/75">Hubungkan Google Drive, OneDrive, Dropbox, S3, dan folder server. Pindahkan file antar penyimpanan langsung lewat server, tanpa mengunduhnya dulu.</p>
        </div>
        <ul className="relative grid max-w-md gap-4 text-[14px]">
          {[[Layers, "Satu file manager untuk semua akun"], [CloudCog, "Transfer antar-penyimpanan lewat server, bisa dijeda dan dilanjutkan"], [ShieldCheck, "Kredensial terenkripsi dan hak akses per penyimpanan"]].map(([I, t]) => {
            const Icon = I as typeof Layers;
            return <li key={t as string} className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-white/10"><Icon className="size-[18px]" aria-hidden /></span>{t as string}</li>;
          })}
        </ul>
      </aside>
    </div>
  );
}

function useSubmit(fn: () => Promise<void>) {
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return { error, busy, submit: async (e: FormEvent) => { e.preventDefault(); setError(""); setBusy(true); try { await fn(); } catch (err) { setError(err instanceof ApiError ? err.message : "Terjadi kesalahan. Coba lagi."); } finally { setBusy(false); } } };
}
const GOOGLE_ERRORS: Record<string, string> = {
  google_disabled: "Masuk dengan Google belum diaktifkan.", google_state: "Sesi masuk Google sudah berakhir. Coba lagi.", google_failed: "Tidak dapat menyelesaikan masuk dengan Google. Coba lagi.",
  email_unverified: "Email akun Google ini belum terverifikasi.", domain_not_allowed: "Domain email ini tidak diizinkan untuk masuk.",
  registration_closed: "Pendaftaran akun baru ditutup. Minta undangan dari administrator.", account_disabled: "Akun ini dinonaktifkan oleh administrator.",
};
const GoogleMark = () => <svg viewBox="0 0 48 48" className="size-5" aria-hidden><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.2 5.6c4.3-3.9 7.1-9.7 7.1-17z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2 1.4-4.9 2.3-8.7 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>;
/** "Masuk dengan Google" plus a divider; renders nothing when the server has no Google credentials. */
function GoogleSignIn({ label }: { label: string }) {
  const brand = useBranding().data; if (!brand?.google) return null;
  return (
    <div className="mb-5">
      <a href="/api/v1/auth/google/start" className="inline-flex h-10 w-full items-center justify-center gap-2.5 rounded-lg border border-line-strong bg-surface text-[14px] font-medium text-ink hover:bg-surface-2 pointer-coarse:h-12"><GoogleMark />{label}</a>
      <div className="mt-5 flex items-center gap-3 text-[12px] text-muted" aria-hidden><span className="h-px flex-1 bg-line" />atau<span className="h-px flex-1 bg-line" /></div>
    </div>
  );
}
const Err = ({ msg }: { msg: string }) => msg ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger-ink">{msg}</p> : null;

async function afterAuth(nav: ReturnType<typeof useNavigate>, to = "/") {
  queryClient.clear();
  const me = await api<{ activeWorkspaceId: string }>("/auth/me"); setWorkspaceId(me.activeWorkspaceId);
  nav(to, { replace: true });
}

export function LoginPage() {
  const nav = useNavigate(); const [sp] = useSearchParams(); const brand = useBranding().data;
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null); const [code, setCode] = useState(""); const [useRecovery, setUseRecovery] = useState(false);
  // Coming back from Google: either an error code, or a second-factor challenge for an account that has TOTP.
  const [googleError, setGoogleError] = useState("");
  useEffect(() => {
    const e = sp.get("error"); const c = sp.get("challenge");
    if (e && GOOGLE_ERRORS[e]) setGoogleError(GOOGLE_ERRORS[e]!);
    if (c) setChallenge(c);
    if (e || c) window.history.replaceState(null, "", window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { error, busy, submit } = useSubmit(async () => {
    const r = await api<{ mfaRequired?: boolean; challenge?: string }>("/auth/login", { body: { email, password } });
    if (r.mfaRequired && r.challenge) { setChallenge(r.challenge); return; }
    await afterAuth(nav, sp.get("next") || "/");
  });
  const verify = useSubmit(async () => {
    try { await api("/auth/mfa/verify", { body: { challenge, ...(useRecovery ? { recoveryCode: code } : { code }) } }); }
    catch (e) { setCode(""); // after five wrong tries the challenge is gone: start over
      if (e instanceof ApiError && e.status === 401 && /berakhir/i.test(e.message)) { setChallenge(null); setPassword(""); } throw e; }
    await afterAuth(nav, sp.get("next") || "/");
  });
  const canRegister = brand?.registration === "open";
  if (challenge) return (
    <AuthLayout title="Verifikasi dua langkah" subtitle={useRecovery ? "Masukkan salah satu kode pemulihan yang Anda simpan." : "Masukkan kode 6 digit dari aplikasi autentikator Anda."} footer={<button type="button" className="font-medium text-primary-ink hover:underline" onClick={() => { setChallenge(null); setCode(""); setPassword(""); }}>Kembali</button>}>
      <form onSubmit={verify.submit} className="space-y-4">
        <Field label={useRecovery ? "Kode pemulihan" : "Kode verifikasi"}>{(id) => <Input id={id} autoFocus required autoComplete="one-time-code" inputMode={useRecovery ? "text" : "numeric"} pattern={useRecovery ? undefined : "[0-9 ]*"} maxLength={useRecovery ? 20 : 7} value={code} onChange={(e) => setCode(e.target.value)} placeholder={useRecovery ? "xxxxxx-xxxxxx" : "123456"} className="tnum tracking-widest" />}</Field>
        <Err msg={verify.error} />
        <Button type="submit" variant="primary" loading={verify.busy} className="h-10 w-full">Verifikasi</Button>
        <div className="text-center"><button type="button" className="text-[13px] text-muted hover:text-ink hover:underline" onClick={() => { setUseRecovery((v) => !v); setCode(""); }}>{useRecovery ? "Pakai kode dari aplikasi" : "Pakai kode pemulihan"}</button></div>
      </form>
    </AuthLayout>
  );
  return (
    <AuthLayout title="Selamat datang kembali" subtitle={sp.get("expired") ? "Sesi Anda berakhir karena tidak ada aktivitas. Masuk lagi untuk melanjutkan." : brand?.loginMessage || "Masuk untuk membuka penyimpanan Anda."} footer={canRegister ? <>Belum punya akun? <Link className="font-medium text-primary-ink hover:underline" to="/register">Daftar</Link></> : <>Akun baru dibuat lewat undangan administrator.</>}>
      <GoogleSignIn label="Masuk dengan Google" />
      {googleError && <div className="mb-4"><Err msg={googleError} /></div>}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@instansi.id" />}</Field>
        <Field label="Kata sandi">{(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <Err msg={error} />
        <Button type="submit" variant="primary" loading={busy} className="h-10 w-full">Masuk <ArrowRight className="size-4" /></Button>
        <div className="text-center"><Link to="/forgot-password" className="text-[13px] text-muted hover:text-ink hover:underline">Lupa kata sandi?</Link></div>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const nav = useNavigate(); const [sp] = useSearchParams();
  const invitation = sp.get("invitation") ?? undefined;
  const [name, setName] = useState(""); const [email, setEmail] = useState(sp.get("email") ?? ""); const [password, setPassword] = useState("");
  const brand = useBranding().data; const blocked = brand && !invitation && brand.registration !== "open";
  const { error, busy, submit } = useSubmit(async () => { await api("/auth/register", { body: { name, email, password, invitationToken: invitation } }); await afterAuth(nav); });
  return (
    <AuthLayout title={invitation ? "Terima undangan" : "Buat akun"} subtitle={invitation ? "Lengkapi data untuk bergabung ke workspace." : "Akun pertama menjadi administrator instalasi."} footer={<>Sudah punya akun? <Link className="font-medium text-primary-ink hover:underline" to="/login">Masuk</Link></>}>
      {!blocked && <GoogleSignIn label={invitation ? "Gabung dengan Google" : "Daftar dengan Google"} />}
      {!blocked && invitation && <p className="-mt-2 mb-4 text-[12px] text-muted">Gunakan akun Google dengan email yang sama dengan undangan ini.</p>}
      {blocked ? <p role="status" className="rounded-lg bg-warn-soft px-3 py-3 text-[14px] text-warn-ink">Pendaftaran terbuka dinonaktifkan. Minta administrator mengirim undangan ke email Anda, lalu buka tautannya.</p> : <form onSubmit={submit} className="space-y-4">
        <Field label="Nama lengkap">{(id) => <Input id={id} required autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Email">{(id) => <Input id={id} type="email" required autoComplete="username" value={email} readOnly={!!invitation} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Kata sandi" hint="Minimal 8 karakter.">{(id) => <Input id={id} type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <Err msg={error} />
        <Button type="submit" variant="primary" loading={busy} className="h-10 w-full">{invitation ? "Gabung workspace" : "Daftar"}</Button>
      </form>}
    </AuthLayout>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState(""); const [sent, setSent] = useState("");
  const { error, busy, submit } = useSubmit(async () => { const r = await api<{ message: string }>("/auth/forgot-password", { body: { email } }); setSent(r.message); });
  return (
    <AuthLayout title="Atur ulang kata sandi" subtitle="Masukkan email akun Anda." footer={<Link className="font-medium text-primary-ink hover:underline" to="/login">Kembali masuk</Link>}>
      {sent ? <p className="rounded-lg bg-ok-soft px-3 py-3 text-[13px] text-ok-ink">{sent}</p> : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">{(id) => <Input id={id} type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Err msg={error} /><Button type="submit" variant="primary" loading={busy} className="h-10 w-full">Buat tautan reset</Button>
        </form>)}
    </AuthLayout>
  );
}

export function ResetPage() {
  const nav = useNavigate(); const [sp] = useSearchParams(); const [password, setPassword] = useState("");
  const { error, busy, submit } = useSubmit(async () => { await api("/auth/reset-password", { body: { token: sp.get("token") ?? "", password } }); nav("/login", { replace: true }); });
  return (
    <AuthLayout title="Kata sandi baru" subtitle="Pilih kata sandi baru untuk akun Anda." footer={<Link className="font-medium text-primary-ink hover:underline" to="/login">Kembali masuk</Link>}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Kata sandi baru" hint="Minimal 8 karakter.">{(id) => <Input id={id} type="password" required minLength={8} autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <Err msg={error} /><Button type="submit" variant="primary" loading={busy} className="h-10 w-full">Simpan kata sandi</Button>
      </form>
    </AuthLayout>
  );
}
