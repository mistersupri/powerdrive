import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  HardDrive,
  Folder as FolderIcon,
  FolderPlus,
  FolderOpen,
  FileText,
  FileSpreadsheet,
  FileCode,
  FileArchive,
  Image as ImageIcon,
  Video,
  Music,
  File as FileGenericIcon,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Download,
  Trash2,
  ChevronRight,
  Home,
  Grid,
  List as ListIcon,
  Search,
  SearchX,
  ExternalLink,
  Lock,
  Edit3,
  Eye,
  Info,
  Filter,
  X,
  Loader2,
  Share2,
  Check,
  CheckSquare,
  Square,
  Copy,
  Move,
  UploadCloud,
} from "lucide-react";
import {
  MountDrive,
  MountFileItem,
  MountBrowseResult,
  Folder,
  FileItem,
  SyncStatus,
  PreviewStatus,
  FolderPermission,
  DriveType,
} from "../types/frontend.ts";
import { api } from "../services/api.ts";
import { useAuth } from "../context/AuthContext.tsx";
import { useDialog } from "../context/DialogContext.tsx";
import { useTransfer } from "../context/TransferContext.tsx";
import { ContextMenu, ContextMenuState } from "./ContextMenu.tsx";
import { ShareFolderModal } from "./ShareFolderModal.tsx";
import { InlineRenameModal } from "./InlineRenameModal.tsx";
import { ItemDetailsDrawer } from "./ItemDetailsDrawer.tsx";
import { FilePreviewModal } from "./FilePreviewModal.tsx";
import { LazyThumbnail } from "./LazyThumbnail.tsx";
import { OperationLoadingModal, OperationType } from "./OperationLoadingModal.tsx";
import { MoveCopyMountModal } from "./MoveCopyMountModal.tsx";

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
  const { user, isAdmin } = useAuth();
  const { showAlert, showConfirm, showToast } = useDialog();
  const { startMountUploadWithProgress } = useTransfer();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const explorerRef = useRef<HTMLDivElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);

  // Navigation & Data State
  const [subPath, setSubPath] = useState<string>("");
  const [browseData, setBrowseData] = useState<MountBrowseResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  // Selection & Multi-select State
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null);

  // Rubberband Marquee Drag Selection State
  const [marqueeBox, setMarqueeBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const [dragStartSelection, setDragStartSelection] = useState<Set<string>>(new Set());
  const hasDraggedMarqueeRef = useRef<boolean>(false);

  // Internal Drag & Drop State
  const [activeDragItem, setActiveDragItem] = useState<{
    key: string;
    type: "folder" | "file";
    id: string;
    relativePath: string;
  } | null>(null);
  const [activeDragOverId, setActiveDragOverId] = useState<string | null>(null);
  const [hoveredCrumbSubPath, setHoveredCrumbSubPath] = useState<string | null>(null);

  // Modals & Drawers
  const [showCreateFolderModal, setShowCreateFolderModal] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>("");
  const [newFolderDesc, setNewFolderDesc] = useState<string>("");
  const [isCreatingFolder, setIsCreatingFolder] = useState<boolean>(false);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [showMoveCopyModal, setShowMoveCopyModal] = useState<"move" | "copy" | null>(null);
  const [shareFolderModal, setShareFolderModal] = useState<Folder | null>(null);
  const [shareFileModal, setShareFileModal] = useState<FileItem | null>(null);
  const [renameItem, setRenameItem] = useState<{
    type: "folder" | "file";
    data: Folder | FileItem;
    mountItem: MountFileItem;
  } | null>(null);
  const [detailsItem, setDetailsItem] = useState<{
    type: "folder" | "file";
    data: Folder | FileItem;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Operation Loading State
  const [operationLoading, setOperationLoading] = useState<{
    isOpen: boolean;
    title: string;
    message?: string;
    type?: OperationType;
    subMessage?: string;
  }>({ isOpen: false, title: "" });

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
        filesCount: undefined,
        totalSizeBytes: undefined,
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
      description: `Titik pasang storage lokal: ${mount.mountPoint}`,
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
        thumbnailPath: file.isImage ? viewUrl : undefined,
        previewStatus:
          file.isImage || file.isText || file.isPdf
            ? PreviewStatus.READY
            : PreviewStatus.FAILED,
        createdAt: file.modifiedAt,
        updatedAt: file.modifiedAt,
      };
    },
    [mount.id]
  );

  // Load Directory Content
  const loadDirectory = useCallback(
    async (targetSubPath: string) => {
      setIsLoading(true);
      try {
        const data = await api.browseMountDirectory(mount.id, targetSubPath);
        setBrowseData(data);
        setSubPath(targetSubPath);
      } catch (err: any) {
        console.error("Failed to browse mount directory:", err);
        showAlert({
          title: "Gagal Membuka Folder",
          message: err.message || "Tidak dapat mengakses direktori storage ini.",
          type: "error",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [mount.id, showAlert]
  );

  useEffect(() => {
    loadDirectory("");
    setSelectedKeys(new Set());
    setLastSelectedKey(null);
  }, [mount.id, loadDirectory]);

  // Raw items from API
  const rawItems = useMemo(() => {
    return browseData?.items || [];
  }, [browseData]);

  // Filter items by search
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return rawItems;
    const query = searchQuery.toLowerCase().trim();
    return rawItems.filter((item) => item.name.toLowerCase().includes(query));
  }, [rawItems, searchQuery]);

  // Partition into Folders and Files
  const currentFolders = useMemo(() => {
    return filteredItems
      .filter((i) => i.isDirectory)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredItems]);

  const currentFiles = useMemo(() => {
    return filteredItems
      .filter((i) => !i.isDirectory)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredItems]);

  // Combined visible items
  const allVisibleItems = useMemo(() => {
    const list: { key: string; type: "folder" | "file"; item: MountFileItem }[] = [];
    currentFolders.forEach((d) =>
      list.push({ key: `folder_${d.id}`, type: "folder", item: d })
    );
    currentFiles.forEach((f) =>
      list.push({ key: `file_${f.id}`, type: "file", item: f })
    );
    return list;
  }, [currentFolders, currentFiles]);

  const selectedFolders = useMemo(() => {
    return currentFolders.filter((d) => selectedKeys.has(`folder_${d.id}`));
  }, [currentFolders, selectedKeys]);

  const selectedFiles = useMemo(() => {
    return currentFiles.filter((f) => selectedKeys.has(`file_${f.id}`));
  }, [currentFiles, selectedKeys]);

  const selectedCount = selectedKeys.size;

  const selectedMountItems = useMemo(() => {
    return allVisibleItems
      .filter((it) => selectedKeys.has(it.key))
      .map((it) => it.item);
  }, [allVisibleItems, selectedKeys]);

  // Selection Click Handler
  const handleItemClick = (
    e: React.MouseEvent,
    key: string,
    type: "folder" | "file",
    item: MountFileItem
  ) => {
    if (hasDraggedMarqueeRef.current) return;

    if (e.shiftKey && lastSelectedKey) {
      const allKeys = allVisibleItems.map((i) => i.key);
      const startIndex = allKeys.indexOf(lastSelectedKey);
      const endIndex = allKeys.indexOf(key);
      if (startIndex !== -1 && endIndex !== -1) {
        const [low, high] = [
          Math.min(startIndex, endIndex),
          Math.max(startIndex, endIndex),
        ];
        const rangeKeys = allKeys.slice(low, high + 1);
        const newKeys = new Set(selectedKeys);
        rangeKeys.forEach((k) => newKeys.add(k));
        setSelectedKeys(newKeys);
        return;
      }
    }

    if (e.ctrlKey || e.metaKey) {
      const newKeys = new Set(selectedKeys);
      if (newKeys.has(key)) {
        newKeys.delete(key);
      } else {
        newKeys.add(key);
        setLastSelectedKey(key);
      }
      setSelectedKeys(newKeys);
      return;
    }

    // Standard single click
    setSelectedKeys(new Set([key]));
    setLastSelectedKey(key);
  };

  // Select All Handler
  const handleSelectAll = useCallback(() => {
    const all = new Set<string>();
    allVisibleItems.forEach((i) => all.add(i.key));
    setSelectedKeys(all);
  }, [allVisibleItems]);

  // Deselect on container click
  const handleContainerClick = (e: React.MouseEvent) => {
    if (hasDraggedMarqueeRef.current) return;
    if ((e.target as HTMLElement).closest("[data-selectable-key]")) return;
    setSelectedKeys(new Set());
    setLastSelectedKey(null);
  };

  // Keyboard Shortcuts (Ctrl+A, Esc, Delete)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        handleSelectAll();
      }

      if (e.key === "Escape") {
        setSelectedKeys(new Set());
        setLastSelectedKey(null);
        setContextMenu(null);
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedCount > 0) {
          e.preventDefault();
          handleBulkDelete();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCount, handleSelectAll]);

  // Rubberband Marquee Drag Selection Handlers
  const handleMouseDownOnContainer = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-selectable-key]")) return;
    if ((e.target as HTMLElement).closest("button, a, input, select")) return;

    hasDraggedMarqueeRef.current = false;
    const startX = e.clientX;
    const startY = e.clientY;
    const initialSelection = e.ctrlKey || e.metaKey ? new Set(selectedKeys) : new Set<string>();

    setDragStartSelection(initialSelection);
    setMarqueeBox({ startX, startY, currentX: startX, currentY: startY });

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const currentX = moveEvent.clientX;
      const currentY = moveEvent.clientY;
      const dist = Math.hypot(currentX - startX, currentY - startY);
      if (dist > 4) {
        hasDraggedMarqueeRef.current = true;
      }

      setMarqueeBox({ startX, startY, currentX, currentY });

      // Calculate intersection bounding box
      const boxLeft = Math.min(startX, currentX);
      const boxTop = Math.min(startY, currentY);
      const boxRight = Math.max(startX, currentX);
      const boxBottom = Math.max(startY, currentY);

      const newlySelected = new Set(initialSelection);
      const elements = contentAreaRef.current?.querySelectorAll("[data-selectable-key]");
      if (elements) {
        elements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const intersects = !(
            rect.right < boxLeft ||
            rect.left > boxRight ||
            rect.bottom < boxTop ||
            rect.top > boxBottom
          );
          const key = el.getAttribute("data-selectable-key");
          if (key && intersects) {
            newlySelected.add(key);
          }
        });
      }
      setSelectedKeys(newlySelected);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      setMarqueeBox(null);
      setTimeout(() => {
        hasDraggedMarqueeRef.current = false;
      }, 50);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Format Helper
  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // Category & Icons Helper
  const getFileCategory = (mimeType: string, name: string) => {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    if (mimeType?.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "svg"].includes(ext)) {
      return "image";
    }
    if (mimeType?.includes("pdf") || ext === "pdf") {
      return "pdf";
    }
    if (
      mimeType?.includes("sheet") ||
      mimeType?.includes("excel") ||
      ext === "xlsx" ||
      ext === "xls" ||
      ext === "csv"
    ) {
      return "spreadsheet";
    }
    if (
      mimeType?.includes("word") ||
      mimeType?.includes("document") ||
      ext === "docx" ||
      ext === "doc"
    ) {
      return "document";
    }
    if (mimeType?.startsWith("video/") || ["mp4", "webm", "mkv", "mov", "avi"].includes(ext)) {
      return "video";
    }
    if (mimeType?.startsWith("audio/") || ["mp3", "wav", "ogg", "aac", "m4a"].includes(ext)) {
      return "audio";
    }
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
      return "archive";
    }
    if (
      mimeType?.includes("json") ||
      mimeType?.includes("javascript") ||
      mimeType?.includes("typescript") ||
      ["js", "ts", "tsx", "jsx", "html", "css", "json", "py", "sql", "txt", "md"].includes(ext)
    ) {
      return "code";
    }
    return "other";
  };

  const getFileIcon = (mimeType: string, name: string) => {
    const category = getFileCategory(mimeType, name);
    switch (category) {
      case "image":
        return <ImageIcon className="w-5 h-5 text-purple-600" />;
      case "pdf":
        return <FileText className="w-5 h-5 text-red-500" />;
      case "spreadsheet":
        return <FileSpreadsheet className="w-5 h-5 text-emerald-600" />;
      case "document":
        return <FileText className="w-5 h-5 text-blue-600" />;
      case "video":
        return <Video className="w-5 h-5 text-purple-600" />;
      case "audio":
        return <Music className="w-5 h-5 text-teal-600" />;
      case "archive":
        return <FileArchive className="w-5 h-5 text-amber-600" />;
      case "code":
        return <FileCode className="w-5 h-5 text-indigo-600" />;
      default:
        return <FileGenericIcon className="w-5 h-5 text-slate-500" />;
    }
  };

  const renderLargeThumbnail = (file: FileItem) => {
    return <LazyThumbnail file={file} />;
  };

  // Internal Drag & Drop Move items
  const executeMoveItems = async (
    targetSubPath: string,
    overrideItems?: { sourcePaths: string[] }
  ) => {
    const sourcePaths = overrideItems
      ? overrideItems.sourcePaths
      : selectedMountItems.map((it) => it.relativePath);

    if (sourcePaths.length === 0) return;

    setOperationLoading({
      isOpen: true,
      title: "Memindahkan Item",
      message: `${sourcePaths.length} item`,
      type: "sync",
      subMessage: `Sedang memindahkan ke ${targetSubPath || "root storage"}...`,
    });

    try {
      const res = await api.bulkMoveMountItems(mount.id, sourcePaths, targetSubPath);
      if (res.success) {
        showToast(res.message || "Item berhasil dipindahkan", "success");
        setSelectedKeys(new Set());
        loadDirectory(subPath);
      } else {
        showAlert({
          title: "Gagal Memindahkan Item",
          message: res.message || "Terjadi kesalahan saat memindahkan item.",
          type: "error",
        });
      }
    } catch (err: any) {
      showAlert({
        title: "Gagal Memindahkan Item",
        message: err.message || "Terjadi kesalahan saat memindahkan item.",
        type: "error",
      });
    } finally {
      setOperationLoading({ isOpen: false, title: "" });
    }
  };

  const handleDragStart = (
    e: React.DragEvent,
    key: string,
    type: "folder" | "file",
    item: MountFileItem
  ) => {
    let sourcePaths: string[] = [];
    if (selectedKeys.has(key)) {
      sourcePaths = selectedMountItems.map((it) => it.relativePath);
    } else {
      sourcePaths = [item.relativePath];
      setSelectedKeys(new Set([key]));
    }

    setActiveDragItem({
      key,
      type,
      id: item.id,
      relativePath: item.relativePath,
    });
    e.dataTransfer.setData(
      "application/mounted-drive-items",
      JSON.stringify({ sourcePaths })
    );
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnd = () => {
    setActiveDragItem(null);
    setActiveDragOverId(null);
    setHoveredCrumbSubPath(null);
  };

  const handleDragOverFolder = (e: React.DragEvent, folderId: string) => {
    if (activeDragItem) {
      const isTargetDragged =
        selectedKeys.has(`folder_${folderId}`) ||
        (activeDragItem.type === "folder" && activeDragItem.id === folderId);
      if (!isTargetDragged) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setActiveDragOverId(folderId);
      }
    }
  };

  const handleDragLeaveFolder = () => {
    setActiveDragOverId(null);
  };

  const handleDropOnFolder = (e: React.DragEvent, targetSubPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveDragOverId(null);
    setHoveredCrumbSubPath(null);

    let movePayload: { sourcePaths: string[] } | undefined;
    const dragData = e.dataTransfer.getData("application/mounted-drive-items");
    if (dragData) {
      try {
        movePayload = JSON.parse(dragData);
      } catch (err) {
        console.warn("Failed to parse drag data:", err);
      }
    }

    if (!movePayload && activeDragItem) {
      movePayload = { sourcePaths: [activeDragItem.relativePath] };
    }

    if (movePayload && movePayload.sourcePaths.length > 0) {
      executeMoveItems(targetSubPath, movePayload);
    }
  };

  // External Drag & Drop to Upload
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files") && !activeDragItem) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files);
    }
  };

  // Create Folder Handler
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    setIsCreatingFolder(true);
    try {
      await api.createMountFolder(mount.id, subPath, newFolderName.trim());
      setNewFolderName("");
      setNewFolderDesc("");
      setShowCreateFolderModal(false);
      showToast("Folder baru berhasil dibuat", "success");
      loadDirectory(subPath);
    } catch (err: any) {
      showAlert({
        title: "Gagal Membuat Folder",
        message: err.message || "Terjadi kesalahan saat membuat folder.",
        type: "error",
      });
    } finally {
      setIsCreatingFolder(false);
    }
  };

  // Upload Files Handler
  const handleFilesSelected = async (fileList: FileList | File[]) => {
    const rawFiles = Array.from(fileList);
    if (rawFiles.length === 0) return;

    startMountUploadWithProgress({
      mountId: mount.id,
      mountName: mount.name,
      subPath: subPath,
      files: rawFiles,
      onComplete: () => {
        loadDirectory(subPath);
        onRefreshMounts();
      },
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Rename Handler
  const handleRenameSubmit = async (newName: string) => {
    if (!renameItem) return;
    try {
      await api.renameMountItem(
        mount.id,
        renameItem.mountItem.relativePath,
        newName
      );
      showToast("Nama berhasil diubah", "success");
      setSelectedKeys(new Set());
      loadDirectory(subPath);
    } catch (err: any) {
      showAlert({
        title: "Gagal Mengubah Nama",
        message: err.message || "Terjadi kesalahan saat mengubah nama.",
        type: "error",
      });
    }
  };

  // Bulk Delete Handler
  const handleBulkDelete = async () => {
    if (selectedCount === 0) return;
    const folderCount = selectedFolders.length;
    const fileCount = selectedFiles.length;

    let itemDesc = "";
    if (folderCount > 0 && fileCount > 0) {
      itemDesc = `${folderCount} folder dan ${fileCount} berkas`;
    } else if (folderCount > 0) {
      itemDesc = `${folderCount} folder`;
    } else {
      itemDesc = `${fileCount} berkas`;
    }

    const confirmed = await showConfirm({
      title: "Hapus Item",
      message: `Apakah Anda yakin ingin menghapus ${itemDesc} yang dipilih dari storage "${mount.name}"? Tindakan ini tidak dapat dibatalkan.`,
      confirmText: "Hapus Permanen",
      cancelText: "Batal",
      isDanger: true,
    });
    if (!confirmed) return;

    setOperationLoading({
      isOpen: true,
      title: "Menghapus Item",
      message: itemDesc,
      type: "delete",
      subMessage: "Sedang menghapus seluruh item terpilih dari storage...",
    });

    try {
      for (const it of selectedMountItems) {
        await api.deleteMountItem(mount.id, it.relativePath);
      }
      setSelectedKeys(new Set());
      showToast(`Berhasil menghapus ${itemDesc}`, "success");
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

  // Single Delete Handler
  const handleDeleteSingleItem = async (item: MountFileItem) => {
    const isDir = item.isDirectory;
    const confirmed = await showConfirm({
      title: isDir ? "Hapus Folder" : "Hapus Berkas",
      message: `Apakah Anda yakin ingin menghapus ${isDir ? "folder" : "berkas"} "${item.name}"? Tindakan ini permanen.`,
      confirmText: "Hapus",
      cancelText: "Batal",
      isDanger: true,
    });
    if (!confirmed) return;

    try {
      await api.deleteMountItem(mount.id, item.relativePath);
      showToast(`"${item.name}" berhasil dihapus`, "success");
      loadDirectory(subPath);
      onRefreshMounts();
    } catch (err: any) {
      showAlert({
        title: "Gagal Menghapus",
        message: err.message || "Terjadi kesalahan saat menghapus item.",
        type: "error",
      });
    }
  };

  // Context Menu Trigger
  const handleContextMenu = (
    e: React.MouseEvent,
    type: "folder" | "file",
    folder?: Folder,
    file?: FileItem,
    mountItem?: MountFileItem
  ) => {
    e.preventDefault();
    e.stopPropagation();

    if (mountItem) {
      const key = `${type}_${mountItem.id}`;
      if (!selectedKeys.has(key)) {
        setSelectedKeys(new Set([key]));
      }
    }

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      type,
      folder,
      file,
    });
  };

  // Single Selected Item Info for Action Bar
  const singleSelectedItem = useMemo(() => {
    if (selectedCount !== 1) return null;
    const firstKey = Array.from(selectedKeys)[0];
    const item = allVisibleItems.find((it) => it.key === firstKey);
    if (!item) return null;

    if (item.type === "folder") {
      return {
        type: "folder" as const,
        data: mountDirToFolder(item.item),
        mountItem: item.item,
      };
    }
    return {
      type: "file" as const,
      data: mountFileToFileItem(item.item),
      mountItem: item.item,
    };
  }, [selectedCount, selectedKeys, allVisibleItems, mountDirToFolder, mountFileToFileItem]);

  // Breadcrumbs Generator
  const breadcrumbs = useMemo(() => {
    const list = [{ name: mount.name, subPath: "" }];
    if (subPath) {
      const parts = subPath.split("/").filter(Boolean);
      let currentAcc = "";
      parts.forEach((p) => {
        currentAcc = currentAcc ? `${currentAcc}/${p}` : p;
        list.push({ name: p, subPath: currentAcc });
      });
    }
    return list;
  }, [mount.name, subPath]);

  return (
    <div
      ref={explorerRef}
      className="flex-1 flex flex-col min-h-0 bg-slate-50/50 relative select-none"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleFilesSelected(e.target.files)}
      />

      {/* FULL-CANVAS DRAG & DROP OVERLAY */}
      {isDragOver && (
        <div className="absolute inset-0 bg-blue-600/10 border-2 border-dashed border-blue-500 rounded-3xl z-40 backdrop-blur-2xs flex items-center justify-center p-6 animate-fade-in pointer-events-none">
          <div className="bg-white p-6 rounded-2xl shadow-2xl border border-blue-200 flex flex-col items-center gap-3 text-center">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <UploadCloud className="w-8 h-8 animate-bounce" />
            </div>
            <span className="text-sm font-bold text-slate-800">
              Lepaskan berkas di sini untuk mengunggah ke "{breadcrumbs[breadcrumbs.length - 1].name}"
            </span>
          </div>
        </div>
      )}

      {/* TOP STICKY HEADER WRAPPER */}
      <div className="sticky top-0 z-20 shadow-xs transition-all" onClick={(e) => e.stopPropagation()}>
        {/* 1. PERMANENT BREADCRUMBS TOOLBAR */}
        <div className="bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-3 sm:px-6 py-2 flex items-center justify-between gap-2">
          <div
            className={`flex items-center gap-1.5 text-xs sm:text-sm font-medium py-0.5 max-w-full ${
              activeDragItem ? "overflow-visible" : "overflow-x-auto"
            }`}
          >
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              const isHovered = hoveredCrumbSubPath === crumb.subPath && !!activeDragItem;

              return (
                <div key={crumb.subPath || "root"} className="flex items-center">
                  {idx > 0 && <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 mr-1.5" />}

                  <div
                    className="relative"
                    onDragOver={(e) => {
                      if (activeDragItem) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = "move";
                        setHoveredCrumbSubPath(crumb.subPath);
                      }
                    }}
                    onDragLeave={() => {
                      setHoveredCrumbSubPath(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setHoveredCrumbSubPath(null);
                      if (activeDragItem) {
                        let movePayload: { sourcePaths: string[] } | undefined;
                        const dragData = e.dataTransfer.getData("application/mounted-drive-items");
                        if (dragData) {
                          try {
                            movePayload = JSON.parse(dragData);
                          } catch (err) {
                            console.warn("Failed to parse drag data:", err);
                          }
                        }
                        if (!movePayload && activeDragItem) {
                          movePayload = { sourcePaths: [activeDragItem.relativePath] };
                        }
                        if (movePayload && movePayload.sourcePaths.length > 0) {
                          executeMoveItems(crumb.subPath, movePayload);
                        }
                      }
                    }}
                  >
                    <button
                      onClick={() => {
                        setSelectedKeys(new Set());
                        setLastSelectedKey(null);
                        loadDirectory(crumb.subPath);
                      }}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all shrink-0 select-none ${
                        isLast
                          ? "text-slate-900 font-bold bg-slate-100"
                          : "text-slate-600 hover:text-indigo-600 hover:bg-slate-50 cursor-pointer"
                      } ${
                        isHovered
                          ? "ring-2 ring-indigo-500 bg-indigo-50 text-indigo-700 font-bold border-indigo-200 shadow-xs"
                          : ""
                      }`}
                    >
                      {idx === 0 ? (
                        <HardDrive className="w-4 h-4 text-indigo-600" />
                      ) : (
                        <FolderIcon className="w-4 h-4 text-amber-500" />
                      )}
                      <span>{crumb.name}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick Item Counter on Breadcrumbs Bar */}
          <div className="hidden sm:flex items-center gap-1 text-[11px] font-medium text-slate-400 shrink-0">
            <span>{currentFolders.length} folder</span>
            <span>•</span>
            <span>{currentFiles.length} berkas</span>
          </div>
        </div>

        {/* 2. ACTION TOOLBAR (Swaps between Default Actions and Selection Action Bar) */}
        {selectedCount > 0 ? (
          /* SELECTION ACTION BAR */
          <div className="bg-blue-600 text-white px-3 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 border-b border-blue-700 shadow-sm transition-all animate-fadeIn">
            {/* Left: Selected count & info */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <button
                onClick={() => setSelectedKeys(new Set())}
                className="p-1.5 rounded-lg bg-blue-700/80 hover:bg-blue-800 text-white transition-colors cursor-pointer"
                title="Batal Pilih (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-2 truncate">
                <span className="text-xs sm:text-sm font-bold whitespace-nowrap">
                  {selectedCount} item terpilih
                </span>
                <span className="text-[11px] sm:text-xs text-blue-200 hidden md:inline truncate">
                  ({selectedFolders.length > 0 ? `${selectedFolders.length} folder` : ""}
                  {selectedFolders.length > 0 && selectedFiles.length > 0 ? ", " : ""}
                  {selectedFiles.length > 0 ? `${selectedFiles.length} berkas` : ""}
                  {selectedFiles.length > 0
                    ? ` • ${formatBytes(selectedFiles.reduce((acc, f) => acc + (f.size || 0), 0))}`
                    : ""})
                </span>
              </div>
              <button
                onClick={handleSelectAll}
                className="text-[11px] sm:text-xs font-semibold text-blue-200 hover:text-white underline underline-offset-2 ml-1 cursor-pointer whitespace-nowrap"
              >
                Pilih Semua (Ctrl+A)
              </button>
            </div>

            {/* Right: Contextual Actions */}
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
              {/* If single File selected */}
              {singleSelectedItem && singleSelectedItem.type === "file" && (
                <>
                  <a
                    href={api.getMountFileDownloadUrl(
                      mount.id,
                      singleSelectedItem.mountItem.relativePath
                    )}
                    download={singleSelectedItem.data.originalName}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold transition-all shadow-xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Unduh</span>
                  </a>
                  <button
                    onClick={() => setShareFileModal(singleSelectedItem.data)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold transition-all cursor-pointer shadow-xs"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Bagikan</span>
                  </button>
                </>
              )}

              {/* If single Folder selected */}
              {singleSelectedItem && singleSelectedItem.type === "folder" && (
                <>
                  <button
                    onClick={() => {
                      setSelectedKeys(new Set());
                      setLastSelectedKey(null);
                      loadDirectory(singleSelectedItem.mountItem.relativePath);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white text-blue-700 hover:bg-blue-50 text-xs font-bold transition-all cursor-pointer shadow-xs"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Buka Folder</span>
                  </button>
                  <button
                    onClick={() => setShareFolderModal(singleSelectedItem.data)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold transition-all cursor-pointer shadow-xs"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Bagikan</span>
                  </button>
                </>
              )}

              {/* Multi-item actions (>1 selected) */}
              {selectedCount > 1 && selectedFiles.length > 0 && (
                <button
                  onClick={() => {
                    selectedFiles.forEach((file) => {
                      const link = document.createElement("a");
                      link.href = api.getMountFileDownloadUrl(mount.id, file.relativePath);
                      link.download = file.name;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    });
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-all cursor-pointer shadow-xs"
                  title="Unduh Berkas Terpilih"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh ({selectedFiles.length})</span>
                </button>
              )}

              {/* Copy and Move Actions */}
              <button
                onClick={() => setShowMoveCopyModal("copy")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-all cursor-pointer shadow-xs"
                title="Salin item terpilih ke direktori lain"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Salin</span>
              </button>
              <button
                onClick={() => setShowMoveCopyModal("move")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-all cursor-pointer shadow-xs"
                title="Pindahkan item terpilih ke direktori lain"
              >
                <Move className="w-3.5 h-3.5" />
                <span>Pindahkan</span>
              </button>

              {/* Delete button */}
              <button
                onClick={handleBulkDelete}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-xs font-semibold transition-all cursor-pointer ml-1 shadow-xs"
                title="Hapus item terpilih"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Hapus {selectedCount > 1 ? `(${selectedCount})` : ""}</span>
              </button>
            </div>
          </div>
        ) : (
          /* PRIMARY ACTION TOOLBAR */
          <div className="bg-slate-50/95 backdrop-blur-md border-b border-slate-200 px-3 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 transition-all">
            {/* Search Bar */}
            <div className="relative flex-1 sm:flex-initial">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari dalam folder..."
                className="w-full sm:w-56 pl-8 pr-7 py-1.5 rounded-xl bg-white hover:bg-slate-100/80 focus:bg-white text-xs border border-slate-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 focus:outline-hidden transition-all shadow-2xs"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
              {/* View Toggle */}
              <div className="flex items-center bg-white p-0.5 rounded-xl border border-slate-200 shadow-2xs">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                    viewMode === "grid"
                      ? "bg-slate-100 text-blue-600 font-bold shadow-2xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                  title="Tampilan Grid"
                >
                  <Grid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                    viewMode === "list"
                      ? "bg-slate-100 text-blue-600 font-bold shadow-2xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                  title="Tampilan Tabel"
                >
                  <ListIcon className="w-4 h-4" />
                </button>
              </div>

              {/* Share Storage */}
              <button
                onClick={() => setShareFolderModal(mountToRootFolder())}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200 transition-all active:scale-95 cursor-pointer shadow-2xs"
                title="Atur izin akses dan bagikan storage ini"
              >
                <Share2 className="w-4 h-4 text-emerald-600" />
                <span className="hidden sm:inline">Bagikan Storage</span>
              </button>

              {/* New Folder Button */}
              <button
                onClick={() => setShowCreateFolderModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200 transition-all active:scale-95 cursor-pointer shadow-2xs"
              >
                <FolderPlus className="w-4 h-4 text-blue-600" />
                <span className="hidden sm:inline">
                  {subPath === "" ? "Folder Baru" : "Subfolder Baru"}
                </span>
              </button>

              {/* Upload Button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-500/20 cursor-pointer"
              >
                <UploadCloud className="w-4 h-4" />
                <span className="hidden sm:inline">Unggah Berkas</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div
        ref={contentAreaRef}
        onMouseDown={handleMouseDownOnContainer}
        className="p-3.5 sm:p-6 flex-1 space-y-8 relative overflow-y-auto"
        onClick={handleContainerClick}
      >
        {/* TOP INDETERMINATE PROGRESS BAR ON FETCHING */}
        {isLoading && (
          <div className="absolute top-0 left-0 right-0 h-1 bg-blue-100/70 overflow-hidden z-40">
            <div className="h-full bg-blue-600 animate-pulse w-full" />
          </div>
        )}

        {/* RUBBERBAND MARQUEE SELECTION BOX */}
        {marqueeBox &&
          Math.hypot(
            marqueeBox.currentX - marqueeBox.startX,
            marqueeBox.currentY - marqueeBox.startY
          ) > 4 &&
          contentAreaRef.current && (
            <div
              className="absolute border border-blue-500 bg-blue-500/15 pointer-events-none rounded-xs z-30"
              style={{
                left:
                  Math.min(marqueeBox.startX, marqueeBox.currentX) -
                  contentAreaRef.current.getBoundingClientRect().left +
                  contentAreaRef.current.scrollLeft,
                top:
                  Math.min(marqueeBox.startY, marqueeBox.currentY) -
                  contentAreaRef.current.getBoundingClientRect().top +
                  contentAreaRef.current.scrollTop,
                width: Math.abs(marqueeBox.currentX - marqueeBox.startX),
                height: Math.abs(marqueeBox.currentY - marqueeBox.startY),
              }}
            />
          )}

        {/* 1. FETCHING LOADING SKELETON */}
        {isLoading ? (
          <div className="py-8 px-2 sm:px-6 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-200">
            <div className="flex flex-col items-center justify-center py-8 px-6 bg-white/80 backdrop-blur-xs border border-blue-100 rounded-3xl shadow-xs text-center">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center mb-3.5 shadow-2xs">
                <Loader2 className="w-7 h-7 text-blue-600 animate-spin" />
              </div>
              <h3 className="text-sm font-bold text-slate-800 mb-1">
                {searchQuery.trim()
                  ? `Mencari "${searchQuery.trim()}"...`
                  : `Memuat Direktori ${mount.name}...`}
              </h3>
              <p className="text-xs text-slate-400 max-w-sm">
                Mengambil daftar berkas dan subfolder dari mounted storage...
              </p>
            </div>

            {/* Skeletons for Folders */}
            <div className="space-y-3">
              <div className="h-4 w-32 bg-slate-200/80 rounded-md animate-pulse" />
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                  <div
                    key={i}
                    className="h-20 bg-white border border-slate-200/80 rounded-2xl p-4 flex items-center gap-3 animate-pulse shadow-2xs"
                  >
                    <div className="w-10 h-10 rounded-xl bg-slate-100 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 bg-slate-200 rounded w-3/4" />
                      <div className="h-2.5 bg-slate-100 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Skeletons for Files */}
            <div className="space-y-3 pt-2">
              <div className="h-4 w-28 bg-slate-200/80 rounded-md animate-pulse" />
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
                {[...Array(8)].map((_, i) => (
                  <div
                    key={i}
                    className="h-44 bg-white border border-slate-200/80 rounded-2xl p-3.5 flex flex-col justify-between animate-pulse shadow-2xs"
                  >
                    <div className="h-24 rounded-xl bg-slate-100 w-full" />
                    <div className="space-y-2 pt-2">
                      <div className="h-3 bg-slate-200 rounded w-4/5" />
                      <div className="h-2.5 bg-slate-100 rounded w-2/5" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : currentFolders.length === 0 && currentFiles.length === 0 ? (
          searchQuery.trim() ? (
            /* SEARCH NOT FOUND STATE */
            <div className="bg-white border border-slate-200 rounded-3xl p-10 sm:p-14 text-center max-w-xl mx-auto my-6 shadow-2xs">
              <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-100 shadow-2xs">
                <SearchX className="w-8 h-8 text-amber-500" />
              </div>
              <h4 className="text-base font-bold text-slate-900 mb-1.5">
                Tidak Ditemukan Hasil untuk "{searchQuery}"
              </h4>
              <p className="text-xs text-slate-500 max-w-md mx-auto mb-6 leading-relaxed">
                Tidak ada folder maupun berkas yang cocok dengan kata kunci pencarian Anda. Periksa kembali ejaan kata kunci atau reset filter pencarian.
              </p>
              <button
                onClick={() => setSearchQuery("")}
                className="px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-all cursor-pointer inline-flex items-center gap-2 active:scale-95"
              >
                <X className="w-3.5 h-3.5" />
                <span>Reset Pencarian</span>
              </button>
            </div>
          ) : (
            /* REGULAR EMPTY STATE */
            <div className="bg-white border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-3xl p-10 sm:p-14 text-center max-w-2xl mx-auto my-4 transition-all shadow-2xs">
              <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-4 border border-blue-100 shadow-2xs">
                <UploadCloud className="w-8 h-8 animate-pulse text-blue-600" />
              </div>
              <h4 className="text-base font-bold text-slate-900 mb-1.5">
                Folder ini Masih Kosong
              </h4>
              <p className="text-xs text-slate-500 max-w-md mx-auto mb-6 leading-relaxed">
                Direktori ini belum memiliki berkas ataupun subfolder. Silakan unggah berkas baru atau buat subfolder di dalamnya.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-500/20 active:scale-95 cursor-pointer"
                >
                  <UploadCloud className="w-4 h-4" />
                  <span>Unggah Berkas Sekarang</span>
                </button>

                <button
                  onClick={() => setShowCreateFolderModal(true)}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
                >
                  <FolderPlus className="w-4 h-4 text-blue-600" />
                  <span>Buat Subfolder</span>
                </button>
              </div>
            </div>
          )
        ) : (
          <>
            {/* VIEW MODE: GRID VIEW */}
            {viewMode === "grid" ? (
              <div className="space-y-8">
                {/* Folders in Grid */}
                {currentFolders.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        {subPath === ""
                          ? `Folder (${currentFolders.length})`
                          : `Subfolder (${currentFolders.length})`}
                      </h3>
                      <button
                        onClick={() => setShowCreateFolderModal(true)}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
                      >
                        <FolderPlus className="w-3.5 h-3.5" />
                        <span>Tambah Folder</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {currentFolders.map((dir) => {
                        const itemKey = `folder_${dir.id}`;
                        const isSelected = selectedKeys.has(itemKey);
                        const folderObj = mountDirToFolder(dir);

                        return (
                          <div
                            key={dir.id}
                            data-selectable-key={itemKey}
                            onClick={(e) => handleItemClick(e, itemKey, "folder", dir)}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              setSelectedKeys(new Set());
                              setLastSelectedKey(null);
                              loadDirectory(dir.relativePath);
                            }}
                            onContextMenu={(e) =>
                              handleContextMenu(e, "folder", folderObj, undefined, dir)
                            }
                            draggable="true"
                            onDragStart={(e) => handleDragStart(e, itemKey, "folder", dir)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => handleDragOverFolder(e, dir.id)}
                            onDragLeave={handleDragLeaveFolder}
                            onDrop={(e) => handleDropOnFolder(e, dir.relativePath)}
                            className={`bg-white border rounded-2xl p-4 transition-all duration-200 group relative flex flex-col justify-between cursor-pointer select-none ${
                              activeDragOverId === dir.id
                                ? "border-indigo-500 ring-2 ring-indigo-500/50 bg-indigo-50/40 shadow-md scale-[1.02]"
                                : isSelected
                                ? "border-blue-500 ring-2 ring-blue-500/50 bg-blue-50/40 shadow-md"
                                : "border-slate-200 hover:border-blue-300 hover:shadow-md"
                            }`}
                          >
                            {/* Selected Checkmark Badge */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const newKeys = new Set(selectedKeys);
                                if (isSelected) newKeys.delete(itemKey);
                                else newKeys.add(itemKey);
                                setSelectedKeys(newKeys);
                                setLastSelectedKey(itemKey);
                              }}
                              className={`absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center transition-all z-10 ${
                                isSelected
                                  ? "bg-blue-600 text-white shadow-xs"
                                  : "bg-slate-100/90 text-slate-400 hover:bg-blue-100 hover:text-blue-600 opacity-80 sm:opacity-0 sm:group-hover:opacity-100"
                              }`}
                              title={isSelected ? "Batal Pilih" : "Pilih Folder"}
                            >
                              <Check
                                className={`w-3.5 h-3.5 stroke-[3] ${
                                  isSelected ? "text-white" : "text-slate-400"
                                }`}
                              />
                            </button>

                            <div>
                              {/* Top Icon */}
                              <div className="flex items-start justify-between gap-2 mb-3">
                                <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-500 border border-amber-100 flex items-center justify-center group-hover:scale-105 transition-transform shadow-2xs">
                                  <FolderIcon className="w-7 h-7 fill-amber-400 text-amber-500" />
                                </div>
                              </div>

                              {/* Folder Name */}
                              <h4 className="text-sm font-bold text-slate-900 truncate group-hover:text-blue-600 mb-1">
                                {dir.name}
                              </h4>
                              <p className="text-[11px] text-slate-400 line-clamp-1 mb-2">
                                Folder direktori storage
                              </p>
                            </div>

                            {/* Metadata Footer */}
                            <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                              <span>Folder Direktori</span>
                              <span>
                                {new Date(dir.modifiedAt).toLocaleDateString("id-ID", {
                                  day: "2-digit",
                                  month: "short",
                                })}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Files in Grid */}
                {currentFiles.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Berkas ({currentFiles.length})
                      </h3>
                      <span className="text-xs text-slate-400">
                        Total:{" "}
                        {formatBytes(
                          currentFiles.reduce((acc, f) => acc + (f.size || 0), 0)
                        )}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {currentFiles.map((file) => {
                        const itemKey = `file_${file.id}`;
                        const isSelected = selectedKeys.has(itemKey);
                        const fileObj = mountFileToFileItem(file);

                        return (
                          <div
                            key={file.id}
                            data-selectable-key={itemKey}
                            onClick={(e) => handleItemClick(e, itemKey, "file", file)}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              setPreviewFile(fileObj);
                            }}
                            onContextMenu={(e) =>
                              handleContextMenu(e, "file", undefined, fileObj, file)
                            }
                            draggable="true"
                            onDragStart={(e) => handleDragStart(e, itemKey, "file", file)}
                            onDragEnd={handleDragEnd}
                            className={`bg-white border rounded-2xl overflow-hidden transition-all duration-200 group flex flex-col justify-between cursor-pointer select-none relative ${
                              isSelected
                                ? "border-blue-500 ring-2 ring-blue-500/50 bg-blue-50/30 shadow-md"
                                : "border-slate-200 hover:border-blue-300 hover:shadow-md"
                            }`}
                          >
                            {/* Selected Checkmark Badge */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const newKeys = new Set(selectedKeys);
                                if (isSelected) newKeys.delete(itemKey);
                                else newKeys.add(itemKey);
                                setSelectedKeys(newKeys);
                                setLastSelectedKey(itemKey);
                              }}
                              className={`absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center transition-all z-10 ${
                                isSelected
                                  ? "bg-blue-600 text-white shadow-xs"
                                  : "bg-slate-900/60 text-white/80 hover:bg-blue-600 hover:text-white opacity-80 sm:opacity-0 sm:group-hover:opacity-100"
                              }`}
                              title={isSelected ? "Batal Pilih" : "Pilih Berkas"}
                            >
                              <Check
                                className={`w-3.5 h-3.5 stroke-[3] ${
                                  isSelected ? "text-white" : "text-white/80"
                                }`}
                              />
                            </button>

                            {/* Large Thumbnail / Large Icon Preview Area */}
                            {renderLargeThumbnail(fileObj)}

                            {/* Card Content Footer */}
                            <div className="p-3.5 flex flex-col justify-between flex-1">
                              <div>
                                <div className="flex items-start justify-between gap-1 mb-1">
                                  <h4
                                    className="text-xs font-bold text-slate-900 truncate group-hover:text-blue-600 transition-colors"
                                    title={file.name}
                                  >
                                    {file.name}
                                  </h4>
                                </div>
                                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-2 font-medium">
                                  <span>{formatBytes(file.size)}</span>
                                  <span>•</span>
                                  <span className="truncate">Mounted Storage</span>
                                </div>
                              </div>

                              {/* Card Bottom Meta */}
                              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                                  {file.extension ? `.${file.extension}` : "FILE"}
                                </span>

                                <span className="text-[10px] text-slate-400">
                                  {new Date(file.modifiedAt).toLocaleDateString("id-ID", {
                                    day: "2-digit",
                                    month: "short",
                                  })}
                                </span>
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
              /* VIEW MODE: LIST / TABLE VIEW */
              <div className="space-y-6">
                {/* 1. Folders Table */}
                {currentFolders.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        {subPath === ""
                          ? `Folder (${currentFolders.length})`
                          : `Subfolder (${currentFolders.length})`}
                      </h3>
                      <button
                        onClick={() => setShowCreateFolderModal(true)}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
                      >
                        <FolderPlus className="w-3.5 h-3.5" />
                        <span>Tambah Folder</span>
                      </button>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                      <div className="overflow-x-auto w-full overscroll-x-contain">
                        <table className="w-full min-w-[700px] text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px] whitespace-nowrap">
                              <th className="py-3 px-3 w-8 text-center">
                                <input
                                  type="checkbox"
                                  checked={
                                    currentFolders.length > 0 &&
                                    currentFolders.every((f) =>
                                      selectedKeys.has(`folder_${f.id}`)
                                    )
                                  }
                                  onChange={(e) => {
                                    const newKeys = new Set(selectedKeys);
                                    if (e.target.checked) {
                                      currentFolders.forEach((f) =>
                                        newKeys.add(`folder_${f.id}`)
                                      );
                                    } else {
                                      currentFolders.forEach((f) =>
                                        newKeys.delete(`folder_${f.id}`)
                                      );
                                    }
                                    setSelectedKeys(newKeys);
                                  }}
                                  className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                                />
                              </th>
                              <th className="py-3 px-4">Nama Folder</th>
                              <th className="py-3 px-4">Hak Akses</th>
                              <th className="py-3 px-4">Tipe</th>
                              <th className="py-3 px-4">Lokasi Path</th>
                              <th className="py-3 px-4">Terakhir Diubah</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 whitespace-nowrap">
                            {currentFolders.map((dir) => {
                              const itemKey = `folder_${dir.id}`;
                              const isSelected = selectedKeys.has(itemKey);
                              const folderObj = mountDirToFolder(dir);

                              return (
                                <tr
                                  key={dir.id}
                                  data-selectable-key={itemKey}
                                  onClick={(e) => handleItemClick(e, itemKey, "folder", dir)}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedKeys(new Set());
                                    setLastSelectedKey(null);
                                    loadDirectory(dir.relativePath);
                                  }}
                                  onContextMenu={(e) =>
                                    handleContextMenu(e, "folder", folderObj, undefined, dir)
                                  }
                                  draggable="true"
                                  onDragStart={(e) => handleDragStart(e, itemKey, "folder", dir)}
                                  onDragEnd={handleDragEnd}
                                  onDragOver={(e) => handleDragOverFolder(e, dir.id)}
                                  onDragLeave={handleDragLeaveFolder}
                                  onDrop={(e) => handleDropOnFolder(e, dir.relativePath)}
                                  className={`cursor-pointer transition-all select-none ${
                                    activeDragOverId === dir.id
                                      ? "bg-indigo-50 text-indigo-950 font-bold border-l-4 border-l-indigo-600 shadow-xs"
                                      : isSelected
                                      ? "bg-blue-50/90 text-blue-900 font-semibold border-l-4 border-l-blue-600"
                                      : "hover:bg-slate-50"
                                  }`}
                                >
                                  <td
                                    className="py-3 px-3 text-center"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => {
                                        const newKeys = new Set(selectedKeys);
                                        if (isSelected) {
                                          newKeys.delete(itemKey);
                                        } else {
                                          newKeys.add(itemKey);
                                        }
                                        setSelectedKeys(newKeys);
                                      }}
                                      className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                                    />
                                  </td>
                                  <td className="py-3 px-4">
                                    <div className="flex items-center gap-3">
                                      <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0">
                                        <FolderIcon className="w-4 h-4 fill-amber-400 text-amber-500" />
                                      </div>
                                      <span className="font-bold text-slate-900 truncate hover:text-blue-600 transition-colors">
                                        {dir.name}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="py-3 px-4">
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      <Check className="w-3 h-3" />
                                      Bisa Edit (EDIT)
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 text-slate-700">
                                    Direktori
                                  </td>
                                  <td className="py-3 px-4 text-slate-500 text-[11px] font-mono truncate max-w-xs">
                                    {dir.fullPath}
                                  </td>
                                  <td className="py-3 px-4 text-slate-500 text-[11px]">
                                    {new Date(dir.modifiedAt).toLocaleDateString("id-ID", {
                                      day: "2-digit",
                                      month: "short",
                                      year: "numeric",
                                    })}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. Files Table */}
                {currentFiles.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Berkas ({currentFiles.length})
                      </h3>
                      <span className="text-xs text-slate-400">
                        Total:{" "}
                        {formatBytes(
                          currentFiles.reduce((acc, f) => acc + (f.size || 0), 0)
                        )}
                      </span>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                      <div className="overflow-x-auto w-full overscroll-x-contain">
                        <table className="w-full min-w-[760px] text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px] whitespace-nowrap">
                              <th className="py-3 px-3 w-8 text-center">
                                <input
                                  type="checkbox"
                                  checked={
                                    currentFiles.length > 0 &&
                                    currentFiles.every((f) =>
                                      selectedKeys.has(`file_${f.id}`)
                                    )
                                  }
                                  onChange={(e) => {
                                    const newKeys = new Set(selectedKeys);
                                    if (e.target.checked) {
                                      currentFiles.forEach((f) =>
                                        newKeys.add(`file_${f.id}`)
                                      );
                                    } else {
                                      currentFiles.forEach((f) =>
                                        newKeys.delete(`file_${f.id}`)
                                      );
                                    }
                                    setSelectedKeys(newKeys);
                                  }}
                                  className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                                />
                              </th>
                              <th className="py-3 px-4">Nama Berkas</th>
                              <th className="py-3 px-4">Tipe Berkas</th>
                              <th className="py-3 px-4">Ukuran</th>
                              <th className="py-3 px-4">Lokasi Path</th>
                              <th className="py-3 px-4">Terakhir Diubah</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 whitespace-nowrap">
                            {currentFiles.map((file) => {
                              const itemKey = `file_${file.id}`;
                              const isSelected = selectedKeys.has(itemKey);
                              const fileObj = mountFileToFileItem(file);

                              return (
                                <tr
                                  key={file.id}
                                  data-selectable-key={itemKey}
                                  onClick={(e) => handleItemClick(e, itemKey, "file", file)}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    setPreviewFile(fileObj);
                                  }}
                                  onContextMenu={(e) =>
                                    handleContextMenu(e, "file", undefined, fileObj, file)
                                  }
                                  draggable="true"
                                  onDragStart={(e) => handleDragStart(e, itemKey, "file", file)}
                                  onDragEnd={handleDragEnd}
                                  className={`cursor-pointer transition-colors select-none ${
                                    isSelected
                                      ? "bg-blue-50/90 text-blue-900 font-semibold border-l-4 border-l-blue-600"
                                      : "hover:bg-slate-50"
                                  }`}
                                >
                                  <td
                                    className="py-3 px-3 text-center"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => {
                                        const newKeys = new Set(selectedKeys);
                                        if (isSelected) {
                                          newKeys.delete(itemKey);
                                        } else {
                                          newKeys.add(itemKey);
                                        }
                                        setSelectedKeys(newKeys);
                                      }}
                                      className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                                    />
                                  </td>
                                  <td className="py-3 px-4">
                                    <div className="flex items-center gap-3">
                                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                                        {getFileIcon(file.mimeType, file.name)}
                                      </div>
                                      <span
                                        className="font-bold text-slate-900 truncate hover:text-blue-600 transition-colors"
                                        title={file.name}
                                      >
                                        {file.name}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="py-3 px-4 text-slate-600">
                                    {file.mimeType || "application/octet-stream"}
                                  </td>
                                  <td className="py-3 px-4 text-slate-700 font-medium font-mono">
                                    {formatBytes(file.size)}
                                  </td>
                                  <td className="py-3 px-4 text-slate-500 text-[11px] font-mono truncate max-w-xs">
                                    {file.fullPath}
                                  </td>
                                  <td className="py-3 px-4 text-slate-500 text-[11px]">
                                    {new Date(file.modifiedAt).toLocaleDateString("id-ID", {
                                      day: "2-digit",
                                      month: "short",
                                      year: "numeric",
                                    })}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* CREATE FOLDER MODAL */}
      {showCreateFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl border border-slate-100 animate-scaleUp">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FolderPlus className="w-5 h-5 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-800">
                  {subPath === "" ? "Buat Folder Baru" : "Buat Subfolder Baru"}
                </h3>
              </div>
              <button
                onClick={() => setShowCreateFolderModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateFolder} className="py-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Nama Folder <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Contoh: Laporan Keuangan 2026"
                  className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Deskripsi / Catatan (Opsional)
                </label>
                <textarea
                  rows={2}
                  value={newFolderDesc}
                  onChange={(e) => setNewFolderDesc(e.target.value)}
                  placeholder="Keterangan singkat isi folder..."
                  className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateFolderModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isCreatingFolder || !newFolderName.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl shadow-sm transition-colors cursor-pointer"
                >
                  {isCreatingFolder ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Membuat...</span>
                    </>
                  ) : (
                    <span>Buat Folder</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INLINE RENAME MODAL */}
      {renameItem && (
        <InlineRenameModal
          item={renameItem}
          onClose={() => setRenameItem(null)}
          onSave={handleRenameSubmit}
        />
      )}

      {/* ITEM DETAILS DRAWER */}
      {detailsItem && (
        <ItemDetailsDrawer
          item={detailsItem}
          onClose={() => setDetailsItem(null)}
          onEdit={() => {
            if (detailsItem.type === "folder") {
              const matched = currentFolders.find((f) => f.id === detailsItem.data.id);
              if (matched) {
                setRenameItem({
                  type: "folder",
                  data: detailsItem.data as Folder,
                  mountItem: matched,
                });
              }
            } else {
              const matched = currentFiles.find((f) => f.id === detailsItem.data.id);
              if (matched) {
                setRenameItem({
                  type: "file",
                  data: detailsItem.data as FileItem,
                  mountItem: matched,
                });
              }
            }
            setDetailsItem(null);
          }}
        />
      )}

      {/* FILE PREVIEW MODAL */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          filesList={currentFiles.map((f) => mountFileToFileItem(f))}
          onClose={() => setPreviewFile(null)}
          onNavigateFile={(nextFile) => setPreviewFile(nextFile)}
        />
      )}

      {/* SHARE FOLDER / STORAGE MODAL */}
      {shareFolderModal && (
        <ShareFolderModal
          folder={shareFolderModal}
          onClose={() => setShareFolderModal(null)}
          onPermissionUpdated={() => {
            onRefreshMounts();
          }}
        />
      )}

      {/* SHARE FILE MODAL */}
      {shareFileModal && (
        <ShareFolderModal
          file={shareFileModal}
          onClose={() => setShareFileModal(null)}
        />
      )}

      {/* MOVE / COPY MODAL */}
      {showMoveCopyModal && (
        <MoveCopyMountModal
          mountId={mount.id}
          items={selectedMountItems}
          mode={showMoveCopyModal}
          onClose={() => setShowMoveCopyModal(null)}
          onSuccess={(msg) => {
            showToast(msg, "success");
            setSelectedKeys(new Set());
            loadDirectory(subPath);
          }}
        />
      )}

      {/* OPERATION LOADING MODAL */}
      <OperationLoadingModal
        isOpen={operationLoading.isOpen}
        title={operationLoading.title}
        message={operationLoading.message}
        subMessage={operationLoading.subMessage}
        type={operationLoading.type}
      />

      {/* CONTEXT MENU */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onOpenFolder={(folder) => {
            const matched = currentFolders.find((f) => f.id === folder.id);
            if (matched) {
              setSelectedKeys(new Set());
              setLastSelectedKey(null);
              loadDirectory(matched.relativePath);
            }
          }}
          onDownloadFolder={(folder) => {
            showToast(`Mempersiapkan folder "${folder.name}"...`, "info");
          }}
          onShareFolder={(folder) => {
            setShareFolderModal(folder);
          }}
          onRenameFolder={(folder) => {
            const matched = currentFolders.find((f) => f.id === folder.id);
            if (matched) {
              setRenameItem({ type: "folder", data: folder, mountItem: matched });
            }
          }}
          onCopyFolder={() => {
            setShowMoveCopyModal("copy");
          }}
          onMoveFolder={() => {
            setShowMoveCopyModal("move");
          }}
          onViewFolderDetails={(folder) => {
            setDetailsItem({ type: "folder", data: folder });
          }}
          onDeleteFolder={(folder) => {
            const matched = currentFolders.find((f) => f.id === folder.id);
            if (matched) {
              handleDeleteSingleItem(matched);
            }
          }}
          onPreviewFile={(file) => {
            setPreviewFile(file);
          }}
          onDownloadFile={(file) => {
            const matched = currentFiles.find((f) => f.id === file.id);
            if (matched) {
              const link = document.createElement("a");
              link.href = api.getMountFileDownloadUrl(mount.id, matched.relativePath);
              link.download = file.originalName;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            }
          }}
          onShareFile={(file) => {
            setShareFileModal(file);
          }}
          onRenameFile={(file) => {
            const matched = currentFiles.find((f) => f.id === file.id);
            if (matched) {
              setRenameItem({ type: "file", data: file, mountItem: matched });
            }
          }}
          onCopyFile={() => {
            setShowMoveCopyModal("copy");
          }}
          onMoveFile={() => {
            setShowMoveCopyModal("move");
          }}
          onViewFileDetails={(file) => {
            setDetailsItem({ type: "file", data: file });
          }}
          onDeleteFile={(file) => {
            const matched = currentFiles.find((f) => f.id === file.id);
            if (matched) {
              handleDeleteSingleItem(matched);
            }
          }}
        />
      )}
    </div>
  );
};
