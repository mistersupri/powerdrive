import type { FileEntry, StorageConnectionDto } from "@superdrive/shared";
import { formatBytes, PROVIDER_LABEL } from "@superdrive/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownAZ, ArrowUpAZ, ChevronRight, Clock, Copy, Download, FolderInput, FolderOpen, FolderPlus, Grid2x2, HardDrive, Info, List, Loader2, Plus, Search, Star, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "@/ui/Button";
import { useMenu } from "@/ui/Menu";
import { Card, ConnectionBadge, EmptyState, Progress, Skeleton } from "@/ui/misc";
import { PageHeader, useStorages } from "@/features/layout/Shell";
import { FileBrowser } from "./FileBrowser";
import { useSelection } from "./selection";
import { useFileActions } from "./useFileActions";
import { sortEntries, useFolder, type SortKey, type SortState } from "./useFolder";
import { applyFilter, emptyFilter, FilterButton, FilterChips, filterToQuery } from "./filter";
import { usePersistentState } from "@/lib/usePersistentState";
import { startTransfer } from "./transferApi";
import { toast } from "sonner";

export { SortViewControls } from "./controls";
import { StoragePage } from "./StoragePage";
export { StoragePage };

/** /files — the built-in "Semua file" storage: the files and folders of the uploads volume, shown directly. */
export function AllFilesPage() {
  const storages = useStorages(); const d = storages.data?.find((s) => s.isDefault);
  if (!d) return (
    <div className="flex min-h-0 flex-1 flex-col"><PageHeader title="Semua file" />
      <div className="p-8">{storages.isLoading ? <Skeleton className="h-48" /> : <EmptyState icon={HardDrive} title="Penyimpanan bawaan belum siap">Muat ulang halaman sebentar lagi.</EmptyState>}</div></div>);
  return <StoragePage forcedStorageId={d.id} />;
}

export function StorageTile({ s }: { s: StorageConnectionDto }) {
  const pct = s.quota?.total && s.quota.used !== null ? Math.round((s.quota.used / s.quota.total) * 100) : null;
  return (
    <Link to={s.isDefault ? "/files" : `/s/${s.id}`} className="group block rounded-xl border border-line bg-surface p-5 shadow-card transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-float">
      <div className="flex items-start gap-3">
        <span className="grid size-11 place-items-center rounded-[10px] bg-primary-soft text-primary-ink"><HardDrive className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1"><h3 className="truncate text-[15px] font-semibold">{s.name}</h3><p className="truncate text-[12px] text-muted">{PROVIDER_LABEL[s.provider]}{s.accountEmail ? ` · ${s.accountEmail}` : ""}</p></div>
        <ConnectionBadge status={s.status} />
      </div>
      <div className="mt-5">
        {pct !== null ? (<><Progress value={pct} tone={pct > 90 ? "danger" : pct > 75 ? "warn" : "primary"} /><p className="tnum mt-2 text-[12px] text-muted">{formatBytes(s.quota!.used)} dari {formatBytes(s.quota!.total)} terpakai</p></>)
          : <p className="text-[12px] text-muted">{s.quota?.used != null ? `${formatBytes(s.quota.used)} terpakai` : "Kapasitas tidak dilaporkan penyedia"}</p>}
      </div>
      <p className="mt-3 font-mono text-[11px] text-faint">{s.mount?.virtualPath}</p>
    </Link>
  );
}

/** /search, /recent, /starred — results come from the local metadata index. */
/** Tells people whether global search already covers every connected storage. */
function IndexBanner() {
  const qc = useQueryClient(); const storages = useStorages().data ?? [];
  const busy = storages.filter((s) => s.index?.status === "RUNNING"); const partial = storages.filter((s) => s.index?.status === "PARTIAL" || s.index?.status === "FAILED");
  useEffect(() => { if (!busy.length) return; const t = setInterval(() => void qc.invalidateQueries({ queryKey: ["storages"] }), 4000); return () => clearInterval(t); }, [busy.length, qc]);
  if (!busy.length && !partial.length) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-line bg-warn-soft px-4 py-2 text-[13px] text-warn-ink sm:px-8">
      {busy.length > 0 ? <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden /> : <Info className="size-4 shrink-0" aria-hidden />}
      <span>{busy.length > 0 ? `Sedang mengindeks ${busy.map((s) => `${s.isDefault ? "Semua file" : s.name} (${s.index!.count.toLocaleString("id-ID")} item)`).join(", ")}. Hasil pencarian mungkin belum lengkap.` : `Indeks ${partial.map((s) => s.name).join(", ")} belum lengkap; sebagian folder tidak bisa dibaca.`}</span>
    </div>
  );
}

export function ResultsPage({ mode }: { mode: "search" | "recent" | "starred" }) {
  const [sp] = useSearchParams(); const q = sp.get("q") ?? ""; const nav = useNavigate();
  const [view, setView] = usePersistentState<"grid" | "list">("sd-view", "grid"); const [filter, setFilter] = useState(emptyFilter);
  const selection = useSelection(); const menu = useMenu();
  const storages = useStorages();
  const names = useMemo(() => Object.fromEntries((storages.data ?? []).map((s) => [s.id, s.name])), [storages.data]);
  const res = useQuery({
    queryKey: ["search", mode, q, filterToQuery(filter), filter.q],
    // Filters run on the server against the metadata index, so they cover every storage, not just what is loaded.
    queryFn: () => api<{ items: FileEntry[]; total: number }>(`/search?limit=200${mode === "recent" ? "&recent=true" : ""}${[q, filter.q.trim()].filter(Boolean).length ? `&q=${encodeURIComponent([q, filter.q.trim()].filter(Boolean).join(" "))}` : ""}&${filterToQuery(filter)}${mode === "starred" ? "&starred=true" : ""}`),
    enabled: mode !== "search" || q.length > 0,
  });
  const entries = res.data?.items ?? [];
  const first = entries.find((e) => selection.selected.has(e.id)) ?? entries[0];
  const storage = storages.data?.find((s) => s.id === first?.storageId);
  const a = useFileActions({ storage, folderId: "root", folderName: "", entries, selection, onOpenFolder: (id) => nav(`/s/${first?.storageId}?f=${id}`) });
  const title = mode === "search" ? `Hasil untuk “${q}”` : mode === "recent" ? "Terbaru" : "Berbintang";
  const openEntry = (e: FileEntry) => { if (e.isFolder) nav(`/s/${e.storageId}?f=${e.id}`); else a.open(e); };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={title} subtitle={res.data ? `${res.data.total} item` : mode === "recent" ? "File yang baru diubah di semua penyimpanan." : mode === "starred" ? "File yang Anda tandai." : undefined} />
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2 sm:px-8">
        <FilterButton value={filter} onChange={setFilter} />
        <span className="flex-1" />
        <div className="flex rounded-lg bg-surface-2 p-0.5">{([["grid", Grid2x2], ["list", List]] as const).map(([v, I]) => <button key={v} aria-label={v === "grid" ? "Tampilan kisi" : "Tampilan daftar"} aria-pressed={view === v} onClick={() => setView(v)} className={cn("grid size-8 place-items-center rounded-md text-muted", view === v && "bg-surface text-ink shadow-card")}><I className="size-4" /></button>)}</div>
      </div>
      <FilterChips value={filter} onChange={setFilter} />
      {mode === "search" && <IndexBanner />}
      <FileBrowser entries={entries} view={view} selected={selection.selected} loading={res.isLoading} storageNames={names}
        empty={<EmptyState icon={mode === "starred" ? Star : mode === "recent" ? Clock : Search} title={mode === "search" ? "Tidak ada hasil" : mode === "starred" ? "Belum ada file berbintang" : "Belum ada file"}>{mode === "starred" ? "Beri bintang pada file penting agar mudah ditemukan." : mode === "search" ? "Pencarian mencakup seluruh isi penyimpanan yang terhubung (diindeks di latar belakang)." : "File akan muncul setelah folder dibuka atau diunggah."}</EmptyState>}
        onSelect={(e, m) => selection.click(e.id, entries, m)} onSetSelection={(ids) => selection.setSelected(new Set(ids))} onOpen={openEntry}
        onContext={(e, x, y) => e && menu.open(x, y, [
          { label: e.isFolder ? "Buka" : "Pratinjau", onSelect: () => openEntry(e) }, { label: "Buka lokasi file", onSelect: () => nav(`/s/${e.storageId}${e.parentId && e.parentId !== "root" ? `?f=${e.parentId}` : ""}`) },
          { label: e.isFolder ? "Unduh sebagai ZIP" : "Unduh", onSelect: () => { const l = document.createElement("a"); l.href = `/api/v1/files/${e.storageId}/${e.id}/download`; l.click(); } },
          { label: e.starred ? "Hapus bintang" : "Beri bintang", onSelect: () => { void a.star(e).then(() => res.refetch()); } },
        ])}
        onKeyAction={(k) => { if (k === "selectAll") selection.selectAll(entries); if (k === "clear") selection.clear(); }} onDropItems={() => {}} onDropFiles={() => {}} />
      {menu.element}{a.dialogs}
    </div>
  );
}
