import type { FileEntry, StorageConnectionDto } from "@superdrive/shared";
import { formatBytes, PROVIDER_LABEL } from "@superdrive/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownAZ, ArrowUpAZ, ChevronRight, Clock, Copy, Download, FolderInput, FolderOpen, FolderPlus, Grid2x2, HardDrive, List, Plus, Search, Star, Trash2, Upload, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
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
import { collectDropped, hasFiles } from "./dnd";
import { usePersistentState } from "@/lib/usePersistentState";
import { startTransfer } from "./transferApi";
import { toast } from "sonner";

const SORT_LABEL: Record<SortKey, string> = { name: "Nama", size: "Ukuran", modified: "Terakhir diubah", type: "Jenis" };

export function SortViewControls({ sort, setSort, view, setView }: { sort: SortState; setSort(s: SortState): void; view: "grid" | "list"; setView(v: "grid" | "list"): void }) {
  const menu = useMenu();
  return (
    <div className="flex items-center gap-1">
      <button className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted hover:bg-surface-2 hover:text-ink" aria-haspopup="menu"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); menu.open(r.left, r.bottom + 4, (Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({ label: SORT_LABEL[k] + (sort.key === k ? (sort.dir === "asc" ? "  ↑" : "  ↓") : ""), onSelect: () => setSort({ key: k, dir: sort.key === k && sort.dir === "asc" ? "desc" : "asc" }) }))); }}>
        {sort.dir === "asc" ? <ArrowDownAZ className="size-4" /> : <ArrowUpAZ className="size-4" />}<span className="hidden sm:inline">{SORT_LABEL[sort.key]}</span>
      </button>
      <div className="flex rounded-lg bg-surface-2 p-0.5" role="group" aria-label="Tampilan">
        {([["grid", Grid2x2, "Tampilan kisi"], ["list", List, "Tampilan daftar"]] as const).map(([v, I, l]) => (
          <button key={v} aria-label={l} title={l} aria-pressed={view === v} onClick={() => setView(v)} className={cn("grid size-8 place-items-center rounded-md text-muted transition-colors", view === v && "bg-surface text-ink shadow-card")}><I className="size-4" /></button>
        ))}
      </div>
      {menu.element}
    </div>
  );
}

function Crumbs({ storage, crumbs, onGo, onDrop }: { storage?: StorageConnectionDto; crumbs: { id: string; name: string }[]; onGo(id: string): void; onDrop?(folderId: string, e: React.DragEvent): void }) {
  const drop = (id: string) => onDrop ? { onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes("application/x-superdrive-items")) e.preventDefault(); }, onDrop: (e: React.DragEvent) => onDrop(id, e) } : {};
  return (
    <nav aria-label="Lokasi" className="flex min-w-0 items-center gap-0.5 overflow-x-auto text-[13px] scroll-thin">
      <Link to="/files" className="rounded-md px-2 py-1 text-muted hover:bg-surface-2 hover:text-ink">Semua file</Link>
      <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden />
      <button {...drop("root")} className={cn("rounded-md px-2 py-1 whitespace-nowrap hover:bg-surface-2", crumbs.length ? "text-muted hover:text-ink" : "font-semibold")} onClick={() => onGo("root")}>{storage?.name ?? "…"}</button>
      {crumbs.map((c, i) => (<span key={c.id} className="flex items-center gap-0.5"><ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden /><button {...drop(c.id)} className={cn("rounded-md px-2 py-1 whitespace-nowrap hover:bg-surface-2", i === crumbs.length - 1 ? "font-semibold" : "text-muted hover:text-ink")} onClick={() => onGo(c.id)}>{c.name}</button></span>))}
    </nav>
  );
}

/** /s/:storageId?f=<folder> — the main file manager. */
export function StoragePage() {
  const { storageId = "" } = useParams(); const [sp, setSp] = useSearchParams(); const nav = useNavigate();
  const folderId = sp.get("f") ?? "root";
  const storages = useStorages(); const storage = storages.data?.find((s) => s.id === storageId);
  const f = useFolder(storage?.status === "CONNECTED" ? storageId : "", folderId);
  const [view, setView] = usePersistentState<"grid" | "list">("sd-view", "grid");
  const [sort, setSort] = usePersistentState<SortState>("sd-sort", { key: "name", dir: "asc" });
  const [filter, setFilter] = useState("");
  const selection = useSelection();
  const go = useCallback((id: string) => { selection.clear(); setSp(id === "root" ? {} : { f: id }); }, [selection, setSp]);
  const shown = useMemo(() => sortEntries(f.entries.filter((e) => !filter || e.name.toLowerCase().includes(filter.toLowerCase())), sort), [f.entries, filter, sort]);
  const a = useFileActions({ storage, folderId, folderName: folderId === "root" ? storage?.name ?? "" : f.folder?.name ?? "", entries: shown, selection, onOpenFolder: go });
  const menu = useMenu();
  const uploadMenu = useMenu();
  const missing = storages.isSuccess && !storage;
  const sel = a.selectedEntries;

  const body = (() => {
    if (missing) return <EmptyState icon={HardDrive} title="Penyimpanan tidak ditemukan" action={<Button onClick={() => nav("/files")}>Kembali ke semua file</Button>}>Penyimpanan ini mungkin sudah diputus atau Anda tidak punya akses.</EmptyState>;
    if (storage && storage.status !== "CONNECTED") return <EmptyState icon={HardDrive} title={storage.status === "DISABLED" ? "Penyimpanan dinonaktifkan" : "Penyimpanan perlu dihubungkan ulang"} action={<Button variant="primary" onClick={() => nav("/storage")}>Buka pengaturan penyimpanan</Button>}>{storage.lastError ?? "Koneksi ke penyimpanan ini tidak aktif."}</EmptyState>;
    if (f.error) return <EmptyState icon={FolderOpen} title="Folder tidak dapat dimuat" action={<Button onClick={() => f.refetch()}>Coba lagi</Button>}>{f.error instanceof ApiError ? f.error.message : "Terjadi kesalahan."}</EmptyState>;
    return (
      <FileBrowser
        entries={shown} view={view} selected={selection.selected} loading={f.isLoading || storages.isLoading}
        empty={<EmptyState icon={FolderPlus} title={filter ? "Tidak ada yang cocok" : "Folder ini masih kosong"} action={!filter && a.can("UPLOAD") ? <Button variant="primary" icon={<Upload className="size-4" />} onClick={a.pickFiles}>Unggah file</Button> : undefined}>{filter ? `Tidak ada file dengan nama “${filter}”.` : "Tarik file ke sini, atau gunakan tombol Unggah."}</EmptyState>}
        onSelect={(e, m) => selection.click(e.id, shown, m)} onOpen={a.open}
        onContext={(e, x, y) => menu.open(x, y, a.menuFor(e))} onKeyAction={a.keyAction}
        onDropItems={a.dropItems} onDropFiles={(t, files) => a.upload(files, t ? t.id : folderId, t?.name)} dropLabel={`Unggah ke ${f.folder?.name || storage?.name || ""}`}
      />
    );
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={storage?.name ?? "Memuat…"} subtitle={storage ? `${PROVIDER_LABEL[storage.provider]}${storage.accountEmail ? ` · ${storage.accountEmail}` : ""}` : undefined} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-surface px-4 py-2 sm:px-8">
        {sel.length === 0 ? (<>
          {a.can("UPLOAD") && <>
            <Button variant="primary" size="sm" icon={<Upload className="size-4" />} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); uploadMenu.open(r.left, r.bottom + 4, [{ label: "Unggah file", icon: <Upload />, onSelect: a.pickFiles }, { label: "Unggah folder", icon: <FolderInput />, onSelect: a.pickFolder }]); }}>Unggah</Button>
            <Button size="sm" icon={<FolderPlus className="size-4" />} onClick={a.newFolder}>Folder baru</Button>
          </>}
          <div className="relative ml-1 hidden sm:block"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" aria-hidden /><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Saring di folder ini" aria-label="Saring di folder ini" className="h-8 w-44 rounded-lg bg-surface-2 pr-2 pl-8 text-[13px] focus:ring-2 focus:ring-primary/30 focus:outline-none" /></div>
        </>) : (<>
          <span className="mr-2 inline-flex items-center gap-1 rounded-lg bg-primary-soft py-1 pr-1 pl-2.5 text-[13px] font-medium text-primary-ink"><span className="tnum">{sel.length}</span> dipilih<IconButton label="Batal pilih" className="size-6" onClick={selection.clear}><X className="size-3.5" /></IconButton></span>
          {a.can("DOWNLOAD") && <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={a.downloadSelected}>Unduh</Button>}
          {a.can("COPY") && <Button size="sm" variant="ghost" icon={<Copy className="size-4" />} onClick={() => a.transferSelected("COPY")}>Salin</Button>}
          {a.can("MOVE") && <Button size="sm" variant="ghost" icon={<FolderInput className="size-4" />} onClick={() => a.transferSelected("MOVE")}>Pindahkan</Button>}
          {a.can("DELETE") && <Button size="sm" variant="ghost" className="text-danger-ink hover:bg-danger-soft hover:text-danger-ink" icon={<Trash2 className="size-4" />} onClick={a.deleteSelected}>Hapus</Button>}
        </>)}
        <span className="flex-1" />
        <SortViewControls sort={sort} setSort={setSort} view={view} setView={setView} />
      </div>
      <div className="border-b border-line bg-surface px-4 py-1.5 sm:px-8"><Crumbs storage={storage} crumbs={f.folder?.path ?? []} onGo={go} onDrop={(id, e) => { const raw = e.dataTransfer.getData("application/x-superdrive-items"); if (raw && storage) { e.preventDefault(); void startTransfer("MOVE", JSON.parse(raw).storageId, JSON.parse(raw).ids, { storageId: storage.id, folderId: id, folderName: "folder tujuan" }).catch((er) => toast.error((er as Error).message)); } }} /></div>
      {body}
      {menu.element}{uploadMenu.element}{a.dialogs}
    </div>
  );
}

/** /files — every connected storage as a virtual mount, with real usage numbers (unknown stays unknown). */
export function AllFilesPage() {
  const storages = useStorages();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Semua file" subtitle="Seluruh penyimpanan yang terhubung, dalam satu pohon." actions={<Link to="/storage"><Button variant="primary" size="sm" icon={<Plus className="size-4" />}>Hubungkan penyimpanan</Button></Link>} />
      <div className="scroll-thin flex-1 overflow-y-auto p-4 sm:p-8">
        {storages.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>
          : !storages.data?.length ? <EmptyState icon={HardDrive} title="Belum ada penyimpanan" action={<Link to="/storage"><Button variant="primary">Hubungkan penyimpanan</Button></Link>}>Hubungkan Google Drive, OneDrive, Dropbox, S3, atau folder server untuk mulai mengelola file.</EmptyState>
          : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{storages.data.map((s) => <StorageTile key={s.id} s={s} />)}</div>}
      </div>
    </div>
  );
}
export function StorageTile({ s }: { s: StorageConnectionDto }) {
  const pct = s.quota?.total && s.quota.used !== null ? Math.round((s.quota.used / s.quota.total) * 100) : null;
  return (
    <Link to={`/s/${s.id}`} className="group block rounded-xl border border-line bg-surface p-5 shadow-card transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-float">
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
export function ResultsPage({ mode }: { mode: "search" | "recent" | "starred" }) {
  const [sp] = useSearchParams(); const q = sp.get("q") ?? ""; const nav = useNavigate();
  const [view, setView] = usePersistentState<"grid" | "list">("sd-view", "grid"); const [type, setType] = useState("");
  const selection = useSelection(); const menu = useMenu();
  const storages = useStorages();
  const names = useMemo(() => Object.fromEntries((storages.data ?? []).map((s) => [s.id, s.name])), [storages.data]);
  const res = useQuery({
    queryKey: ["search", mode, q, type],
    queryFn: () => api<{ items: FileEntry[]; total: number }>(`/search?limit=200${mode === "recent" ? "&recent=true" : mode === "starred" ? "&starred=true" : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}${type ? `&type=${type}` : ""}`),
    enabled: mode !== "search" || q.length > 0,
  });
  const entries = res.data?.items ?? [];
  const first = entries.find((e) => selection.selected.has(e.id)) ?? entries[0];
  const storage = storages.data?.find((s) => s.id === first?.storageId);
  const a = useFileActions({ storage, folderId: "root", folderName: "", entries, selection, onOpenFolder: (id) => nav(`/s/${first?.storageId}?f=${id}`) });
  const title = mode === "search" ? `Hasil untuk “${q}”` : mode === "recent" ? "Terbaru" : "Berbintang";
  const types = [["", "Semua"], ["image", "Gambar"], ["video", "Video"], ["pdf", "PDF"], ["document", "Dokumen"], ["archive", "Arsip"], ["folder", "Folder"]];
  const openEntry = (e: FileEntry) => { if (e.isFolder) nav(`/s/${e.storageId}?f=${e.id}`); else a.open(e); };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={title} subtitle={res.data ? `${res.data.total} item` : mode === "recent" ? "File yang baru diubah di semua penyimpanan." : mode === "starred" ? "File yang Anda tandai." : undefined} />
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2 sm:px-8">
        <div className="flex gap-1 overflow-x-auto scroll-thin" role="group" aria-label="Jenis file">{types.map(([v, l]) => <button key={v} aria-pressed={type === v} onClick={() => setType(v!)} className={cn("h-8 rounded-full px-3 text-[13px] whitespace-nowrap transition-colors", type === v ? "bg-primary text-white" : "bg-surface-2 text-muted hover:text-ink")}>{l}</button>)}</div>
        <span className="flex-1" />
        <div className="flex rounded-lg bg-surface-2 p-0.5">{([["grid", Grid2x2], ["list", List]] as const).map(([v, I]) => <button key={v} aria-label={v === "grid" ? "Tampilan kisi" : "Tampilan daftar"} aria-pressed={view === v} onClick={() => setView(v)} className={cn("grid size-8 place-items-center rounded-md text-muted", view === v && "bg-surface text-ink shadow-card")}><I className="size-4" /></button>)}</div>
      </div>
      <FileBrowser entries={entries} view={view} selected={selection.selected} loading={res.isLoading} storageNames={names}
        empty={<EmptyState icon={mode === "starred" ? Star : mode === "recent" ? Clock : Search} title={mode === "search" ? "Tidak ada hasil" : mode === "starred" ? "Belum ada file berbintang" : "Belum ada file"}>{mode === "starred" ? "Beri bintang pada file penting agar mudah ditemukan." : mode === "search" ? "Pencarian memakai indeks nama file. Buka folder agar isinya ikut terindeks." : "File akan muncul setelah folder dibuka atau diunggah."}</EmptyState>}
        onSelect={(e, m) => selection.click(e.id, entries, m)} onOpen={openEntry}
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
