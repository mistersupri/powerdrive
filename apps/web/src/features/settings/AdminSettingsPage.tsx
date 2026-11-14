import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageUp, RotateCcw, Send } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { contrast } from "@/lib/branding";
import { cn } from "@/lib/cn";
import { useWorkspace } from "@/features/auth/useAuth";
import { PageHeader } from "@/features/layout/Shell";
import { Button } from "@/ui/Button";
import { Field, Input, Select, Switch } from "@/ui/Field";
import { Card, EmptyState, Skeleton } from "@/ui/misc";
import { ShieldAlert } from "lucide-react";

interface S {
  registration: { mode: "open" | "invite" | "closed" };
  guest: { allowLinks: boolean; allowUploads: boolean; requirePassword: boolean; maxExpiryDays: number; defaultExpiryDays: number };
  retention: { trashDays: number; auditDays: number; transferHistoryDays: number };
  security: { mfa: "off" | "admins" | "everyone"; idleTimeoutMinutes: number; sessionDays: number };
  email: { enabled: boolean; host: string; port: number; secure: boolean; user: string; hasPassword: boolean; fromName: string; fromAddress: string };
  brand: { appName: string; color: string; defaultTheme: "light" | "dark" | "system"; loginMessage: string; iconVersion: number };
}

function Section({ id, title, description, children, onSave, saving, dirty, extra, disabled }: { id: string; title: string; description: string; children: ReactNode; onSave(): void; saving: boolean; dirty: boolean; extra?: ReactNode; disabled?: boolean }) {
  return (
    <Card className="p-5 sm:p-6" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-[15px] font-semibold">{title}</h2>
      <p className="mt-0.5 mb-4 text-[13px] text-muted">{description}</p>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
        {children}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button type="submit" variant="primary" size="sm" loading={saving} disabled={!dirty || disabled}>Simpan</Button>
          {!dirty && !saving && <span className="text-[12px] text-muted" role="status">Tidak ada perubahan.</span>}
          {extra}
        </div>
      </form>
    </Card>
  );
}
const Toggle = ({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange(v: boolean): void }) => (
  <div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-[14px] font-medium">{label}</p>{hint && <p className="text-[12px] text-muted">{hint}</p>}</div><Switch checked={checked} onChange={onChange} label={label} /></div>
);
const Num = ({ label, hint, value, onChange, min = 0, max = 3650, unit }: { label: string; hint?: string; value: number; onChange(v: number): void; min?: number; max?: number; unit: string }) => (
  <Field label={label} hint={hint}>{(id) => <div className="flex items-center gap-2"><Input id={id} type="number" inputMode="numeric" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Math.round(Number(e.target.value) || 0))))} className="tnum w-28" /><span className="text-[13px] text-muted">{unit}</span></div>}</Field>
);

/** Instance-wide settings. Each card saves on its own so one mistake never blocks the others. */
export default function AdminSettingsPage() {
  const { user } = useWorkspace(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-settings"], queryFn: () => api<S>("/admin/settings"), enabled: !!user?.isSuperAdmin, retry: false });
  const [d, setD] = useState<S | null>(null); const [pw, setPw] = useState(""); const [testTo, setTestTo] = useState(user?.email ?? "");
  useEffect(() => { if (q.data) setD(structuredClone(q.data)); }, [q.data]);
  const save = useMutation({
    mutationFn: ({ patch }: { patch: object; section: string }) => api<S>("/admin/settings", { method: "PATCH", body: patch }),
    onSuccess: (r) => { qc.setQueryData(["admin-settings"], r); setPw(""); toast.success("Pengaturan disimpan"); void qc.invalidateQueries({ queryKey: ["branding"] }); void qc.invalidateQueries({ queryKey: ["mfa"] }); void qc.invalidateQueries({ queryKey: ["me"] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Gagal menyimpan."),
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const icon = useMutation({
    mutationFn: async (f: File | null) => { const r = await fetch("/api/v1/admin/branding/icon", { method: f ? "PUT" : "DELETE", credentials: "same-origin", headers: { "x-requested-with": "superdrive", ...(f ? { "content-type": f.type } : {}) }, body: f ?? undefined }); const j = await r.json(); if (!r.ok) throw new Error(j?.error?.message ?? "Gagal."); return j; },
    onSuccess: () => { toast.success("Ikon diperbarui"); void qc.invalidateQueries({ queryKey: ["branding"] }); void qc.invalidateQueries({ queryKey: ["admin-settings"] }); }, onError: (e) => toast.error((e as Error).message),
  });
  const test = useMutation({ mutationFn: () => api("/admin/email/test", { body: { to: testTo } }), onSuccess: () => toast.success(`Email uji dikirim ke ${testTo}`), onError: (e) => toast.error((e as Error).message) });
  const sweep = useMutation({ mutationFn: () => api<Record<string, number>>("/admin/retention/run", { body: {} }), onSuccess: (r) => toast.success(`Dibersihkan: ${r.audit} catatan audit, ${r.activity} aktivitas file, ${r.transfers} riwayat transfer.`), onError: (e) => toast.error((e as Error).message) });

  if (!user?.isSuperAdmin) return <div className="flex min-h-0 flex-1 flex-col"><PageHeader title="Pengaturan sistem" /><EmptyState icon={ShieldAlert} title="Khusus administrator sistem">Hanya akun administrator instalasi yang bisa membuka halaman ini.</EmptyState></div>;
  if (!d || !q.data) return <div className="flex min-h-0 flex-1 flex-col"><PageHeader title="Pengaturan sistem" /><div className="p-8"><Skeleton className="h-64" /></div></div>;
  const o = q.data; const dirty = (k: keyof S) => JSON.stringify(d[k]) !== JSON.stringify(o[k]) || (k === "email" && pw !== "");
  const upd = <K extends keyof S>(k: K, v: Partial<S[K]>) => setD({ ...d, [k]: { ...d[k], ...v } });
  const run = (k: keyof S, extra: object = {}) => save.mutate({ section: k, patch: { [k]: { ...d[k], ...extra } } });
  const ratio = contrast(d.brand.color, "#ffffff"); const colorOk = /^#[0-9a-fA-F]{6}$/.test(d.brand.color) && ratio >= 4.5;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Pengaturan sistem" subtitle="Berlaku untuk seluruh instalasi dan semua workspace." />
      <div className="scroll-thin flex-1 overflow-y-auto p-4 sm:p-8">
        <div className="mx-auto max-w-3xl space-y-5">
          <Section id="brand" title="Tampilan dan merek" description="Nama, warna utama, dan ikon aplikasi. Dipakai di halaman masuk, sidebar, tab browser, dan saat aplikasi dipasang di ponsel." saving={save.isPending} dirty={dirty("brand")} disabled={!colorOk} onSave={() => run("brand")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nama aplikasi">{(id) => <Input id={id} maxLength={40} value={d.brand.appName} onChange={(e) => upd("brand", { appName: e.target.value })} />}</Field>
              <Field label="Tema bawaan" hint="Untuk pengguna yang belum memilih sendiri.">{(id) => <Select id={id} value={d.brand.defaultTheme} onChange={(e) => upd("brand", { defaultTheme: e.target.value as S["brand"]["defaultTheme"] })}><option value="light">Terang</option><option value="dark">Gelap</option><option value="system">Ikuti perangkat</option></Select>}</Field>
            </div>
            <Field label="Warna utama" hint={colorOk ? `Kontras dengan teks putih ${ratio.toFixed(1)}:1. Cukup terbaca.` : "Warna terlalu terang: teks putih di atasnya sulit dibaca (butuh minimal 4,5:1)."}>{(id) => (
              <div className="flex flex-wrap items-center gap-3">
                <input aria-label="Pilih warna" type="color" value={/^#[0-9a-fA-F]{6}$/.test(d.brand.color) ? d.brand.color : "#1769e8"} onChange={(e) => upd("brand", { color: e.target.value })} className="size-11 cursor-pointer rounded-lg border border-line-strong bg-surface p-1" />
                <Input id={id} value={d.brand.color} onChange={(e) => upd("brand", { color: e.target.value })} className="tnum w-32 font-mono" maxLength={7} aria-invalid={!colorOk} />
                <span className="inline-flex h-9 items-center rounded-lg px-3.5 text-[13px] font-medium text-white" style={{ background: colorOk ? d.brand.color : "#999" }}>Contoh tombol</span>
              </div>)}</Field>
            <Field label="Pesan di halaman masuk" hint="Opsional, maksimal 300 karakter.">{(id) => <Input id={id} maxLength={300} value={d.brand.loginMessage} onChange={(e) => upd("brand", { loginMessage: e.target.value })} placeholder="mis. Gunakan akun kantor Anda." />}</Field>
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 p-3">
              {o.brand.iconVersion ? <img alt="Ikon aplikasi saat ini" src={`/api/v1/branding/icon/192?v=${o.brand.iconVersion}`} className="size-14 rounded-xl border border-line bg-white object-contain" /> : <span className="grid size-14 place-items-center rounded-xl border border-dashed border-line-strong text-[11px] text-muted">Bawaan</span>}
              <div className="min-w-0 flex-1 text-[13px]"><p className="font-medium">Ikon aplikasi</p><p className="text-muted">PNG, JPG, atau WebP, minimal 128 × 128 piksel. Dipotong menjadi persegi otomatis.</p></div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/x-icon" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) icon.mutate(f); e.target.value = ""; }} />
              <Button size="sm" type="button" icon={<ImageUp className="size-4" />} loading={icon.isPending} onClick={() => fileRef.current?.click()}>Unggah ikon</Button>
              {o.brand.iconVersion > 0 && <Button size="sm" type="button" variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => icon.mutate(null)}>Kembalikan bawaan</Button>}
            </div>
          </Section>

          <Section id="reg" title="Pendaftaran dan akses tamu" description="Siapa yang bisa membuat akun, dan apa yang boleh dilakukan orang tanpa akun lewat tautan berbagi." saving={save.isPending} dirty={dirty("registration") || dirty("guest")} onSave={() => save.mutate({ section: "reg", patch: { registration: d.registration, guest: d.guest } })}>
            <Field label="Pendaftaran akun baru">{(id) => <Select id={id} value={d.registration.mode} onChange={(e) => upd("registration", { mode: e.target.value as S["registration"]["mode"] })}><option value="open">Terbuka: siapa pun bisa mendaftar</option><option value="invite">Hanya dengan undangan</option><option value="closed">Tertutup: tidak ada akun baru, undangan pun ditolak</option></Select>}</Field>
            <div className="space-y-4 rounded-xl border border-line p-4">
              <Toggle label="Izinkan tautan berbagi publik" hint="Jika dimatikan, semua tautan publik langsung berhenti berfungsi. Berbagi ke anggota workspace tetap bisa." checked={d.guest.allowLinks} onChange={(v) => upd("guest", { allowLinks: v })} />
              <Toggle label="Izinkan tamu mengunggah dan mengubah (tautan editor)" hint="Dimatikan: tautan editor yang ada hanya bisa melihat." checked={d.guest.allowUploads} onChange={(v) => upd("guest", { allowUploads: v })} />
              <Toggle label="Wajibkan kata sandi pada tautan publik" checked={d.guest.requirePassword} onChange={(v) => upd("guest", { requirePassword: v })} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Num label="Masa berlaku bawaan" hint="0 = tanpa batas, kecuali ada batas maksimal." unit="hari" value={d.guest.defaultExpiryDays} onChange={(v) => upd("guest", { defaultExpiryDays: v })} />
                <Num label="Masa berlaku maksimal" hint="0 = pengguna bebas memilih." unit="hari" value={d.guest.maxExpiryDays} onChange={(v) => upd("guest", { maxExpiryDays: v })} />
              </div>
            </div>
          </Section>

          <Section id="sec" title="Keamanan" description="Verifikasi dua langkah dan batas waktu sesi." saving={save.isPending} dirty={dirty("security")} onSave={() => run("security")}>
            <Field label="Verifikasi dua langkah (TOTP)" hint="Akun yang wajib dan belum mengaktifkannya hanya bisa membuka halaman pengaturan sampai selesai.">{(id) => <Select id={id} value={d.security.mfa} onChange={(e) => upd("security", { mfa: e.target.value as S["security"]["mfa"] })}><option value="off">Opsional: pengguna memilih sendiri</option><option value="admins">Wajib untuk administrator dan pemilik workspace</option><option value="everyone">Wajib untuk semua pengguna</option></Select>}</Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Num label="Keluar otomatis bila tidak aktif" hint="0 = tidak pernah. Pengguna diberi peringatan 1 menit sebelumnya." unit="menit" max={10080} value={d.security.idleTimeoutMinutes} onChange={(v) => upd("security", { idleTimeoutMinutes: v })} />
              <Num label="Lama sesi maksimal" unit="hari" min={1} max={365} value={d.security.sessionDays} onChange={(v) => upd("security", { sessionDays: v })} />
            </div>
          </Section>

          <Section id="ret" title="Retensi data" description="Berapa lama data disimpan sebelum dibersihkan otomatis (sekali sehari)." saving={save.isPending} dirty={dirty("retention")} onSave={() => run("retention")}
            extra={<Button type="button" size="sm" variant="ghost" loading={sweep.isPending} onClick={() => sweep.mutate()}>Jalankan pembersihan sekarang</Button>}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Num label="Sampah" hint="Berlaku untuk item yang dihapus setelah ini." unit="hari" min={1} value={d.retention.trashDays} onChange={(v) => upd("retention", { trashDays: v })} />
              <Num label="Log audit dan aktivitas file" hint="0 = simpan selamanya." unit="hari" value={d.retention.auditDays} onChange={(v) => upd("retention", { auditDays: v })} />
              <Num label="Riwayat transfer" hint="0 = simpan selamanya." unit="hari" value={d.retention.transferHistoryDays} onChange={(v) => upd("retention", { transferHistoryDays: v })} />
            </div>
          </Section>

          <Section id="mail" title="Email (SMTP)" description="Untuk mengirim tautan atur ulang kata sandi dan undangan. Tanpa ini, tautan ditampilkan di layar atau dicatat di log server." saving={save.isPending} dirty={dirty("email")} onSave={() => save.mutate({ section: "email", patch: { email: { ...d.email, hasPassword: undefined, ...(pw ? { password: pw } : {}) } } })}
            extra={<form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); test.mutate(); }}><Input aria-label="Kirim email uji ke" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} className="h-9 w-56 text-[13px]" /><Button type="submit" size="sm" icon={<Send className="size-3.5" />} loading={test.isPending} disabled={!o.email.enabled || dirty("email")} title={dirty("email") ? "Simpan dulu" : undefined}>Kirim email uji</Button></form>}>
            <Toggle label="Aktifkan pengiriman email" checked={d.email.enabled} onChange={(v) => upd("email", { enabled: v })} />
            <div className={cn("grid gap-4 sm:grid-cols-2", !d.email.enabled && "opacity-70")}>
              <Field label="Server SMTP">{(id) => <Input id={id} value={d.email.host} onChange={(e) => upd("email", { host: e.target.value })} placeholder="smtp.contoh.id" />}</Field>
              <div className="grid grid-cols-[1fr_auto] gap-3"><Field label="Port">{(id) => <Input id={id} type="number" inputMode="numeric" min={1} max={65535} value={d.email.port} onChange={(e) => upd("email", { port: Number(e.target.value) || 587 })} className="tnum" />}</Field><label className="flex items-end gap-2 pb-2.5 text-[13px]"><input type="checkbox" checked={d.email.secure} onChange={(e) => upd("email", { secure: e.target.checked })} className="size-4 accent-[var(--primary)]" />SSL/TLS</label></div>
              <Field label="Nama pengguna">{(id) => <Input id={id} autoComplete="off" value={d.email.user} onChange={(e) => upd("email", { user: e.target.value })} />}</Field>
              <Field label="Kata sandi" hint={o.email.hasPassword ? "Sudah tersimpan terenkripsi. Kosongkan untuk tidak mengubah." : undefined}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={o.email.hasPassword ? "••••••••" : ""} />}</Field>
              <Field label="Nama pengirim">{(id) => <Input id={id} value={d.email.fromName} onChange={(e) => upd("email", { fromName: e.target.value })} />}</Field>
              <Field label="Alamat pengirim">{(id) => <Input id={id} type="email" value={d.email.fromAddress} onChange={(e) => upd("email", { fromAddress: e.target.value })} placeholder="drive@contoh.id" />}</Field>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
