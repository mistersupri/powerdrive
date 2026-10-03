import React, { Suspense, useCallback, useMemo, useRef, useState } from "react";
import {
  CloudDownload,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FolderOpen,
  FolderPlus,
  Home,
  Info,
  Move,
  Pencil,
  RefreshCw,
  SearchX,
  Share2,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { FileItem, Folder, FolderPermission, GoogleDriveStatus, SyncStatus } from "../../types/frontend.ts";
import { api } from "../../services/api.ts";
import { useAuth } from "../../context/AuthContext.tsx";
import { formatBytes, formatDate, formatShortDate } from "../../lib/format.ts";
import { downloadFromUrl } from "../../lib/download.ts";
import { usePersistentState } from "../../lib/usePersistentState.ts";
import { Button } from "../../ui/Button.tsx";
import { ContextMenu, MenuItem } from "../../ui/Menu.tsx";
import { Badge, DriveLinkedBadge, PermissionBadge, SyncBadge } from "../../ui/Badge.tsx";
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
import { useDriveListing } from "./useDriveListing.ts";
import { ROOT_NAME, useBreadcrumbs } from "./useBreadcrumbs.ts";
import { useDriveActions } from "./useDriveActions.ts";
import { LazyThumbnail } from "../../components/LazyThumbnail.tsx";
import { InlineRenameModal } from "../../components/InlineRenameModal.tsx";
import { OperationLoadingModal } from "../../components/OperationLoadingModal.tsx";
import {
  FileConflictModal,
  FilePreviewModal,
  ImportGoogleDriveModal,
  ItemDetailsDrawer,
  MoveCopyModal,
  MultiPartZipModal,
  ShareFolderModal,
} from "../explorer/lazyDialogs.ts";

interface GoogleDriveExplorerProps {
  folders: Folder[];
  googleStatus: GoogleDriveStatus | null;
  currentFolderId: string | null;
  onNavigateFolder: (folderId: string | null) => void;
  onRefreshData: () => void;
}

type ItemRef = { type: "folder"; data: Folder } | { type: "file"; data: FileItem };

export const GoogleDriveExplorer: React.FC<GoogleDriveExplorerProps> = ({
  folders: allFolders,
  googleStatus,
  currentFolderId,
  onNavigateFolder,
  onRefreshData,
}) => {
  const { user, isAdmin } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [view, setView] = usePersistentState<"grid" | "list">("powerdrive:view", "grid");
  const [search, setSearch] = useState("");
  const listing = useDriveListing(currentFolderId, search);
  const { trail, folder: currentFolder } = useBreadcrumbs(currentFolderId, allFolders);
  const currentName = currentFolder?.name || (currentFolderId ? "Folder" : ROOT_NAME);

  const refreshAll = useCallback(() => {
    listing.refresh();
    onRefreshData();
  }, [listing, onRefreshData]);

  const actions = useDriveActions({
    currentFolderId,
    currentFolderName: currentName,
    allFolders,
    onChanged: refreshAll,
  });

  // Modals and drawers
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: ExplorerEntry } | null>(null);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [shareTarget, setShareTarget] = useState<ItemRef | null>(null);
  const [renameTarget, setRenameTarget] = useState<ItemRef | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<ItemRef | null>(null);
  const [moveCopy, setMoveCopy] = useState<{ mode: "move" | "copy"; files: FileItem[] } | null>(null);
  const [zip, setZip] = useState<{ folder?: Folder; files: FileItem[] } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const folderById = useMemo(() => new Map(listing.folders.map((f) => [f.id, f])), [listing.folders]);
  const fileById = useMemo(() => new Map(listing.files.map((f) => [f.id, f])), [listing.files]);
  const knownFolderById = useMemo(() => new Map(allFolders.map((f) => [f.id, f])), [allFolders]);
  const entries = useMemo(() => toEntries(listing.folders, listing.files), [listing.folders, listing.files]);

  const canUpload = useMemo(() => {
    if (!currentFolderId) return false; // the root holds folders only
    if (!currentFolder || isAdmin) return true;
    if (currentFolder.ownerId === user?.id) return true;
    return currentFolder.permission !== FolderPermission.VIEW;
  }, [currentFolderId, currentFolder, isAdmin, user]);

  const canImport = currentFolderId === null && (user?.authProvider === "GOOGLE" || !!googleStatus?.isConnected || !!user?.isGoogleConnected);

  const splitKeys = (keys: Iterable<string>) => {
    const folders: Folder[] = [];
    const files: FileItem[] = [];
    for (const key of keys) {
      if (key.startsWith("folder_")) {
        const f = folderById.get(key.slice(7));
        if (f) folders.push(f);
      } else if (key.startsWith("file_")) {
        const f = fileById.get(key.slice(5));
        if (f) files.push(f);
      }
    }
    return { folders, files };
  };

  const openEntry = (entry: ExplorerEntry) => {
    if (entry.kind === "folder") {
      setSearch("");
      onNavigateFolder(entry.id);
    } else {
      const file = fileById.get(entry.id);
      if (file) setPreviewFile(file);
    }
  };

  const explorer = useExplorer({
    entries,
    resetKey: `${currentFolderId}|${listing.isSearching}`,
    open: openEntry,
    onContextMenu: (entry, x, y) => setContextMenu({ x, y, entry }),
    dragEnabled: !listing.isSearching,
    onMove: (target, keys) => {
      const folderIds = keys.filter((k) => k.startsWith("folder_")).map((k) => k.slice(7));
      const fileIds = keys.filter((k) => k.startsWith("file_")).map((k) => k.slice(5));
      actions.moveItems(target === ROOT_TARGET ? null : target, folderIds, fileIds);
      explorer.selection.clear();
    },
    canDropOn: (target, keys) => !(target === ROOT_TARGET && keys.some((k) => k.startsWith("file_"))) && target !== currentFolderId,
    onDeleteKey: () => {
      const { folders, files } = splitKeys(explorer.selection.keys);
      actions.trashItems(folders, files);
    },
  });
  const { selection } = explorer;

  const drop = useFileDropZone((files) => (canUpload ? actions.uploadFiles(files) : undefined), !!currentFolderId);

  const selected = splitKeys(selection.keys);
  const selectedBytes = selected.files.reduce((sum, f) => sum + (f.size || 0), 0);

  const isFolderSynced = (folderId?: string | null) => {
    const f = folderId ? knownFolderById.get(folderId) || folderById.get(folderId) || (currentFolder?.id === folderId ? currentFolder : undefined) : undefined;
    return !!(f?.syncToGoogleDrive && f?.googleDriveFolderId);
  };

  const fileStatus = (file: FileItem) =>
    isFolderSynced(file.folderId) && file.syncStatus !== SyncStatus.LOCAL_ONLY ? <SyncBadge status={file.syncStatus} error={file.lastError} /> : null;

  // ----- context menu -----
  const menuFor = (entry: ExplorerEntry): MenuItem[] => {
    if (entry.kind === "folder") {
      const folder = folderById.get(entry.id);
      if (!folder) return [];
      const items: MenuItem[] = [
        { label: "Buka", icon: <FolderOpen className="w-4 h-4" />, onSelect: () => openEntry(entry) },
        { label: "Unduh sebagai ZIP", icon: <Download className="w-4 h-4" />, onSelect: () => setZip({ folder, files: [] }) },
      ];
      if (googleStatus?.isConnected) {
        items.push({
          label: folder.syncToGoogleDrive ? "Sinkronkan ulang ke Drive" : "Sinkronkan ke Google Drive",
          icon: <RefreshCw className="w-4 h-4" />,
          onSelect: () => actions.syncFolder(folder),
        });
      }
      items.push(
        { label: "Bagikan", icon: <Share2 className="w-4 h-4" />, onSelect: () => setShareTarget({ type: "folder", data: folder }) },
        { label: "Ubah nama", icon: <Pencil className="w-4 h-4" />, onSelect: () => setRenameTarget({ type: "folder", data: folder }) },
        { label: "Detail", icon: <Info className="w-4 h-4" />, onSelect: () => setDetailsTarget({ type: "folder", data: folder }) },
        {
          label: "Pindahkan ke Sampah",
          icon: <Trash2 className="w-4 h-4" />,
          danger: true,
          separated: true,
          onSelect: () => actions.trashItems([folder], []),
        }
      );
      return items;
    }
    const file = fileById.get(entry.id);
    if (!file) return [];
    const items: MenuItem[] = [
      { label: "Pratinjau", icon: <Eye className="w-4 h-4" />, onSelect: () => setPreviewFile(file) },
      { label: "Unduh", icon: <Download className="w-4 h-4" />, onSelect: () => downloadFromUrl(api.getDownloadUrl(file.id), file.originalName) },
      { label: "Bagikan", icon: <Share2 className="w-4 h-4" />, onSelect: () => setShareTarget({ type: "file", data: file }) },
      { label: "Salin ke folder lain", icon: <Copy className="w-4 h-4" />, onSelect: () => setMoveCopy({ mode: "copy", files: [file] }) },
      { label: "Pindahkan ke folder lain", icon: <Move className="w-4 h-4" />, onSelect: () => setMoveCopy({ mode: "move", files: [file] }) },
      { label: "Ubah nama", icon: <Pencil className="w-4 h-4" />, onSelect: () => setRenameTarget({ type: "file", data: file }) },
    ];
    if (file.syncStatus === SyncStatus.SYNCED && file.googleDriveWebViewLink) {
      items.push({
        label: "Buka di Google Drive",
        icon: <ExternalLink className="w-4 h-4" />,
        onSelect: () => window.open(file.googleDriveWebViewLink!, "_blank", "noopener"),
      });
    } else if (googleStatus?.isConnected) {
      items.push({ label: "Sinkronkan ke Drive", icon: <RefreshCw className="w-4 h-4" />, onSelect: () => actions.syncFiles([file]) });
    }
    items.push(
      { label: "Detail", icon: <Info className="w-4 h-4" />, onSelect: () => setDetailsTarget({ type: "file", data: file }) },
      { label: "Pindahkan ke Sampah", icon: <Trash2 className="w-4 h-4" />, danger: true, separated: true, onSelect: () => actions.trashItems([], [file]) }
    );
    return items;
  };

  // ----- render -----
  const pickFiles = () => fileInputRef.current?.click();
  const showSkeleton = listing.status === "loading";
  const isEmpty = listing.status === "ready" && listing.folders.length === 0 && listing.files.length === 0;

  const uploadButton = canUpload && (
    <Button variant="primary" icon={<UploadCloud className="w-4 h-4" />} onClick={pickFiles}>
      <span className="hidden sm:inline">Unggah</span>
    </Button>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 relative" {...drop.bind}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          actions.uploadFiles(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />

      {drop.isOver && <DropOverlay label={`Lepas untuk mengunggah ke "${currentName}"`} disabled={!canUpload} />}

      {/* Toolbar: path, then search and actions */}
      <div className="sticky top-0 z-20 bg-canvas border-b border-ink-200">
        <div className="px-3 sm:px-6 pt-2.5 pb-1 flex items-center gap-3">
          <Breadcrumbs
            items={trail.map((c, i) => ({
              targetId: c.id ?? ROOT_TARGET,
              label: c.name,
              icon: i === 0 ? <Home className="w-4 h-4" /> : undefined,
            }))}
            onNavigate={(i) => {
              setSearch("");
              onNavigateFolder(trail[i].id);
            }}
            dnd={explorer.dnd}
            loadChildren={async (targetId) => {
              const res = await api.listFolders({ parentId: targetId === ROOT_TARGET ? "root" : targetId, limit: 100 });
              return (res.folders || []).filter((f) => !f.storageId).map((f) => ({ id: f.id, name: f.name }));
            }}
          />
          {listing.status === "ready" && (
            <span className="hidden sm:block text-xs text-ink-500 shrink-0 tabular">{listing.total} item</span>
          )}
        </div>
        <div className="px-3 sm:px-6 pb-2.5 pt-1 flex items-center gap-2">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={currentFolderId ? `Cari di ${currentName}` : "Cari folder dan berkas"}
          />
          <div className="flex items-center gap-2 ml-auto">
            <ViewToggle value={view} onChange={setView} />
            {canImport && (
              <Button icon={<CloudDownload className="w-4 h-4" />} onClick={() => setShowImport(true)} title="Impor folder dari Google Drive">
                <span className="hidden lg:inline">Impor dari Drive</span>
              </Button>
            )}
            <Button
              variant={currentFolderId ? "secondary" : "primary"}
              icon={<FolderPlus className="w-4 h-4" />}
              onClick={() => setShowCreate(true)}
              title="Folder baru"
            >
              <span className="hidden sm:inline">Folder baru</span>
            </Button>
            {uploadButton}
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

        {showSkeleton ? (
          <ItemsSkeleton files={!listing.isRoot} />
        ) : listing.status === "error" ? (
          <ErrorState message={listing.error || "Periksa koneksi Anda lalu coba lagi."} onRetry={listing.retry} />
        ) : isEmpty ? (
          listing.isSearching ? (
            <EmptyState
              icon={<SearchX className="w-6 h-6" />}
              title={`Tidak ada hasil untuk "${search.trim()}"`}
              description="Coba kata kunci lain, atau periksa ejaannya."
            >
              <Button size="md" onClick={() => setSearch("")}>
                Hapus pencarian
              </Button>
            </EmptyState>
          ) : currentFolderId ? (
            <EmptyState
              dashed
              icon={<UploadCloud className="w-6 h-6" />}
              title="Folder ini masih kosong"
              description={canUpload ? "Tarik berkas ke sini, atau pilih dari perangkat Anda." : "Anda hanya punya izin melihat folder ini."}
            >
              {canUpload && (
                <Button variant="primary" size="md" icon={<UploadCloud className="w-4 h-4" />} onClick={pickFiles}>
                  Pilih berkas
                </Button>
              )}
              <Button size="md" icon={<FolderPlus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
                Subfolder baru
              </Button>
            </EmptyState>
          ) : (
            <EmptyState
              dashed
              icon={<FolderPlus className="w-6 h-6" />}
              title="Mulai dengan membuat folder"
              description={`Berkas di Power Drive selalu disimpan di dalam folder. Buat folder pertama Anda${canImport ? ", atau impor dari Google Drive" : ""}.`}
            >
              <Button variant="primary" size="md" icon={<FolderPlus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
                Buat folder
              </Button>
              {canImport && (
                <Button size="md" icon={<CloudDownload className="w-4 h-4" />} onClick={() => setShowImport(true)}>
                  Impor dari Drive
                </Button>
              )}
            </EmptyState>
          )
        ) : (
          <>
            <ItemsView
              view={view}
              folders={listing.folders}
              files={listing.files}
              showFiles={!listing.isRoot}
              explorer={explorer}
              folderTitle={currentFolderId ? "Subfolder" : "Folder"}
              folderMeta={(f) => `${f.filesCount || 0} berkas · ${formatBytes(f.totalSizeBytes)}`}
              folderBadge={(f) => (f.syncToGoogleDrive && f.googleDriveFolderId ? <DriveLinkedBadge /> : null)}
              folderSub={(f) => f.description || undefined}
              folderColumns={[
                { label: "Akses", render: (f) => <PermissionBadge permission={f.permission} /> },
                { label: "Pemilik", render: (f) => f.ownerName || "-" },
                { label: "Isi", render: (f) => `${f.filesCount || 0} berkas` },
                { label: "Ukuran", render: (f) => formatBytes(f.totalSizeBytes) },
                { label: "Dibuat", render: (f) => formatDate(f.createdAt) },
              ]}
              fileMeta={(f) => `${formatBytes(f.size)} · ${formatShortDate(f.createdAt)}`}
              fileStatus={fileStatus}
              fileCorner={(f) => (f.version && f.version > 1 ? <Badge tone="solid">v{f.version}</Badge> : null)}
              fileSub={(f) => f.user?.name}
              fileColumns={[
                { label: "Google Drive", render: (f) => fileStatus(f) || <span className="text-ink-400">-</span> },
                { label: "Pengunggah", render: (f) => f.user?.name || "-" },
                { label: "Ukuran", render: (f) => formatBytes(f.size) },
                { label: "Diunggah", render: (f) => formatDate(f.createdAt) },
              ]}
              thumbnail={(f) => <LazyThumbnail file={f} />}
              emptyFiles={
                <div className="rounded-xl border-2 border-dashed border-ink-200 px-6 py-8 text-center text-sm text-ink-500">
                  Belum ada berkas di folder ini.{" "}
                  {canUpload && (
                    <button type="button" onClick={pickFiles} className="font-semibold text-ink-900 underline underline-offset-2">
                      Unggah berkas
                    </button>
                  )}
                </div>
              }
            />
            <LoadMore
              hasMore={listing.hasMore}
              loading={listing.isLoadingMore}
              onLoadMore={listing.loadMore}
              shown={listing.folders.length + listing.files.length}
              total={listing.total}
            />
          </>
        )}
      </div>

      <SelectionDock
        count={selection.count}
        summary={selected.files.length ? `${selected.folders.length ? `${selected.folders.length} folder, ` : ""}${selected.files.length} berkas · ${formatBytes(selectedBytes)}` : undefined}
        onClear={selection.clear}
        onSelectAll={selection.selectAll}
      >
        {selected.folders.length === 1 && selected.files.length === 0 && (
          <DockAction icon={<FolderOpen className="w-4 h-4" />} label="Buka" onClick={() => openEntry({ key: "", kind: "folder", id: selected.folders[0].id, name: "" })} />
        )}
        {selected.files.length > 0 && selected.folders.length === 0 && (
          <DockAction
            icon={<Download className="w-4 h-4" />}
            label="Unduh"
            onClick={() =>
              selected.files.length === 1
                ? downloadFromUrl(api.getDownloadUrl(selected.files[0].id), selected.files[0].originalName)
                : setZip({ files: selected.files })
            }
          />
        )}
        {selected.folders.length === 1 && selected.files.length === 0 && (
          <DockAction icon={<Download className="w-4 h-4" />} label="Unduh ZIP" onClick={() => setZip({ folder: selected.folders[0], files: [] })} />
        )}
        {selection.count === 1 && (
          <DockAction
            icon={<Share2 className="w-4 h-4" />}
            label="Bagikan"
            onClick={() =>
              setShareTarget(selected.folders[0] ? { type: "folder", data: selected.folders[0] } : { type: "file", data: selected.files[0] })
            }
          />
        )}
        {selected.files.length > 0 && selected.folders.length === 0 && (
          <>
            <DockAction icon={<Copy className="w-4 h-4" />} label="Salin" onClick={() => setMoveCopy({ mode: "copy", files: selected.files })} />
            <DockAction icon={<Move className="w-4 h-4" />} label="Pindahkan" onClick={() => setMoveCopy({ mode: "move", files: selected.files })} />
            {googleStatus?.isConnected && (
              <DockAction icon={<RefreshCw className="w-4 h-4" />} label="Sinkronkan" onClick={() => actions.syncFiles(selected.files)} />
            )}
          </>
        )}
        <DockAction
          icon={<Trash2 className="w-4 h-4" />}
          label="Hapus"
          danger
          onClick={async () => {
            if (await actions.trashItems(selected.folders, selected.files)) selection.clear();
          }}
        />
      </SelectionDock>

      <TouchDragBadge badge={explorer.dnd.touchBadge} />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          title={contextMenu.entry.name}
          items={menuFor(contextMenu.entry)}
          onClose={() => setContextMenu(null)}
        />
      )}

      <CreateFolderDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={actions.createFolder}
        parentName={currentName}
      />

      <Suspense fallback={null}>
      {previewFile && (
        <FilePreviewModal file={previewFile} filesList={listing.files} onClose={() => setPreviewFile(null)} onNavigateFile={setPreviewFile} />
      )}

      {shareTarget && (
        <ShareFolderModal
          folder={shareTarget.type === "folder" ? shareTarget.data : undefined}
          file={shareTarget.type === "file" ? shareTarget.data : undefined}
          onClose={() => setShareTarget(null)}
          onPermissionUpdated={refreshAll}
        />
      )}

      {renameTarget && (
        <InlineRenameModal
          item={renameTarget}
          onClose={() => setRenameTarget(null)}
          onSave={async (name) => {
            if (renameTarget.type === "folder") await api.updateFolder(renameTarget.data.id, { name });
            else await api.renameFile(renameTarget.data.id, name);
            refreshAll();
          }}
        />
      )}

      {detailsTarget && (
        <ItemDetailsDrawer
          item={detailsTarget}
          googleStatus={googleStatus}
          onClose={() => setDetailsTarget(null)}
          onPreviewFile={setPreviewFile}
          onShareFolder={(f) => setShareTarget({ type: "folder", data: f })}
          onSyncFolder={actions.syncFolder}
          onSyncFile={(f) => actions.syncFiles([f])}
          onRename={(item) => setRenameTarget(item)}
        />
      )}

      {showImport && (
      <ImportGoogleDriveModal
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        onSuccess={(imported) => {
          refreshAll();
          if (imported?.id) onNavigateFolder(imported.id);
        }}
        currentFolderId={currentFolderId}
        existingFolders={allFolders}
      />
      )}

      {zip && <MultiPartZipModal isOpen={!!zip} onClose={() => setZip(null)} selectedFiles={zip?.files || []} selectedFolder={zip?.folder} />}

      {actions.conflicts && (
      <FileConflictModal
        isOpen={!!actions.conflicts}
        conflicts={actions.conflicts?.items || []}
        targetFolderName={currentName}
        onClose={actions.cancelConflicts}
        onResolve={actions.resolveConflicts}
      />
      )}

      {moveCopy && (
        <MoveCopyModal
          files={moveCopy.files}
          mode={moveCopy.mode}
          onClose={() => setMoveCopy(null)}
          onSuccess={() => {
            selection.clear();
            refreshAll();
          }}
        />
      )}

      </Suspense>

      <OperationLoadingModal {...actions.operation} />
    </div>
  );
};
