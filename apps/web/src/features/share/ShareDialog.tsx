import type { FileEntry, ShareLinkDto } from "@superdrive/shared";
import { formatBytes } from "@superdrive/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, KeyRound, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dateTime } from "@/lib/format";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input, Select } from "@/ui/Field";
import { Skeleton } from "@/ui/misc";

type Role = "VIEWER" | "EDITOR";
const EXPIRY = [["", "Tanpa batas waktu"], ["1", "1 hari"], ["7", "7 hari"], ["30", "30 hari"], ["90", "90 hari"]] as const;
const ROLE_HELP: Record<Role, string> = { VIEWER: "Bisa melihat, memutar, dan mengunduh. Tidak bisa mengubah apa pun.", EDITOR: "Bisa mengunggah, membuat folder, mengganti nama, dan menghapus di dalam folder ini." };

function RoleSelect({ value, isFolder, onChange, label }: { value: Role; isFolder: boolean; onChange(r: Role): void; label: string }) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as Role)} className="h-9 text-[13px]">
      <option value="VIEWER">Penonton</option>
      <option value="EDITOR" disabled={!isFolder}>{isFolder ? "Editor" : "Editor (hanya folder)"}</option>
    </Select>
  );
}

function LinkRow({ link, onChanged }: { link: ShareLinkDto; onChanged(): void }) {
  const [title, setTitle] = useState(link.title ?? ""); const [copied, setCopied] = useState(false); const [edit, setEdit] = useState(false);
  const [days, setDays] = useState(""); const [pw, setPw] = useState(""); const [mb, setMb] = useState(link.maxUploadBytes ? String(Math.round(link.maxUploadBytes / 1048576)) : "");
  const update = useMutation({
    mutationFn: (body: object) => api<ShareLinkDto>(`/shares/${link.id}`, { method: "PATCH", body }),
    onSuccess: () => { setPw(""); onChanged(); }, onError: (e) => { toast.error((e as Error).message); setTitle(link.title ?? ""); },
  });
  const revoke = useMutation({ mutationFn: () => api(`/shares/${link.id}`, { method: "DELETE" }), onSuccess: () => { toast.success("Tautan dimatikan"); onChanged(); } });
  const copy = async () => { await navigator.clipboard.writeText(link.url); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const editor = link.role === "EDITOR"; const Icon = editor ? Pencil : Eye;
  const saveTitle = () => { if (title.trim() !== (link.title ?? "")) update.mutate({ title: title.trim() || null }, { onSuccess: () => toast.success("Judul disimpan") }); };

  return (
    <section className="space-y-3 rounded-xl border border-line p-3 sm:p-4" aria-label={link.title ? `Tautan untuk ${link.title}` : "Tautan tanpa judul"}>
      <div className="flex items-start gap-2.5">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", editor ? "bg-warn-soft text-warn-ink" : "bg-primary-soft text-primary-ink")}><Icon className="size-[18px]" aria-hidden /></span>
        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
          <Input aria-label="Judul tautan: untuk siapa" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} placeholder="Untuk siapa? mis. Pak Budi, Tim audit" className="h-9 text-[14px] font-medium" />
          <RoleSelect label="Izin tautan" value={link.role} isFolder={link.isFolder} onChange={(role) => update.mutate({ role }, { onSuccess: () => toast.success(role === "EDITOR" ? "Izin diubah: editor" : "Izin diubah: penonton") })} />
        </div>
      </div>
      <p className="text-[12px] text-muted">{ROLE_HELP[link.role]} Perubahan izin langsung berlaku, juga untuk orang yang sudah membuka tautan ini.</p>
      <div className="flex gap-2"><Input readOnly value={link.url} aria-label="Alamat tautan" onFocus={(e) => e.currentTarget.select()} className="h-9 font-mono text-[12px]" />
        <Button size="sm" variant="primary" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={copy}>{copied ? "Tersalin" : "Salin"}</Button></div>
      <p className="tnum text-[12px] text-muted">{link.accessCount} kali dibuka{link.lastAccessAt ? ` · terakhir ${dateTime(link.lastAccessAt)}` : ""} · {link.expiresAt ? `berlaku sampai ${dateTime(link.expiresAt)}` : "tanpa batas waktu"}{link.hasPassword ? " · dilindungi sandi" : ""}
        {editor && link.maxUploadBytes ? ` · kuota ${formatBytes(link.uploadedBytes)} / ${formatBytes(link.maxUploadBytes)}` : ""}</p>
      {edit ? (
        <div className="grid gap-2 rounded-lg bg-surface-2 p-3 sm:grid-cols-2">
          <label className="text-[12px] text-muted">Masa berlaku<Select value={days} onChange={(e) => setDays(e.target.value)} className="mt-1 h-9">{[["", link.expiresAt ? "Tidak diubah" : "Tanpa batas waktu"], ...EXPIRY.filter(([v]) => v), ["0", "Hapus batas waktu"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></label>
          <label className="text-[12px] text-muted">Kata sandi baru<Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={link.hasPassword ? "Kosong = tidak diubah" : "Opsional"} className="mt-1 h-9" /></label>
          {editor && <label className="text-[12px] text-muted sm:col-span-2">Kuota unggahan (MB)<Input inputMode="numeric" value={mb} onChange={(e) => setMb(e.target.value)} placeholder="Tanpa batas" className="mt-1 h-9" /></label>}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button size="sm" variant="primary" loading={update.isPending} onClick={() => update.mutate({ ...(days !== "" ? { expiresInDays: days === "0" ? null : Number(days) } : {}), ...(pw ? { password: pw } : {}), ...(editor ? { maxUploadMb: mb ? Number(mb) : null } : {}) }, { onSuccess: () => { toast.success("Pengaturan disimpan"); setEdit(false); setDays(""); } })}>Simpan</Button>
            {link.hasPassword && <Button size="sm" onClick={() => update.mutate({ password: null }, { onSuccess: () => toast.success("Sandi dihapus") })}>Hapus sandi</Button>}
            <Button size="sm" variant="ghost" onClick={() => setEdit(false)}>Batal</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<KeyRound className="size-3.5" />} onClick={() => setEdit(true)}>Sandi, masa berlaku</Button>
          <Button size="sm" variant="ghost" className="text-danger-ink hover:bg-danger-soft" icon={<Trash2 className="size-3.5" />} loading={revoke.isPending} onClick={() => { if (confirm(`Matikan tautan${link.title ? ` untuk ${link.title}` : ""}? Siapa pun yang memegangnya langsung tidak bisa membuka.`)) revoke.mutate(); }}>Matikan</Button>
        </div>
      )}
    </section>
  );
}

function NewLink({ storageId, file, first, onCreated }: { storageId: string; file: FileEntry; first: boolean; onCreated(): void }) {
  const [open, setOpen] = useState(first); const [title, setTitle] = useState(""); const [role, setRole] = useState<Role>("VIEWER"); const [days, setDays] = useState(""); const [pw, setPw] = useState(""); const [mb, setMb] = useState("");
  const create = useMutation({
    mutationFn: () => api<ShareLinkDto>("/shares", { body: { storageId, fileId: file.id, role, newLink: true, title: title.trim() || null, expiresInDays: days ? Number(days) : null, password: pw || null, maxUploadMb: role === "EDITOR" && mb ? Number(mb) : null } }),
    onSuccess: () => { setTitle(""); setPw(""); setMb(""); setRole("VIEWER"); setOpen(false); onCreated(); }, onError: (e) => toast.error((e as Error).message),
  });
  if (!open) return <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Buat tautan baru</Button>;
  return (
    <form className="space-y-3 rounded-xl border border-dashed border-line-strong p-3 sm:p-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }} aria-label="Buat tautan baru">
      <h3 className="text-[14px] font-semibold">Tautan baru</h3>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
        <label className="text-[12px] text-muted">Untuk siapa (judul)<Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="mis. Pak Budi, Tim audit" className="mt-1 h-9" /></label>
        <label className="text-[12px] text-muted">Izin<RoleSelect label="Izin" value={role} isFolder={file.isFolder} onChange={setRole} /></label>
        <label className="text-[12px] text-muted">Masa berlaku<Select value={days} onChange={(e) => setDays(e.target.value)} className="mt-1 h-9">{EXPIRY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></label>
        <label className="text-[12px] text-muted">Kata sandi (opsional)<Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className="mt-1 h-9" /></label>
        {role === "EDITOR" && <label className="text-[12px] text-muted sm:col-span-2">Kuota unggahan, MB (opsional)<Input inputMode="numeric" value={mb} onChange={(e) => setMb(e.target.value)} placeholder="Tanpa batas" className="mt-1 h-9" /></label>}
      </div>
      <p className="text-[12px] text-muted">{ROLE_HELP[role]} Izin bisa diubah nanti.</p>
      <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" size="sm" icon={<Link2 className="size-4" />} loading={create.isPending}>Buat tautan</Button>{!first && <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Batal</Button>}</div>
    </form>
  );
}

export function ShareDialog({ open, storageId, file, onClose }: { open: boolean; storageId: string; file: FileEntry | null; onClose(): void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["shares", storageId, file?.id], queryFn: () => api<ShareLinkDto[]>(`/shares?storageId=${storageId}&fileId=${encodeURIComponent(file!.id)}`), enabled: open && !!file, staleTime: 0 });
  const changed = () => { void q.refetch(); void qc.invalidateQueries({ queryKey: ["shares-all"] }); };
  return (
    <Dialog open={open && !!file} onClose={onClose} width="max-w-xl" title={`Bagikan “${file?.name ?? ""}”`} description="Siapa pun yang memegang tautan bisa membukanya tanpa akun. Buat satu tautan per penerima supaya bisa dimatikan sendiri-sendiri.">
      {file && (q.isLoading ? <Skeleton className="h-48" /> : q.error ? <p className="text-[13px] text-danger-ink">{(q.error as Error).message}</p> : (
        <div className="space-y-3">
          {q.data?.map((l) => <LinkRow key={l.id} link={l} onChanged={changed} />)}
          <NewLink key={q.data?.length ?? 0} storageId={storageId} file={file} first={!q.data?.length} onCreated={changed} />
        </div>))}
    </Dialog>
  );
}
