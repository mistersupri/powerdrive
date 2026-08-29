import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  HardDrive,
  Folder as FolderIcon,
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  FileCode,
  FileSpreadsheet,
  FileArchive,
  Download,
  Eye,
  Play,
  Trash2,
  Upload,
  Plus,
  RefreshCw,
  Search,
  LayoutGrid,
  List as ListIcon,
  ChevronRight,
  ArrowLeft,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  FolderPlus,
  Cloud,
  Check,
  X,
  FileUp,
  Share2,
  Edit3,
  Info,
  Layers,
  MoreVertical,
  CheckSquare,
  Square,
  SearchX,
  ShieldCheck,
} from "lucide-react";
import {
  MountDrive,
  MountFileItem,
  MountBrowseResult,
  Folder,
  FileItem,
  SyncStatus,
  IndexerStatus,
  IndexingState,
  FolderPermission,
  DriveType,
} from "../types/frontend.ts";
import { api } from "../services/api.ts";
import { useDialog } from "../context/DialogContext.tsx";
import { useTransfer } from "../context/TransferContext.tsx";
import { FilePreviewModal } from "./FilePreviewModal.tsx";
import { OperationLoadingModal, OperationType } from "./OperationLoadingModal.tsx";
import { ShareFolderModal } from "./ShareFolderModal.tsx";
import { InlineRenameModal } from "./InlineRenameModal.tsx";
import { ItemDetailsDrawer } from "./ItemDetailsDrawer.tsx";
import { ContextMenu, ContextMenuState } from "./ContextMenu.tsx";

interface MountedDriveExplorerProps {
  mount: MountDrive;
  folders: Folder[];
  onRefreshMounts: () => void;
}

export const MountedDriveExplorer: React.FC<MountedDriveExplorerProps> = ({
  mount,
  folders,
  onRefreshMounts,
}) => {
  const { showAlert, showConfirm, showToast } = useDialog();
  const { startFileDownload, startMountUploadWithProgress } = useTransfer();

  // Navigation & Data State
  const [subPath, setSubPath] = useState<string>("");
  const [browseData, setBrowseData] = useState<MountBrowseResult | null>(null);
  const [indexerStatus, setIndexerStatus] = useState<IndexerStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState<"name" | "size" | "modified">("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Selection & Multi-select State
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  // Marquee Rubberband Selection
  const [marqueeBox, setMarqueeBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const [dragStartSelection, setDragStartSelection] = useState<Set<string>>(new Set());
  const hasDraggedMarqueeRef = useRef<boolean>(false);

  // Modals & Drawers
  const [isCreatingFolder, setIsCreatingFolder] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>("");
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isSyncingMetadata, setIsSyncingMetadata] = useState<boolean>(false);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [shareFolderModal, setShareFolderModal] = useState<Folder | null>(null);
  const [renameItem, setRenameItem] = useState<{
    type: "folder" | "file";
    data: Folder | FileItem;
    mountItem?: MountFileItem;
  } | null>(null);
  const [detailsItem, setDetailsItem] = useState<{
    type: "folder" | "file";
    data: Folder | FileItem;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Import to Google Drive State
  const [importingItem, setImportingItem] = useState<MountFileItem | null>(null);
  const [selectedTargetFolderId, setSelectedTargetFolderId] = useState<string>(folders[0]?.id || "");
  const [isImporting, setIsImporting] = useState<boolean>(false);

  // Operation loading modal
  const [operationLoading, setOperationLoading] = useState<{
    isOpen: boolean;
    title: string;
    message?: string;
    type?: OperationType;
    subMessage?: string;
  }>({ isOpen: false, title: "" });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);

  // Helper: convert MountFileItem to Frontend Folder
  const mountDirToFolder = useCallback(
    (dir: MountFileItem): Folder => {
      return {
        id: dir.id,
        name: dir.name,
        description: `Folder lokal di ${dir.fullPath}`,
        parentId: subPath === "" ? mount.id : "folder-parent",
        ownerId: "system",
        ownerName: "Mounted Storage /mnt",
        permission: FolderPermission.EDIT,
        targetDriveType: DriveType.MY_DRIVE,
        targetDriveId: null,
        targetFolderPath: dir.fullPath,
        googleDriveFolderId: null,
        syncToGoogleDrive: false,
        createdAt: dir.modifiedAt,
        updatedAt: dir.modifiedAt,
      };
    },
    [mount.id, subPath]
  );

  // Helper: convert MountDrive to Root Folder
  const mountToRootFolder = useCallback((): Folder => {
    return {
      id: mount.id,
      name: mount.name,
      description: `Titik pasang sistem lokal: ${mount.mountPoint}`,
      parentId: null,
      ownerId: "system",
      ownerName: "Mounted Storage /mnt",
      permission: FolderPermission.EDIT,
      targetDriveType: DriveType.MY_DRIVE,
      targetDriveId: null,
      targetFolderPath: mount.mountPoint,
      googleDriveFolderId: null,
      syncToGoogleDrive: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }, [mount.id, mount.name, mount.mountPoint]);

  // Helper: convert MountFileItem to FileItem
  const mountFileToFileItem = useCallback(
    (file: MountFileItem): FileItem => {
      const viewUrl = api.getMountFileViewUrl(mount.id, file.relativePath);
      const downloadUrl = api.getMountFileDownloadUrl(mount.id, file.relativePath);
      return {
        id: file.id,
        folderId: mount.id,
        userId: "system",
        originalName: file.name,
        storagePath: file.fullPath,
        size: file.size,
        mimeType: file.mimeType || "application/octet-stream",
        checksumSha256: file.id,
        syncStatus: SyncStatus.SYNCED,
        syncAttempts: 0,
        createdAt: file.modifiedAt,
        updatedAt: file.modifiedAt,
        googleDriveWebViewLink: viewUrl,
      };
    },
    [mount.id]
  );

  // Load directory contents (progressive & instant on-demand)
  const loadDirectory = useCallback(
    async (path: string = "") => {
      setIsLoading(true);
      try {
        const data = await api.browseMountDirectory(mount.id, path);
        setBrowseData(data);
        if (data.indexingStatus) {
          setIndexerStatus(data.indexingStatus);
        }
      } catch (err: any) {
        showAlert({
          title: "Gagal Membaca Direktori",
          message: err.message || "Tidak dapat memuat isi folder pada drive mount.",
          type: "error",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [mount.id, showAlert]
  );

  useEffect(() => {
    setSubPath("");
    setSearchTerm("");
    setSelectedKeys(new Set());
    loadDirectory("");
  }, [mount.id, loadDirectory]);

  // Polling indexer status when background indexing is running
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    const fetchStatus = async () => {
      try {
        const status = await api.getMountSyncStatus(mount.id);
        setIndexerStatus(status);
        if (status.isIndexing || status.state === "indexing") {
          timer = setTimeout(fetchStatus, 2500);
        }
      } catch {
        // Silent catch for background polling
      }
    };

    if (indexerStatus?.isIndexing || indexerStatus?.state === "indexing" || isSyncingMetadata) {
      timer = setTimeout(fetchStatus, 2000);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [mount.id, indexerStatus?.isIndexing, indexerStatus?.state, isSyncingMetadata]);

  // Navigate into subfolder
  const handleNavigate = (newSubPath: string) => {
    setSubPath(newSubPath);
    setSearchTerm("");
    setSelectedKeys(new Set());
    loadDirectory(newSubPath);
  };

  // Format bytes helper
  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // Format date helper
  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  // Filter items based on search query and category
  const rawItems = browseData?.items || [];

  const filteredItems = useMemo(() => {
    return rawItems.filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;

      if (categoryFilter === "ALL") return true;
      if (item.isDirectory) return true; // Keep folders visible or toggleable

      if (categoryFilter === "IMAGE") return item.isImage;
      if (categoryFilter === "VIDEO") return item.isVideo;
      if (categoryFilter === "DOCUMENT") return item.isText || item.isOfficeDoc || item.isPdf;
      if (categoryFilter === "SPREADSHEET") return item.isOfficeDoc;
      if (categoryFilter === "PDF") return item.isPdf;
      if (categoryFilter === "CODE") return item.isText;
      if (categoryFilter === "ARCHIVE") return item.isArchive;
      if (categoryFilter === "AUDIO") return item.isAudio;
      return true;
    });
  }, [rawItems, searchTerm, categoryFilter]);

  // Sort items
  const sortedDirectories = useMemo(() => {
    const dirs = filteredItems.filter((i) => i.isDirectory);
    return dirs.sort((a, b) => {
      if (sortBy === "name") {
        return sortOrder === "asc"
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      }
      if (sortBy === "modified") {
        return sortOrder === "asc"
          ? new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime()
          : new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
      }
      return 0;
    });
  }, [filteredItems, sortBy, sortOrder]);

  const sortedFiles = useMemo(() => {
    const files = filteredItems.filter((i) => !i.isDirectory);
    return files.sort((a, b) => {
      if (sortBy === "name") {
        return sortOrder === "asc"
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      }
      if (sortBy === "size") {
        return sortOrder === "asc" ? a.size - b.size : b.size - a.size;
      }
      if (sortBy === "modified") {
        return sortOrder === "asc"
          ? new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime()
          : new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
      }
      return 0;
    });
  }, [filteredItems, sortBy, sortOrder]);

  // Combined visible items for keyboard & multi-selection
  const allVisibleItems = useMemo(() => {
    const list: { key: string; type: "folder" | "file"; item: MountFileItem }[] = [];
    sortedDirectories.forEach((d) => list.push({ key: `folder_${d.id}`, type: "folder", item: d }));
    sortedFiles.forEach((f) => list.push({ key: `file_${f.id}`, type: "file", item: f }));
    return list;
  }, [sortedDirectories, sortedFiles]);

  const selectedFolders = useMemo(() => {
    return sortedDirectories.filter((d) => selectedKeys.has(`folder_${d.id}`));
  }, [sortedDirectories, selectedKeys]);

  const selectedFiles = useMemo(() => {
    return sortedFiles.filter((f) => selectedKeys.has(`file_${f.id}`));
  }, [sortedFiles, selectedKeys]);

  const selectedCount = selectedKeys.size;

  // Selection Click Handler
  const handleItemClick = (
    e: React.MouseEvent,
    key: string,
    type: "folder" | "file",
    item: MountFileItem
  ) => {
    if (hasDraggedMarqueeRef.current) return;

    if (e.shiftKey && lastSelectedKey) {
      const lastIdx = allVisibleItems.findIndex((it) => it.key === lastSelectedKey);
      const currIdx = allVisibleItems.findIndex((it) => it.key === key);
      if (lastIdx !== -1 && currIdx !== -1) {
        const start = Math.min(lastIdx, currIdx);
        const end = Math.max(lastIdx, currIdx);
        const rangeKeys = new Set(selectedKeys);
        for (let i = start; i <= end; i++) {
          rangeKeys.add(allVisibleItems[i].key);
        }
        setSelectedKeys(rangeKeys);
        return;
      }
    }

    if (e.ctrlKey || e.metaKey) {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setLastSelectedKey(key);
      return;
    }

    // Single item selection
    setSelectedKeys(new Set([key]));
    setLastSelectedKey(key);
  };

  const handleToggleSelectKey = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setLastSelectedKey(key);
  };

  const handleSelectAll = () => {
    const all = new Set<string>();
    allVisibleItems.forEach((it) => all.add(it.key));
    setSelectedKeys(all);
  };

  // Rubberband Marquee Drag Selection
  const handleMouseDownOnContainer = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        "[data-selectable-key], button, a, input, select, textarea, [data-prevent-marquee]"
      )
    ) {
      return;
    }

    const rect = contentAreaRef.current?.getBoundingClientRect();
    if (!rect) return;

    const startX = e.clientX;
    const startY = e.clientY;

    const preserve = e.ctrlKey || e.metaKey || e.shiftKey;
    setDragStartSelection(preserve ? new Set(selectedKeys) : new Set());

    setMarqueeBox({
      startX,
      startY,
      currentX: startX,
      currentY: startY,
    });
  };

  useEffect(() => {
    if (!marqueeBox) return;

    const handleMouseMove = (e: MouseEvent) => {
      setMarqueeBox((prev) =>
        prev ? { ...prev, currentX: e.clientX, currentY: e.clientY } : null
      );

      const minX = Math.min(marqueeBox.startX, e.clientX);
      const maxX = Math.max(marqueeBox.startX, e.clientX);
      const minY = Math.min(marqueeBox.startY, e.clientY);
      const maxY = Math.max(marqueeBox.startY, e.clientY);

      if (Math.hypot(e.clientX - marqueeBox.startX, e.clientY - marqueeBox.startY) > 4) {
        hasDraggedMarqueeRef.current = true;
        const newSelected = new Set(dragStartSelection);
        const elements = contentAreaRef.current?.querySelectorAll("[data-selectable-key]");
        if (elements) {
          elements.forEach((el) => {
            const rect = el.getBoundingClientRect();
            const intersects = !(
              rect.right < minX ||
              rect.left > maxX ||
              rect.bottom < minY ||
              rect.top > maxY
            );
            const key = el.getAttribute("data-selectable-key");
            if (key) {
              if (intersects) {
                newSelected.add(key);
              } else if (!dragStartSelection.has(key)) {
                newSelected.delete(key);
              }
            }
          });
        }
        setSelectedKeys(newSelected);
      }
    };

    const handleMouseUp = () => {
      setMarqueeBox(null);
      setTimeout(() => {
        hasDraggedMarqueeRef.current = false;
      }, 120);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [marqueeBox, dragStartSelection]);

  const handleContainerClick = (e: React.MouseEvent) => {
    if (hasDraggedMarqueeRef.current) return;
    const target = e.target as HTMLElement;
    if (
      !target.closest(
        "[data-selectable-key], button, a, input, select, textarea, [data-prevent-marquee]"
      )
    ) {
      setSelectedKeys(new Set());
      setLastSelectedKey(null);
    }
  };

  // Handle Create Folder
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newFolderName.trim();
    if (!clean) return;

    try {
      await api.createMountFolder(mount.id, subPath, clean);
      showToast(`Folder "${clean}" berhasil dibuat`, "success");
      setNewFolderName("");
      setIsCreatingFolder(false);
      loadDirectory(subPath);
      onRefreshMounts();
    } catch (err: any) {
      showAlert({
        title: "Gagal Membuat Folder",
        message: err.message || "Terjadi kesalahan saat membuat folder.",
        type: "error",
      });
    }
  };

  // Listen for global background mount upload completion events
  useEffect(() => {
    const handleMountRefresh = () => {
      loadDirectory(subPath);
      onRefreshMounts();
    };
    window.addEventListener("powerdrive:refresh-mounts", handleMountRefresh);
    return () => {
      window.removeEventListener("powerdrive:refresh-mounts", handleMountRefresh);
    };
  }, [subPath, loadDirectory, onRefreshMounts]);

  // Handle File Upload
  const handleUploadFiles = async (fileList: File[]) => {
    if (!fileList || fileList.length === 0) return;
    if (fileInputRef.current) fileInputRef.current.value = "";

    await startMountUploadWithProgress({
      mountId: mount.id,
      mountName: mount.name,
      subPath: subPath,
      files: fileList,
      onComplete: () => {
        loadDirectory(subPath);
        onRefreshMounts();
      },
    });
  };

  // Handle Delete Single Item
  const handleDeleteItem = async (item: MountFileItem) => {
    const isDir = item.isDirectory;
    const confirmed = await showConfirm({
      title: isDir ? "Hapus Folder Mount?" : "Hapus Berkas Mount?",
      message: isDir
        ? `Apakah Anda yakin ingin menghapus folder "${item.name}" beserta seluruh isinya secara permanen dari sistem penyimpanan lokal?`
        : `Apakah Anda yakin ingin menghapus berkas "${item.name}" secara permanen dari sistem penyimpanan lokal?`,
      isDanger: true,
      confirmText: "Hapus Permanen",
      cancelText: "Batal",
    });

    if (!confirmed) return;

    setOperationLoading({
      isOpen: true,
      title: isDir ? "Menghapus Folder" : "Menghapus Berkas",
      message: `Menghapus "${item.name}" dari ${mount.name}...`,
      type: "delete",
    });

    try {
      await api.deleteMountItem(mount.id, item.relativePath);
      showToast(`"${item.name}" berhasil dihapus`, "success");
      loadDirectory(subPath);
      onRefreshMounts();
    } catch (err: any) {
      showAlert({
        title: "Gagal Menghapus Item",
        message: err.message || "Terjadi kesalahan saat menghapus item.",
        type: "error",
      });
    } finally {
      setOperationLoading({ isOpen: false, title: "" });
    }
  };

  // Handle Batch Delete
  const handleBatchDelete = async () => {
    if (selectedCount === 0) return;

    const confirmed = await showConfirm({
      title: `Hapus ${selectedCount} Item Terpilih?`,
      message: `Apakah Anda yakin ingin menghapus ${selectedCount} item yang dipilih secara permanen dari penyimpanan ${mount.name}? Tindakan ini tidak dapat dibatalkan.`,
      isDanger: true,
      confirmText: "Hapus Semua",
      cancelText: "Batal",
    });

    if (!confirmed) return;

    setOperationLoading({
      isOpen: true,
      title: "Menghapus Item Terpilih",
      message: `Menghapus ${selectedCount} item...`,
      type: "delete",
    });

    try {
      let successCount = 0;
      for (const dir of selectedFolders) {
        await api.deleteMountItem(mount.id, dir.relativePath).catch(() => {});
        successCount++;
      }
      for (const file of selectedFiles) {
        await api.deleteMountItem(mount.id, file.relativePath).catch(() => {});
        successCount++;
      }
      showToast(`${successCount} item berhasil dihapus`, "success");
      setSelectedKeys(new Set());
      loadDirectory(subPath);
      onRefreshMounts();
    } catch (err: any) {
      showAlert({
        title: "Gagal Menghapus Batch",
        message: err.message || "Terjadi kesalahan saat menghapus item terpilih.",
        type: "error",
      });
    } finally {
      setOperationLoading({ isOpen: false, title: "" });
    }
  };

  // Handle Batch Download
  const handleBatchDownload = () => {
    if (selectedFiles.length === 0) {
      showToast("Pilih setidaknya satu berkas untuk diunduh", "warning");
      return;
    }
    selectedFiles.forEach((file, index) => {
      setTimeout(() => {
        startFileDownload(file.id, file.name, file.size);
      }, index * 200);
    });
    showToast(`Mengunduh ${selectedFiles.length} berkas...`, "info");
  };

  // Handle Single File Download
  const handleDownloadFile = (file: MountFileItem) => {
    startFileDownload(file.id, file.name, file.size);
  };

  // Handle Sync Metadata
  const handleSyncMetadata = async () => {
    setIsSyncingMetadata(true);
    showToast("Memulai sinkronisasi metadata dengan database...", "info");
    try {
      await api.syncMount(mount.id);
      showToast("Sinkronisasi metadata database selesai", "success");
      loadDirectory(subPath);
      onRefreshMounts();
    } catch (err: any) {
      showAlert({
        title: "Gagal Sinkronisasi",
        message: err.message || "Terjadi kesalahan saat menyinkronkan metadata.",
        type: "error",
      });
    } finally {
      setIsSyncingMetadata(false);
    }
  };

  // Handle Execute Import to Google Drive
  const handleExecuteImport = async () => {
    if (!importingItem || !selectedTargetFolderId) return;

    setIsImporting(true);
    try {
      const res = await api.importMountFileToDrive(
        mount.id,
        importingItem.relativePath,
        selectedTargetFolderId
      );
      showToast(res.message || "Berkas berhasil diantrekan ke Google Drive", "success");
      setImportingItem(null);
      onRefreshMounts();
    } catch (err: any) {
      showAlert({
        title: "Gagal Mengimpor ke Google Drive",
        message: err.message || "Terjadi kesalahan saat mengimpor berkas.",
        type: "error",
      });
    } finally {
      setIsImporting(false);
    }
  };

  // Handle Save Rename
  const handleSaveRename = async (newName: string) => {
    if (!renameItem) return;
    try {
      const relPath =
        renameItem.mountItem?.relativePath ||
        (renameItem.type === "folder"
          ? (renameItem.data as Folder).name
          : (renameItem.data as FileItem).originalName);

      await api.renameMountItem(mount.id, relPath, newName);
      showToast(`Nama berhasil diubah menjadi "${newName}"`, "success");
      loadDirectory(subPath);
      onRefreshMounts();
    } catch (err: any) {
      showAlert({
        title: "Gagal Mengubah Nama",
        message: err.message || "Terjadi kesalahan saat mengubah nama item.",
        type: "error",
      });
    }
  };

  // Right-Click Context Menu Handlers
  const handleContextMenu = (
    e: React.MouseEvent,
    type: "folder" | "file",
    item: MountFileItem
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const itemKey = type === "folder" ? `folder_${item.id}` : `file_${item.id}`;
    if (!selectedKeys.has(itemKey)) {
      setSelectedKeys(new Set([itemKey]));
      setLastSelectedKey(itemKey);
    }

    if (type === "folder") {
      const folderObj = mountDirToFolder(item);
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        type: "folder",
        folder: folderObj,
      });
    } else {
      const fileObj = mountFileToFileItem(item);
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        type: "file",
        file: fileObj,
      });
    }
  };

  // Render Icon Helper for categories
  const renderItemIcon = (item: MountFileItem) => {
    if (item.isDirectory) {
      return <FolderIcon className="w-5 h-5 text-amber-500 fill-amber-500/20" />;
    }
    if (item.isImage) return <ImageIcon className="w-5 h-5 text-purple-500" />;
    if (item.isVideo) return <Video className="w-5 h-5 text-rose-500" />;
    if (item.isAudio) return <Music className="w-5 h-5 text-emerald-500" />;
    if (item.isPdf) return <FileText className="w-5 h-5 text-red-500" />;
    if (item.isText) return <FileCode className="w-5 h-5 text-blue-500" />;
    if (item.isOfficeDoc) return <FileSpreadsheet className="w-5 h-5 text-teal-500" />;
    if (item.isArchive) return <FileArchive className="w-5 h-5 text-amber-600" />;
    return <FileText className="w-5 h-5 text-slate-500" />;
  };

  // Drag & Drop Handlers for Canvas
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUploadFiles(Array.from(e.dataTransfer.files));
    }
  };

  // Category filter items
  const categoryFilters = [
    { id: "ALL", label: "Semua" },
    { id: "IMAGE", label: "Gambar" },
    { id: "VIDEO", label: "Video" },
    { id: "DOCUMENT", label: "Dokumen" },
    { id: "SPREADSHEET", label: "Spreadsheet" },
    { id: "PDF", label: "PDF" },
    { id: "CODE", label: "Kode" },
    { id: "ARCHIVE", label: "Arsip" },
    { id: "AUDIO", label: "Audio" },
  ];

  return (
    <div
      ref={contentAreaRef}
      className="flex-1 flex flex-col h-full bg-slate-50/50 overflow-hidden relative select-none"
      onMouseDown={handleMouseDownOnContainer}
      onClick={handleContainerClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleUploadFiles(Array.from(e.target.files));
          }
        }}
        multiple
        className="hidden"
      />

      {/* Drag & Drop Visual Overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-blue-600/10 backdrop-blur-sm border-2 border-dashed border-blue-500 rounded-xl m-3 flex flex-col items-center justify-center pointer-events-none transition-all animate-in fade-in">
          <div className="p-4 bg-white rounded-2xl shadow-xl border border-blue-100 flex flex-col items-center text-center max-w-sm">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600 mb-3 shadow-inner">
              <UploadCloud className="w-8 h-8 animate-bounce" />
            </div>
            <h3 className="text-base font-semibold text-slate-800">
              Lepaskan berkas untuk mengunggah
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Berkas akan disimpan langsung ke {mount.name}
              {subPath ? ` / ${subPath}` : ""}
            </p>
          </div>
        </div>
      )}

      {/* Marquee Selection Box */}
      {marqueeBox && (
        <div
          className="fixed pointer-events-none border border-blue-500 bg-blue-500/15 rounded z-50"
          style={{
            left: Math.min(marqueeBox.startX, marqueeBox.currentX),
            top: Math.min(marqueeBox.startY, marqueeBox.currentY),
            width: Math.abs(marqueeBox.currentX - marqueeBox.startX),
            height: Math.abs(marqueeBox.currentY - marqueeBox.startY),
          }}
        />
      )}

      {/* TOP ACTION BAR / HEADER */}
      <div className="bg-white border-b border-slate-200/80 px-6 py-4 flex-shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Left Title & Status */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white shadow-sm shadow-blue-200">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-slate-800 tracking-tight flex items-center gap-1.5">
                  {mount.name}
                </h1>
                <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200/60">
                  {mount.mountPoint}
                </span>

                {/* Indexing Status Pill */}
                {indexerStatus && (
                  <div
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                      indexerStatus.state === "indexing" || isSyncingMetadata
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : indexerStatus.state === "ready"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-slate-50 text-slate-600 border-slate-200"
                    }`}
                  >
                    {indexerStatus.state === "indexing" || isSyncingMetadata ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin text-amber-600" />
                        <span>Mengindeks...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>Tersinkronisasi DB</span>
                      </>
                    )}
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {rawItems.length} item dimuat • Kapasitas: {mount.usedSpace} / {mount.totalSpace}
              </p>
            </div>
          </div>

          {/* Right Action Buttons */}
          <div className="flex items-center flex-wrap gap-2">
            {/* New Folder Button */}
            <button
              onClick={() => setIsCreatingFolder(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm"
              title="Buat folder baru di path saat ini"
            >
              <FolderPlus className="w-4 h-4 text-amber-500" />
              <span>Folder Baru</span>
            </button>

            {/* Upload Button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-sm shadow-blue-200 transition-colors"
              title="Unggah berkas ke folder saat ini"
            >
              {isUploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <UploadCloud className="w-4 h-4" />
              )}
              <span>Unggah Berkas</span>
            </button>

            {/* Share Drive Button */}
            <button
              onClick={() => setShareFolderModal(mountToRootFolder())}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm"
              title="Bagikan akses tautan publik untuk storage ini"
            >
              <Share2 className="w-4 h-4 text-blue-600" />
              <span>Bagikan Storage</span>
            </button>

            {/* Sync DB Button */}
            <button
              onClick={handleSyncMetadata}
              disabled={isSyncingMetadata}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm disabled:opacity-50"
              title="Pindai ulang dan sinkronkan metadata ke PostgreSQL"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-slate-500 ${
                  isSyncingMetadata ? "animate-spin text-blue-600" : ""
                }`}
              />
              <span className="hidden sm:inline">Sinkronkan DB</span>
            </button>

            {/* Refresh Button */}
            <button
              onClick={() => loadDirectory(subPath)}
              disabled={isLoading}
              className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              title="Segarkan data folder"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Create Folder Inline Form Modal */}
        {isCreatingFolder && (
          <div className="mt-3 p-3 bg-blue-50/70 border border-blue-100 rounded-xl flex items-center gap-2 animate-in fade-in">
            <FolderPlus className="w-5 h-5 text-blue-600 flex-shrink-0" />
            <form onSubmit={handleCreateFolder} className="flex-1 flex items-center gap-2">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Nama folder baru..."
                autoFocus
                className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={!newFolderName.trim()}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-sm"
              >
                Buat
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCreatingFolder(false);
                  setNewFolderName("");
                }}
                className="px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-200/60 rounded-lg"
              >
                Batal
              </button>
            </form>
          </div>
        )}

        {/* BREADCRUMBS & TOOLBAR */}
        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Breadcrumbs Trail */}
          <nav className="flex items-center gap-1 overflow-x-auto text-xs py-1 scrollbar-none">
            <button
              onClick={() => handleNavigate("")}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors ${
                subPath === ""
                  ? "font-semibold text-blue-700 bg-blue-50"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>{mount.name}</span>
            </button>

            {browseData?.breadcrumbs?.slice(1).map((crumb, idx) => {
              const isLast = idx === (browseData.breadcrumbs?.length || 0) - 2;
              return (
                <React.Fragment key={crumb.subPath}>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                  <button
                    onClick={() => handleNavigate(crumb.subPath)}
                    className={`px-2 py-1 rounded-md whitespace-nowrap transition-colors ${
                      isLast
                        ? "font-semibold text-blue-700 bg-blue-50"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                    }`}
                  >
                    {crumb.name}
                  </button>
                </React.Fragment>
              );
            })}
          </nav>

          {/* Search, Filter & View Mode Controls */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Search Input */}
            <div className="relative w-48 sm:w-60">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Cari dalam storage..."
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/80">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded-md transition-colors ${
                  viewMode === "grid"
                    ? "bg-white text-blue-600 shadow-xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
                title="Tampilan Grid"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-1.5 rounded-md transition-colors ${
                  viewMode === "list"
                    ? "bg-white text-blue-600 shadow-xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
                title="Tampilan Daftar"
              >
                <ListIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* CATEGORY FILTER CHIPS */}
        <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none text-xs">
          {categoryFilters.map((cat) => {
            const isActive = categoryFilter === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setCategoryFilter(cat.id)}
                className={`px-2.5 py-1 rounded-full whitespace-nowrap font-medium transition-all ${
                  isActive
                    ? "bg-blue-600 text-white shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        {isLoading && !browseData ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
            <p className="text-sm">Memuat konten storage...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          /* EMPTY STATE */
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-slate-400 mb-4 shadow-inner">
              {searchTerm ? <SearchX className="w-8 h-8" /> : <HardDrive className="w-8 h-8" />}
            </div>
            <h3 className="text-base font-semibold text-slate-700">
              {searchTerm ? "Tidak ada item yang cocok" : "Folder ini masih kosong"}
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mt-1">
              {searchTerm
                ? `Tidak ditemukan berkas atau folder dengan kata kunci "${searchTerm}".`
                : "Unggah berkas atau buat folder baru untuk mulai mengisi penyimpanan terpasang ini."}
            </p>
            <div className="mt-5 flex items-center gap-2">
              <button
                onClick={() => setIsCreatingFolder(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-xs"
              >
                <FolderPlus className="w-4 h-4 text-amber-500" />
                <span>Buat Folder</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm"
              >
                <UploadCloud className="w-4 h-4" />
                <span>Unggah Berkas</span>
              </button>
            </div>
          </div>
        ) : viewMode === "grid" ? (
          /* GRID VIEW */
          <div className="space-y-6">
            {/* DIRECTORIES SECTION */}
            {sortedDirectories.length > 0 && (
              <div>
                <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <FolderIcon className="w-3.5 h-3.5 text-amber-500" />
                  <span>Folder ({sortedDirectories.length})</span>
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {sortedDirectories.map((dir) => {
                    const itemKey = `folder_${dir.id}`;
                    const isSelected = selectedKeys.has(itemKey);
                    const folderObj = mountDirToFolder(dir);

                    return (
                      <div
                        key={dir.id}
                        data-selectable-key={itemKey}
                        onClick={(e) => handleItemClick(e, itemKey, "folder", dir)}
                        onDoubleClick={() => handleNavigate(dir.relativePath)}
                        onContextMenu={(e) => handleContextMenu(e, "folder", dir)}
                        className={`group relative p-3 rounded-2xl border transition-all cursor-pointer select-none ${
                          isSelected
                            ? "bg-blue-50/70 border-blue-400 ring-2 ring-blue-400/30 shadow-sm"
                            : "bg-white border-slate-200/80 hover:border-slate-300 hover:shadow-sm"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600 flex-shrink-0 group-hover:scale-105 transition-transform">
                              <FolderIcon className="w-4 h-4 fill-amber-500/20" />
                            </div>
                            <span className="text-xs font-semibold text-slate-800 truncate" title={dir.name}>
                              {dir.name}
                            </span>
                          </div>

                          {/* Hover Checkbox */}
                          <div
                            onClick={(e) => handleToggleSelectKey(e, itemKey)}
                            className={`p-1 rounded transition-opacity ${
                              isSelected
                                ? "text-blue-600 opacity-100"
                                : "text-slate-400 opacity-0 group-hover:opacity-100 hover:text-slate-600"
                            }`}
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </div>
                        </div>

                        {/* Folder Quick Actions on Hover */}
                        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                          <span className="truncate">{formatDate(dir.modifiedAt)}</span>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {/* Share Folder */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setShareFolderModal(folderObj);
                              }}
                              className="p-1 hover:text-blue-600 hover:bg-blue-50 rounded"
                              title="Bagikan folder"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>
                            {/* Rename Folder */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenameItem({ type: "folder", data: folderObj, mountItem: dir });
                              }}
                              className="p-1 hover:text-slate-700 hover:bg-slate-100 rounded"
                              title="Ubah nama"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            {/* Delete Folder */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteItem(dir);
                              }}
                              className="p-1 hover:text-red-600 hover:bg-red-50 rounded"
                              title="Hapus folder"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* FILES SECTION */}
            {sortedFiles.length > 0 && (
              <div>
                <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-blue-500" />
                  <span>Berkas ({sortedFiles.length})</span>
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {sortedFiles.map((file) => {
                    const itemKey = `file_${file.id}`;
                    const isSelected = selectedKeys.has(itemKey);
                    const fileObj = mountFileToFileItem(file);

                    return (
                      <div
                        key={file.id}
                        data-selectable-key={itemKey}
                        onClick={(e) => handleItemClick(e, itemKey, "file", file)}
                        onDoubleClick={() => setPreviewFile(fileObj)}
                        onContextMenu={(e) => handleContextMenu(e, "file", file)}
                        className={`group relative flex flex-col rounded-2xl border transition-all cursor-pointer select-none overflow-hidden ${
                          isSelected
                            ? "bg-blue-50/70 border-blue-400 ring-2 ring-blue-400/30 shadow-sm"
                            : "bg-white border-slate-200/80 hover:border-slate-300 hover:shadow-sm"
                        }`}
                      >
                        {/* File Thumbnail / Preview Area */}
                        <div className="h-28 bg-slate-100/70 relative flex items-center justify-center overflow-hidden border-b border-slate-100">
                          {file.isImage ? (
                            <img
                              src={api.getMountFileViewUrl(mount.id, file.relativePath)}
                              alt={file.name}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                              loading="lazy"
                            />
                          ) : file.isVideo ? (
                            <div className="relative w-full h-full flex items-center justify-center bg-slate-900">
                              <Video className="w-8 h-8 text-rose-400 opacity-60" />
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-xs flex items-center justify-center text-white">
                                  <Play className="w-4 h-4 fill-white translate-x-0.5" />
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center">
                              <div className="p-3 rounded-xl bg-white shadow-xs border border-slate-200/60">
                                {renderItemIcon(file)}
                              </div>
                            </div>
                          )}

                          {/* Extension Badge */}
                          <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/60 backdrop-blur-xs text-white text-[10px] font-mono font-bold rounded">
                            {file.extension.toUpperCase() || "FILE"}
                          </div>

                          {/* Top-Right Selection Checkbox */}
                          <div
                            onClick={(e) => handleToggleSelectKey(e, itemKey)}
                            className={`absolute top-2 right-2 p-1 rounded-md bg-white/80 backdrop-blur-xs shadow-xs transition-opacity ${
                              isSelected
                                ? "text-blue-600 opacity-100"
                                : "text-slate-400 opacity-0 group-hover:opacity-100 hover:text-slate-700"
                            }`}
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </div>
                        </div>

                        {/* File Details Deck */}
                        <div className="p-3 flex-1 flex flex-col justify-between">
                          <div>
                            <span className="text-xs font-semibold text-slate-800 line-clamp-1 group-hover:text-blue-600 transition-colors" title={file.name}>
                              {file.name}
                            </span>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              {formatBytes(file.size)} • {formatDate(file.modifiedAt)}
                            </p>
                          </div>

                          {/* Quick Bottom Action Buttons */}
                          <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                            {/* Preview */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewFile(fileObj);
                              }}
                              className="p-1 hover:text-blue-600 hover:bg-blue-50 rounded"
                              title="Pratinjau berkas"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>

                            {/* Download */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownloadFile(file);
                              }}
                              className="p-1 hover:text-emerald-600 hover:bg-emerald-50 rounded"
                              title="Unduh berkas"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>

                            {/* Import to Google Drive */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setImportingItem(file);
                              }}
                              className="p-1 hover:text-blue-600 hover:bg-blue-50 rounded"
                              title="Impor ke Google Drive"
                            >
                              <UploadCloud className="w-3.5 h-3.5" />
                            </button>

                            {/* Rename */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenameItem({ type: "file", data: fileObj, mountItem: file });
                              }}
                              className="p-1 hover:text-slate-700 hover:bg-slate-100 rounded"
                              title="Ubah nama"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>

                            {/* Delete */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteItem(file);
                              }}
                              className="p-1 hover:text-red-600 hover:bg-red-50 rounded"
                              title="Hapus berkas"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* LIST VIEW TABLE */
          <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200/80 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4 w-10">
                      <div
                        onClick={handleSelectAll}
                        className="cursor-pointer text-slate-400 hover:text-slate-600"
                        title="Pilih Semua"
                      >
                        {selectedCount > 0 && selectedCount === allVisibleItems.length ? (
                          <CheckSquare className="w-4 h-4 text-blue-600" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </div>
                    </th>
                    <th className="py-3 px-4">Nama</th>
                    <th className="py-3 px-4 hidden md:table-cell">Ukuran</th>
                    <th className="py-3 px-4 hidden lg:table-cell">Tipe</th>
                    <th className="py-3 px-4 hidden sm:table-cell">Terakhir Diubah</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {/* DIRECTORIES IN LIST */}
                  {sortedDirectories.map((dir) => {
                    const itemKey = `folder_${dir.id}`;
                    const isSelected = selectedKeys.has(itemKey);
                    const folderObj = mountDirToFolder(dir);

                    return (
                      <tr
                        key={dir.id}
                        data-selectable-key={itemKey}
                        onClick={(e) => handleItemClick(e, itemKey, "folder", dir)}
                        onDoubleClick={() => handleNavigate(dir.relativePath)}
                        onContextMenu={(e) => handleContextMenu(e, "folder", dir)}
                        className={`group cursor-pointer transition-colors ${
                          isSelected ? "bg-blue-50/60" : "hover:bg-slate-50/70"
                        }`}
                      >
                        <td className="py-2.5 px-4">
                          <div
                            onClick={(e) => handleToggleSelectKey(e, itemKey)}
                            className={isSelected ? "text-blue-600" : "text-slate-300 group-hover:text-slate-400"}
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2.5">
                            <FolderIcon className="w-4 h-4 text-amber-500 fill-amber-500/20 flex-shrink-0" />
                            <span className="font-semibold text-slate-800 group-hover:text-blue-600 transition-colors">
                              {dir.name}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-slate-400 hidden md:table-cell">—</td>
                        <td className="py-2.5 px-4 text-slate-500 hidden lg:table-cell">Folder</td>
                        <td className="py-2.5 px-4 text-slate-500 hidden sm:table-cell">
                          {formatDate(dir.modifiedAt)}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setShareFolderModal(folderObj);
                              }}
                              className="p-1 hover:text-blue-600 hover:bg-blue-50 rounded"
                              title="Bagikan folder"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenameItem({ type: "folder", data: folderObj, mountItem: dir });
                              }}
                              className="p-1 hover:text-slate-700 hover:bg-slate-100 rounded"
                              title="Ubah nama"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteItem(dir);
                              }}
                              className="p-1 hover:text-red-600 hover:bg-red-50 rounded"
                              title="Hapus folder"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {/* FILES IN LIST */}
                  {sortedFiles.map((file) => {
                    const itemKey = `file_${file.id}`;
                    const isSelected = selectedKeys.has(itemKey);
                    const fileObj = mountFileToFileItem(file);

                    return (
                      <tr
                        key={file.id}
                        data-selectable-key={itemKey}
                        onClick={(e) => handleItemClick(e, itemKey, "file", file)}
                        onDoubleClick={() => setPreviewFile(fileObj)}
                        onContextMenu={(e) => handleContextMenu(e, "file", file)}
                        className={`group cursor-pointer transition-colors ${
                          isSelected ? "bg-blue-50/60" : "hover:bg-slate-50/70"
                        }`}
                      >
                        <td className="py-2.5 px-4">
                          <div
                            onClick={(e) => handleToggleSelectKey(e, itemKey)}
                            className={isSelected ? "text-blue-600" : "text-slate-300 group-hover:text-slate-400"}
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2.5">
                            {renderItemIcon(file)}
                            <span className="font-medium text-slate-800 group-hover:text-blue-600 transition-colors">
                              {file.name}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-slate-500 font-mono hidden md:table-cell">
                          {formatBytes(file.size)}
                        </td>
                        <td className="py-2.5 px-4 text-slate-400 font-mono uppercase hidden lg:table-cell">
                          {file.extension || "FILE"}
                        </td>
                        <td className="py-2.5 px-4 text-slate-500 hidden sm:table-cell">
                          {formatDate(file.modifiedAt)}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewFile(fileObj);
                              }}
                              className="p-1 hover:text-blue-600 hover:bg-blue-50 rounded"
                              title="Pratinjau berkas"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownloadFile(file);
                              }}
                              className="p-1 hover:text-emerald-600 hover:bg-emerald-50 rounded"
                              title="Unduh berkas"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setImportingItem(file);
                              }}
                              className="p-1 hover:text-blue-600 hover:bg-blue-50 rounded"
                              title="Impor ke Google Drive"
                            >
                              <UploadCloud className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenameItem({ type: "file", data: fileObj, mountItem: file });
                              }}
                              className="p-1 hover:text-slate-700 hover:bg-slate-100 rounded"
                              title="Ubah nama"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteItem(file);
                              }}
                              className="p-1 hover:text-red-600 hover:bg-red-50 rounded"
                              title="Hapus berkas"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* MULTI-ITEM FLOATING SELECTION TOOLBAR */}
      {selectedCount > 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 text-white px-5 py-2.5 rounded-2xl shadow-2xl border border-slate-700 backdrop-blur-md flex items-center gap-4 animate-in slide-in-from-bottom-5">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-[10px]">
              {selectedCount}
            </span>
            <span>Item Dipilih</span>
          </div>

          <div className="h-4 w-px bg-slate-700" />

          <div className="flex items-center gap-1.5">
            {selectedFiles.length > 0 && (
              <button
                onClick={handleBatchDownload}
                className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors text-slate-200"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>Unduh ({selectedFiles.length})</span>
              </button>
            )}

            <button
              onClick={handleBatchDelete}
              className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-red-600/80 hover:bg-red-600 text-white rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Hapus ({selectedCount})</span>
            </button>
          </div>

          <div className="h-4 w-px bg-slate-700" />

          <button
            onClick={() => setSelectedKeys(new Set())}
            className="text-xs text-slate-400 hover:text-white transition-colors"
          >
            Batal
          </button>
        </div>
      )}

      {/* MODAL: SHARE FOLDER / MOUNT */}
      {shareFolderModal && (
        <ShareFolderModal
          folder={shareFolderModal}
          onClose={() => setShareFolderModal(null)}
          onPermissionUpdated={(updated) => {
            showToast("Izin berbagi berhasil diperbarui", "success");
          }}
        />
      )}

      {/* MODAL: INLINE RENAME */}
      {renameItem && (
        <InlineRenameModal
          item={renameItem}
          onClose={() => setRenameItem(null)}
          onSave={handleSaveRename}
        />
      )}

      {/* DRAWER: ITEM DETAILS */}
      {detailsItem && (
        <ItemDetailsDrawer
          item={detailsItem}
          onClose={() => setDetailsItem(null)}
          onPreviewFile={(f) => setPreviewFile(f)}
          onShareFolder={(f) => setShareFolderModal(f)}
        />
      )}

      {/* MODAL: FILE PREVIEW */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
          onDownload={(f) => startFileDownload(f.id, f.originalName, f.size)}
        />
      )}

      {/* MODAL: IMPORT TO GOOGLE DRIVE */}
      {importingItem && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-50 rounded-xl text-blue-600">
                  <UploadCloud className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">
                    Impor ke Google Drive
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 truncate max-w-xs">
                    {importingItem.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setImportingItem(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-4">
              <p className="text-xs text-slate-600">
                Berkas akan disalin ke antrean sinkronisasi Google Drive dan otomatis diunggah ke cloud sesuai target folder yang dipilih.
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Pilih Folder Tujuan di Google Drive
                </label>
                <select
                  value={selectedTargetFolderId}
                  onChange={(e) => setSelectedTargetFolderId(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {folders.length === 0 ? (
                    <option value="">(Belum ada folder aplikasi)</option>
                  ) : (
                    folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.targetDriveType === DriveType.SHARED_DRIVE ? "Shared Drive" : "Drive Saya"})
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setImportingItem(null)}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={isImporting || !selectedTargetFolderId}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-sm transition-colors"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Mengimpor...</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-3.5 h-3.5" />
                    <span>Mulai Impor</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONTEXT MENU */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onOpenFolder={(f) => {
            const rel = f.targetFolderPath
              ? f.targetFolderPath.replace(mount.mountPoint, "").replace(/^[\/\\]/, "")
              : f.name;
            handleNavigate(rel);
          }}
          onShareFolder={(f) => setShareFolderModal(f)}
          onRenameFolder={(f) => {
            const match = sortedDirectories.find((d) => d.id === f.id);
            setRenameItem({ type: "folder", data: f, mountItem: match });
          }}
          onViewFolderDetails={(f) => setDetailsItem({ type: "folder", data: f })}
          onDeleteFolder={(f) => {
            const match = sortedDirectories.find((d) => d.id === f.id);
            if (match) handleDeleteItem(match);
          }}
          onPreviewFile={(f) => setPreviewFile(f)}
          onDownloadFile={(f) => startFileDownload(f.id, f.originalName, f.size)}
          onRenameFile={(f) => {
            const match = sortedFiles.find((file) => file.id === f.id);
            setRenameItem({ type: "file", data: f, mountItem: match });
          }}
          onViewFileDetails={(f) => setDetailsItem({ type: "file", data: f })}
          onDeleteFile={(f) => {
            const match = sortedFiles.find((file) => file.id === f.id);
            if (match) handleDeleteItem(match);
          }}
        />
      )}

      {/* OPERATION LOADING MODAL */}
      <OperationLoadingModal
        isOpen={operationLoading.isOpen}
        title={operationLoading.title}
        message={operationLoading.message}
        type={operationLoading.type}
        subMessage={operationLoading.subMessage}
      />
    </div>
  );
};
