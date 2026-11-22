import type { AutomationAction, AutomationDto, AutomationFileKind, AutomationRunDto, AutomationTrigger } from "@superdrive/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyCheck, Eraser, Eye, History, Pencil, Play, Plus, Trash2, Wand2, X, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dateTime, timeAgo } from "@/lib/format";
import { useWorkspace } from "@/features/auth/useAuth";
import { PageHeader, useStorages } from "@/features/layout/Shell";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, Input, Select } from "@/ui/Field";
import { Badge, Card, EmptyState, Skeleton } from "@/ui/misc";
import { DAYS, describeAction, describeConditions, describeTrigger, EVENT_LABEL, KIND_LABEL, localToUtc, utcToLocal } from "./describe";
import { FolderPicker, type Picked } from "./FolderPicker";

/* ---------- the form's own shape, kept flat so every field is a plain input ---------- */
interface Draft {
  name: string; enabled: boolean; trigger: AutomationTrigger["type"]; every: "minutes" | "hourly" | "daily" | "weekly"; n: string; at: string; weekday: number; event: keyof typeof EVENT_LABEL;
  storageId: string; folderId: string | null; folderLabel: string; recursive: boolean;
  cond: { name: string; ext: string; kinds: AutomationFileKind[]; minMb: string; maxMb: string; olderDays: string };
  actions: AutomationAction[];
}
const blank = (storageId = ""): Draft => ({ name: "", enabled: true, trigger: "file.created", every: "daily", n: "15", at: "02:00", weekday: 0, event: "transfer.failed", storageId, folderId: null, folderLabel: "", recursive: true, cond: { name: "", ext: "", kinds: [], minMb: "", maxMb: "", olderDays: "" }, actions: [] });
const TEMPLATES = [
  { key: "sort", icon: Wand2, title: "Rapikan file yang masuk", text: "Saat file baru masuk ke sebuah folder, pindahkan atau beri tag sesuai jenisnya.", make: (d: Draft): Draft => ({ ...d, name: "Rapikan file masuk", trigger: "file.created", actions: [] }) },
  { key: "backup", icon: CopyCheck, title: "Cadangan terjadwal", text: "Salin isi sebuah folder ke penyimpanan lain secara berkala. Yang sudah ada dilewati.", make: (d: Draft): Draft => ({ ...d, name: "Cadangan terjadwal", trigger: "schedule", every: "daily", at: "02:00", actions: [{ type: "copy", storageId: "", folderId: "root", mirror: true }] }) },
  { key: "clean", icon: Eraser, title: "Bersihkan file lama", text: "Pindahkan file yang lebih tua dari sekian hari ke sampah. Masih bisa dipulihkan dari Sampah.", make: (d: Draft): Draft => ({ ...d, name: "Bersihkan file lama", trigger: "schedule", every: "daily", at: "03:00", cond: { ...d.cond, olderDays: "30" }, actions: [{ type: "trash" }] }) },
  { key: "tell", icon: Zap, title: "Kabari saya", text: "Kirim notifikasi (atau webhook, untuk admin) saat ada file baru atau kejadian penting.", make: (d: Draft): Draft => ({ ...d, name: "Kabari saya", trigger: "file.created", actions: [{ type: "notify", message: "File baru: {name}" }] }) },
];

function toInput(d: Draft) {
  const trigger: AutomationTrigger = d.trigger === "file.created" ? { type: "file.created" } : d.trigger === "event" ? { type: "event", event: d.event }
    : d.every === "minutes" ? { type: "schedule", every: "minutes", n: Number(d.n) || 15 } : d.every === "hourly" ? { type: "schedule", every: "hourly" }
    : d.every === "daily" ? { type: "schedule", every: "daily", at: localToUtc(d.at).at } : { type: "schedule", every: "weekly", ...localToUtc(d.at, d.weekday) };
  const mb = (v: string) => (v.trim() && !isNaN(Number(v)) ? Math.round(Number(v) * 1_048_576) : undefined);
  const days = d.cond.olderDays.trim() && !isNaN(Number(d.cond.olderDays)) ? Math.round(Number(d.cond.olderDays)) : undefined;
  return {
    name: d.name.trim(), enabled: d.enabled, storageId: d.trigger === "event" ? null : d.storageId || null, folderId: d.trigger === "event" ? null : d.folderId, recursive: d.recursive, trigger,
    conditions: d.trigger === "event" ? {} : { name: d.cond.name.trim() || undefined, ext: d.cond.ext.split(/[,\s]+/).map((e) => e.replace(/^\./, "").toLowerCase()).filter(Boolean) || undefined, kinds: d.cond.kinds.length ? d.cond.kinds : undefined, minSize: mb(d.cond.minMb), maxSize: mb(d.cond.maxMb), olderThanDays: days },
    actions: d.actions,
  };
}
function fromDto(a: AutomationDto): Draft {
  const t = a.trigger; const c = a.conditions; const l = t.type === "schedule" && (t.every === "daily" || t.every === "weekly") ? utcToLocal(t.at ?? "02:00", t.weekday) : null;
  return {
    ...blank(a.storageId ?? ""), name: a.name, enabled: a.enabled, trigger: t.type, every: t.type === "schedule" ? t.every : "daily", n: String(t.type === "schedule" ? t.n ?? 15 : 15), at: l?.at ?? "02:00", weekday: l?.weekday ?? 0,
    event: t.type === "event" ? t.event : "transfer.failed", folderId: a.folderId, folderLabel: a.storageName ? `${a.storageName}${a.folderPath && a.folderPath !== "/" ? ` · ${a.folderPath}` : ""}` : "", recursive: a.recursive,
    cond: { name: c.name ?? "", ext: (c.ext ?? []).join(", "), kinds: c.kinds ?? [], minMb: c.minSize !== undefined ? String(Math.round(c.minSize / 1_048_576)) : "", maxMb: c.maxSize !== undefined ? String(Math.round(c.maxSize / 1_048_576)) : "", olderDays: c.olderThanDays !== undefined ? String(c.olderThanDays) : "" },
    actions: a.actions,
  };
}

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "neutral" }> = { OK: { label: "Berhasil", tone: "ok" }, PARTIAL: { label: "Sebagian", tone: "warn" }, FAILED: { label: "Gagal", tone: "danger" }, DENIED: { label: "Ditolak", tone: "danger" }, SKIPPED: { label: "Dilewati", tone: "neutral" }, RUNNING: { label: "Berjalan", tone: "neutral" } };

/* ---------- create / edit ---------- */
function AutomationDialog({ open, edit, onClose }: { open: boolean; edit: AutomationDto | null; onClose(): void }) {
  const qc = useQueryClient(); const { isAdmin } = useWorkspace(); const storages = useStorages().data ?? [];
  const home = storages.find((s) => s.isDefault)?.id ?? storages[0]?.id ?? "";
  const [d, setD] = useState<Draft>(blank()); const [step, setStep] = useState<"pick" | "form">("pick"); const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<null | { kind: "scope" } | { kind: "action"; index: number }>(null); const [seen, setSeen] = useState<string | null>(null);
  const key = open ? (edit?.id ?? "new") : null;
  if (key !== seen) { setSeen(key); if (open) { setD(edit ? fromDto(edit) : blank(home)); setStep(edit ? "form" : "pick"); } }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((s) => ({ ...s, [k]: v }));
  const setCond = (k: keyof Draft["cond"], v: string | AutomationFileKind[]) => setD((s) => ({ ...s, cond: { ...s.cond, [k]: v } }));
  const fileBased = d.trigger !== "event";
  const addAction = (type: string) => {
    const a: AutomationAction = type === "tag" ? { type: "tag", tag: "" } : type === "notify" ? { type: "notify", message: "" } : type === "webhook" ? { type: "webhook", url: "" } : type === "move" || type === "copy" ? { type, storageId: "", folderId: "root" } : ({ type } as AutomationAction);
    set("actions", [...d.actions, a]);
  };
  const setAction = (i: number, a: AutomationAction) => set("actions", d.actions.map((x, k) => (k === i ? a : x)));
  const pick = (p: Picked) => {
    if (picker?.kind === "scope") setD((s) => ({ ...s, storageId: p.storageId, folderId: p.folderId === "root" ? null : p.folderId, folderLabel: p.label }));
    else if (picker?.kind === "action") { const x = d.actions[picker.index]; if (x && (x.type === "move" || x.type === "copy")) setAction(picker.index, { ...x, storageId: p.storageId, folderId: p.folderId, label: p.label }); }
  };
  const save = async () => {
    setBusy(true);
    try {
      await api(edit ? `/automations/${edit.id}` : "/automations", { method: edit ? "PUT" : "POST", body: toInput(d) });
      toast.success(edit ? "Otomasi disimpan" : "Otomasi dibuat"); await qc.invalidateQueries({ queryKey: ["automations"] }); onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const mirror = d.actions.some((a) => a.type === "copy" && a.mirror);
  return (
    <Dialog open={open} onClose={onClose} width="max-w-2xl" title={edit ? "Ubah otomasi" : step === "pick" ? "Buat otomasi" : "Otomasi baru"} description={step === "pick" ? "Pilih yang paling dekat dengan kebutuhan Anda. Semuanya bisa diubah di langkah berikutnya." : undefined}
      footer={step === "form" ? <><Button onClick={onClose}>Batal</Button><Button variant="primary" loading={busy} disabled={!d.name.trim() || d.actions.length === 0} onClick={save}>{edit ? "Simpan" : "Buat otomasi"}</Button></> : undefined}>
      {step === "pick" ? (
        <div className="grid gap-3 sm:grid-cols-2">{TEMPLATES.map((t) => (
          <button key={t.key} type="button" onClick={() => { setD(t.make(blank(home))); setStep("form"); }} className="flex gap-3 rounded-xl border border-line p-4 text-left transition-colors hover:border-primary hover:bg-primary-soft/40">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-ink"><t.icon className="size-5" aria-hidden /></span>
            <span><span className="block text-[14px] font-semibold">{t.title}</span><span className="mt-0.5 block text-[12.5px] text-muted">{t.text}</span></span>
          </button>))}</div>
      ) : (
        <div className="space-y-6">
          <Field label="Nama">{(id) => <Input id={id} value={d.name} maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder="mis. Rapikan unduhan" />}</Field>

          <section className="space-y-3"><h3 className="text-[13px] font-semibold">Kapan</h3>
            <Select aria-label="Pemicu" value={d.trigger} onChange={(e) => set("trigger", e.target.value as Draft["trigger"])}>
              <option value="file.created">Saat file baru masuk</option><option value="schedule">Sesuai jadwal</option>{isAdmin && <option value="event">Saat ada kejadian (admin)</option>}
            </Select>
            {d.trigger === "schedule" && <div className="grid gap-3 sm:grid-cols-3">
              <Select aria-label="Seberapa sering" value={d.every} onChange={(e) => set("every", e.target.value as Draft["every"])}><option value="minutes">Setiap beberapa menit</option><option value="hourly">Setiap jam</option><option value="daily">Setiap hari</option><option value="weekly">Setiap minggu</option></Select>
              {d.every === "minutes" && <Input aria-label="Menit" inputMode="numeric" value={d.n} onChange={(e) => set("n", e.target.value)} placeholder="15" />}
              {d.every === "weekly" && <Select aria-label="Hari" value={d.weekday} onChange={(e) => set("weekday", Number(e.target.value))}>{DAYS.map((x, i) => <option key={x} value={i}>{x}</option>)}</Select>}
              {(d.every === "daily" || d.every === "weekly") && <Input aria-label="Pukul" type="time" value={d.at} onChange={(e) => set("at", e.target.value)} />}
            </div>}
            {d.trigger === "event" && <Select aria-label="Kejadian" value={d.event} onChange={(e) => set("event", e.target.value as Draft["event"])}>{Object.entries(EVENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}
          </section>

          {fileBased && <section className="space-y-3"><h3 className="text-[13px] font-semibold">Di mana</h3>
            <div className="flex items-center gap-2"><div className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px]">{d.folderLabel || (d.storageId ? `${storages.find((s) => s.id === d.storageId)?.name ?? ""} (seluruh penyimpanan)` : "Belum dipilih")}</div><Button onClick={() => setPicker({ kind: "scope" })}>Pilih folder…</Button></div>
            {!mirror && <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={d.recursive} onChange={(e) => set("recursive", e.target.checked)} />Termasuk folder di bawahnya</label>}
          </section>}

          {fileBased && !mirror && <section className="space-y-3"><h3 className="text-[13px] font-semibold">File yang cocok <span className="font-normal text-muted">(kosongkan untuk semua)</span></h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nama mengandung">{(id) => <Input id={id} value={d.cond.name} onChange={(e) => setCond("name", e.target.value)} placeholder="mis. laporan" />}</Field>
              <Field label="Ekstensi" hint="Pisahkan dengan koma">{(id) => <Input id={id} value={d.cond.ext} onChange={(e) => setCond("ext", e.target.value)} placeholder="pdf, docx" />}</Field>
            </div>
            <div role="group" aria-label="Jenis file" className="flex flex-wrap gap-1.5">{(Object.keys(KIND_LABEL) as AutomationFileKind[]).map((k) => { const on = d.cond.kinds.includes(k); return <button key={k} type="button" aria-pressed={on} onClick={() => setCond("kinds", on ? d.cond.kinds.filter((x) => x !== k) : [...d.cond.kinds, k])} className={cn("h-8 rounded-full px-3 text-[13px] font-medium", on ? "bg-primary-soft text-primary-ink" : "bg-surface-2 text-muted hover:text-ink")}>{KIND_LABEL[k]}</button>; })}</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Ukuran minimal (MB)">{(id) => <Input id={id} inputMode="decimal" value={d.cond.minMb} onChange={(e) => setCond("minMb", e.target.value)} />}</Field>
              <Field label="Ukuran maksimal (MB)">{(id) => <Input id={id} inputMode="decimal" value={d.cond.maxMb} onChange={(e) => setCond("maxMb", e.target.value)} />}</Field>
              <Field label="Lebih lama dari (hari)">{(id) => <Input id={id} inputMode="numeric" value={d.cond.olderDays} onChange={(e) => setCond("olderDays", e.target.value)} />}</Field>
            </div>
          </section>}

          <section className="space-y-3"><h3 className="text-[13px] font-semibold">Lakukan</h3>
            <ul className="space-y-2">{d.actions.map((a, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2.5">
                <span className="min-w-[8rem] text-[13px] font-medium">{describeAction(a).split(" ke ")[0]!.split(" “")[0]}</span>
                {(a.type === "move" || a.type === "copy") && <><span className="min-w-0 flex-1 truncate text-[13px] text-muted">{a.label ?? "Pilih folder tujuan"}</span><Button size="sm" onClick={() => setPicker({ kind: "action", index: i })}>Pilih folder…</Button></>}
                {a.type === "copy" && d.trigger === "schedule" && <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={!!a.mirror} onChange={(e) => setAction(i, { ...a, mirror: e.target.checked })} />Sinkronkan (hanya yang belum ada)</label>}
                {a.type === "tag" && <Input aria-label="Tag" className="h-8 min-w-0 flex-1" value={a.tag} onChange={(e) => setAction(i, { ...a, tag: e.target.value })} placeholder="nama tag, bisa memakai {name}" />}
                {a.type === "notify" && <Input aria-label="Pesan" className="h-8 min-w-0 flex-1" value={a.message ?? ""} onChange={(e) => setAction(i, { ...a, message: e.target.value })} placeholder="Pesan, mis. File baru: {name}" />}
                {a.type === "webhook" && <><Input aria-label="Alamat webhook" className="h-8 min-w-0 flex-[2]" value={a.url} onChange={(e) => setAction(i, { ...a, url: e.target.value })} placeholder="https://…" /><Input aria-label="Rahasia tanda tangan" className="h-8 min-w-0 flex-1" type="password" value={a.secret ?? ""} onChange={(e) => setAction(i, { ...a, secret: e.target.value })} placeholder="Rahasia (opsional)" /></>}
                <button type="button" aria-label="Hapus aksi" className="ml-auto grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-danger-ink" onClick={() => set("actions", d.actions.filter((_, k) => k !== i))}><X className="size-4" /></button>
              </li>))}</ul>
            <Select aria-label="Tambah aksi" value="" onChange={(e) => { if (e.target.value) addAction(e.target.value); }}>
              <option value="">+ Tambah aksi…</option>
              {fileBased && <><option value="move">Pindahkan ke folder lain</option><option value="copy">Salin ke folder lain</option><option value="tag">Beri tag</option><option value="star">Beri bintang</option><option value="trash">Pindahkan ke sampah</option></>}
              <option value="notify">Kirim notifikasi</option>{isAdmin && <option value="webhook">Kirim webhook</option>}
            </Select>
            <p className="text-[12px] text-muted">Otomasi hanya bisa melakukan apa yang bisa Anda lakukan sendiri, dan dicek lagi setiap kali berjalan. Memindahkan atau menghapus harus jadi aksi terakhir. Pesan bisa memakai {"{name}"}, {"{path}"}, {"{size}"}.</p>
          </section>
        </div>)}
      <FolderPicker open={picker !== null} title={picker?.kind === "scope" ? "Folder yang dipantau" : "Folder tujuan"} writable={picker?.kind === "action"} initial={picker?.kind === "action" && d.actions[picker.index] && "storageId" in d.actions[picker.index]! ? { storageId: (d.actions[picker.index] as { storageId: string }).storageId || undefined } : { storageId: d.storageId || undefined }} onPick={pick} onClose={() => setPicker(null)} />
    </Dialog>
  );
}

/* ---------- run history ---------- */
function RunsDialog({ a, onClose }: { a: AutomationDto | null; onClose(): void }) {
  const q = useQuery({ queryKey: ["automation-runs", a?.id], queryFn: () => api<AutomationRunDto[]>(`/automations/${a!.id}/runs`), enabled: !!a, refetchInterval: 5000 });
  return (
    <Dialog open={!!a} onClose={onClose} width="max-w-xl" title={`Riwayat · ${a?.name ?? ""}`}>
      {q.isLoading ? <Skeleton className="h-32" /> : !q.data?.length ? <p className="py-6 text-center text-[13px] text-muted">Belum pernah berjalan.</p> : (
        <ul className="divide-y divide-line">{q.data.map((r) => { const s = STATUS[r.status] ?? STATUS.OK!; return (
          <li key={r.id} className="space-y-1 py-2.5"><div className="flex flex-wrap items-center gap-2"><Badge tone={s.tone}>{s.label}</Badge><span className="text-[12px] text-muted">{dateTime(r.startedAt)} · {r.trigger === "event" ? "karena kejadian" : r.trigger === "schedule" ? "sesuai jadwal" : "dijalankan manual"}{r.dryRun ? " · pratinjau" : ""}</span><span className="tnum ml-auto text-[12px] text-muted">{r.acted}/{r.matched}</span></div>{r.message && <p className="text-[13px] break-words">{r.message}</p>}</li>); })}</ul>)}
    </Dialog>
  );
}

/* ---------- page ---------- */
export default function AutomationsPage() {
  const qc = useQueryClient(); const list = useQuery({ queryKey: ["automations"], queryFn: () => api<AutomationDto[]>("/automations"), refetchInterval: 10_000 });
  const [editing, setEditing] = useState<AutomationDto | null | "new">(null); const [runs, setRuns] = useState<AutomationDto | null>(null); const [del, setDel] = useState<AutomationDto | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["automations"] });
  const toggle = useMutation({ mutationFn: (a: AutomationDto) => api(`/automations/${a.id}/enabled`, { method: "PATCH", body: { enabled: !a.enabled } }), onSuccess: refresh, onError: (e) => toast.error((e as Error).message) });
  const run = useMutation({ mutationFn: (v: { a: AutomationDto; dryRun: boolean }) => api<AutomationRunDto>(`/automations/${v.a.id}/run`, { body: { dryRun: v.dryRun } }), onSuccess: (r, v) => { toast(v.dryRun ? "Pratinjau" : STATUS[r.status]?.label ?? "Selesai", { description: r.message ?? undefined }); void refresh(); void qc.invalidateQueries({ queryKey: ["automation-runs", v.a.id] }); }, onError: (e) => toast.error((e as Error).message) });
  const remove = useMutation({ mutationFn: (a: AutomationDto) => api(`/automations/${a.id}`, { method: "DELETE" }), onSuccess: () => { toast.success("Otomasi dihapus"); setDel(null); void refresh(); } });
  const items = list.data ?? []; const many = new Set(items.map((i) => i.createdBy)).size > 1;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Otomasi" subtitle="Biarkan SuperDrive mengerjakan hal yang berulang: merapikan, mencadangkan, membersihkan, dan memberi kabar." actions={<Button variant="primary" size="sm" iconOnlyMobile icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Buat otomasi</Button>} />
      <div className="scroll-thin flex-1 overflow-y-auto p-4 sm:p-8">
        {list.isLoading ? <Skeleton className="mx-auto h-40 max-w-4xl" /> : list.error ? <EmptyState icon={Zap} title="Tidak dapat memuat otomasi">{(list.error as Error).message}</EmptyState>
          : items.length === 0 ? <EmptyState icon={Zap} title="Belum ada otomasi" action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Buat otomasi</Button>}>Contoh: pindahkan semua PDF yang masuk ke folder Dokumen, cadangkan folder penting tiap malam, atau bersihkan file sementara yang sudah 30 hari.</EmptyState>
          : <div className="mx-auto grid max-w-4xl gap-3">{items.map((a) => {
            const bad = a.lastStatus === "FAILED" || a.lastStatus === "DENIED"; const conds = describeConditions(a.conditions);
            return (
              <Card key={a.id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-[15px] font-semibold break-words">{a.name}</h3>{!a.enabled ? <Badge>{bad ? "Dimatikan otomatis" : "Mati"}</Badge> : bad ? <Badge tone="danger">Perlu perhatian</Badge> : <Badge tone="ok">Aktif</Badge>}{many && <span className="text-[12px] text-muted">oleh {a.createdByName}</span>}</div>
                    <p className="mt-1 text-[13px]">{describeTrigger(a)}</p>
                    {conds.length > 0 && <p className="text-[13px] text-muted">Jika {conds.join(", ")}</p>}
                    <p className="text-[13px] text-muted">→ {a.actions.map(describeAction).join(", lalu ")}</p></div>
                  {a.canEdit && <button type="button" role="switch" aria-checked={a.enabled} aria-label={a.enabled ? "Matikan" : "Nyalakan"} onClick={() => toggle.mutate(a)} className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", a.enabled ? "bg-primary" : "bg-line-strong")}><span className={cn("absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform", a.enabled && "translate-x-5")} /></button>}
                </div>
                {(a.lastRunAt || a.nextRunAt) && <p className="mt-3 text-[12px] text-muted">{a.lastRunAt ? <>Terakhir {timeAgo(a.lastRunAt)}{a.lastMessage ? ` · ${a.lastMessage}` : ""}</> : "Belum pernah berjalan"}{a.enabled && a.nextRunAt ? ` · berikutnya ${dateTime(a.nextRunAt)}` : ""}</p>}
                {a.lastMessage && bad && <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-danger-ink">{a.lastMessage}</p>}
                {a.canEdit && <div className="mt-3 flex flex-wrap gap-1.5">
                  {a.trigger.type !== "event" && <><Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />} loading={run.isPending && run.variables?.a.id === a.id && run.variables.dryRun} onClick={() => run.mutate({ a, dryRun: true })}>Pratinjau</Button><Button size="sm" variant="ghost" icon={<Play className="size-3.5" />} onClick={() => run.mutate({ a, dryRun: false })}>Jalankan sekarang</Button></>}
                  <Button size="sm" variant="ghost" icon={<History className="size-3.5" />} onClick={() => setRuns(a)}>Riwayat</Button>
                  <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(a)}>Ubah</Button>
                  <Button size="sm" variant="ghost" className="text-danger-ink hover:bg-danger-soft" icon={<Trash2 className="size-3.5" />} onClick={() => setDel(a)}>Hapus</Button>
                </div>}
              </Card>); })}</div>}
      </div>
      <AutomationDialog open={editing !== null} edit={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      <RunsDialog a={runs} onClose={() => setRuns(null)} />
      <Dialog open={!!del} onClose={() => setDel(null)} width="max-w-sm" title={`Hapus “${del?.name ?? ""}”?`} footer={<><Button onClick={() => setDel(null)}>Batal</Button><Button variant="danger" onClick={() => del && remove.mutate(del)}>Hapus</Button></>}><p className="text-[14px] text-muted">Otomasi berhenti dan riwayatnya dihapus. <b className="text-ink">File tidak disentuh.</b></p></Dialog>
    </div>
  );
}
