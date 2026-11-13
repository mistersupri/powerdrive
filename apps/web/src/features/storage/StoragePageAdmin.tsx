import type { MemberDto, Permission, StorageConnectionDto } from "@superdrive/shared";
import { ALL_PERMISSIONS, formatBytes, PROVIDER_LABEL } from "@superdrive/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, HardDrive, KeyRound, Link2, MoreVertical, Plus, RefreshCw, Server, Cloud } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { api, getWorkspaceId } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useWorkspace } from "@/features/auth/useAuth";
import { PageHeader, useStorages } from "@/features/layout/Shell";
import { Button, IconButton } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, Input, Select } from "@/ui/Field";
import { useMenu } from "@/ui/Menu";
import { Card, ConnectionBadge, EmptyState, Progress, Skeleton } from "@/ui/misc";

type FormKind = "local" | "s3" | "sftp" | "webdav" | "smb";
interface ProviderInfo { slug: string; provider: string; label: string; kind: "oauth" | FormKind | "planned"; configured: boolean; available: boolean; roots?: string[]; note?: string }
const PERM_LABEL: Record<Permission, string> = { READ: "Melihat", UPLOAD: "Mengunggah", DOWNLOAD: "Mengunduh", COPY: "Menyalin", MOVE: "Memindahkan", DELETE: "Menghapus", RENAME: "Ganti nama", SHARE: "Membagikan", MOUNT: "Membuat mount", MANAGE_STORAGE: "Kelola penyimpanan" };

function AddStorageDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const qc = useQueryClient();
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => api<ProviderInfo[]>("/storages/providers"), enabled: open, staleTime: 60_000 });
  const [form, setForm] = useState<null | FormKind>(null); const [busy, setBusy] = useState<string | null>(null);
  const [v, setV] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setForm(null); setV({}); } }, [open]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  const connectOAuth = async (p: ProviderInfo) => {
    setBusy(p.slug);
    try { const { url } = await api<{ url: string }>(`/storages/${p.slug}/connect`, { body: { name: v.name || undefined } }); location.href = url; }
    catch (e) { toast.error((e as Error).message); setBusy(null); }
  };
  const create = async () => {
    setBusy(form);
    try {
      const bodies: Record<FormKind, object> = {
        local: { provider: "LOCAL", name: v.name, root: v.root },
        s3: { provider: "S3", name: v.name, endpoint: v.endpoint || "", region: v.region || "auto", bucket: v.bucket, prefix: v.prefix || undefined, accessKeyId: v.accessKeyId, secretAccessKey: v.secretAccessKey },
        sftp: { provider: "SFTP", name: v.name, host: v.host, port: Number(v.port) || 22, username: v.username, password: v.password || undefined, privateKey: v.privateKey || undefined, passphrase: v.passphrase || undefined, baseDir: v.baseDir || "/", hostKey: v.hostKey || undefined },
        webdav: { provider: "WEBDAV", name: v.name, url: v.url, username: v.username || undefined, password: v.password || undefined },
        smb: { provider: "SMB", name: v.name, host: v.host, port: Number(v.port) || 445, share: v.share, baseDir: v.baseDir || "", domain: v.domain || undefined, username: v.username, password: v.password, encrypt: v.encrypt === "1" || undefined },
      };
      await api("/storages", { body: bodies[form!] });
      toast.success("Penyimpanan terhubung"); await qc.invalidateQueries({ queryKey: ["storages"] }); onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const cloud = providers.data?.filter((p) => p.kind === "oauth") ?? []; const ext = providers.data?.filter((p) => p.kind !== "oauth") ?? [];
  return (
    <Dialog open={open} onClose={onClose} width="max-w-[640px]" title="Hubungkan penyimpanan" description={form ? undefined : "Pilih penyedia yang ingin dihubungkan."}
      footer={form ? <><Button onClick={() => setForm(null)}>Kembali</Button><Button variant="primary" loading={busy === form} onClick={create}>Hubungkan</Button></> : undefined}>
      {!form ? (
        <div className="space-y-6">
          <section><h3 className="mb-2 text-[13px] font-semibold">Penyimpanan cloud</h3>
            <div className="space-y-2">{cloud.map((p) => (
              <div key={p.slug} className="flex items-center gap-3.5 rounded-[10px] bg-surface-2 p-3.5">
                <span className="grid size-10 place-items-center rounded-lg bg-surface text-primary-ink"><Cloud className="size-5" aria-hidden /></span>
                <div className="min-w-0 flex-1"><p className="text-[14px] font-medium">{p.label}</p><p className="text-[12px] text-muted">{p.configured ? "Beberapa akun didukung" : "Belum dikonfigurasi administrator (client ID/secret)"}</p></div>
                <Button variant="primary" size="sm" disabled={!p.configured} loading={busy === p.slug} icon={<ExternalLink className="size-3.5" />} onClick={() => connectOAuth(p)}>Hubungkan</Button>
              </div>))}
              {providers.isLoading && <Skeleton className="h-16" />}
            </div>
            <div className="mt-3"><Field label="Nama koneksi (opsional)" hint="Mis. “Google Kantor”. Berguna jika punya beberapa akun.">{(id) => <Input id={id} value={v.name ?? ""} onChange={set("name")} placeholder="Google Kantor" />}</Field></div>
          </section>
          <section><h3 className="mb-2 text-[13px] font-semibold">Penyimpanan eksternal</h3>
            <div className="space-y-1.5">{ext.map((p) => (
              <div key={p.slug} className="flex items-center gap-3 rounded-lg bg-surface-2 px-3.5 py-2.5">
                <Server className="size-4 text-muted" aria-hidden /><span className="flex-1 text-[13px] font-medium">{p.label}</span>
                {p.available ? <Button size="sm" onClick={() => { setForm(p.kind as FormKind); setV({}); }}>Atur</Button> : <span className="max-w-48 rounded-md bg-surface px-2 py-1 text-right text-[11px] text-muted">{p.note ?? "Segera hadir"}</span>}
              </div>))}</div>
          </section>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <Field label="Nama koneksi">{(id) => <Input id={id} required value={v.name ?? ""} onChange={set("name")} placeholder={{ local: "Arsip server", s3: "Bucket arsip", sftp: "Server SFTP", webdav: "Nextcloud kantor", smb: "NAS kantor" }[form]} />}</Field>
          {form === "local" && <Field label="Folder di server" hint={`Harus berada di dalam: ${providers.data?.find((p) => p.kind === "local")?.roots?.join(", ")}. Nama relatif dibuat di dalam folder pertama.`}>{(id) => <Input id={id} required value={v.root ?? ""} onChange={set("root")} placeholder="arsip-2026" />}</Field>}
          {form === "s3" && (<>
            <Field label="Endpoint" hint="Kosongkan untuk AWS S3. Untuk MinIO/R2/B2 isi alamat HTTPS-nya.">{(id) => <Input id={id} type="url" value={v.endpoint ?? ""} onChange={set("endpoint")} placeholder="https://<akun>.r2.cloudflarestorage.com" />}</Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Bucket">{(id) => <Input id={id} required value={v.bucket ?? ""} onChange={set("bucket")} />}</Field><Field label="Region">{(id) => <Input id={id} value={v.region ?? ""} onChange={set("region")} placeholder="auto" />}</Field></div>
            <Field label="Prefix (opsional)" hint="Batasi ke satu folder di dalam bucket.">{(id) => <Input id={id} value={v.prefix ?? ""} onChange={set("prefix")} placeholder="kantor/" />}</Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Access key">{(id) => <Input id={id} required autoComplete="off" value={v.accessKeyId ?? ""} onChange={set("accessKeyId")} />}</Field><Field label="Secret key">{(id) => <Input id={id} required type="password" autoComplete="new-password" value={v.secretAccessKey ?? ""} onChange={set("secretAccessKey")} />}</Field></div>
          </>)}
          {form === "sftp" && (<>
            <div className="grid grid-cols-[1fr_96px] gap-3"><Field label="Host">{(id) => <Input id={id} required value={v.host ?? ""} onChange={set("host")} placeholder="sftp.contoh.id" />}</Field><Field label="Port">{(id) => <Input id={id} inputMode="numeric" value={v.port ?? ""} onChange={set("port")} placeholder="22" />}</Field></div>
            <Field label="Username">{(id) => <Input id={id} required autoComplete="off" value={v.username ?? ""} onChange={set("username")} />}</Field>
            <Field label="Password" hint="Atau pakai kunci privat di bawah.">{(id) => <Input id={id} type="password" autoComplete="new-password" value={v.password ?? ""} onChange={set("password")} />}</Field>
            <Field label="Kunci privat (opsional)" hint="Tempel isi file kunci (OpenSSH/PEM). Disimpan terenkripsi.">{(id) => <textarea id={id} rows={3} value={v.privateKey ?? ""} onChange={(e) => setV((s) => ({ ...s, privateKey: e.target.value }))} className="w-full rounded-lg border border-line-strong bg-surface p-3 font-mono text-[12px] focus:border-primary focus:ring-2 focus:ring-primary/25 focus:outline-none" />}</Field>
            <Field label="Folder dasar" hint="Folder di server yang menjadi akar penyimpanan.">{(id) => <Input id={id} value={v.baseDir ?? ""} onChange={set("baseDir")} placeholder="/data/arsip" />}</Field>
            <Field label="Sidik jari host (opsional)" hint="Format SHA256:…  Jika kosong, kunci host pertama yang terlihat dipercaya lalu dikunci; koneksi berikutnya ditolak bila berubah.">{(id) => <Input id={id} value={v.hostKey ?? ""} onChange={set("hostKey")} placeholder="SHA256:abc…" />}</Field>
          </>)}
          {form === "webdav" && (<>
            <Field label="Alamat WebDAV" hint="Harus HTTPS. Contoh Nextcloud: https://cloud.contoh.id/remote.php/dav/files/nama/">{(id) => <Input id={id} type="url" required value={v.url ?? ""} onChange={set("url")} placeholder="https://cloud.contoh.id/remote.php/dav/files/nama/" />}</Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Username">{(id) => <Input id={id} autoComplete="off" value={v.username ?? ""} onChange={set("username")} />}</Field><Field label="Password">{(id) => <Input id={id} type="password" autoComplete="new-password" value={v.password ?? ""} onChange={set("password")} />}</Field></div>
            <p className="text-[12px] text-muted">Untuk Nextcloud/ownCloud, pakai “app password”, bukan password akun utama.</p>
          </>)}
          {form === "smb" && (<>
            <div className="grid grid-cols-[1fr_96px] gap-3"><Field label="Host / alamat NAS">{(id) => <Input id={id} required value={v.host ?? ""} onChange={set("host")} placeholder="nas.kantor.local" />}</Field><Field label="Port">{(id) => <Input id={id} inputMode="numeric" value={v.port ?? ""} onChange={set("port")} placeholder="445" />}</Field></div>
            <div className="grid grid-cols-2 gap-3"><Field label="Nama share">{(id) => <Input id={id} required value={v.share ?? ""} onChange={set("share")} placeholder="dokumen" />}</Field><Field label="Domain (opsional)">{(id) => <Input id={id} value={v.domain ?? ""} onChange={set("domain")} placeholder="WORKGROUP" />}</Field></div>
            <div className="grid grid-cols-2 gap-3"><Field label="Username">{(id) => <Input id={id} required autoComplete="off" value={v.username ?? ""} onChange={set("username")} />}</Field><Field label="Password">{(id) => <Input id={id} required type="password" autoComplete="new-password" value={v.password ?? ""} onChange={set("password")} />}</Field></div>
            <Field label="Subfolder di share (opsional)" hint="Jadikan satu folder di dalam share sebagai akar.">{(id) => <Input id={id} value={v.baseDir ?? ""} onChange={set("baseDir")} placeholder="Tim/Arsip" />}</Field>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={v.encrypt === "1"} onChange={(e) => setV((s) => ({ ...s, encrypt: e.target.checked ? "1" : "" }))} />Wajibkan enkripsi SMB3</label>
          </>)}
          <button type="submit" hidden />
        </form>)}
    </Dialog>
  );
}

function PermissionsDialog({ s, onClose }: { s: StorageConnectionDto | null; onClose(): void }) {
  const members = useQuery({ queryKey: ["members"], queryFn: () => api<{ members: MemberDto[] }>(`/workspaces/${getWorkspaceId()}/members`), enabled: !!s });
  const grants = useQuery({ queryKey: ["grants", s?.id], queryFn: () => api<{ id: string; userId: string | null; role: string | null; permissions: Permission[] }[]>(`/storages/${s!.id}/permissions`), enabled: !!s });
  const [target, setTarget] = useState(""); const [perms, setPerms] = useState<Set<Permission>>(new Set(["READ", "DOWNLOAD"]));
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => api(`/storages/${s!.id}/permissions`, { method: "PUT", body: { ...(target.startsWith("role:") ? { role: target.slice(5) } : { userId: target }), permissions: [...perms] } }),
    onSuccess: () => { toast.success("Hak akses disimpan"); void qc.invalidateQueries({ queryKey: ["grants", s?.id] }); }, onError: (e) => toast.error((e as Error).message),
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/storages/${s!.id}/permissions/${id}`, { method: "DELETE" }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["grants", s?.id] }) });
  const nameOf = (g: { userId: string | null; role: string | null }) => g.userId ? members.data?.members.find((m) => m.userId === g.userId)?.name ?? "Pengguna" : `Semua ${g.role === "VIEWER" ? "pembaca" : "anggota"}`;
  return (
    <Dialog open={!!s} onClose={onClose} width="max-w-lg" title={`Hak akses · ${s?.name ?? ""}`} description="Admin dan pemilik selalu punya akses penuh. Aturan khusus pengguna mengalahkan aturan peran.">
      <div className="space-y-5">
        <ul className="divide-y divide-line rounded-lg border border-line">
          {grants.data?.length ? grants.data.map((g) => (<li key={g.id} className="flex items-center gap-3 px-3 py-2 text-[13px]"><span className="flex-1"><b>{nameOf(g)}</b><span className="block text-[12px] text-muted">{g.permissions.map((p) => PERM_LABEL[p]).join(", ") || "Tidak ada akses"}</span></span><Button size="sm" variant="ghost" onClick={() => del.mutate(g.id)}>Hapus</Button></li>))
            : <li className="px-3 py-4 text-center text-[13px] text-muted">Belum ada aturan khusus. Anggota memakai izin bawaan peran.</li>}
        </ul>
        <div className="space-y-3 rounded-lg bg-surface-2 p-3">
          <Field label="Berlaku untuk">{(id) => <Select id={id} value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Pilih…</option><option value="role:MEMBER">Semua anggota</option><option value="role:VIEWER">Semua pembaca</option>{members.data?.members.filter((m) => m.role === "MEMBER" || m.role === "VIEWER").map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</Select>}</Field>
          <fieldset><legend className="mb-1.5 text-[13px] font-medium">Izin</legend><div className="grid grid-cols-2 gap-x-3 gap-y-1.5">{ALL_PERMISSIONS.map((p) => (<label key={p} className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={perms.has(p)} onChange={() => setPerms((c) => { const n = new Set(c); if (n.has(p)) n.delete(p); else n.add(p); return n; })} />{PERM_LABEL[p]}</label>))}</div></fieldset>
          <Button variant="primary" size="sm" disabled={!target} loading={save.isPending} onClick={() => save.mutate()}>Simpan aturan</Button>
        </div>
      </div>
    </Dialog>
  );
}

function StorageRow({ s, onPerms }: { s: StorageConnectionDto; onPerms(): void }) {
  const qc = useQueryClient(); const menu = useMenu(); const [busy, setBusy] = useState(false); const [rename, setRename] = useState(false); const [name, setName] = useState(s.name); const [confirm, setConfirm] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["storages"] });
  const run = async (fn: () => Promise<unknown>, ok?: string) => { setBusy(true); try { await fn(); if (ok) toast.success(ok); await refresh(); } catch (e) { toast.error((e as Error).message); await refresh(); } finally { setBusy(false); } };
  const pct = s.quota?.total && s.quota.used !== null ? Math.round((s.quota.used / s.quota.total) * 100) : null;
  const oauth = ["GOOGLE_DRIVE", "ONEDRIVE", "DROPBOX"].includes(s.provider);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid size-11 place-items-center rounded-[10px] bg-primary-soft text-primary-ink"><HardDrive className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1"><h3 className="truncate text-[15px] font-semibold">{s.name}</h3><p className="truncate text-[12px] text-muted">{PROVIDER_LABEL[s.provider]}{s.accountEmail ? ` · ${s.accountEmail}` : ""}</p></div>
        <ConnectionBadge status={s.status} />
        {s.permissions.includes("MANAGE_STORAGE") && <IconButton label="Aksi" disabled={busy} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); menu.open(r.right - 210, r.bottom + 4, [
          { label: "Uji koneksi", icon: <RefreshCw />, onSelect: () => run(() => api(`/storages/${s.id}/test`, { body: {} }), "Koneksi diperiksa") },
          { label: "Hubungkan ulang", icon: <Link2 />, hidden: !oauth, onSelect: () => run(async () => { const r = await api<{ url: string }>(`/storages/${s.id}/reconnect`, { body: {} }); location.href = r.url; }) },
          { label: "Indeks ulang pencarian", icon: <RefreshCw />, hidden: s.status !== "CONNECTED" || s.index?.status === "RUNNING", onSelect: () => run(() => api(`/storages/${s.id}/reindex`, { body: {} }), "Pengindeksan dimulai") },
          { label: "Ganti nama", onSelect: () => setRename(true) },
          { label: "Hak akses…", icon: <KeyRound />, onSelect: onPerms },
          { label: s.status === "DISABLED" ? "Aktifkan" : "Nonaktifkan", onSelect: () => run(() => api(`/storages/${s.id}`, { method: "PATCH", body: { enabled: s.status === "DISABLED" } })) },
          { label: "Putuskan koneksi", danger: true, divider: true, onSelect: () => setConfirm(true) },
        ]); }}><MoreVertical className="size-4" /></IconButton>}
      </div>
      {s.info && <p className="mt-3 truncate font-mono text-[11px] text-muted" title={s.info}>{s.info}</p>}
      {s.lastError && s.status !== "CONNECTED" && <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[12px] text-warn-ink">{s.lastError}</p>}
      <div className="mt-4 grid gap-x-8 gap-y-2 text-[12px] sm:grid-cols-3">
        <div className="sm:col-span-2">{pct !== null ? <><Progress value={pct} tone={pct > 90 ? "danger" : pct > 75 ? "warn" : "primary"} /><p className="tnum mt-1.5 text-muted">{formatBytes(s.quota!.used)} dari {formatBytes(s.quota!.total)} · {pct}%</p></> : <p className="text-muted">{s.quota?.used != null ? `${formatBytes(s.quota.used)} terpakai` : "Kapasitas tidak dilaporkan penyedia"}</p>}</div>
        <div className="text-muted"><p>Path virtual: <code className="text-ink">{s.mount?.virtualPath}</code></p><p>Terakhir terhubung {timeAgo(s.lastConnectedAt)}</p>{s.index && <p>Indeks pencarian: <span className="text-ink">{s.index.status === "RUNNING" ? `mengindeks… ${s.index.count.toLocaleString("id-ID")} item` : s.index.status === "DONE" ? `${s.index.count.toLocaleString("id-ID")} item` : s.index.status === "IDLE" ? "belum dimulai" : s.index.status === "PARTIAL" ? `sebagian (${s.index.count.toLocaleString("id-ID")} item)` : "gagal"}</span></p>}</div>
      </div>
      {menu.element}
      <Dialog open={rename} onClose={() => setRename(false)} width="max-w-sm" title="Ganti nama koneksi" footer={<><Button onClick={() => setRename(false)}>Batal</Button><Button variant="primary" onClick={() => { void run(() => api(`/storages/${s.id}`, { method: "PATCH", body: { name } }), "Nama diperbarui"); setRename(false); }}>Simpan</Button></>}>
        <Field label="Nama">{(id) => <Input id={id} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      </Dialog>
      <Dialog open={confirm} onClose={() => setConfirm(false)} width="max-w-sm" title={`Putuskan “${s.name}”?`} footer={<><Button onClick={() => setConfirm(false)}>Batal</Button><Button variant="danger" onClick={() => { void run(() => api(`/storages/${s.id}`, { method: "DELETE" }), "Koneksi diputus"); setConfirm(false); }}>Putuskan</Button></>}>
        <p className="text-[14px] text-muted">Hanya koneksi di SuperDrive yang dihapus. <b className="text-ink">File di penyedia tidak disentuh.</b> Riwayat transfer tetap tersimpan.</p>
      </Dialog>
    </Card>
  );
}

export default function StorageAdminPage() {
  const storages = useStorages(); const { isAdmin } = useWorkspace(); const [add, setAdd] = useState(false); const [perms, setPerms] = useState<StorageConnectionDto | null>(null);
  const [sp, setSp] = useSearchParams(); const qc = useQueryClient();
  useEffect(() => {
    if (sp.get("connected")) { toast.success("Penyimpanan berhasil dihubungkan"); void qc.invalidateQueries({ queryKey: ["storages"] }); setSp({}, { replace: true }); }
    else if (sp.get("error")) { toast.error(sp.get("error")!); setSp({}, { replace: true }); }
  }, [sp, setSp, qc]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Penyimpanan" subtitle="Akun cloud dan penyimpanan eksternal yang terhubung ke workspace ini." actions={isAdmin ? <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={() => setAdd(true)}>Tambah penyimpanan</Button> : undefined} />
      <div className="scroll-thin flex-1 overflow-y-auto p-4 sm:p-8">
        {storages.isLoading ? <Skeleton className="h-40" /> : !storages.data?.length
          ? <EmptyState icon={HardDrive} title="Belum ada penyimpanan terhubung" action={isAdmin ? <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdd(true)}>Tambah penyimpanan</Button> : undefined}>{isAdmin ? "Hubungkan akun cloud atau folder server untuk mulai." : "Minta admin workspace menghubungkan penyimpanan."}</EmptyState>
          : <div className="mx-auto grid max-w-4xl gap-4">{storages.data.map((s) => <StorageRow key={s.id} s={s} onPerms={() => setPerms(s)} />)}</div>}
      </div>
      <AddStorageDialog open={add} onClose={() => setAdd(false)} />
      <PermissionsDialog s={perms} onClose={() => setPerms(null)} />
    </div>
  );
}
