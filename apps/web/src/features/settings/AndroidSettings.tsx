import { ArrowLeft, ChevronRight, Download, Fingerprint, Images, Lock, RefreshCw, Smartphone } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useAlbumVault } from "@/lib/albumVault";
import { useMe } from "@/features/auth/useAuth";
import { PageHeader } from "@/features/layout/Shell";
import { Button } from "@/ui/Button";
import { Field, Input } from "@/ui/Field";
import { Card } from "@/ui/misc";

/** What the Android app lets the page do. Only present inside the app. */
interface AndroidBridge {
  appVersion?(): string; checkForUpdate?(): void;
  lockState?(): string; setLock?(enabled: boolean, delayMs: number): void; setNativeUi?(on: boolean): void;
  backupState?(): string; setBackup?(json: string): void; backupNow?(): void; backupAlbums?(): string; setBackupAlbums?(json: string): void;
}
export const androidBridge = () => (window as unknown as { SuperDriveAndroid?: AndroidBridge }).SuperDriveAndroid;
export const inAndroidApp = () => !!androidBridge()?.checkForUpdate;

interface LockState { enabled: boolean; delay: number; available: boolean }
interface BackupState { enabled: boolean; allAlbums: boolean; albumCount: number; wifiOnly: boolean; videos: boolean; existing: boolean; permission: boolean; running: boolean; lastRun: number; lastCount: number; error: string | null; pending: number }
interface DeviceAlbum { id: string; name: string; count: number; selected: boolean }
const LOCK_DELAYS = [[0, "Setiap kali keluar dari aplikasi"], [60_000, "Setelah 1 menit"], [300_000, "Setelah 5 menit"], [900_000, "Setelah 15 menit"]] as const;

const parse = <T,>(read: () => string | undefined, fallback: T): T => { try { const s = read(); return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; } };
/** Re-reads a piece of phone state whenever the phone says it changed (and every few seconds while [poll] is set). */
function usePhoneState<T>(read: () => T, event: string, poll?: number) {
  const [v, setV] = useState<T>(read);
  useEffect(() => { const f = () => setV(read()); window.addEventListener(event, f); const t = poll ? setInterval(f, poll) : undefined; return () => { window.removeEventListener(event, f); if (t) clearInterval(t); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

/** One page of the app's own settings. Each section has its own page so none of them has to scroll past the others. */
function Page({ title, back = "/app", backLabel = "Pengaturan aplikasi", children }: { title: string; back?: string; backLabel?: string; children: ReactNode }) {
  if (!inAndroidApp()) return <Navigate to="/settings" replace />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={title} />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4 pb-24 sm:p-8">
        <div className="mx-auto max-w-xl space-y-4">
          <Link to={back} className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-ink pointer-coarse:h-11"><ArrowLeft className="size-4" aria-hidden />{backLabel}</Link>
          {children}
        </div>
      </div>
    </div>
  );
}
const Row = ({ to, icon: Icon, title, summary }: { to: string; icon: typeof Smartphone; title: string; summary: string }) => (
  <Link to={to} className="flex min-h-16 items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:bg-surface-2">
    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-ink"><Icon className="size-5" aria-hidden /></span>
    <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium">{title}</span><span className="block truncate text-[13px] text-muted">{summary}</span></span>
    <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
  </Link>
);
const Switch = ({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange(v: boolean): void }) => (
  <label className="flex min-h-12 cursor-pointer items-center gap-3 py-1">
    <input type="checkbox" role="switch" className="size-5 shrink-0 accent-[var(--color-primary)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium">{label}</span>{hint && <span className="block text-[13px] text-muted">{hint}</span>}</span>
  </label>
);

/* ---- hub ---- */
export function AndroidSettingsHub() {
  const b = androidBridge();
  const backup = usePhoneState(() => parse<BackupState | null>(() => b?.backupState?.(), null), "sd-backup-changed", 5000);
  const lock = usePhoneState(() => parse<LockState | null>(() => b?.lockState?.(), null), "sd-lock-changed");
  return (
    <Page title="Pengaturan aplikasi" back="/settings" backLabel="Pengaturan">
      <p className="text-[13px] text-muted">Pengaturan di halaman ini hanya berlaku untuk aplikasi di HP ini. Pengaturan akun dan situs ada di <Link to="/settings" className="font-medium text-primary-ink hover:underline">Pengaturan</Link>.</p>
      <div className="space-y-2">
        <Row to="/app/backup" icon={Images} title="Cadangan foto dan video" summary={!backup ? "—" : backup.enabled ? (backup.running ? "Sedang mencadangkan…" : backup.allAlbums ? "Aktif · semua album" : `Aktif · ${backup.albumCount} album`) : "Nonaktif"} />
        <Row to="/app/lock" icon={Fingerprint} title="Kunci aplikasi" summary={!lock ? "—" : lock.enabled ? "Aktif · sidik jari atau kunci layar" : "Nonaktif"} />
        <Row to="/app/private" icon={Lock} title="Album privat" summary="Buka dengan sidik jari" />
        <button type="button" onClick={() => b?.setNativeUi?.(true)} className="press flex min-h-16 w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-ink"><Smartphone className="size-5" aria-hidden /></span>
          <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium">Antarmuka native (beta)</span><span className="block text-[13px] text-muted">Tampilan baru yang ditulis ulang native. File sudah native; layar lain masih memakai halaman web. Bisa dikembalikan dari menu ⋮ di layar File.</span></span>
          <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
        </button>
        <Row to="/app/update" icon={RefreshCw} title="Pembaruan aplikasi" summary={`Versi ${b?.appVersion?.() ?? "—"}`} />
      </div>
    </Page>
  );
}

/* ---- updates ---- */
export function AndroidUpdatePage() {
  const b = androidBridge();
  return (
    <Page title="Pembaruan aplikasi">
      <Card className="space-y-3 p-5"><div><p className="text-[14px] font-medium">Versi {b?.appVersion?.() ?? "—"}</p><p className="text-[13px] text-muted">Aplikasi memeriksa pembaruan setiap kali dibuka. Anda juga bisa memeriksanya sekarang.</p></div>
        <Button icon={<Download className="size-4" />} onClick={() => b?.checkForUpdate?.()}>Periksa pembaruan</Button></Card>
    </Page>
  );
}

/* ---- app lock ---- */
export function AndroidLockPage() {
  const b = androidBridge(); const lock = usePhoneState(() => parse<LockState | null>(() => b?.lockState?.(), null), "sd-lock-changed");
  return (
    <Page title="Kunci aplikasi">
      <Card className="space-y-3 p-5">
        {lock ? (<>
          <Switch label="Kunci dengan sidik jari" hint="Minta sidik jari (atau kunci layar HP) sebelum SuperDrive terbuka. Perubahan harus dikonfirmasi dengan sidik jari." checked={lock.enabled} disabled={!lock.available && !lock.enabled} onChange={(v) => b?.setLock?.(v, lock.delay)} />
          {!lock.available && !lock.enabled && <p className="text-[13px] text-warn-ink">Daftarkan sidik jari atau kunci layar di pengaturan HP terlebih dahulu.</p>}
          {lock.enabled && (
            <label className="flex flex-wrap items-center gap-3 text-[13px] text-muted"><span className="w-28 shrink-0">Kunci ulang</span>
              <select aria-label="Kunci ulang" value={lock.delay} onChange={(e) => b?.setLock?.(true, Number(e.target.value))} className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 text-[14px] text-ink">
                {LOCK_DELAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>)}
        </>) : <p className="text-[13px] text-muted">Tidak tersedia.</p>}
      </Card>
    </Page>
  );
}

/* ---- photo backup ---- */
export function AndroidBackupPage() {
  const b = androidBridge(); const backup = usePhoneState(() => parse<BackupState | null>(() => b?.backupState?.(), null), "sd-backup-changed", 4000);
  const set = (patch: Partial<BackupState>) => { if (backup) b?.setBackup?.(JSON.stringify({ ...backup, ...patch })); };
  return (
    <Page title="Cadangan foto dan video">
      {backup ? (<>
        <Card className="space-y-2 p-5">
          <Switch label="Cadangkan otomatis" hint="Foto dan video baru di HP ini diunggah ke “Cadangan Foto” di Semua file, satu folder per album HP." checked={backup.enabled} onChange={(v) => set({ enabled: v })} />
        </Card>
        {backup.enabled && (<>
          <Link to="/app/backup/albums" className="flex min-h-14 items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 hover:bg-surface-2">
            <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium">Album yang dicadangkan</span><span className="block text-[13px] text-muted">{backup.allAlbums ? "Semua album" : `${backup.albumCount} album dipilih`}</span></span><ChevronRight className="size-4 text-faint" aria-hidden />
          </Link>
          <Card className="space-y-1 p-5">
            <Switch label="Hanya lewat Wi-Fi" checked={backup.wifiOnly} onChange={(v) => set({ wifiOnly: v })} />
            <Switch label="Sertakan video" checked={backup.videos} onChange={(v) => set({ videos: v })} />
            <Switch label="Sertakan foto yang sudah ada di HP" hint="Dimatikan: hanya foto yang diambil sejak pencadangan dinyalakan." checked={backup.existing} onChange={(v) => set({ existing: v })} />
          </Card>
          <Card className="flex flex-wrap items-center gap-3 p-5 text-[13px] text-muted">
            <span className="min-w-0 flex-1" role="status">
              {backup.running ? "Sedang mencadangkan…" : backup.error ? <span className="text-danger-ink">{backup.error}</span> : backup.lastRun ? `Terakhir ${new Date(backup.lastRun).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}${backup.lastCount ? ` · ${backup.lastCount} item` : ""}` : "Belum pernah berjalan"}
              {backup.pending > 0 && !backup.running ? ` · ${backup.pending.toLocaleString("id-ID")} menunggu` : ""}
            </span>
            <Button size="sm" disabled={backup.running || !backup.permission} onClick={() => b?.backupNow?.()}>Cadangkan sekarang</Button>
          </Card>
        </>)}
      </>) : <p className="text-[13px] text-muted">Tidak tersedia.</p>}
    </Page>
  );
}

/** Pick which gallery albums (device folders) are backed up. */
export function AndroidBackupAlbumsPage() {
  const b = androidBridge(); const backup = usePhoneState(() => parse<BackupState | null>(() => b?.backupState?.(), null), "sd-backup-changed");
  const [albums, setAlbums] = useState<DeviceAlbum[]>(() => parse<DeviceAlbum[]>(() => b?.backupAlbums?.(), []));
  const save = (next: DeviceAlbum[], all: boolean) => { setAlbums(next); b?.setBackupAlbums?.(all ? "null" : JSON.stringify(next.filter((a) => a.selected).map((a) => a.id))); };
  const allOn = albums.length > 0 && albums.every((a) => a.selected);
  return (
    <Page title="Album dicadangkan" back="/app/backup" backLabel="Cadangan foto dan video">
      {!backup?.permission ? <Card className="p-5 text-[13px] text-muted">Izin akses foto diperlukan. Nyalakan pencadangan dulu agar Android meminta izinnya.</Card>
        : !albums.length ? <Card className="p-5 text-[13px] text-muted">Belum ada album berisi foto atau video di HP ini.</Card> : (<>
          <Card className="p-2">
            <Switch label="Semua album" hint="Termasuk album yang dibuat nanti." checked={allOn} onChange={(v) => save(albums.map((a) => ({ ...a, selected: v })), v)} />
          </Card>
          <Card className="divide-y divide-line p-0">
            {albums.map((a) => (
              <label key={a.id} className="flex min-h-14 cursor-pointer items-center gap-3 px-5 py-2">
                <input type="checkbox" className="size-5 shrink-0 accent-[var(--color-primary)]" checked={a.selected} onChange={(e) => { const next = albums.map((x) => (x.id === a.id ? { ...x, selected: e.target.checked } : x)); save(next, next.every((x) => x.selected)); }} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{a.name}</span><span className="block text-[12px] text-muted">{a.count.toLocaleString("id-ID")} item</span></span>
              </label>))}
          </Card>
          <p className="text-[12px] text-muted">{albums.some((x) => x.selected) ? "Hanya album yang dicentang yang dicadangkan." : "Tidak ada album dipilih: tidak ada yang dicadangkan."}</p>
        </>)}
    </Page>
  );
}

/* ---- private albums: fingerprint ---- */
export function AndroidPrivatePage() {
  const me = useMe().data?.user.id; const vault = useAlbumVault(me); const nav = useNavigate();
  const [v, setV] = useState(vault.state()); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const refresh = () => setV(vault.state());
  const enable = async () => {
    setBusy(true); setError("");
    try {
      await api("/albums-private/unlock", { body: { password } }); // proves it is the right password before it is stored
      if (!(await vault.enroll(password))) throw new Error("Sidik jari tidak dikonfirmasi.");
      setPassword(""); refresh(); toast.success("Album privat bisa dibuka dengan sidik jari");
    } catch (e) { setError(e instanceof ApiError && e.code === "NO_PASSWORD" ? "Buat kata sandi album dulu di Media → Album → Album privat." : (e as Error).message); }
    setBusy(false);
  };
  return (
    <Page title="Album privat">
      <Card className="space-y-3 p-5">
        <div className="flex items-start gap-3"><Fingerprint className="mt-0.5 size-5 shrink-0 text-primary-ink" aria-hidden /><div><p className="text-[14px] font-medium">Buka dengan sidik jari</p><p className="text-[13px] text-muted">Kata sandi album disimpan terenkripsi di HP dan hanya bisa dipakai setelah sidik jari Anda. Server tetap memeriksa kata sandinya. Bila sidik jari di HP berubah, Anda diminta memasukkan kata sandi lagi.</p></div></div>
        {!v.available ? <p className="text-[13px] text-warn-ink">HP ini belum punya sidik jari yang terdaftar.</p>
          : v.enrolled ? (<div className="flex flex-wrap items-center gap-3"><p className="min-w-0 flex-1 text-[13px] text-ok-ink">Aktif di HP ini.</p><Button onClick={async () => { await vault.clear(); refresh(); }}>Matikan</Button></div>)
          : (<form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (password.length >= 6) void enable(); }}>
            <Field label="Kata sandi album" hint="Masukkan sekali untuk mengaktifkan.">{(id) => <Input id={id} type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
            {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger-ink">{error}</p>}
            <Button type="submit" variant="primary" loading={busy} disabled={password.length < 6}>Aktifkan sidik jari</Button></form>)}
      </Card>
      <Button variant="ghost" onClick={() => nav("/media")}>Ke album privat</Button>
    </Page>
  );
}
