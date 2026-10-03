import React, { Suspense, useMemo, useRef, useState } from "react";
import { Copy, Download, Eye, FolderOpen, FolderPlus, Info, Move, Pencil, SearchX, Server, Trash2, UploadCloud } from "lucide-react";
import {
  DriveType,
  FileItem,
  Folder,
  FolderPermission,
  MountDrive,
  MountFileItem,
  PreviewStatus,
  SyncStatus,
} from "../../types/frontend.ts";
import { api } from "../../services/api.ts";
import { useDialog } from "../../context/DialogContext.tsx";
import { useTransfer } from "../../context/TransferContext.tsx";
import { describeItemCount, formatBytes, formatDate, formatDateTime, formatShortDate } from "../../lib/format.ts";
import { downloadFromUrl } from "../../lib/download.ts";
import { usePersistentState } from "../../lib/usePersistentState.ts";
import { Button } from "../../ui/Button.tsx";
import { ContextMenu, MenuItem } from "../../ui/Menu.tsx";
import { Dialog, DialogBody, DialogHeader } from "../../ui/Dialog.tsx";
import { useExplorer } from "../explorer/useExplorer.ts";
import { useFileDropZone } from "../explorer/useFileDropZone.ts";
import { ROOT_TARGET, TouchDragBadge } from "../explorer/useItemDragDrop.ts";
import { MarqueeBox } from "../explorer/useMarquee.ts";
import { ExplorerEntry } from "../explorer/types.ts";
import { ItemsView, toEntries } from "../explorer/ItemsView.tsx";
import { Breadcrumbs } from "../explorer/Breadcrumbs.tsx";
import { CreateFolderDialog } from "../explorer/CreateFolderDialog.tsx";
import {
  DockAction,
  DropOverlay,
  EmptyState,
  ErrorState,
  ItemsSkeleton,
  LoadMore,
  SearchField,
  SelectionDock,
  TopProgress,
  ViewToggle,
} from "../explorer/ExplorerParts.tsx";
import { useMountListing } from "./useMountListing.ts";
import { LazyThumbnail } from "../../components/LazyThumbnail.tsx";
import { InlineRenameModal } from "../../components/InlineRenameModal.tsx";
import { FilePreviewModal, MoveCopyMountModal } from "../explorer/lazyDialogs.ts";
import { OperationLoadingModal } from "../../components/OperationLoadingModal.tsx";

interface MountedDriveExplorerProps {
  mount: MountDrive;
  onRefreshMounts: () => void;
}

// The shared explorer views speak Folder/FileItem; mount entries are adapted to them.
function toFolder(dir: MountFileItem): Folder {
  return {
    id: dir.id,
    name: dir.name,
    targetFolderPath: dir.fullPath,
    targetDriveType: DriveType.MY_DRIVE,
    permission: FolderPermission.EDIT,
    createdAt: dir.modifiedAt,
    updatedAt: dir.modifiedAt,
  };
}

function toFile(mountId: string, file: MountFileItem): FileItem {
  const viewUrl = api.getMountFileViewUrl(mountId, file.relativePath);
  return {
    id: file.id,
    folderId: mountId,
    userId: "system",
    originalName: file.name,
    storagePath: file.fullPath,
    size: file.size,
    mimeType: file.mimeType || "application/octet-stream",
    checksumSha256: "",
    syncStatus: SyncStatus.LOCAL_ONLY,
    previewStatus: PreviewStatus.READY,
    syncAttempts: 0,
    createdAt: file.modifiedAt,
    updatedAt: file.modifiedAt,
    mountSource: {
      mountId,
      relativePath: file.relativePath,
      viewUrl,
      downloadUrl: api.getMountFileDownloadUrl(mountId, file.relativePath),
    },
  };
}

export const MountedDriveExplorer: React.FC<MountedDriveExplorerProps> = ({ mount, onRefreshMounts }) => {
  const { showAlert, showConfirm, showToast } = useDialog();
  const { startMountUploadWithProgress } = useTransfer();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [subPath, setSubPath] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = usePersistentState<"grid" | "list">("powerdrive:view", "grid");
  const listing = useMountListing(mount.id, subPath, search);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: ExplorerEntry } | null>(null);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [renameItem, setRenameItem] = useState<MountFileItem | null>(null);
  const [detailsItem, setDetailsItem] = useState<MountFileItem | null>(null);
  const [moveCopy, setMoveCopy] = useState<{ mode: "move" | "copy"; items: MountFileItem[] } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [operation, setOperation] = useState<{ isOpen: boolean; title: string; message?: string }>({ isOpen: false, title: "" });

  const itemById = useMemo(() => new Map(listing.items.map((i) => [i.id, i])), [listing.items]);
  const folders = useMemo(() => listing.folders.map(toFolder), [listing.folders]);
  const files = useMemo(() => listing.files.map((f) => toFile(mount.id, f)), [listing.files, mount.id]);
  const entries = useMemo(() => toEntries(folders, files), [folders, files]);
  const location = subPath ? subPath.split("/").pop()! : mount.name;

  const refresh = () => {
    listing.refresh();
    onRefreshMounts();
  };

  const navigate = (path: string) => {
    setSearch("");
    setSubPath(path);
  };

  const openEntry = (entry: ExplorerEntry) => {
    const item = itemById.get(entry.id);
    if (!item) return;
    if (item.isDirectory) navigate(item.relativePath);
    else setPreviewFile(toFile(mount.id, item));
  };

  const selectedItems = (keys: Iterable<string>) =>
    Array.from(keys)
      .map((k) => itemById.get(k.replace(/^(folder|file)_/, "")))
      .filter(Boolean) as MountFileItem[];

  const deleteItems = async (items: MountFileItem[]) => {
    if (items.length === 0) return false;
    const dirs = items.filter((i) => i.isDirectory).length;
    const label = items.length === 1 ? `"${items[0].name}"` : describeItemCount(dirs, items.length - dirs);
    const ok = await showConfirm({
      title: "Hapus permanen?",
      message: `${label} akan dihapus langsung dari ${mount.mountPoint}. Penyimpanan server tidak punya Sampah, jadi tindakan ini tidak bisa dibatalkan.`,
      confirmText: "Hapus permanen",
      isDanger: true,
    });
    if (!ok) return false;
    setOperation({ isOpen: true, title: "Menghapus", message: label });
    let failed = 0;
    for (const item of items) {
      try {
        await api.deleteMountItem(mount.id, item.relativePath);
      } catch {
        failed += 1;
      }
    }
    setOperation({ isOpen: false, title: "" });
    if (failed) {
      showAlert({ title: "Sebagian item tidak terhapus", message: `${failed} item gagal dihapus. Periksa izin tulis direktori tersebut.`, type: "warning" });
    } else {
      showToast(`${items.length === 1 ? label : label.charAt(0).toUpperCase() + label.slice(1)} dihapus`, "success");
    }
    refresh();
    return true;
  };

  const resolveTarget = (target: string) => {
    if (target === ROOT_TARGET) return "";
    return itemById.get(target)?.relativePath ?? target;
  };

  const explorer = useExplorer({
    entries,
    resetKey: `${subPath}|${listing.isSearching}`,
    open: openEntry,
    onContextMenu: (entry, x, y) => setContextMenu({ x, y, entry }),
    dragEnabled: !listing.isSearching,
    canDropOn: (target) => resolveTarget(target) !== subPath,
    onMove: async (target, keys) => {
      const sources = selectedItems(keys).map((i) => i.relativePath);
      const dest = resolveTarget(target);
      if (sources.length === 0) return;
      setOperation({ isOpen: true, title: "Memindahkan", message: `${sources.length} item ke ${dest || mount.name}` });
      try {
        const res = await api.bulkMoveMountItems(mount.id, sources, dest);
        if (res.success === false) throw new Error(res.message);
        showToast(res.message || "Item dipindahkan", "success");
        explorer.selection.clear();
      } catch (err: any) {
        showAlert({ title: "Gagal memindahkan", message: err?.message || "Item tidak dapat dipindahkan.", type: "error" });
      } finally {
        setOperation({ isOpen: false, title: "" });
        listing.refresh();
      }
    },
    onDeleteKey: () => deleteItems(selectedItems(explorer.selection.keys)),
  });
  const { selection } = explorer;

  const uploadFiles = (list: File[]) => {
    if (list.length === 0) return;
    startMountUploadWithProgress({
      mountId: mount.id,
      mountName: mount.name,
      subPath,
      files: list,
      onComplete: refresh,
    });
  };
  const drop = useFileDropZone(uploadFiles, mount.isWritable !== false);

  const selected = selectedItems(selection.keys);
  const selectedFiles = selected.filter((i) => !i.isDirectory);

  const menuFor = (entry: ExplorerEntry): MenuItem[] => {
    const item = itemById.get(entry.id);
    if (!item) return [];
    const common: MenuItem[] = [
      { label: "Salin ke…", icon: <Copy className="w-4 h-4" />, onSelect: () => setMoveCopy({ mode: "copy", items: selectedOr(item) }) },
      { label: "Pindahkan ke…", icon: <Move className="w-4 h-4" />, onSelect: () => setMoveCopy({ mode: "move", items: selectedOr(item) }) },
      { label: "Ubah nama", icon: <Pencil className="w-4 h-4" />, onSelect: () => setRenameItem(item) },
      { label: "Detail", icon: <Info className="w-4 h-4" />, onSelect: () => setDetailsItem(item) },
      { label: "Hapus permanen", icon: <Trash2 className="w-4 h-4" />, danger: true, separated: true, onSelect: () => deleteItems(selectedOr(item)) },
    ];
    if (item.isDirectory) {
      return [{ label: "Buka", icon: <FolderOpen className="w-4 h-4" />, onSelect: () => navigate(item.relativePath) }, ...common];
    }
    return [
      { label: "Pratinjau", icon: <Eye className="w-4 h-4" />, onSelect: () => setPreviewFile(toFile(mount.id, item)) },
      {
        label: "Unduh",
        icon: <Download className="w-4 h-4" />,
        onSelect: () => downloadFromUrl(api.getMountFileDownloadUrl(mount.id, item.relativePath), item.name),
      },
      ...common,
    ];
  };

  // Menu actions apply to the whole selection when the clicked item is part of it.
  const selectedOr = (item: MountFileItem) => {
    const sel = selectedItems(selection.ref.current);
    return sel.some((s) => s.id === item.id) ? sel : [item];
  };

  const crumbs = useMemo(() => {
    const list = [{ targetId: ROOT_TARGET, label: mount.name, path: "", icon: <Server className="w-4 h-4" /> as React.ReactNode }];
    let acc = "";
    for (const part of subPath.split("/").filter(Boolean)) {
      acc = acc ? `${acc}/${part}` : part;
      list.push({ targetId: acc, label: part, path: acc, icon: undefined as unknown as React.ReactNode });
    }
    return list;
  }, [mount.name, subPath]);

  const pickFiles = () => fileInputRef.current?.click();
  const writable = mount.isWritable !== false;
  const isEmpty = listing.status === "ready" && listing.items.length === 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 relative" {...drop.bind}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          uploadFiles(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      {drop.isOver && <DropOverlay label={`Lepas untuk mengunggah ke "${location}"`} />}

      <div className="sticky top-0 z-20 bg-canvas border-b border-ink-200">
        <div className="px-3 sm:px-6 pt-2.5 pb-1 flex items-center gap-3">
          <Breadcrumbs
            items={crumbs}
            onNavigate={(i) => navigate(crumbs[i].path)}
            dnd={explorer.dnd}
            loadChildren={async (targetId) => {
              const res = await api.browseMountDirectory(mount.id, resolveTarget(targetId), { limit: 100 });
              return (res.items || []).filter((i) => i.isDirectory).map((i) => ({ id: i.relativePath, name: i.name }));
            }}
          />
          <span className="hidden sm:block text-xs font-mono text-ink-500 shrink-0 truncate max-w-[16rem]" title={mount.mountPoint}>
            {mount.mountPoint}
          </span>
        </div>
        <div className="px-3 sm:px-6 pb-2.5 pt-1 flex items-center gap-2">
          <SearchField value={search} onChange={setSearch} placeholder={`Cari di ${location}`} />
          <div className="flex items-center gap-2 ml-auto">
            <ViewToggle value={view} onChange={setView} />
            {writable && (
              <>
                <Button icon={<FolderPlus className="w-4 h-4" />} onClick={() => setShowCreate(true)} title="Folder baru">
                  <span className="hidden sm:inline">Folder baru</span>
                </Button>
                <Button variant="primary" icon={<UploadCloud className="w-4 h-4" />} onClick={pickFiles}>
                  <span className="hidden sm:inline">Unggah</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div
        ref={explorer.contentRef}
        onMouseDown={explorer.marquee.onMouseDown}
        onClick={explorer.marquee.onBackgroundClick}
        className="relative flex-1 overflow-y-auto px-3 sm:px-6 pt-5 pb-32 md:pb-24"
      >
        <TopProgress active={listing.isRefreshing || listing.isSearchPending} />
        <MarqueeBox box={explorer.marquee.box} />

        {listing.status === "loading" ? (
          <ItemsSkeleton />
        ) : listing.status === "error" ? (
          <ErrorState message={listing.error || "Direktori tidak dapat dibaca."} onRetry={listing.retry} />
        ) : isEmpty ? (
          listing.isSearching ? (
            <EmptyState icon={<SearchX className="w-6 h-6" />} title={`Tidak ada hasil untuk "${search.trim()}"`} description="Pencarian hanya mencakup direktori ini.">
              <Button size="md" onClick={() => setSearch("")}>
                Hapus pencarian
              </Button>
            </EmptyState>
          ) : (
            <EmptyState
              dashed
              icon={<FolderOpen className="w-6 h-6" />}
              title="Direktori ini kosong"
              description={writable ? "Tarik berkas ke sini, atau pilih dari perangkat Anda." : "Penyimpanan ini hanya bisa dibaca."}
            >
              {writable && (
                <Button variant="primary" size="md" icon={<UploadCloud className="w-4 h-4" />} onClick={pickFiles}>
                  Pilih berkas
                </Button>
              )}
            </EmptyState>
          )
        ) : (
          <>
            <ItemsView
              view={view}
              folders={folders}
              files={files}
              showFiles={files.length > 0}
              explorer={explorer}
              folderTitle="Folder"
              folderMeta={(f) => `Diubah ${formatShortDate(f.updatedAt)}`}
              folderColumns={[{ label: "Diubah", render: (f) => formatDate(f.updatedAt) }]}
              fileMeta={(f) => `${formatBytes(f.size)} · ${formatShortDate(f.updatedAt)}`}
              fileColumns={[
                { label: "Jenis", render: (f) => f.mimeType },
                { label: "Ukuran", render: (f) => formatBytes(f.size) },
                { label: "Diubah", render: (f) => formatDate(f.updatedAt) },
              ]}
              thumbnail={(f) => {
                const item = itemById.get(f.id);
                return (
                  <LazyThumbnail
                    file={f}
                    imageUrl={item?.isImage ? f.mountSource?.viewUrl : undefined}
                    videoUrl={item?.isVideo ? f.mountSource?.viewUrl : undefined}
                  />
                );
              }}
            />
            <LoadMore
              hasMore={listing.hasMore}
              loading={listing.isLoadingMore}
              onLoadMore={listing.loadMore}
              shown={listing.items.length}
              total={listing.total}
            />
          </>
        )}
      </div>

      <SelectionDock
        count={selection.count}
        summary={selectedFiles.length ? `${formatBytes(selectedFiles.reduce((s, f) => s + f.size, 0))}` : undefined}
        onClear={selection.clear}
        onSelectAll={selection.selectAll}
      >
        {selected.length === 1 && selected[0].isDirectory && (
          <DockAction icon={<FolderOpen className="w-4 h-4" />} label="Buka" onClick={() => navigate(selected[0].relativePath)} />
        )}
        {selectedFiles.length > 0 && (
          <DockAction
            icon={<Download className="w-4 h-4" />}
            label="Unduh"
            onClick={() =>
              selectedFiles.forEach((f, i) =>
                setTimeout(() => downloadFromUrl(api.getMountFileDownloadUrl(mount.id, f.relativePath), f.name), i * 250)
              )
            }
          />
        )}
        {writable && (
          <>
            <DockAction icon={<Copy className="w-4 h-4" />} label="Salin" onClick={() => setMoveCopy({ mode: "copy", items: selected })} />
            <DockAction icon={<Move className="w-4 h-4" />} label="Pindahkan" onClick={() => setMoveCopy({ mode: "move", items: selected })} />
            <DockAction icon={<Trash2 className="w-4 h-4" />} label="Hapus" danger onClick={() => deleteItems(selected)} />
          </>
        )}
      </SelectionDock>

      <TouchDragBadge badge={explorer.dnd.touchBadge} />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          title={contextMenu.entry.name}
          items={menuFor(contextMenu.entry).filter((m) => writable || !["Salin ke…", "Pindahkan ke…", "Ubah nama", "Hapus permanen"].includes(m.label))}
          onClose={() => setContextMenu(null)}
        />
      )}

      <CreateFolderDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        parentName={location}
        withDescription={false}
        onCreate={async (name) => {
          await api.createMountFolder(mount.id, subPath, name);
          showToast(`Folder "${name}" dibuat`, "success");
          refresh();
        }}
      />

      <Suspense fallback={null}>
        {previewFile && <FilePreviewModal file={previewFile} filesList={files} onClose={() => setPreviewFile(null)} onNavigateFile={setPreviewFile} />}
      </Suspense>

      {renameItem && (
        <InlineRenameModal
          item={renameItem.isDirectory ? { type: "folder", data: toFolder(renameItem) } : { type: "file", data: toFile(mount.id, renameItem) }}
          onClose={() => setRenameItem(null)}
          onSave={async (name) => {
            await api.renameMountItem(mount.id, renameItem.relativePath, name);
            showToast("Nama diubah", "success");
            listing.refresh();
          }}
        />
      )}

      <Dialog open={!!detailsItem} onClose={() => setDetailsItem(null)} size="sm">
        {detailsItem && (
          <>
            <DialogHeader title={detailsItem.name} description={detailsItem.isDirectory ? "Folder" : detailsItem.mimeType} onClose={() => setDetailsItem(null)} />
            <DialogBody className="pb-5">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-ink-500">Lokasi</dt>
                <dd className="font-mono text-xs text-ink-800 break-all">{detailsItem.fullPath}</dd>
                {!detailsItem.isDirectory && (
                  <>
                    <dt className="text-ink-500">Ukuran</dt>
                    <dd className="text-ink-800 tabular">{formatBytes(detailsItem.size)}</dd>
                  </>
                )}
                <dt className="text-ink-500">Diubah</dt>
                <dd className="text-ink-800">{formatDateTime(detailsItem.modifiedAt)}</dd>
              </dl>
            </DialogBody>
          </>
        )}
      </Dialog>

      {moveCopy && (
        <Suspense fallback={null}>
        <MoveCopyMountModal
          mountId={mount.id}
          items={moveCopy.items}
          mode={moveCopy.mode}
          onClose={() => setMoveCopy(null)}
          onSuccess={(msg) => {
            showToast(msg, "success");
            selection.clear();
            listing.refresh();
          }}
        />
        </Suspense>
      )}

      <OperationLoadingModal isOpen={operation.isOpen} title={operation.title} message={operation.message} type="sync" />
    </div>
  );
};
