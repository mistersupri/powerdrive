import type { FileEntry, ShareLinkDto } from "@superdrive/shared";
import { formatBytes } from "@superdrive/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, KeyRound, Link2, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input, Select } from "@/ui/Field";
import { Skeleton } from "@/ui/misc";

type Role = "VIEWER" | "EDITOR";
const EXPIRY = [["", "Tanpa batas waktu"], ["1", "1 hari"], ["7", "7 hari"], ["30", "30 hari"], ["90", "90 hari"]] as const;

function LinkCard({ role, link, storageId, file, onChanged }: { role: Role; link?: ShareLinkDto; storageId: string; file: FileEntry; onChanged(): void }) {
  const [days, setDays] = useState(""); const [pw, setPw] = useState(""); const [mb, setMb] = useState(""); const [copied, setCopied] = useState(false); const [edit, setEdit] = useState(false);
  const editor = role === "EDITOR"; const Icon = editor ? Pencil : Eye;
  const disabled = editor && !file.isFolder;
  const create = useMutation({
    mutationFn: (regenerate: boolean) => api<ShareLinkDto>("/shares", { body: { storageId, fileId: file.id, role, regenerate, expiresInDays: days ? Number(days) : null, password: pw || null, maxUploadMb: editor && mb ? Number(mb) : null } }),
    onSuccess: () => { setPw(""); onChanged(); }, onError: (e) => toast.error((e as Error).message),
  });
  const update = useMutation({
    mutationFn: (body: object) => api<ShareLinkDto>(`/shares/${link!.id}`, { method: "PATCH", body }),
    onSuccess: () => { toast.success("Pengaturan tautan disimpan"); setPw(""); setEdit(false); onChanged(); }, onError: (e) => toast.error((e as Error).message),
  });
  const revoke = useMutation({ mutationFn: () => api(`/shares/${link!.id}`, { method: "DELETE" }), onSuccess: () => { toast.success("Tautan dimatikan"); onChanged(); } });
  const copy = async () => { await navigator.clipboard.writeText(link!.url); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return (
    <section className="rounded-xl border border-line p-4">
      <div className="flex items-center gap-2.5">
        <span className={`grid size-9 place-items-center rounded-lg ${editor ? "bg-warn-soft text-warn-ink" : "bg-primary-soft text-primary-ink"}`}><Icon className="size-[18px]" aria-hidden /></span>
        <div className="min-w-0 flex-1"><h3 className="text-[14px] font-semibold">{editor ? "Tautan editor" : "Tautan penonton"}</h3>
          <p className="text-[12px] text-muted">{editor ? "Bisa mengunggah, membuat folder, mengganti nama, dan menghapus di dalam folder ini." : "Bisa melihat, memutar, dan mengunduh. Tidak bisa mengubah apa pun."}</p></div>
      </div>
      {disabled ? <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-muted">Tautan editor hanya tersedia untuk folder.</p>
        : link ? (
          <div className="mt-3 space-y-3">
            <div className="flex gap-2"><Input readOnly value={link.url} aria-label={`Tautan ${editor ? "editor" : "penonton"}`} onFocus={(e) => e.currentTarget.select()} className="h-9 font-mono text-[12px]" />
              <Button size="sm" variant="primary" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={copy}>{copied ? "Tersalin" : "Salin"}</Button></div>
            <p className="tnum text-[12px] text-muted">{link.accessCount} kali dibuka{link.lastAccessAt ? ` · terakhir ${dateTime(link.lastAccessAt)}` : ""} · {link.expiresAt ? `berlaku sampai ${dateTime(link.expiresAt)}` : "tanpa batas waktu"}{link.hasPassword ? " · dilindungi sandi" : ""}
              {editor && link.maxUploadBytes ? ` · kuota ${formatBytes(link.uploadedBytes)} / ${formatBytes(link.maxUploadBytes)}` : ""}</p>
            {edit ? (
              <div className="grid gap-2 rounded-lg bg-surface-2 p-3 sm:grid-cols-2">
                <label className="text-[12px] text-muted">Masa berlaku<Select value={days} onChange={(e) => setDays(e.target.value)} className="mt-1 h-9">{EXPIRY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></label>
                <label className="text-[12px] text-muted">Kata sandi baru<Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={link.hasPassword ? "Biarkan kosong = tidak diubah" : "Opsional"} className="mt-1 h-9" /></label>
                {editor && <label className="text-[12px] text-muted">Kuota unggahan (MB)<Input inputMode="numeric" value={mb} onChange={(e) => setMb(e.target.value)} placeholder="Tanpa batas" className="mt-1 h-9" /></label>}
                <div className="flex items-end gap-2 sm:col-span-2"><Button size="sm" variant="primary" loading={update.isPending} onClick={() => update.mutate({ expiresInDays: days ? Number(days) : null, ...(pw ? { password: pw } : {}), ...(editor ? { maxUploadMb: mb ? Number(mb) : null } : {}) })}>Simpan</Button>
                  {link.hasPassword && <Button size="sm" onClick={() => update.mutate({ password: null })}>Hapus sandi</Button>}<Button size="sm" variant="ghost" onClick={() => setEdit(false)}>Batal</Button></div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2"><Button size="sm" icon={<KeyRound className="size-3.5" />} onClick={() => { setEdit(true); setDays(""); setMb(link.maxUploadBytes ? String(Math.round(link.maxUploadBytes / 1048576)) : ""); }}>Pengaturan</Button>
                <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={create.isPending} onClick={() => { if (confirm("Buat tautan baru? Tautan lama langsung berhenti berfungsi.")) create.mutate(true); }}>Buat ulang</Button>
                <Button size="sm" variant="ghost" className="text-danger-ink hover:bg-danger-soft" icon={<Trash2 className="size-3.5" />} loading={revoke.isPending} onClick={() => revoke.mutate()}>Matikan tautan</Button></div>)}
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[12px] text-muted">Masa berlaku<Select value={days} onChange={(e) => setDays(e.target.value)} className="mt-1 h-9">{EXPIRY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></label>
              <label className="text-[12px] text-muted">Kata sandi (opsional)<Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className="mt-1 h-9" /></label>
              {editor && <label className="text-[12px] text-muted sm:col-span-2">Kuota unggahan, MB (opsional)<Input inputMode="numeric" value={mb} onChange={(e) => setMb(e.target.value)} placeholder="Tanpa batas" className="mt-1 h-9" /></label>}
            </div>
            <Button variant="primary" size="sm" icon={<Link2 className="size-4" />} loading={create.isPending} onClick={() => create.mutate(false)}>Buat tautan {editor ? "editor" : "penonton"}</Button>
          </div>)}
    </section>
  );
}

export function ShareDialog({ open, storageId, file, onClose }: { open: boolean; storageId: string; file: FileEntry | null; onClose(): void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["shares", storageId, file?.id], queryFn: () => api<ShareLinkDto[]>(`/shares?storageId=${storageId}&fileId=${encodeURIComponent(file!.id)}`), enabled: open && !!file, staleTime: 0 });
  const changed = () => { void q.refetch(); void qc.invalidateQueries({ queryKey: ["shares-all"] }); };
  return (
    <Dialog open={open && !!file} onClose={onClose} width="max-w-xl" title={`Bagikan “${file?.name ?? ""}”`} description="Siapa pun yang memegang tautan bisa membukanya tanpa akun. Bagikan hanya ke orang yang tepat.">
      {file && (q.isLoading ? <Skeleton className="h-48" /> : (
        <div className="space-y-3">
          <LinkCard role="VIEWER" link={q.data?.find((l) => l.role === "VIEWER")} storageId={storageId} file={file} onChanged={changed} />
          <LinkCard role="EDITOR" link={q.data?.find((l) => l.role === "EDITOR")} storageId={storageId} file={file} onChanged={changed} />
        </div>))}
    </Dialog>
  );
}
