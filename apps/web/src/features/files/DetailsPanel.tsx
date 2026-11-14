import type { FileEntry, FolderStats } from "@superdrive/shared";
import { formatBytes } from "@superdrive/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, FilePlus2, FolderPlus, Link2, MessageSquare, Pencil, Send, Tag, Trash2, Undo2, UploadCloud, X } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dateTime, timeAgo } from "@/lib/format";
import { KIND_ICON, KIND_TONE, kindOf } from "@/lib/fileType";
import { IconButton } from "@/ui/Button";
import { Skeleton } from "@/ui/misc";
import { FileThumb } from "./FileThumb";

const KIND_LABEL: Record<string, string> = { folder: "Folder", image: "Gambar", video: "Video", audio: "Audio", pdf: "Dokumen PDF", text: "Teks", sheet: "Lembar kerja", slides: "Presentasi", doc: "Dokumen", archive: "Arsip", code: "Kode", other: "File" };

function Row({ k, children }: { k: string; children: ReactNode }) {
  return <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 py-1.5 text-[13px]"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{children}</dd></div>;
}

interface Activity { id: string; action: string; actor: string; actorKind: "member" | "visitor" | "system"; meta: Record<string, any>; at: string; ip: string | null }
interface Comment { id: string; body: string; authorName: string; createdAt: string; mine: boolean }
interface MetaGroup { title: string; rows: { k: string; v: string }[] }

const ACCESS = new Set(["view", "download"]);
const ACTION: Record<string, { icon: typeof Eye; text: (m: Record<string, any>) => string }> = {
  view: { icon: Eye, text: () => "membuka" }, download: { icon: Download, text: () => "mengunduh" }, upload: { icon: UploadCloud, text: () => "mengunggah" }, create: { icon: FolderPlus, text: () => "membuat" },
  rename: { icon: Pencil, text: (m) => `mengganti nama dari “${m.from}” menjadi “${m.to}”` }, delete: { icon: Trash2, text: () => "memindahkan ke Sampah" }, restore: { icon: Undo2, text: () => "memulihkan" },
  move: { icon: FilePlus2, text: () => "memindahkan" }, share: { icon: Link2, text: (m) => `membuat tautan berbagi${m.title ? ` untuk ${m.title}` : ""} (${m.role === "EDITOR" ? "editor" : "penonton"})` },
  unshare: { icon: Link2, text: (m) => `mematikan tautan${m.title ? ` untuk ${m.title}` : ""}` }, share_role: { icon: Link2, text: (m) => `mengubah izin tautan${m.title ? ` ${m.title}` : ""} dari ${m.from === "EDITOR" ? "editor" : "penonton"} ke ${m.to === "EDITOR" ? "editor" : "penonton"}` },
  comment: { icon: MessageSquare, text: () => "menulis komentar" }, tag: { icon: Tag, text: (m) => (m.add ? `menambah tag “${m.add}”` : `menghapus tag “${m.remove}”`) },
};

function TagsEditor({ entry }: { entry: FileEntry }) {
  const qc = useQueryClient(); const key = ["tags", entry.storageId, entry.id]; const listId = useId(); const [v, setV] = useState("");
  const tags = useQuery({ queryKey: key, queryFn: () => api<string[]>(`/files/${entry.storageId}/${entry.id}/tags`) });
  const all = useQuery({ queryKey: ["tags-all"], staleTime: 60_000, queryFn: () => api<{ tag: string; n: number }[]>("/tags") });
  const set = (d: string[]) => { qc.setQueryData(key, d); void qc.invalidateQueries({ queryKey: ["tags-all"] }); void qc.invalidateQueries({ queryKey: ["activity", entry.storageId, entry.id] }); };
  const add = useMutation({ mutationFn: (tag: string) => api<string[]>(`/files/${entry.storageId}/${entry.id}/tags`, { body: { tag } }), onSuccess: (d) => { set(d); setV(""); }, onError: (e) => toast.error((e as Error).message) });
  const del = useMutation({ mutationFn: (tag: string) => api<string[]>(`/files/${entry.storageId}/${entry.id}/tags/${encodeURIComponent(tag)}`, { method: "DELETE" }), onSuccess: set, onError: (e) => toast.error((e as Error).message) });
  return (
    <section aria-label="Tag" className="mt-4">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-muted uppercase"><Tag className="size-3.5" aria-hidden />Tag</h3>
      <div className="flex flex-wrap gap-1.5">
        {tags.isLoading ? <Skeleton className="h-6 w-24" /> : tags.data?.map((t) => (
          <span key={t} className="inline-flex h-7 items-center gap-1 rounded-full bg-primary-soft pr-1 pl-2.5 text-[12px] font-medium text-primary-ink">{t}
            <button type="button" aria-label={`Hapus tag ${t}`} className="relative grid size-5 place-items-center rounded-full hover:bg-primary/15 after:absolute after:-inset-2 after:content-['']" onClick={() => del.mutate(t)}><X className="size-3" /></button></span>))}
        {!tags.isLoading && !tags.data?.length && <span className="text-[12px] text-muted">Belum ada tag.</span>}
      </div>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (v.trim()) add.mutate(v); }}>
        <input list={listId} value={v} maxLength={32} onChange={(e) => setV(e.target.value)} aria-label="Tambah tag" placeholder="Tambah tag, mis. klien-a" className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-2.5 text-[16px] placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 sm:text-[13px]" />
        <datalist id={listId}>{all.data?.filter((t) => !tags.data?.includes(t.tag)).map((t) => <option key={t.tag} value={t.tag} />)}</datalist>
        <button type="submit" disabled={!v.trim() || add.isPending} className="h-9 rounded-lg bg-surface-2 px-3 text-[13px] font-medium hover:bg-line disabled:opacity-50 pointer-coarse:h-11">Tambah</button>
      </form>
    </section>
  );
}

function Metadata({ entry }: { entry: FileEntry }) {
  const q = useQuery({ queryKey: ["metadata", entry.storageId, entry.id, entry.version], enabled: !entry.isFolder, staleTime: 5 * 60_000, retry: false, queryFn: () => api<MetaGroup[]>(`/files/${entry.storageId}/${entry.id}/metadata`) });
  if (entry.isFolder) return null;
  if (q.isLoading) return <div className="mt-4 space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-16" /></div>;
  if (!q.data?.length) return null;
  return <>{q.data.map((g) => (
    <section key={g.title} aria-label={g.title} className="mt-4"><h3 className="mb-0.5 text-[12px] font-semibold tracking-wide text-muted uppercase">{g.title}</h3>
      <dl className="divide-y divide-line">{g.rows.map((r) => <Row key={r.k} k={r.k}>{r.v}</Row>)}</dl></section>))}</>;
}

function ActivityTab({ entry }: { entry: FileEntry }) {
  const [only, setOnly] = useState<"all" | "access" | "changes">("all");
  const q = useQuery({ queryKey: ["activity", entry.storageId, entry.id], queryFn: () => api<Activity[]>(`/files/${entry.storageId}/${entry.id}/activity?limit=100`), staleTime: 10_000 });
  const items = (q.data ?? []).filter((a) => (only === "all" ? true : only === "access" ? ACCESS.has(a.action) : !ACCESS.has(a.action)));
  const who = new Map<string, { n: number; at: string; kind: string }>();
  for (const a of q.data ?? []) if (ACCESS.has(a.action)) { const w = who.get(a.actor); who.set(a.actor, { n: (w?.n ?? 0) + 1, at: w?.at ?? a.at, kind: a.actorKind }); }
  return (
    <div className="space-y-4">
      {who.size > 0 && (
        <section aria-label="Siapa yang mengakses"><h3 className="mb-1.5 text-[12px] font-semibold tracking-wide text-muted uppercase">Siapa yang mengakses</h3>
          <ul className="divide-y divide-line rounded-lg border border-line">{[...who].map(([name, w]) => (
            <li key={name} className="flex items-center gap-2 px-3 py-2 text-[13px]"><span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
              <span className="tnum shrink-0 text-[12px] text-muted" title={dateTime(w.at)}>{w.n}× · {timeAgo(w.at)}</span></li>))}</ul></section>)}
      <section aria-label="Riwayat">
        <div className="mb-1.5 flex items-center gap-1" role="group" aria-label="Saring riwayat">
          {([["all", "Semua"], ["access", "Akses"], ["changes", "Perubahan"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={only === k} onClick={() => setOnly(k)} className={cn("h-8 rounded-full px-3 text-[12px] font-medium pointer-coarse:h-10", only === k ? "bg-primary-soft text-primary-ink" : "text-muted hover:bg-surface-2")}>{l}</button>)}
        </div>
        {q.isLoading ? <Skeleton className="h-32" /> : q.error ? <p className="text-[13px] text-danger-ink">{(q.error as Error).message}</p> : !items.length ? <p className="py-6 text-center text-[13px] text-muted">Belum ada aktivitas tercatat.</p> : (
          <ol className="space-y-0.5">{items.map((a) => { const d = ACTION[a.action] ?? { icon: Eye, text: () => a.action }; const Icon = d.icon; return (
            <li key={a.id} className="flex gap-2.5 rounded-lg px-1 py-1.5 text-[13px]">
              <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", a.actorKind === "visitor" ? "bg-warn-soft text-warn-ink" : "bg-surface-2 text-muted")}><Icon className="size-3.5" aria-hidden /></span>
              <p className="min-w-0 flex-1 break-words"><b className="font-semibold">{a.actor}</b> {d.text(a.meta)}<span className="block text-[12px] text-muted" title={dateTime(a.at)}>{timeAgo(a.at)}{a.actorKind === "visitor" && a.ip ? ` · ${a.ip}` : ""}</span></p>
            </li>); })}</ol>)}
      </section>
    </div>
  );
}

function CommentsTab({ entry }: { entry: FileEntry }) {
  const qc = useQueryClient(); const key = ["comments", entry.storageId, entry.id]; const [text, setText] = useState(""); const box = useRef<HTMLTextAreaElement>(null);
  const q = useQuery({ queryKey: key, queryFn: () => api<Comment[]>(`/files/${entry.storageId}/${entry.id}/comments`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ["activity", entry.storageId, entry.id] }); };
  const add = useMutation({ mutationFn: () => api<Comment>(`/files/${entry.storageId}/${entry.id}/comments`, { body: { body: text } }), onSuccess: () => { setText(""); refresh(); }, onError: (e) => toast.error((e as Error).message) });
  const del = useMutation({ mutationFn: (id: string) => api(`/files/${entry.storageId}/comments/${id}`, { method: "DELETE" }), onSuccess: refresh, onError: (e) => toast.error((e as Error).message) });
  return (
    <div className="flex min-h-0 flex-col gap-3">
      {q.isLoading ? <Skeleton className="h-24" /> : !q.data?.length ? <p className="py-6 text-center text-[13px] text-muted">Belum ada komentar. Tulis yang pertama.</p> : (
        <ul className="space-y-2.5">{q.data.map((c) => (
          <li key={c.id} className="rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
            <div className="flex items-baseline gap-2"><b className="min-w-0 flex-1 truncate font-semibold">{c.authorName}{c.mine ? " (Anda)" : ""}</b><span className="shrink-0 text-[11px] text-muted" title={dateTime(c.createdAt)}>{timeAgo(c.createdAt)}</span></div>
            <p className="mt-0.5 break-words whitespace-pre-wrap">{c.body}</p>
            <button type="button" className="mt-1 text-[12px] text-muted hover:text-danger-ink" onClick={() => { if (confirm("Hapus komentar ini?")) del.mutate(c.id); }}>Hapus</button>
          </li>))}</ul>)}
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(); }}>
        <textarea ref={box} value={text} maxLength={2000} rows={2} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) { e.preventDefault(); add.mutate(); } }} aria-label="Tulis komentar" placeholder="Tulis komentar…  (Ctrl+Enter untuk kirim)"
          className="min-h-[2.75rem] flex-1 resize-y rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-[16px] placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 sm:text-[13px]" />
        <IconButton label="Kirim komentar" type="submit" disabled={!text.trim() || add.isPending} className="bg-primary text-white hover:bg-primary-hover hover:text-white"><Send className="size-4" /></IconButton>
      </form>
    </div>
  );
}

type Tab = "detail" | "activity" | "comments";

/** Metadata, activity, tags and comments for one file or folder. `extras` is off for visitors of a share link (those need a login). */
export function DetailsPanel({ entry, storageName, location, onClose, className, stats = true, extras = true }: { entry: FileEntry; storageName?: string; location?: string; onClose?(): void; className?: string; stats?: boolean; extras?: boolean }) {
  const [tab, setTab] = useState<Tab>("detail"); const kind = kindOf(entry); const Icon = KIND_ICON[kind]; const idp = useId();
  const st = useQuery({ queryKey: ["files", entry.storageId, "stats", entry.id], enabled: stats && entry.isFolder, staleTime: 30_000, retry: false, queryFn: () => api<FolderStats>(`/files/${entry.storageId}/${entry.id}/stats`) });
  const cc = useQuery({ queryKey: ["comments", entry.storageId, entry.id], enabled: extras, queryFn: () => api<Comment[]>(`/files/${entry.storageId}/${entry.id}/comments`) });
  const where = location ?? (entry.path ? entry.path : undefined);
  const tabs: [Tab, string][] = [["detail", "Detail"], ["activity", "Aktivitas"], ["comments", `Komentar${cc.data?.length ? ` (${cc.data.length})` : ""}`]];
  return (
    <aside aria-label="Detail" className={cn("flex min-h-0 flex-col bg-surface", className)}>
      <header className="flex items-center gap-2 border-b border-line px-4 pt-3"><h2 className="min-w-0 flex-1 truncate pb-2 text-[14px] font-semibold" title={entry.name}>{entry.name}</h2>{onClose && <IconButton label="Tutup detail" onClick={onClose} className="mb-1"><X className="size-4" /></IconButton>}</header>
      {extras && (
        <div role="tablist" aria-label="Bagian detail" className="flex gap-1 border-b border-line px-2">
          {tabs.map(([k, l]) => <button key={k} role="tab" id={`${idp}-${k}`} aria-selected={tab === k} aria-controls={`${idp}-p`} tabIndex={tab === k ? 0 : -1} onClick={() => setTab(k)}
            onKeyDown={(e) => { const i = tabs.findIndex(([x]) => x === tab); if (e.key === "ArrowRight") setTab(tabs[(i + 1) % tabs.length]![0]); else if (e.key === "ArrowLeft") setTab(tabs[(i + tabs.length - 1) % tabs.length]![0]); }}
            className={cn("relative h-10 rounded-t-lg px-3 text-[13px] font-medium whitespace-nowrap pointer-coarse:h-11", tab === k ? "text-primary-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded after:bg-primary" : "text-muted hover:text-ink")}>{l}</button>)}
        </div>)}
      <div id={`${idp}-p`} role="tabpanel" aria-labelledby={`${idp}-${tab}`} className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "detail" || !extras ? (<>
          <div className="mb-4 grid aspect-[4/3] place-items-center overflow-hidden rounded-xl bg-surface-2">
            {entry.isFolder ? <span className={cn("grid size-16 place-items-center rounded-2xl", KIND_TONE.folder)}><Icon className="size-8" aria-hidden /></span> : <FileThumb file={entry} size={256} className="size-full" />}
          </div>
          <dl className="divide-y divide-line">
            <Row k="Jenis">{KIND_LABEL[kind] ?? "File"}{entry.mimeType && !entry.isFolder ? <span className="block text-[12px] text-muted">{entry.mimeType}</span> : null}</Row>
            {entry.isFolder ? <Row k="Isi">{st.isLoading ? "Menghitung…" : st.data ? `${st.data.files.toLocaleString("id-ID")} file, ${st.data.folders.toLocaleString("id-ID")} folder${st.data.truncated ? " (perkiraan)" : ""}` : "–"}</Row> : null}
            <Row k="Ukuran">{entry.isFolder ? (st.data ? `${formatBytes(st.data.bytes)}${st.data.truncated ? "+" : ""}` : st.isLoading ? "Menghitung…" : "–") : `${formatBytes(entry.size)}${entry.size ? ` (${entry.size.toLocaleString("id-ID")} byte)` : ""}`}</Row>
            {storageName && <Row k="Penyimpanan">{storageName}</Row>}
            {where !== undefined && <Row k="Lokasi"><span className="font-mono text-[12px]">{where || "/"}</span></Row>}
            {entry.modifiedAt && <Row k="Diubah">{dateTime(entry.modifiedAt)}</Row>}
            {entry.createdAt && <Row k="Dibuat">{dateTime(entry.createdAt)}</Row>}
            {entry.checksum && <Row k="Checksum"><span className="font-mono text-[11px] break-all">{entry.checksum}</span></Row>}
          </dl>
          {extras && <><TagsEditor entry={entry} /><Metadata entry={entry} /></>}
        </>) : tab === "activity" ? <ActivityTab entry={entry} /> : <CommentsTab entry={entry} />}
      </div>
    </aside>
  );
}
