import type { FileEntry } from "@superdrive/shared";
import { PROVIDER_LABEL } from "@superdrive/shared";
import { ChevronRight, Copy, Info, Download, FolderInput, FolderOpen, FolderPlus, HardDrive, Share2, Trash2, Upload, X } from "lucide-react";
import { useCallback, useMemo } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { usePersistentState } from "@/lib/usePersistentState";
import { PageHeader, useStorages } from "@/features/layout/Shell";
import { Button, IconButton } from "@/ui/Button";
import { useMenu } from "@/ui/Menu";
import { EmptyState } from "@/ui/misc";
import { SortViewControls } from "./controls";
import { CrumbDrop, type DropPayload } from "./CrumbDrop";
import { FileBrowser } from "./FileBrowser";
import { applyFilter, emptyFilter, FilterButton, FilterChips } from "./filter";
import { useSelection } from "./selection";
import { startTransfer } from "./transferApi";
import { useFileActions } from "./useFileActions";
import { sortEntries, useFolder, type SortState } from "./useFolder";
import { useState } from "react";
import { DetailsPanel } from "./DetailsPanel";

/** /s/:storageId?f=<folder> — and /files, which is the same screen on the built-in "Semua file" storage. */
export function StoragePage({ forcedStorageId }: { forcedStorageId?: string }) {
  const params = useParams(); const storageId = forcedStorageId ?? params.storageId ?? "";
  const [sp, setSp] = useSearchParams(); const nav = useNavigate();
  const folderId = sp.get("f") ?? "root";
  const storages = useStorages(); const storage = storages.data?.find((s) => s.id === storageId);
  const f = useFolder(storage?.status === "CONNECTED" ? storageId : "", folderId);
  const [view, setView] = usePersistentState<"grid" | "list">("sd-view", "grid");
  const [sort, setSort] = usePersistentState<SortState>("sd-sort", { key: "name", dir: "asc" });
  const [filter, setFilter] = useState(emptyFilter);
  const [showInfo, setShowInfo] = usePersistentState<boolean>("sd-details-open", false);
  const selection = useSelection();
  const go = useCallback((id: string) => { selection.clear(); setFilter(emptyFilter); setSp(id === "root" ? {} : { f: id }); }, [selection, setSp]);
  const shown = useMemo(() => sortEntries(applyFilter(f.entries, filter), sort), [f.entries, filter, sort]);
  const title = storage?.isDefault ? "Semua file" : storage?.name ?? "Memuat…";
  const crumbPath = "/" + (f.folder?.path ?? []).map((c) => c.name).join("/");
  const a = useFileActions({ storage, folderId, location: crumbPath === "/" ? "/" : crumbPath, folderName: folderId === "root" ? title : f.folder?.name ?? "", entries: shown, allEntries: f.entries, selection, onOpenFolder: go, onDetails: (e) => { if (e) selection.setSelected(new Set([e.id])); else selection.clear(); setShowInfo(true); } });
  const menu = useMenu(); const uploadMenu = useMenu();
  const missing = storages.isSuccess && !storage;
  const sel = a.selectedEntries;
  const crumbs = f.folder?.path ?? [];
  // The selected item, or — with nothing selected — the folder you are in.
  const detailEntry: FileEntry | null = sel.length === 1 ? sel[0]! : sel.length === 0 && f.folder ? { id: f.folder.id, storageId, parentId: f.folder.parentId, name: folderId === "root" ? title : f.folder.name, isFolder: true, mimeType: null, size: null, modifiedAt: null, createdAt: null, checksum: null, hasThumbnail: false, version: null } : null;
  const detailWhere = sel.length === 1 ? (crumbPath === "/" ? "/" : crumbPath) : crumbs.length > 1 ? "/" + crumbs.slice(0, -1).map((c) => c.name).join("/") : "/";

  const dropToFolder = (target: string, p: DropPayload, copy: boolean) => {
    // Items already in the target folder: nothing to do, and no progress dialog.
    if (!copy && p.storageId === storageId && p.ids.every((id) => f.entries.some((e) => e.id === id)) && target === folderId) return;
    void startTransfer(copy ? "COPY" : "MOVE", p.storageId, p.ids, { storageId, folderId: target, folderName: "folder tujuan" }).catch((er) => toast.error((er as Error).message));
  };

  const body = (() => {
    if (missing) return <EmptyState icon={HardDrive} title="Penyimpanan tidak ditemukan" action={<Button onClick={() => nav("/")}>Kembali ke beranda</Button>}>Penyimpanan ini mungkin sudah diputus atau Anda tidak punya akses.</EmptyState>;
    if (storage && storage.status !== "CONNECTED") return <EmptyState icon={HardDrive} title={storage.status === "DISABLED" ? "Penyimpanan dinonaktifkan" : "Penyimpanan perlu dihubungkan ulang"} action={<Button variant="primary" onClick={() => nav("/storage")}>Buka pengaturan penyimpanan</Button>}>{storage.lastError ?? "Koneksi ke penyimpanan ini tidak aktif."}</EmptyState>;
    if (f.error) return <EmptyState icon={FolderOpen} title="Folder tidak dapat dimuat" action={<Button onClick={() => f.refetch()}>Coba lagi</Button>}>{f.error instanceof ApiError ? f.error.message : "Terjadi kesalahan."}</EmptyState>;
    const filtered = f.entries.length > 0 && shown.length === 0;
    return (
      <FileBrowser
        entries={shown} view={view} selected={selection.selected} loading={f.isLoading || storages.isLoading}
        empty={<EmptyState icon={FolderPlus} title={filtered ? "Tidak ada yang cocok" : "Folder ini masih kosong"} action={filtered ? <Button onClick={() => setFilter(emptyFilter)}>Hapus filter</Button> : a.can("UPLOAD") ? <Button variant="primary" icon={<Upload className="size-4" />} onClick={a.pickFiles}>Unggah file</Button> : undefined}>{filtered ? "Ubah atau hapus filter untuk melihat semua isi folder." : "Tarik file ke sini, atau gunakan tombol Unggah."}</EmptyState>}
        onSelect={(e, m) => selection.click(e.id, shown, m)} onSetSelection={(ids) => selection.setSelected(new Set(ids))} onOpen={a.open}
        onContext={(e, x, y) => menu.open(x, y, a.menuFor(e))} onKeyAction={a.keyAction}
        onDropItems={a.dropItems} onDropFiles={(t, files) => a.upload(files, t ? t.id : folderId, t?.name)} dropLabel={`Unggah ke ${f.folder?.name || title}`}
      />
    );
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={title} subtitle={storage ? (storage.isDefault ? "Semua berkas di server ini" : `${PROVIDER_LABEL[storage.provider]}${storage.accountEmail ? ` · ${storage.accountEmail}` : ""}`) : undefined} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-surface px-4 py-2 sm:px-8">
        {sel.length === 0 ? (<>
          {a.can("UPLOAD") && <>
            <Button variant="primary" size="sm" icon={<Upload className="size-4" />} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); uploadMenu.open(r.left, r.bottom + 4, [{ label: "Unggah file", icon: <Upload />, onSelect: a.pickFiles }, { label: "Unggah folder", icon: <FolderInput />, onSelect: a.pickFolder }]); }}>Unggah</Button>
            <Button size="sm" icon={<FolderPlus className="size-4" />} onClick={a.newFolder}>Folder baru</Button>
          </>}
          <FilterButton value={filter} onChange={setFilter} />
        </>) : (<>
          <span className="mr-2 inline-flex items-center gap-1 rounded-lg bg-primary-soft py-1 pr-1 pl-2.5 text-[13px] font-medium text-primary-ink"><span className="tnum">{sel.length}</span> dipilih<IconButton label="Batal pilih" className="size-6" onClick={selection.clear}><X className="size-3.5" /></IconButton></span>
          {a.can("DOWNLOAD") && <Button size="sm" variant="ghost" aria-label="Unduh" icon={<Download className="size-4" />} onClick={a.downloadSelected}><span className="hidden sm:inline">{sel.length > 1 ? "Unduh ZIP" : "Unduh"}</span></Button>}
          {sel.length === 1 && <Button size="sm" variant="ghost" aria-label="Detail" className={cn(showInfo && "bg-surface-2")} icon={<Info className="size-4" />} onClick={() => setShowInfo(!showInfo)}><span className="hidden sm:inline">Detail</span></Button>}
          {a.can("SHARE") && <Button size="sm" variant="ghost" aria-label={sel.length > 1 ? `Bagikan ${sel.length} item` : "Bagikan"} icon={<Share2 className="size-4" />} onClick={() => a.share(sel)}><span className="hidden sm:inline">Bagikan</span></Button>}
          {a.can("COPY") && <Button size="sm" variant="ghost" aria-label="Salin" icon={<Copy className="size-4" />} onClick={() => a.transferSelected("COPY")}><span className="hidden sm:inline">Salin</span></Button>}
          {a.can("MOVE") && <Button size="sm" variant="ghost" aria-label="Pindahkan" icon={<FolderInput className="size-4" />} onClick={() => a.transferSelected("MOVE")}><span className="hidden sm:inline">Pindahkan</span></Button>}
          {a.can("DELETE") && <Button size="sm" variant="ghost" aria-label="Hapus" className="text-danger-ink hover:bg-danger-soft hover:text-danger-ink" icon={<Trash2 className="size-4" />} onClick={a.deleteSelected}><span className="hidden sm:inline">Hapus</span></Button>}
        </>)}
        <span className="flex-1" />
        <SortViewControls sort={sort} setSort={setSort} view={view} setView={setView} />
      </div>
      <FilterChips value={filter} onChange={setFilter} />
      <nav aria-label="Lokasi" className="flex items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-4 py-1.5 text-[13px] sm:px-8">
        {!storage?.isDefault && <><Link to="/files" className="rounded-md px-2 py-1 text-muted hover:bg-surface-2 hover:text-ink">Semua file</Link><ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden /></>}
        <CrumbDrop storageId={storageId} folderId="root" label={title} onDropTo={dropToFolder}>
          <button className={cn("rounded-md px-2 py-1 whitespace-nowrap hover:bg-surface-2", crumbs.length ? "text-muted hover:text-ink" : "font-semibold")} onClick={() => go("root")}>{title}</button>
        </CrumbDrop>
        {crumbs.map((c, i) => (
          <span key={c.id} className="flex items-center gap-0.5"><ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden />
            <CrumbDrop storageId={storageId} folderId={c.id} label={c.name} onDropTo={dropToFolder}>
              <button className={cn("rounded-md px-2 py-1 whitespace-nowrap hover:bg-surface-2", i === crumbs.length - 1 ? "font-semibold" : "text-muted hover:text-ink")} onClick={() => go(c.id)}>{c.name}</button>
            </CrumbDrop></span>))}
      </nav>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{body}</div>
        {showInfo && detailEntry && storage?.status === "CONNECTED" && <DetailsPanel key={detailEntry.id} entry={detailEntry} storageName={title} location={detailWhere} onClose={() => setShowInfo(false)} className="fixed inset-x-0 bottom-0 z-40 max-h-[75dvh] rounded-t-2xl border-t border-line shadow-float lg:static lg:z-auto lg:max-h-none lg:w-72 lg:shrink-0 lg:rounded-none lg:border-t-0 lg:border-l lg:shadow-none" />}
      </div>
      {menu.element}{uploadMenu.element}{a.dialogs}
    </div>
  );
}
