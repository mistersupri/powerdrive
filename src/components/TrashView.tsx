import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  FileItem,
  Folder,
  FolderPermission,
  SyncStatus,
} from "../types/frontend.ts";
import { api } from "../services/api.ts";
import { useAuth } from "../context/AuthContext.tsx";
import { useDialog } from "../context/DialogContext.tsx";
import { FilePreviewModal } from "./FilePreviewModal.tsx";
import { OperationLoadingModal, OperationType } from "./OperationLoadingModal.tsx";
import {
  Trash2,
  RotateCcw,
  AlertTriangle,
  Search,
  Filter,
  RefreshCw,
  Folder as FolderIcon,
  FolderOpen,
  FolderTree,
  ChevronRight,
  ChevronDown,
  FileText,
  FileSpreadsheet,
  FileCode,
  FileArchive,
  Image as ImageIcon,
  Video,
  Music,
  File as FileGenericIcon,
  CheckSquare,
  Square,
  Eye,
  Info,
  Clock,
  HardDrive,
  Calendar,
  User as UserIcon,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

interface TrashViewProps {
  onRefreshAll?: () => void;
}

interface FolderTreeNode {
  type: "folder";
  folder: Folder;
  subfolders: FolderTreeNode[];
  files: FileItem[];
  totalFilesCount: number;
  totalSize: number;
  depth: number;
  matchesFilter: boolean;
  isVisible: boolean;
}

export const TrashView: React.FC<TrashViewProps> = ({ onRefreshAll }) => {
  const { user, isAdmin } = useAuth();
  const { showAlert, showConfirm, showToast } = useDialog();

  const [trashedFiles, setTrashedFiles] = useState<FileItem[]>([]);
  const [trashedFolders, setTrashedFolders] = useState<Folder[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");

  // Expanded folders in the tree
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Selection state
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Action in progress state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingInfo, setProcessingInfo] = useState<{
    isOpen: boolean;
    title: string;
    message?: string;
    type?: OperationType;
    subMessage?: string;
  }>({ isOpen: false, title: "" });
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);

  // Load trash data
  const loadTrash = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getTrash();
      setTrashedFiles(res.files || []);
      setTrashedFolders(res.folders || []);
    } catch (err: any) {
      console.error("Gagal memuat data sampah:", err);
      showToast("Gagal memuat data sampah", "error");
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  // Expand root folders by default when folders load
  useEffect(() => {
    if (trashedFolders.length > 0) {
      const initialExpanded = new Set<string>();
      const folderMap = new Map<string, Folder>();
      trashedFolders.forEach((f) => folderMap.set(f.id, f));

      trashedFolders.forEach((f) => {
        // Expand root / parent folders by default
        if (!f.parentId || !folderMap.has(f.parentId)) {
          initialExpanded.add(f.id);
        }
      });
      setExpandedFolders(initialExpanded);
    }
  }, [trashedFolders]);

  // Format Helper
  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formatDate = (dateStr?: string | Date | null) => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  };

  const getRelativeTime = (dateStr?: string | Date | null) => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Baru saja";
    if (diffMins < 60) return `${diffMins} mnt lalu`;
    if (diffHours < 24) return `${diffHours} jam lalu`;
    if (diffDays === 1) return "Kemarin";
    if (diffDays < 30) return `${diffDays} hari lalu`;
    return formatDate(dateStr);
  };

  // Helper to determine file category
  const getFileCategory = (mimeType: string, name: string) => {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    if (mimeType.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "svg"].includes(ext)) {
      return "image";
    }
    if (mimeType.includes("pdf") || ext === "pdf") {
      return "pdf";
    }
    if (
      mimeType.includes("sheet") ||
      mimeType.includes("excel") ||
      ext === "xlsx" ||
      ext === "xls" ||
      ext === "csv"
    ) {
      return "spreadsheet";
    }
    if (
      mimeType.includes("word") ||
      mimeType.includes("document") ||
      ext === "docx" ||
      ext === "doc"
    ) {
      return "document";
    }
    if (mimeType.startsWith("video/") || ["mp4", "webm", "mkv", "mov", "avi"].includes(ext)) {
      return "video";
    }
    if (mimeType.startsWith("audio/") || ["mp3", "wav", "ogg", "aac", "m4a"].includes(ext)) {
      return "audio";
    }
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
      return "archive";
    }
    if (
      mimeType.includes("json") ||
      mimeType.includes("javascript") ||
      mimeType.includes("typescript") ||
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
        return <ImageIcon className="w-4 h-4 text-purple-600" />;
      case "pdf":
        return <FileText className="w-4 h-4 text-red-500" />;
      case "spreadsheet":
        return <FileSpreadsheet className="w-4 h-4 text-emerald-600" />;
      case "document":
        return <FileText className="w-4 h-4 text-blue-600" />;
      case "video":
        return <Video className="w-4 h-4 text-purple-600" />;
      case "audio":
        return <Music className="w-4 h-4 text-teal-600" />;
      case "archive":
        return <FileArchive className="w-4 h-4 text-amber-600" />;
      case "code":
        return <FileCode className="w-4 h-4 text-indigo-600" />;
      default:
        return <FileGenericIcon className="w-4 h-4 text-slate-500" />;
    }
  };

  const fileMatchesFilter = useCallback((file: FileItem) => {
    const matchesSearch = !searchQuery || file.originalName.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (categoryFilter === "ALL") return true;
    if (categoryFilter === "FOLDERS") return false;
    const cat = getFileCategory(file.mimeType, file.originalName);
    return cat === categoryFilter.toLowerCase();
  }, [searchQuery, categoryFilter]);

  const folderMatchesFilter = useCallback((folder: Folder) => {
    const matchesSearch = !searchQuery || folder.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === "ALL" || categoryFilter === "FOLDERS";
    return matchesSearch && matchesCategory;
  }, [searchQuery, categoryFilter]);

  // Construct Tree Data Structure
  const { rootNodes, standaloneFiles, totalVisibleItems, allVisibleFileKeys, allVisibleFolderKeys } = useMemo(() => {
    const folderMap = new Map<string, Folder>();
    trashedFolders.forEach((f) => folderMap.set(f.id, f));

    // Map parentId -> child folders
    const childrenFoldersMap = new Map<string, Folder[]>();
    // Map folderId -> files
    const folderFilesMap = new Map<string, FileItem[]>();

    trashedFolders.forEach((f) => {
      if (f.parentId && folderMap.has(f.parentId)) {
        const list = childrenFoldersMap.get(f.parentId) || [];
        list.push(f);
        childrenFoldersMap.set(f.parentId, list);
      }
    });

    trashedFiles.forEach((file) => {
      if (file.folderId && folderMap.has(file.folderId)) {
        const list = folderFilesMap.get(file.folderId) || [];
        list.push(file);
        folderFilesMap.set(file.folderId, list);
      }
    });

    // Standalone files (files not attached to any trashed folder)
    const standalone = trashedFiles.filter((file) => !file.folderId || !folderMap.has(file.folderId));
    const filteredStandalone = standalone.filter(fileMatchesFilter);

    const visibleFileKeys = new Set<string>();
    const visibleFolderKeys = new Set<string>();

    filteredStandalone.forEach((file) => visibleFileKeys.add(`file_${file.id}`));

    // Recursive node builder
    const buildFolderNode = (folder: Folder, depth: number): FolderTreeNode => {
      const childFolders = childrenFoldersMap.get(folder.id) || [];
      const childFiles = folderFilesMap.get(folder.id) || [];

      const subnodes = childFolders.map((cf) => buildFolderNode(cf, depth + 1));
      const matchingChildFiles = childFiles.filter(fileMatchesFilter);

      const folderSelfMatches = folderMatchesFilter(folder);
      const hasVisibleSubfolders = subnodes.some((sn) => sn.isVisible);
      const hasVisibleFiles = matchingChildFiles.length > 0;

      const isVisible = folderSelfMatches || hasVisibleSubfolders || hasVisibleFiles;

      if (isVisible) {
        visibleFolderKeys.add(`folder_${folder.id}`);
        matchingChildFiles.forEach((f) => visibleFileKeys.add(`file_${f.id}`));
      }

      // Calculate sizes and file counts
      const directFilesSize = childFiles.reduce((acc, f) => acc + (f.size || 0), 0);
      const subfoldersSize = subnodes.reduce((acc, sn) => acc + sn.totalSize, 0);
      const totalSize = (folder.totalSizeBytes !== undefined && folder.totalSizeBytes > 0)
        ? folder.totalSizeBytes
        : directFilesSize + subfoldersSize;

      const directFilesCount = childFiles.length;
      const subfoldersFilesCount = subnodes.reduce((acc, sn) => acc + sn.totalFilesCount, 0);
      const totalFilesCount = (folder.filesCount !== undefined && folder.filesCount > 0)
        ? folder.filesCount
        : directFilesCount + subfoldersFilesCount;

      return {
        type: "folder",
        folder,
        subfolders: subnodes,
        files: matchingChildFiles,
        totalFilesCount,
        totalSize,
        depth,
        matchesFilter: folderSelfMatches,
        isVisible,
      };
    };

    // Root folders (no parentId or parent not in trashedFolders)
    const rootFolders = trashedFolders.filter((f) => !f.parentId || !folderMap.has(f.parentId));
    const rootNodesList = rootFolders
      .map((rf) => buildFolderNode(rf, 0))
      .filter((node) => node.isVisible);

    let count = 0;
    const countItems = (node: FolderTreeNode) => {
      if (node.isVisible) {
        count += 1; // folder itself
        count += node.files.length;
        node.subfolders.forEach(countItems);
      }
    };
    rootNodesList.forEach(countItems);
    count += filteredStandalone.length;

    return {
      rootNodes: rootNodesList,
      standaloneFiles: filteredStandalone,
      totalVisibleItems: count,
      allVisibleFileKeys: visibleFileKeys,
      allVisibleFolderKeys: visibleFolderKeys,
    };
  }, [trashedFolders, trashedFiles, fileMatchesFilter, folderMatchesFilter]);

  // Auto-expand all folders when search query is active
  useEffect(() => {
    if (searchQuery.trim().length > 0) {
      const allVisibleFolderIds = new Set<string>();
      const collect = (node: FolderTreeNode) => {
        if (node.isVisible) {
          allVisibleFolderIds.add(node.folder.id);
          node.subfolders.forEach(collect);
        }
      };
      rootNodes.forEach(collect);
      setExpandedFolders(allVisibleFolderIds);
    }
  }, [searchQuery, rootNodes]);

  const totalTrashSize = useMemo(() => {
    return trashedFiles.reduce((acc, f) => acc + (f.size || 0), 0);
  }, [trashedFiles]);

  // Selected items breakdown
  const selectedFolders = useMemo(() => {
    return trashedFolders.filter((f) => selectedKeys.has(`folder_${f.id}`));
  }, [trashedFolders, selectedKeys]);

  const selectedFiles = useMemo(() => {
    return trashedFiles.filter((f) => selectedKeys.has(`file_${f.id}`));
  }, [trashedFiles, selectedKeys]);

  const isAllSelected =
    totalVisibleItems > 0 &&
    Array.from(allVisibleFolderKeys).every((key) => selectedKeys.has(key)) &&
    Array.from(allVisibleFileKeys).every((key) => selectedKeys.has(key));

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedKeys(new Set());
    } else {
      const next = new Set<string>();
      allVisibleFolderKeys.forEach((k) => next.add(k));
      allVisibleFileKeys.forEach((k) => next.add(k));
      setSelectedKeys(next);
    }
  };

  const handleToggleItem = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Toggle Folder Selection and all its children
  const handleToggleFolderSubtree = (node: FolderTreeNode) => {
    const isFolderSelected = selectedKeys.has(`folder_${node.folder.id}`);
    const keysToChange: string[] = [];

    const collectKeys = (n: FolderTreeNode) => {
      keysToChange.push(`folder_${n.folder.id}`);
      n.files.forEach((f) => keysToChange.push(`file_${f.id}`));
      n.subfolders.forEach(collectKeys);
    };
    collectKeys(node);

    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (isFolderSelected) {
        keysToChange.forEach((k) => next.delete(k));
      } else {
        keysToChange.forEach((k) => next.add(k));
      }
      return next;
    });
  };

  // Tree Expand / Collapse controls
  const toggleFolderExpand = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const handleExpandAll = () => {
    const allIds = new Set<string>(trashedFolders.map((f) => f.id));
    setExpandedFolders(allIds);
  };

  const handleCollapseAll = () => {
    setExpandedFolders(new Set());
  };

  // Restore Single File
  const handleRestoreFile = async (file: FileItem) => {
    const confirmed = await showConfirm({
      title: "Pulihkan Berkas?",
      message: `Apakah Anda yakin ingin memulihkan berkas "${file.originalName}" ke lokasi asalnya?`,
      confirmText: "Pulihkan",
      cancelText: "Batal",
    });
    if (!confirmed) return;

    setIsProcessing(true);
    setProcessingInfo({
      isOpen: true,
      title: "Memulihkan Berkas",
      message: file.originalName,
      type: "restore",
      subMessage: "Sedang memulihkan berkas dari sampah ke Drive...",
    });
    try {
      await api.restoreFile(file.id);
      showToast(`Berkas "${file.originalName}" berhasil dipulihkan`, "success");
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        next.delete(`file_${file.id}`);
        return next;
      });
      await loadTrash();
      onRefreshAll?.();
    } catch (err: any) {
      showAlert({
        title: "Gagal Memulihkan Berkas",
        message: err.message,
        type: "error",
      });
    } finally {
      setIsProcessing(false);
      setProcessingInfo((prev) => ({ ...prev, isOpen: false }));
    }
  };

  // Restore Single Folder
  const handleRestoreFolder = async (folder: Folder) => {
    const confirmed = await showConfirm({
      title: "Pulihkan Folder?",
      message: `Apakah Anda yakin ingin memulihkan folder "${folder.name}" beserta seluruh isinya ke lokasi asalnya?`,
      confirmText: "Pulihkan",
      cancelText: "Batal",
    });
    if (!confirmed) return;

    setIsProcessing(true);
    setProcessingInfo({
      isOpen: true,
      title: "Memulihkan Folder",
      message: folder.name,
      type: "restore",
      subMessage: "Sedang memulihkan folder dan isinya ke Drive...",
    });
    try {
      await api.restoreFolder(folder.id);
      showToast(`Folder "${folder.name}" berhasil dipulihkan`, "success");
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        next.delete(`folder_${folder.id}`);
        return next;
      });
      await loadTrash();
      onRefreshAll?.();
    } catch (err: any) {
      showAlert({
        title: "Gagal Memulihkan Folder",
        message: err.message,
        type: "error",
      });
    } finally {
      setIsProcessing(false);
      setProcessingInfo((prev) => ({ ...prev, isOpen: false }));
    }
  };

  // Permanent Delete Single File
  const handlePermanentDeleteFile = async (file: FileItem) => {
    const confirmed = await showConfirm({
      title: "Hapus Berkas Permanen?",
      message: `Tindakan ini tidak dapat dibatalkan! Berkas "${file.originalName}" akan dimusnahkan secara permanen dari server dan Google Drive.`,
      confirmText: "Hapus Permanen",
      cancelText: "Batal",
      isDanger: true,
    });
    if (!confirmed) return;

    setIsProcessing(true);
    setProcessingInfo({
      isOpen: true,
      title: "Menghapus Berkas Permanen",
      message: file.originalName,
      type: "permanent_delete",
      subMessage: "Sedang menghapus berkas secara permanen dari server...",
    });
    try {
      await api.deleteFile(file.id, true);
      showToast(`Berkas "${file.originalName}" dihapus secara permanen`, "info");
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        next.delete(`file_${file.id}`);
        return next;
      });
      await loadTrash();
      onRefreshAll?.();
    } catch (err: any) {
      showAlert({
        title: "Gagal Menghapus Berkas",
        message: err.message,
        type: "error",
      });
    } finally {
      setIsProcessing(false);
      setProcessingInfo((prev) => ({ ...prev, isOpen: false }));
    }
  };

  // Permanent Delete Single Folder
  const handlePermanentDeleteFolder = async (folder: Folder) => {
    const confirmed = await showConfirm({
      title: "Hapus Folder Permanen?",
      message: `Tindakan ini tidak dapat dibatalkan! Folder "${folder.name}" beserta seluruh berkas di dalamnya akan dimusnahkan secara permanen.`,
      confirmText: "Hapus Folder Permanen",
      cancelText: "Batal",
      isDanger: true,
    });
    if (!confirmed) return;

    setIsProcessing(true);
    setProcessingInfo({
      isOpen: true,
      title: "Menghapus Folder Permanen",
      message: folder.name,
      type: "permanent_delete",
      subMessage: "Sedang memusnahkan folder dan isinya secara permanen...",
    });
    try {
      await api.deleteFolder(folder.id, true);
      showToast(`Folder "${folder.name}" dihapus secara permanen`, "info");
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        next.delete(`folder_${folder.id}`);
        return next;
      });
      await loadTrash();
      onRefreshAll?.();
    } catch (err: any) {
      showAlert({
        title: "Gagal Menghapus Folder",
        message: err.message,
        type: "error",
      });
    } finally {
      setIsProcessing(false);
      setProcessingInfo((prev) => ({ ...prev, isOpen: false }));
    }
  };

  // Bulk Restore
  const handleBulkRestore = async () => {
    const fileIds = selectedFiles.map((f) => f.id);
    const folderIds = selectedFolders.map((f) => f.id);

    const confirmed = await showConfirm({
      title: "Pulihkan Item Terpilih?",
      message: `Apakah Anda yakin ingin memulihkan ${selectedFolders.length} folder dan ${selectedFiles.length} berkas yang terpilih ke lokasi asalnya?`,
      confirmText: "Pulihkan",
      cancelText: "Batal",
    });
    if (!confirmed) return;

    setIsProcessing(true);
    setProcessingInfo({
      isOpen: true,
      title: "Memulihkan Item Terpilih",
      message: `${selectedFolders.length} folder, ${selectedFiles.length} berkas`,
      type: "restore",
      subMessage: "Sedang memulihkan seluruh item terpilih ke Drive...",
    });
    try {
      const res = await api.restoreTrashItems(fileIds, folderIds);
      showToast(res.message || "Item terpilih berhasil dipulihkan", "success");
      setSelectedKeys(new Set());
      await loadTrash();
      onRefreshAll?.();
    } catch (err: any) {
      showAlert({
        title: "Gagal Memulihkan Item",
        message: err.message,
        type: "error",
      });
    } finally {
      setIsProcessing(false);
      setProcessingInfo((prev) => ({ ...prev, isOpen: false }));
    }
  };

  // Bulk Permanent Delete
  const handleBulkPermanentDelete = async () => {
    const count = selectedKeys.size;
    const confirmed = await showConfirm({
      title: "Hapus Permanen Item Terpilih?",
      message: `Yakin ingin menghapus ${count} item (${selectedFolders.length} folder dan ${selectedFiles.length} berkas) secara permanen? Data yang dihapus tidak akan dapat dikembalikan lagi.`,
      confirmText: `Hapus ${count} Item Permanen`,
      cancelText: "Batal",
      isDanger: true,
    });
    if (!confirmed) return;

    setIsProcessing(true);
    setProcessingInfo({
      isOpen: true,
      title: "Menghapus Permanen Terpilih",
      message: `${selectedFolders.length} folder, ${selectedFiles.length} berkas`,
      type: "permanent_delete",
      subMessage: "Sedang memusnahkan seluruh item terpilih dari penyimpanan...",
    });
    try {
      const fileIds = selectedFiles.map((f) => f.id);
      const folderIds = selectedFolders.map((f) => f.id);
      const res = await api.permanentDeleteTrashItems(fileIds, folderIds);
      showToast(res.message || `${count} item berhasil dihapus permanen`, "info");
      setSelectedKeys(new Set());
      await loadTrash();
      onRefreshAll?.();
    } catch (err: any) {
      showAlert({
        title: "Gagal Menghapus Item",
        message: err.message,
        type: "error",
      });
    } finally {
      setIsProcessing(false);
      setProcessingInfo((prev) => ({ ...prev, isOpen: false }));
    }
  };

  // Empty Entire Trash
  const handleEmptyTrash = async () => {
    const confirmed = await showConfirm({
      title: "Kosongkan Seluruh Sampah?",
      message: `Semua item di dalam sampah (${trashedFolders.length} folder dan ${trashedFiles.length} berkas) akan dimusnahkan secara permanen. Ruang disk (${formatBytes(totalTrashSize)}) akan dibebaskan. Tindakan ini TIDAK DAPAT DIBATALKAN!`,
      confirmText: "Kosongkan Sampah Sekarang",
      cancelText: "Batal",
      isDanger: true,
    });
    if (!confirmed) return;

    setIsProcessing(true);
    setProcessingInfo({
      isOpen: true,
      title: "Mengosongkan Sampah",
      message: `${trashedFolders.length} folder, ${trashedFiles.length} berkas`,
      type: "permanent_delete",
      subMessage: "Sedang membersihkan seluruh data sampah di server...",
    });
    try {
      const res = await api.emptyTrash();
      showToast(res.message || "Sampah berhasil dikosongkan seluruhnya", "success");
      setSelectedKeys(new Set());
      await loadTrash();
      onRefreshAll?.();
    } catch (err: any) {
      showAlert({
        title: "Gagal Mengosongkan Sampah",
        message: err.message,
        type: "error",
      });
    } finally {
      setIsProcessing(false);
      setProcessingInfo((prev) => ({ ...prev, isOpen: false }));
    }
  };

  // Render a Single File Row in Tree
  const renderFileRow = (file: FileItem, depth: number) => {
    const isSelected = selectedKeys.has(`file_${file.id}`);
    const indentPadding = Math.min(depth * 24 + 16, 120);

    return (
      <tr
        key={`file_${file.id}`}
        className={`hover:bg-slate-50/90 transition-colors group text-xs border-b border-slate-100/80 ${
          isSelected ? "bg-indigo-50/60" : ""
        }`}
      >
        {/* Checkbox Column */}
        <td className="py-2.5 px-3 w-10 text-center">
          <button
            type="button"
            onClick={() => handleToggleItem(`file_${file.id}`)}
            className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors"
          >
            {isSelected ? (
              <CheckSquare className="w-4 h-4 text-indigo-600" />
            ) : (
              <Square className="w-4 h-4" />
            )}
          </button>
        </td>

        {/* Tree Item: Indented File */}
        <td className="py-2.5 px-3">
          <div
            className="flex items-center gap-2.5 min-w-[240px]"
            style={{ paddingLeft: `${indentPadding}px` }}
          >
            {/* Tree Branch Visual Connector */}
            <div className="text-slate-300 select-none font-mono text-xs flex items-center shrink-0">
              <span className="w-3 border-b-2 border-slate-200 inline-block mr-1"></span>
            </div>

            {/* File Icon */}
            <div className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-200/90 flex items-center justify-center shrink-0 shadow-2xs">
              {getFileIcon(file.mimeType, file.originalName)}
            </div>

            {/* File Name & Details */}
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-slate-900 truncate max-w-[280px] sm:max-w-md text-xs sm:text-[13px] flex items-center gap-1.5">
                <span className="truncate" title={file.originalName}>
                  {file.originalName}
                </span>
              </div>
              {file.checksumSha256 && (
                <div className="text-[10px] text-slate-400 font-mono truncate">
                  SHA-256: {file.checksumSha256.substring(0, 10)}...
                </div>
              )}
            </div>
          </div>
        </td>

        {/* Trashed Time */}
        <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
          <div className="flex items-center gap-1.5 text-[11px] sm:text-xs">
            <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>{getRelativeTime(file.trashedAt || file.updatedAt)}</span>
          </div>
        </td>

        {/* Size */}
        <td className="py-2.5 px-3 text-slate-700 font-medium whitespace-nowrap text-[11px] sm:text-xs">
          {formatBytes(file.size)}
        </td>

        {/* Trashed By */}
        <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap hidden md:table-cell text-[11px] sm:text-xs">
          <div className="flex items-center gap-1.5">
            <UserIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate max-w-[120px]">{file.user?.name || "Pengguna"}</span>
          </div>
        </td>

        {/* Actions */}
        <td className="py-2.5 px-3 text-right whitespace-nowrap">
          <div className="flex items-center justify-end gap-1 opacity-90 group-hover:opacity-100">
            <button
              type="button"
              onClick={() => setPreviewFile(file)}
              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
              title="Pratinjau Berkas"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleRestoreFile(file)}
              disabled={isProcessing}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs border border-emerald-200 transition-colors cursor-pointer disabled:opacity-50"
              title="Pulihkan Berkas"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Pulihkan</span>
            </button>
            <button
              type="button"
              onClick={() => handlePermanentDeleteFile(file)}
              disabled={isProcessing}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs border border-rose-200 transition-colors cursor-pointer disabled:opacity-50"
              title="Hapus Permanen"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Hapus</span>
            </button>
          </div>
        </td>
      </tr>
    );
  };

  // Render a Folder Node and its children in Tree
  const renderFolderNode = (node: FolderTreeNode): React.ReactNode => {
    const isExpanded = expandedFolders.has(node.folder.id);
    const isSelected = selectedKeys.has(`folder_${node.folder.id}`);
    const hasChildren = node.subfolders.length > 0 || node.files.length > 0;
    const indentPadding = Math.min(node.depth * 24 + 8, 100);

    return (
      <React.Fragment key={`folder_fragment_${node.folder.id}`}>
        <tr
          className={`hover:bg-amber-50/40 transition-colors group text-xs border-b border-slate-100/90 font-medium ${
            isSelected ? "bg-indigo-50/70" : "bg-white"
          }`}
        >
          {/* Checkbox Column */}
          <td className="py-2.5 px-3 w-10 text-center">
            <button
              type="button"
              onClick={() => handleToggleFolderSubtree(node)}
              className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors"
              title="Pilih folder dan isinya"
            >
              {isSelected ? (
                <CheckSquare className="w-4 h-4 text-indigo-600" />
              ) : (
                <Square className="w-4 h-4" />
              )}
            </button>
          </td>

          {/* Tree Item: Indented Folder with Expand/Collapse */}
          <td className="py-2.5 px-3">
            <div
              className="flex items-center gap-2 min-w-[240px]"
              style={{ paddingLeft: `${indentPadding}px` }}
            >
              {/* Expand / Collapse Button */}
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggleFolderExpand(node.folder.id)}
                  className="w-5 h-5 rounded hover:bg-slate-200/80 flex items-center justify-center text-slate-500 hover:text-slate-800 transition-colors shrink-0 cursor-pointer"
                  title={isExpanded ? "Tutup Folder" : "Buka Folder"}
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 stroke-[2.5]" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 stroke-[2.5]" />
                  )}
                </button>
              ) : (
                <div className="w-5 h-5 flex items-center justify-center shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
                </div>
              )}

              {/* Folder Icon */}
              <div
                onClick={() => hasChildren && toggleFolderExpand(node.folder.id)}
                className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0 shadow-2xs cursor-pointer"
              >
                {isExpanded ? (
                  <FolderOpen className="w-4 h-4" />
                ) : (
                  <FolderIcon className="w-4 h-4" />
                )}
              </div>

              {/* Folder Name & Info */}
              <div
                onClick={() => hasChildren && toggleFolderExpand(node.folder.id)}
                className="min-w-0 flex-1 cursor-pointer select-none"
              >
                <div className="font-bold text-slate-900 text-xs sm:text-[13px] flex items-center gap-1.5 flex-wrap">
                  <span className="truncate" title={node.folder.name}>
                    {node.folder.name}
                  </span>
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-800 shrink-0">
                    Folder
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 flex items-center gap-2">
                  <span>
                    {node.subfolders.length > 0 ? `${node.subfolders.length} subfolder, ` : ""}
                    {node.files.length} berkas langsung
                    {node.totalFilesCount > node.files.length ? ` (${node.totalFilesCount} total)` : ""}
                  </span>
                </div>
              </div>
            </div>
          </td>

          {/* Trashed Time */}
          <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
            <div className="flex items-center gap-1.5 text-[11px] sm:text-xs">
              <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>{getRelativeTime(node.folder.trashedAt || node.folder.updatedAt)}</span>
            </div>
          </td>

          {/* Size */}
          <td className="py-2.5 px-3 text-slate-700 font-semibold whitespace-nowrap text-[11px] sm:text-xs">
            {node.totalSize > 0 ? formatBytes(node.totalSize) : "-"}
          </td>

          {/* Trashed By */}
          <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap hidden md:table-cell text-[11px] sm:text-xs">
            <div className="flex items-center gap-1.5">
              <UserIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate max-w-[120px]">{node.folder.ownerName || "Pengguna"}</span>
            </div>
          </td>

          {/* Actions */}
          <td className="py-2.5 px-3 text-right whitespace-nowrap">
            <div className="flex items-center justify-end gap-1 opacity-90 group-hover:opacity-100">
              <button
                type="button"
                onClick={() => handleRestoreFolder(node.folder)}
                disabled={isProcessing}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs border border-emerald-200 transition-colors cursor-pointer disabled:opacity-50"
                title="Pulihkan Folder dan Seluruh Isinya"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Pulihkan</span>
              </button>
              <button
                type="button"
                onClick={() => handlePermanentDeleteFolder(node.folder)}
                disabled={isProcessing}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs border border-rose-200 transition-colors cursor-pointer disabled:opacity-50"
                title="Hapus Folder Permanen"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Hapus</span>
              </button>
            </div>
          </td>
        </tr>

        {/* Render Child Subfolders and Files when Folder is Expanded */}
        {isExpanded && (
          <>
            {node.subfolders.map((subnode) => renderFolderNode(subnode))}
            {node.files.map((file) => renderFileRow(file, node.depth + 1))}
          </>
        )}
      </React.Fragment>
    );
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl w-full mx-auto space-y-5 animate-fade-in">
      {/* 1. TOP NOTICE & BANNER */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shrink-0 shadow-2xs">
            <Trash2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                Sampah &amp; Pemulihan Berkas
              </h2>
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700">
                {trashedFolders.length + trashedFiles.length} Item
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Tampilan hierarki pohon direktori (files tree) dimulai dari folder induk. Berkas dan folder dapat dipulihkan kembali atau dihapus secara permanen ({formatBytes(totalTrashSize)}).
            </p>
          </div>
        </div>

        {/* Top Actions: Refresh & Empty Trash */}
        <div className="flex items-center gap-2 self-end md:self-center shrink-0">
          <button
            onClick={loadTrash}
            disabled={isLoading || isProcessing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
            title="Segarkan Data Sampah"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-blue-600" : ""}`} />
            <span>Segarkan</span>
          </button>

          {(trashedFiles.length > 0 || trashedFolders.length > 0) && (
            <button
              onClick={handleEmptyTrash}
              disabled={isProcessing}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-bold shadow-xs hover:shadow-md transition-all cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Kosongkan Sampah</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. FILTER & TREE NAVIGATION TOOLBAR */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Cari folder atau berkas di sampah..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-xl text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-hidden transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Category Filter Pills & Tree Expand/Collapse Controls */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 no-scrollbar">
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs">
              {[
                { id: "ALL", label: "Semua" },
                { id: "FOLDERS", label: "Folder" },
                { id: "PDF", label: "PDF" },
                { id: "SPREADSHEET", label: "Spreadsheet" },
                { id: "DOCUMENT", label: "Dokumen" },
                { id: "IMAGE", label: "Gambar" },
              ].map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setCategoryFilter(cat.id)}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                    categoryFilter === cat.id
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Expand / Collapse All Tree Buttons */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl shrink-0 text-xs">
              <button
                onClick={handleExpandAll}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-white font-medium transition-all cursor-pointer"
                title="Buka seluruh cabang pohon folder"
              >
                <FolderTree className="w-3.5 h-3.5 text-indigo-600" />
                <span className="hidden sm:inline">Buka Semua</span>
              </button>
              <button
                onClick={handleCollapseAll}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-white font-medium transition-all cursor-pointer"
                title="Tutup seluruh cabang pohon folder"
              >
                <FolderIcon className="w-3.5 h-3.5 text-slate-500" />
                <span className="hidden sm:inline">Tutup Semua</span>
              </button>
            </div>
          </div>
        </div>

        {/* Bulk Selection Bar when items are selected */}
        {selectedKeys.size > 0 && (
          <div className="bg-indigo-50/90 border border-indigo-200/80 rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 animate-fade-in">
            <div className="flex items-center gap-2.5 text-xs font-bold text-indigo-900">
              <button
                onClick={handleToggleSelectAll}
                className="flex items-center gap-1.5 text-indigo-700 hover:text-indigo-900 cursor-pointer"
              >
                {isAllSelected ? (
                  <CheckSquare className="w-4 h-4 text-indigo-600" />
                ) : (
                  <Square className="w-4 h-4 text-indigo-400" />
                )}
                <span>
                  {selectedKeys.size} item terpilih ({selectedFolders.length} folder, {selectedFiles.length} berkas)
                </span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkRestore}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Pulihkan Terpilih</span>
              </button>

              <button
                onClick={handleBulkPermanentDelete}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Hapus Permanen</span>
              </button>

              <button
                onClick={() => setSelectedKeys(new Set())}
                className="px-2.5 py-1.5 text-slate-500 hover:text-slate-800 text-xs font-semibold cursor-pointer"
              >
                Batal
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. TRASH CONTENT: FILES TREE VIEW */}
      {isLoading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 space-y-6 shadow-xs animate-in fade-in duration-200">
          <div className="flex flex-col items-center justify-center gap-2.5 text-slate-700 text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shadow-2xs">
              <RefreshCw className="w-6 h-6 animate-spin text-rose-600" />
            </div>
            <p className="text-sm font-bold text-slate-800">Menyusun Pohon Direktori Sampah...</p>
            <p className="text-xs text-slate-400 max-w-xs">Mengambil struktur hierarki folder dan berkas...</p>
          </div>
          <div className="space-y-3 pt-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 bg-slate-50 border border-slate-100 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      ) : totalVisibleItems === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center shadow-xs">
          <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mx-auto mb-3">
            <Trash2 className="w-8 h-8 stroke-[1.5]" />
          </div>
          <h3 className="text-base font-bold text-slate-800">
            {searchQuery ? "Tidak ditemukan item yang cocok" : "Sampah Kosong"}
          </h3>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            {searchQuery
              ? `Tidak ada berkas atau folder di sampah yang cocok dengan kata kunci "${searchQuery}".`
              : "Semua berkas dan folder Anda tersimpan aman di Drive Saya."}
          </p>
        </div>
      ) : (
        /* HIERARCHICAL FILES TREE TABLE */
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-[11px] font-bold">
                <tr>
                  <th className="py-3 px-3 w-10 text-center">
                    <button
                      onClick={handleToggleSelectAll}
                      className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors"
                      title={isAllSelected ? "Batalkan Semua Pilihan" : "Pilih Semua"}
                    >
                      {isAllSelected ? (
                        <CheckSquare className="w-4 h-4 text-indigo-600" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  <th className="py-3 px-3">
                    <div className="flex items-center gap-1.5">
                      <FolderTree className="w-3.5 h-3.5 text-slate-400" />
                      <span>Pohon Direktori &amp; Berkas</span>
                    </div>
                  </th>
                  <th className="py-3 px-3">Waktu Dihapus</th>
                  <th className="py-3 px-3">Ukuran</th>
                  <th className="py-3 px-3 hidden md:table-cell">Dihapus Oleh</th>
                  <th className="py-3 px-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {/* 1. Root Folders and their recursive children */}
                {rootNodes.map((node) => renderFolderNode(node))}

                {/* 2. Standalone Files without parent folder */}
                {standaloneFiles.length > 0 && (
                  <>
                    {rootNodes.length > 0 && (
                      <tr className="bg-slate-50/60 border-t-2 border-slate-100">
                        <td colSpan={6} className="py-2 px-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                          Berkas di Luar Folder
                        </td>
                      </tr>
                    )}
                    {standaloneFiles.map((file) => renderFileRow(file, 0))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* File Preview Modal */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {/* Operation Loading Component */}
      <OperationLoadingModal {...processingInfo} />
    </div>
  );
};
