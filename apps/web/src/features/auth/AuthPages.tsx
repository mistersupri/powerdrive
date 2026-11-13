import { ArrowRight, CloudCog, Layers, ShieldCheck } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, ApiError, setWorkspaceId } from "@/lib/api";
import { queryClient } from "@/lib/query";
import { Button } from "@/ui/Button";
import { Field, Input } from "@/ui/Field";
import { Logo } from "@/features/layout/Logo";

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
const Err = ({ msg }: { msg: string }) => msg ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger-ink">{msg}</p> : null;

async function afterAuth(nav: ReturnType<typeof useNavigate>, to = "/") {
  queryClient.clear();
  const me = await api<{ activeWorkspaceId: string }>("/auth/me"); setWorkspaceId(me.activeWorkspaceId);
  nav(to, { replace: true });
}

export function LoginPage() {
  const nav = useNavigate(); const [sp] = useSearchParams();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const { error, busy, submit } = useSubmit(async () => { await api("/auth/login", { body: { email, password } }); await afterAuth(nav, sp.get("next") || "/"); });
  return (
    <AuthLayout title="Selamat datang kembali" subtitle="Masuk untuk membuka penyimpanan Anda." footer={<>Belum punya akun? <Link className="font-medium text-primary-ink hover:underline" to="/register">Daftar</Link></>}>
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
  const { error, busy, submit } = useSubmit(async () => { await api("/auth/register", { body: { name, email, password, invitationToken: invitation } }); await afterAuth(nav); });
  return (
    <AuthLayout title={invitation ? "Terima undangan" : "Buat akun"} subtitle={invitation ? "Lengkapi data untuk bergabung ke workspace." : "Akun pertama menjadi administrator instalasi."} footer={<>Sudah punya akun? <Link className="font-medium text-primary-ink hover:underline" to="/login">Masuk</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nama lengkap">{(id) => <Input id={id} required autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Email">{(id) => <Input id={id} type="email" required autoComplete="username" value={email} readOnly={!!invitation} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Kata sandi" hint="Minimal 8 karakter.">{(id) => <Input id={id} type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <Err msg={error} />
        <Button type="submit" variant="primary" loading={busy} className="h-10 w-full">{invitation ? "Gabung workspace" : "Daftar"}</Button>
      </form>
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
