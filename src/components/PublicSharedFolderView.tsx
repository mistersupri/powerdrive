import React, { useState, useRef, useMemo, useEffect, useCallback } from "react";
import {
  Folder,
  FileItem,
  FolderPermission,
  GoogleDriveStatus,
  SyncStatus,
} from "../types/frontend.ts";
import { api } from "../services/api.ts";
import { useTransfer } from "../context/TransferContext.tsx";
import { useDialog } from "../context/DialogContext.tsx";
import { ContextMenu, ContextMenuState } from "./ContextMenu.tsx";
import { ItemDetailsDrawer } from "./ItemDetailsDrawer.tsx";
import { FilePreviewModal } from "./FilePreviewModal.tsx";
import { VideoThumbnail } from "./VideoThumbnail.tsx";
import {
  Folder as FolderIcon,
  FolderOpen,
  HardDrive,
  Download,
  UploadCloud,
  FileText,
  FileSpreadsheet,
  FileCode,
  FileArchive,
  Image as ImageIcon,
  Video,
  Music,
  File as FileGenericIcon,
  Search,
  SearchX,
  Grid,
  List as ListIcon,
  ChevronRight,
  ShieldCheck,
  ShieldAlert,
  Eye,
  Edit3,
  LogIn,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Copy,
  Check,
  ExternalLink,
  Info,
  X,
  Lock,
  Layers,
  ChevronDown,
  Clock,
  Sparkles,
} from "lucide-react";

interface PublicSharedFolderViewProps {
  initialFolderId: string;
  permParam?: string | null;
  signatureParam?: string | null;
  onGoToLogin: () => void;
}

export const PublicSharedFolderView: React.FC<PublicSharedFolderViewProps> = ({
  initialFolderId,
  permParam,
  signatureParam,
  onGoToLogin,
}) => {
  const { startFileDownload, startUploadWithProgress } = useTransfer();
  const { showAlert, showToast } = useDialog();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const explorerRef = useRef<HTMLDivElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);

  // Folder & Hierarchy state
  const [rootFolder, setRootFolder] = useState<Folder | null>(null);
  const [currentFolder, setCurrentFolder] = useState<Folder | null>(null);
  const [folderPath, setFolderPath] = useState<Folder[]>([]);
  const [childFolders, setChildFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);

  // Permissions & Security state
  const [permission, setPermission] = useState<FolderPermission>(
    permParam === "EDIT" ? FolderPermission.EDIT : FolderPermission.VIEW
  );
  const [isSignatureValid, setIsSignatureValid] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // View & Filter state (Identical to Drive Saya)
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isDownloadingZip, setIsDownloadingZip] = useState<boolean>(false);

  // Multi-Item Selection state
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

  // Modals & Drawers
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [detailsItem, setDetailsItem] = useState<
    { type: "folder"; data: Folder } | { type: "file"; data: FileItem } | null
  >(null);

  // 1. Initial Load: Fetch Shared Root Folder & Verify Signature
  const loadSharedRoot = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      let effectivePerm = permParam === "EDIT" ? FolderPermission.EDIT : FolderPermission.VIEW;
      if (signatureParam) {
        try {
          const verifyRes = await api.verifyShareToken({
            folderId: initialFolderId,
            permission: effectivePerm,
            signature: signatureParam,
          });
          if (verifyRes.isValid && verifyRes.folder) {
            setIsSignatureValid(true);
            setRootFolder(verifyRes.folder);
            setCurrentFolder(verifyRes.folder);
            setFolderPath([verifyRes.folder]);
            if (verifyRes.grantedPermission) {
              setPermission(verifyRes.grantedPermission as FolderPermission);
            }
          } else {
            setIsSignatureValid(false);
          }
        } catch {
          setIsSignatureValid(false);
        }
      }

      const folderRes = await api.getFolder(initialFolderId);
      if (folderRes.folder) {
        setRootFolder(folderRes.folder);
        setCurrentFolder(folderRes.folder);
        setFolderPath([folderRes.folder]);
        if (!signatureParam) {
          setPermission(folderRes.folder.permission || FolderPermission.VIEW);
        }
      } else {
        throw new Error("Folder tidak ditemukan atau tautan telah kedaluwarsa.");
      }
    } catch (err: any) {
      console.error("Failed to load shared folder:", err);
      setError(err.message || "Gagal memuat folder bagikan. Tautan mungkin telah dihapus atau tidak valid.");
    } finally {
      setIsLoading(false);
    }
  }, [initialFolderId, permParam, signatureParam]);

  useEffect(() => {
    loadSharedRoot();
  }, [loadSharedRoot]);

  // 2. Load Folder Contents when current folder changes
  const loadFolderContents = useCallback(async (folderId: string) => {
    try {
      const [filesRes, foldersRes] = await Promise.all([
        api.listFiles({ folderId }),
        api.listFolders(folderId),
      ]);
      setFiles(filesRes.files || []);
      setChildFolders(foldersRes.folders || []);
      setSelectedKeys(new Set());
      setLastSelectedKey(null);
    } catch (err: any) {
      console.warn("Failed to load folder contents:", err);
    }
  }, []);

  useEffect(() => {
    if (currentFolder) {
      loadFolderContents(currentFolder.id);
    }
  }, [currentFolder, loadFolderContents]);

  // Folder navigation inside the shared subtree
  const handleEnterSubfolder = (subfolder: Folder) => {
    setCurrentFolder(subfolder);
    setFolderPath((prev) => [...prev, subfolder]);
  };

  const handleNavigateBreadcrumb = (index: number) => {
    const targetFolder = folderPath[index];
    if (targetFolder) {
      setCurrentFolder(targetFolder);
      setFolderPath((prev) => prev.slice(0, index + 1));
    }
  };

  // Categorization & Filtering Helper
  const getFileCategory = (mimeType: string = "", name: string = "") => {
    const mime = (mimeType || "").toLowerCase();
    const ext = name.split(".").pop()?.toLowerCase() || "";
    if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext)) {
      return "image";
    }
    if (mime.includes("pdf") || ext === "pdf") {
      return "pdf";
    }
    if (
      mime.includes("spreadsheet") ||
      mime.includes("excel") ||
      mime.includes("csv") ||
      ["xls", "xlsx", "csv", "tsv", "ods"].includes(ext)
    ) {
      return "spreadsheet";
    }
    if (
      mime.includes("word") ||
      mime.includes("document") ||
      ["doc", "docx", "rtf", "odt"].includes(ext)
    ) {
      return "document";
    }
    if (mime.startsWith("video/") || ["mp4", "webm", "mkv", "mov", "avi", "wmv", "flv"].includes(ext)) {
      return "video";
    }
    if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "aac", "m4a", "flac"].includes(ext)) {
      return "audio";
    }
    if (["zip", "rar", "7z", "tar", "gz", "bz2"].includes(ext)) {
      return "archive";
    }
    if (
      mime.includes("json") ||
      mime.includes("javascript") ||
      mime.includes("typescript") ||
      ["js", "ts", "tsx", "jsx", "html", "css", "json", "py", "sql", "txt", "md", "c", "cpp", "go", "rs", "java"].includes(ext)
    ) {
      return "code";
    }
    return "other";
  };

  // Filtered files & folders
  const currentFolders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return childFolders.filter((f) => {
      if (!q) return true;
      return (
        f.name.toLowerCase().includes(q) ||
        (f.description && f.description.toLowerCase().includes(q))
      );
    });
  }, [childFolders, searchQuery]);

  const currentFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return files.filter((f) => {
      const matchSearch =
        !q ||
        f.originalName.toLowerCase().includes(q) ||
        f.mimeType.toLowerCase().includes(q);
      const cat = getFileCategory(f.mimeType, f.originalName);
      const matchCategory = categoryFilter === "ALL" || cat === categoryFilter.toLowerCase();
      return matchSearch && matchCategory;
    });
  }, [files, searchQuery, categoryFilter]);

  // Pagination & Infinite Loading State (Limit 20 items per load)
  const PAGE_SIZE = 20;
  const [visibleLimit, setVisibleLimit] = useState<number>(PAGE_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // Reset pagination limit when folder, search, or category filter changes
  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
    setIsLoadingMore(false);
  }, [currentFolder?.id, searchQuery, categoryFilter]);

  // Total items matching criteria & pagination slicing
  const totalItemsCount = currentFolders.length + currentFiles.length;
  const hasMoreItems = visibleLimit < totalItemsCount;

  // Split visibleLimit across folders then files
  const displayedFolders = useMemo(() => {
    return currentFolders.slice(0, visibleLimit);
  }, [currentFolders, visibleLimit]);

  const displayedFiles = useMemo(() => {
    const remainingSlots = Math.max(0, visibleLimit - currentFolders.length);
    return currentFiles.slice(0, remainingSlots);
  }, [currentFiles, currentFolders.length, visibleLimit]);

  const handleLoadMore = useCallback(() => {
    if (isLoadingMore || !hasMoreItems) return;
    setIsLoadingMore(true);
    setTimeout(() => {
      setVisibleLimit((prev) => prev + PAGE_SIZE);
      setIsLoadingMore(false);
    }, 350);
  }, [isLoadingMore, hasMoreItems]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !hasMoreItems) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first && first.isIntersecting && !isLoadingMore && hasMoreItems) {
          handleLoadMore();
        }
      },
      {
        root: null,
        rootMargin: "250px", // Trigger smoothly before reaching exact bottom
        threshold: 0.1,
      }
    );

    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [handleLoadMore, hasMoreItems, isLoadingMore]);

  // Combined visible items array (for Shift+Click range selection and Select All)
  const allVisibleItems = useMemo(() => {
    const list: { key: string; type: "folder" | "file"; data: Folder | FileItem }[] = [];
    displayedFolders.forEach((f) => list.push({ key: `folder_${f.id}`, type: "folder", data: f }));
    displayedFiles.forEach((f) => list.push({ key: `file_${f.id}`, type: "file", data: f }));
    return list;
  }, [displayedFolders, displayedFiles]);

  const selectedFolders = useMemo(() => {
    return currentFolders.filter((f) => selectedKeys.has(`folder_${f.id}`));
  }, [currentFolders, selectedKeys]);

  const selectedFiles = useMemo(() => {
    return currentFiles.filter((f) => selectedKeys.has(`file_${f.id}`));
  }, [currentFiles, selectedKeys]);

  const selectedCount = selectedKeys.size;

  const singleSelectedItem = useMemo(() => {
    if (selectedCount !== 1) return null;
    if (selectedFolders.length === 1) return { type: "folder" as const, data: selectedFolders[0] };
    if (selectedFiles.length === 1) return { type: "file" as const, data: selectedFiles[0] };
    return null;
  }, [selectedCount, selectedFolders, selectedFiles]);

  // Selection item click handling (Single click, Shift+Click, Ctrl+Click)
  const handleItemClick = (
    e: React.MouseEvent,
    key: string,
    type: "folder" | "file",
    data: Folder | FileItem
  ) => {
    if (hasDraggedMarqueeRef.current) return;

    if (e.shiftKey && lastSelectedKey) {
      const lastIdx = allVisibleItems.findIndex((item) => item.key === lastSelectedKey);
      const currIdx = allVisibleItems.findIndex((item) => item.key === key);
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

    // Standard click: select single item
    setSelectedKeys(new Set([key]));
    setLastSelectedKey(key);
  };

  const handleSelectAll = () => {
    const all = new Set<string>();
    allVisibleItems.forEach((item) => all.add(item.key));
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

  // Context Menu Trigger
  const handleContextMenu = (
    e: React.MouseEvent,
    type: "folder" | "file",
    folder?: Folder,
    file?: FileItem
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const key = folder ? `folder_${folder.id}` : file ? `file_${file.id}` : "";
    if (key && !selectedKeys.has(key)) {
      setSelectedKeys(new Set([key]));
      setLastSelectedKey(key);
    }
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      type,
      folder,
      file,
    });
  };

  // Bulk ZIP Download
  const handleDownloadZip = async (targetFileIds?: string[]) => {
    const ids = targetFileIds || (selectedFiles.length > 0 ? selectedFiles.map((f) => f.id) : files.map((f) => f.id));
    if (ids.length === 0) {
      showToast("Tidak ada berkas untuk diunduh sebagai ZIP", "warning");
      return;
    }

    setIsDownloadingZip(true);
    try {
      const archiveName = `${currentFolder?.name || "Shared-Folder"}-${new Date().toISOString().slice(0, 10)}.zip`;
      await api.downloadDirectZip(ids, archiveName);
      showToast(`Arsip ${archiveName} berhasil diunduh.`, "success");
    } catch (err: any) {
      showAlert({
        title: "Gagal Mengunduh ZIP",
        message: err.message || "Terjadi kesalahan saat mengompres berkas menjadi ZIP.",
        type: "error",
      });
    } finally {
      setIsDownloadingZip(false);
    }
  };

  // Upload Management (Allowed only if permission is EDIT)
  const handleUploadFiles = async (fileList: FileList | File[]) => {
    if (permission !== FolderPermission.EDIT) {
      showAlert({
        title: "Hak Akses Terbatas",
        message: "Folder ini berstatus Hanya Lihat (VIEW). Anda tidak memiliki izin untuk mengunggah berkas ke dalam folder ini.",
        type: "warning",
      });
      return;
    }
    if (!currentFolder) return;

    const filesArray = Array.from(fileList);
    if (filesArray.length === 0) return;

    try {
      showToast(`Memulai proses pengunggahan ${filesArray.length} berkas...`, "info");
      await startUploadWithProgress(currentFolder.id, filesArray);
      setTimeout(() => {
        loadFolderContents(currentFolder.id);
      }, 1500);
    } catch (err: any) {
      showAlert({
        title: "Gagal Mengunggah Berkas",
        message: err.message || "Terjadi kesalahan saat mengunggah berkas.",
        type: "error",
      });
    }
  };

  // Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
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
      if (permission !== FolderPermission.EDIT) {
        showAlert({
          title: "Hak Akses Terbatas",
          message: "Folder ini memiliki hak akses Hanya Lihat (VIEW). Pengunggahan berkas dinonaktifkan.",
          type: "warning",
        });
        return;
      }
      handleUploadFiles(e.dataTransfer.files);
    }
  };

  const copyShareLink = async (fileId: string) => {
    const url = `${window.location.origin}/api/storage/files/${fileId}/download`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(fileId);
      setTimeout(() => setCopiedId(null), 2500);
      showToast("Tautan unduh berkas disalin ke papan klip", "success");
    } catch {
      // ignore
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // Large visual thumbnail in Grid (Matching GoogleDriveExplorer)
  const renderLargeThumbnail = (file: FileItem) => {
    const category = getFileCategory(file.mimeType, file.originalName);
    const ext = file.originalName.split(".").pop()?.toUpperCase() || "FILE";

    if (category === "image") {
      return (
        <div className="w-full h-36 sm:h-40 bg-slate-100 rounded-t-xl overflow-hidden flex items-center justify-center relative border-b border-slate-100 select-none">
          <img
            src={api.getThumbnailUrl(file.id)}
            alt={file.originalName}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 pointer-events-none"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.style.display = "none";
              const fallback = e.currentTarget.parentElement?.querySelector(".image-fallback");
              if (fallback) fallback.classList.remove("hidden");
            }}
          />
          <div className="image-fallback hidden flex flex-col items-center justify-center gap-2 p-4 text-purple-600">
            <div className="w-14 h-14 rounded-2xl bg-purple-100 flex items-center justify-center shadow-2xs">
              <ImageIcon className="w-8 h-8 text-purple-600" />
            </div>
            <span className="text-[10px] font-extrabold tracking-wider bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
              {ext}
            </span>
          </div>
        </div>
      );
    }

    if (category === "pdf") {
      return (
        <div className="w-full h-36 sm:h-40 bg-gradient-to-b from-rose-50 to-rose-100/60 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-rose-100 select-none">
          <div className="w-16 h-16 rounded-2xl bg-white shadow-md border border-rose-200 flex items-center justify-center text-rose-600 group-hover:scale-105 transition-transform">
            <FileText className="w-9 h-9" />
          </div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-rose-700 bg-white/90 border border-rose-200 px-2.5 py-0.5 rounded-full shadow-2xs">
            DOKUMEN PDF
          </span>
        </div>
      );
    }

    if (category === "spreadsheet") {
      return (
        <div className="w-full h-36 sm:h-40 bg-gradient-to-b from-emerald-50 to-emerald-100/60 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-emerald-100 select-none">
          <div className="w-16 h-16 rounded-2xl bg-white shadow-md border border-emerald-200 flex items-center justify-center text-emerald-600 group-hover:scale-105 transition-transform">
            <FileSpreadsheet className="w-9 h-9" />
          </div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 bg-white/90 border border-emerald-200 px-2.5 py-0.5 rounded-full shadow-2xs">
            LEMBAR SEBAR ({ext})
          </span>
        </div>
      );
    }

    if (category === "document") {
      return (
        <div className="w-full h-36 sm:h-40 bg-gradient-to-b from-blue-50 to-blue-100/60 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-blue-100 select-none">
          <div className="w-16 h-16 rounded-2xl bg-white shadow-md border border-blue-200 flex items-center justify-center text-blue-600 group-hover:scale-105 transition-transform">
            <FileText className="w-9 h-9" />
          </div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-700 bg-white/90 border border-blue-200 px-2.5 py-0.5 rounded-full shadow-2xs">
            DOKUMEN WORD ({ext})
          </span>
        </div>
      );
    }

    if (category === "video") {
      return (
        <VideoThumbnail
          file={file}
          className="w-full h-36 sm:h-40 border-b border-purple-100/50"
        />
      );
    }

    if (category === "audio") {
      return (
        <div className="w-full h-36 sm:h-40 bg-gradient-to-b from-teal-50 to-teal-100/60 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-teal-100 select-none">
          <div className="w-16 h-16 rounded-2xl bg-white shadow-md border border-teal-200 flex items-center justify-center text-teal-600 group-hover:scale-105 transition-transform">
            <Music className="w-9 h-9" />
          </div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-teal-700 bg-white/90 border border-teal-200 px-2.5 py-0.5 rounded-full shadow-2xs">
            AUDIO ({ext})
          </span>
        </div>
      );
    }

    if (category === "archive") {
      return (
        <div className="w-full h-36 sm:h-40 bg-gradient-to-b from-amber-50 to-amber-100/60 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-amber-100 select-none">
          <div className="w-16 h-16 rounded-2xl bg-white shadow-md border border-amber-200 flex items-center justify-center text-amber-600 group-hover:scale-105 transition-transform">
            <FileArchive className="w-9 h-9" />
          </div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-700 bg-white/90 border border-amber-200 px-2.5 py-0.5 rounded-full shadow-2xs">
            ARSIP ZIP ({ext})
          </span>
        </div>
      );
    }

    if (category === "code") {
      return (
        <div className="w-full h-36 sm:h-40 bg-gradient-to-b from-indigo-50 to-indigo-100/60 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-indigo-100 select-none">
          <div className="w-16 h-16 rounded-2xl bg-white shadow-md border border-indigo-200 flex items-center justify-center text-indigo-600 group-hover:scale-105 transition-transform">
            <FileCode className="w-9 h-9" />
          </div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-700 bg-white/90 border border-indigo-200 px-2.5 py-0.5 rounded-full shadow-2xs">
            SKRIP / KODE ({ext})
          </span>
        </div>
      );
    }

    return (
      <div className="w-full h-36 sm:h-40 bg-gradient-to-b from-slate-50 to-slate-100 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-slate-200 select-none">
        <div className="w-16 h-16 rounded-2xl bg-white shadow-md border border-slate-200 flex items-center justify-center text-slate-500 group-hover:scale-105 transition-transform">
          <FileGenericIcon className="w-9 h-9" />
        </div>
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-600 bg-white/90 border border-slate-200 px-2.5 py-0.5 rounded-full shadow-2xs">
          BERKAS ({ext})
        </span>
      </div>
    );
  };

  const getFileSmallIcon = (mimeType: string, name: string) => {
    const category = getFileCategory(mimeType, name);
    switch (category) {
      case "image":
        return <ImageIcon className="w-5 h-5 text-purple-600" />;
      case "pdf":
        return <FileText className="w-5 h-5 text-rose-500" />;
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

  // Loading State
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3 text-slate-700 bg-white p-8 rounded-3xl shadow-xl border border-slate-200 text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-2xs">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
          <p className="text-base font-bold text-slate-900">Membuka Folder Dibagikan...</p>
          <p className="text-xs text-slate-500 max-w-xs">
            Memverifikasi tanda tangan keamanan kriptografi HMAC-SHA256
          </p>
        </div>
      </div>
    );
  }

  // Error State
  if (error || !rootFolder) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-2xl">
          <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-rose-100">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">Tautan Bagikan Tidak Tersedia</h2>
          <p className="text-xs text-slate-500 mb-6 leading-relaxed">
            {error || "Folder yang Anda tuju mungkin telah dihapus, akses dicabut, atau tanda tangan keamanan tidak cocok."}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={loadSharedRoot}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Coba Lagi</span>
            </button>
            <button
              onClick={onGoToLogin}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-md shadow-blue-600/20"
            >
              <LogIn className="w-4 h-4" />
              <span>Masuk ke Akun</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={explorerRef}
      className="min-h-screen bg-slate-50 flex flex-col selection:bg-blue-600 selection:text-white"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden File Upload Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleUploadFiles(e.target.files)}
      />

      {/* TOP GOOGLE DRIVE HEADER */}
      <header className="h-16 bg-white border-b border-slate-200 sticky top-0 z-30 px-4 sm:px-6 flex items-center justify-between gap-4 shadow-2xs">
        {/* Left: Brand Identity & Shared Folder Pill */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-600/20 shrink-0">
            <HardDrive className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-slate-900 text-sm sm:text-base tracking-tight truncate">
                Power Drive
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                Folder Dibagikan
              </span>
            </div>
            <p className="text-[11px] text-slate-500 truncate hidden md:block">
              {rootFolder.name} • {permission === FolderPermission.EDIT ? "Akses Edit & Unduh" : "Akses Hanya Lihat"}
            </p>
          </div>
        </div>

        {/* Right Header Status & Action Badges */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Permission Status Pill */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
              permission === FolderPermission.EDIT
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-blue-50 text-blue-700 border-blue-200"
            }`}
            title={
              permission === FolderPermission.EDIT
                ? "Anda memiliki izin untuk mengunggah dan mengunduh berkas"
                : "Anda memiliki izin untuk melihat dan mengunduh berkas"
            }
          >
            {permission === FolderPermission.EDIT ? (
              <>
                <Edit3 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Bisa Mengedit (EDIT)</span>
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5 text-blue-600" />
                <span>Hanya Lihat (VIEW)</span>
              </>
            )}
          </div>

          {/* Cryptographic Verification Badge */}
          {isSignatureValid && (
            <div
              className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-teal-50 text-teal-800 border border-teal-200 text-xs font-bold"
              title="Tautan diverifikasi dengan tanda tangan kriptografi HMAC-SHA256"
            >
              <ShieldCheck className="w-4 h-4 text-teal-600" />
              <span>Terverifikasi HMAC</span>
            </div>
          )}

          {/* Login / Switch Account Button */}
          <button
            onClick={onGoToLogin}
            className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all border border-slate-200 cursor-pointer active:scale-95"
            title="Masuk ke akun Power Drive Anda"
          >
            <LogIn className="w-3.5 h-3.5 text-blue-600" />
            <span>Masuk Akun</span>
          </button>
        </div>
      </header>

      {/* BODY LAYOUT: SIDEBAR + MAIN CANVAS (Matching Drive Saya) */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT SIDEBAR (Google Drive Style) */}
        <aside className="w-60 bg-white border-r border-slate-200 p-4 flex flex-col justify-between shrink-0 hidden md:flex overflow-y-auto">
          <div className="space-y-5">
            {/* Primary Navigation / Root Folder Info */}
            <div className="space-y-1 text-xs font-semibold">
              <button
                onClick={() => {
                  if (rootFolder) {
                    setCurrentFolder(rootFolder);
                    setFolderPath([rootFolder]);
                  }
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                  currentFolder?.id === rootFolder.id
                    ? "bg-blue-50 text-blue-700 font-bold"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <FolderIcon className="w-4 h-4 text-blue-600" />
                <span className="truncate">{rootFolder.name}</span>
              </button>
            </div>

            {/* Subfolders Quick List */}
            {childFolders.length > 0 && (
              <div className="pt-2 border-t border-slate-100">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-3 mb-2 flex items-center justify-between">
                  <span>Subfolder</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    {childFolders.length}
                  </span>
                </div>
                <div className="space-y-1 text-xs">
                  {childFolders.map((sub) => (
                    <button
                      key={sub.id}
                      onClick={() => handleEnterSubfolder(sub)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all text-left truncate ${
                        currentFolder?.id === sub.id
                          ? "bg-blue-50 text-blue-700 font-bold"
                          : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <FolderIcon className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span className="truncate">{sub.name}</span>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Permissions & Capabilities Summary Card */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 text-xs space-y-2.5">
              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                <Info className="w-4 h-4 text-blue-600" />
                <span>Hak Akses Anda</span>
              </div>
              <div className="space-y-1.5 text-[11px] text-slate-600">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Pratinjau &amp; Baca Berkas</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Unduh Individual &amp; Arsip ZIP</span>
                </div>
                <div className="flex items-center gap-2">
                  {permission === FolderPermission.EDIT ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span className="font-semibold text-emerald-800">Unggah Berkas Baru</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="text-slate-400">Unggah Berkas (Terkunci)</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Stats Indicator */}
          <div className="pt-4 border-t border-slate-200">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs">
              <div className="flex items-center justify-between text-slate-600 font-bold mb-1">
                <span>Total Berkas</span>
                <span className="text-blue-600">{files.length}</span>
              </div>
              <div className="text-[11px] text-slate-400">
                Ukuran: {formatBytes(files.reduce((acc, f) => acc + (f.size || 0), 0))}
              </div>
            </div>
          </div>
        </aside>

        {/* MAIN VIEWPORT CANVAS */}
        <main className="flex-1 bg-slate-50/50 flex flex-col min-h-0 relative select-none">
          {/* DRAG & DROP FULL OVERLAY */}
          {isDragOver && (
            <div className="absolute inset-0 bg-blue-600/10 border-2 border-dashed border-blue-500 rounded-3xl z-40 backdrop-blur-2xs flex items-center justify-center p-6 animate-fade-in pointer-events-none">
              <div className="bg-white p-6 rounded-2xl shadow-2xl border border-blue-200 flex flex-col items-center gap-3 text-center">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <UploadCloud className="w-8 h-8 animate-bounce" />
                </div>
                <span className="text-sm font-bold text-slate-800">
                  {permission === FolderPermission.EDIT
                    ? `Lepaskan berkas di sini untuk mengunggah ke "${currentFolder?.name || rootFolder.name}"`
                    : "Folder ini memiliki hak akses Hanya Lihat (VIEW)"}
                </span>
              </div>
            </div>
          )}

          {/* TOP STICKY TOOLBAR WRAPPER (Breadcrumbs + Actions Toolbar) */}
          <div className="sticky top-0 z-20 shadow-2xs transition-all" onClick={(e) => e.stopPropagation()}>
            {/* 1. PERMANENT BREADCRUMBS TOOLBAR */}
            <div className="bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 py-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs sm:text-sm font-medium overflow-x-auto py-0.5 max-w-full">
                {folderPath.map((item, idx) => {
                  const isLast = idx === folderPath.length - 1;
                  return (
                    <React.Fragment key={item.id}>
                      {idx > 0 && <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                      <button
                        onClick={() => handleNavigateBreadcrumb(idx)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-colors shrink-0 ${
                          isLast
                            ? "text-slate-900 font-bold bg-slate-100"
                            : "text-slate-600 hover:text-blue-600 hover:bg-slate-50 cursor-pointer"
                        }`}
                      >
                        {idx === 0 ? (
                          <FolderIcon className="w-4 h-4 text-blue-600" />
                        ) : (
                          <FolderIcon className="w-4 h-4 text-amber-500" />
                        )}
                        <span>{item.name}</span>
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Quick Counter Info */}
              <div className="hidden sm:flex items-center gap-1 text-[11px] font-medium text-slate-400 shrink-0">
                <span>{currentFolders.length} folder</span>
                <span>•</span>
                <span>{currentFiles.length} berkas</span>
              </div>
            </div>

            {/* 2. ACTION TOOLBAR (Swaps between Default Actions and Selection Bar) */}
            {selectedCount > 0 ? (
              /* SELECTION ACTION BAR */
              <div className="bg-blue-600 text-white px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 border-b border-blue-700 shadow-sm transition-all animate-fadeIn">
                {/* Left: Selection Counter */}
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
                    Pilih Semua
                  </button>
                </div>

                {/* Right: Contextual Selection Actions */}
                <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                  {/* Single File Action */}
                  {singleSelectedItem && singleSelectedItem.type === "file" && (
                    <>
                      <button
                        onClick={() => setPreviewFile(singleSelectedItem.data)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold transition-all shadow-2xs cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Pratinjau</span>
                      </button>
                      <button
                        onClick={() =>
                          startFileDownload(
                            singleSelectedItem.data.id,
                            singleSelectedItem.data.originalName,
                            singleSelectedItem.data.size
                          )
                        }
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-all shadow-2xs cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Unduh</span>
                      </button>
                    </>
                  )}

                  {/* Single Folder Action */}
                  {singleSelectedItem && singleSelectedItem.type === "folder" && (
                    <button
                      onClick={() => handleEnterSubfolder(singleSelectedItem.data)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white text-blue-700 hover:bg-blue-50 text-xs font-bold transition-all cursor-pointer shadow-2xs"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Buka Subfolder</span>
                    </button>
                  )}

                  {/* Multiple Files Download ZIP */}
                  {selectedFiles.length > 0 && (
                    <button
                      onClick={() => handleDownloadZip(selectedFiles.map((f) => f.id))}
                      disabled={isDownloadingZip}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-all cursor-pointer shadow-2xs disabled:opacity-50"
                    >
                      {isDownloadingZip ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>Unduh ZIP ({selectedFiles.length})</span>
                    </button>
                  )}

                  {/* Details Drawer Trigger */}
                  {singleSelectedItem && (
                    <button
                      onClick={() => setDetailsItem(singleSelectedItem)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold transition-all cursor-pointer shadow-2xs"
                    >
                      <Info className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Rincian</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              /* PRIMARY ACTION TOOLBAR */
              <div className="bg-slate-50/95 backdrop-blur-md border-b border-slate-200 px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 transition-all">
                {/* Search Bar & Category Filter Chips */}
                <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap sm:flex-nowrap">
                  <div className="relative flex-1 sm:w-60 min-w-[160px]">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Cari dalam folder..."
                      className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-white hover:bg-slate-100/80 focus:bg-white text-xs border border-slate-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 focus:outline-hidden transition-all shadow-2xs"
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

                  {/* Category Chips */}
                  <div className="hidden lg:flex items-center gap-1 overflow-x-auto text-xs py-0.5">
                    {[
                      { id: "ALL", label: "Semua" },
                      { id: "DOCUMENT", label: "Dokumen" },
                      { id: "IMAGE", label: "Gambar" },
                      { id: "VIDEO", label: "Video" },
                      { id: "AUDIO", label: "Audio" },
                      { id: "ARCHIVE", label: "Arsip" },
                      { id: "CODE", label: "Kode" },
                    ].map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => setCategoryFilter(cat.id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          categoryFilter === cat.id
                            ? "bg-blue-600 text-white shadow-2xs"
                            : "text-slate-600 hover:bg-slate-200/70"
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Right Action Buttons */}
                <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
                  {/* View Mode Switcher */}
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

                  {/* ZIP Download All */}
                  <button
                    onClick={() => handleDownloadZip()}
                    disabled={files.length === 0 || isDownloadingZip}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200 transition-all active:scale-95 cursor-pointer shadow-2xs disabled:opacity-50"
                  >
                    {isDownloadingZip ? (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    ) : (
                      <Download className="w-4 h-4 text-blue-600" />
                    )}
                    <span className="hidden sm:inline">Unduh ZIP</span>
                  </button>

                  {/* Upload Button - Enabled ONLY if permission is EDIT */}
                  {permission === FolderPermission.EDIT ? (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-md shadow-blue-500/20 active:scale-95 cursor-pointer"
                    >
                      <UploadCloud className="w-4 h-4" />
                      <span>Unggah Berkas</span>
                    </button>
                  ) : (
                    <div
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 text-slate-400 text-xs font-semibold border border-slate-200 cursor-not-allowed select-none"
                      title="Izin Hanya Lihat: Pengunggahan berkas dinonaktifkan"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Hanya Lihat</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* MAIN CONTENT CANVAS (With Marquee Drag Selection) */}
          <div
            ref={contentAreaRef}
            onMouseDown={handleMouseDownOnContainer}
            className="p-3.5 sm:p-6 flex-1 space-y-8 relative overflow-y-auto"
            onClick={handleContainerClick}
          >
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

            {/* EMPTY STATE */}
            {currentFolders.length === 0 && currentFiles.length === 0 ? (
              searchQuery.trim() ? (
                /* 1. SEARCH NOT FOUND STATE */
                <div className="bg-white border border-slate-200 rounded-3xl p-10 sm:p-14 text-center max-w-xl mx-auto my-6 shadow-2xs">
                  <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-100 shadow-2xs">
                    <SearchX className="w-8 h-8 text-amber-500" />
                  </div>
                  <h4 className="text-base font-bold text-slate-900 mb-1.5">
                    Tidak Ditemukan Hasil untuk "{searchQuery}"
                  </h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto mb-6 leading-relaxed">
                    Tidak ada folder maupun berkas di dalam folder bagikan ini yang cocok dengan kata kunci pencarian Anda. Periksa kembali ejaan kata kunci atau reset filter pencarian.
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
                /* 2. REGULAR EMPTY STATE */
                <div className="bg-white border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-3xl p-10 sm:p-14 text-center max-w-2xl mx-auto my-4 transition-all shadow-2xs">
                  <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-4 border border-blue-100 shadow-2xs">
                    {permission === FolderPermission.EDIT ? (
                      <UploadCloud className="w-8 h-8 animate-pulse text-blue-600" />
                    ) : (
                      <FolderIcon className="w-8 h-8 text-blue-600" />
                    )}
                  </div>
                  <h4 className="text-base font-bold text-slate-900 mb-1.5">
                    Folder "{currentFolder?.name || rootFolder.name}" Masih Kosong
                  </h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto mb-6 leading-relaxed">
                    {permission === FolderPermission.EDIT
                      ? "Folder ini belum memiliki berkas. Anda memiliki izin untuk mengunggah berkas. Tarik dan lepaskan berkas ke area ini atau klik tombol di bawah."
                      : "Folder yang dibagikan ini belum memiliki berkas di dalamnya."}
                  </p>

                  {permission === FolderPermission.EDIT && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-4 py-2.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-500/20 active:scale-95 cursor-pointer flex items-center gap-2 mx-auto"
                    >
                      <UploadCloud className="w-4 h-4" />
                      <span>Unggah Berkas Sekarang</span>
                    </button>
                  )}
                </div>
              )
            ) : (
              <>
                {/* 1. GRID VIEW MODE */}
                {viewMode === "grid" ? (
                  <div className="space-y-8">
                    {/* Subfolders Section */}
                    {displayedFolders.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                            <FolderIcon className="w-3.5 h-3.5 text-blue-600" />
                            <span>
                              {displayedFolders.length < currentFolders.length
                                ? `Subfolder (${displayedFolders.length} dari ${currentFolders.length})`
                                : `Subfolder (${currentFolders.length})`}
                            </span>
                          </h3>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                          {displayedFolders.map((folder) => {
                            const itemKey = `folder_${folder.id}`;
                            const isSelected = selectedKeys.has(itemKey);

                            return (
                              <div
                                key={folder.id}
                                data-selectable-key={itemKey}
                                onClick={(e) => handleItemClick(e, itemKey, "folder", folder)}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  handleEnterSubfolder(folder);
                                }}
                                onContextMenu={(e) => handleContextMenu(e, "folder", folder)}
                                className={`bg-white border rounded-2xl p-4 transition-all duration-200 group relative flex flex-col justify-between cursor-pointer select-none ${
                                  isSelected
                                    ? "border-blue-500 ring-2 ring-blue-500/50 bg-blue-50/40 shadow-md"
                                    : "border-slate-200 hover:border-blue-300 hover:shadow-md"
                                }`}
                              >
                                {/* Selected Checkmark */}
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
                                      ? "bg-blue-600 text-white shadow-2xs"
                                      : "bg-slate-100/90 text-slate-400 hover:bg-blue-100 hover:text-blue-600 opacity-80 sm:opacity-0 sm:group-hover:opacity-100"
                                  }`}
                                  title={isSelected ? "Batal Pilih" : "Pilih Folder"}
                                >
                                  <Check className={`w-3.5 h-3.5 stroke-[3] ${isSelected ? "text-white" : "text-slate-400"}`} />
                                </button>

                                <div>
                                  {/* Folder Icon */}
                                  <div className="flex items-start justify-between gap-2 mb-3">
                                    <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-500 border border-amber-100 flex items-center justify-center group-hover:scale-105 transition-transform shadow-2xs">
                                      <FolderIcon className="w-7 h-7 fill-amber-400 text-amber-500" />
                                    </div>
                                  </div>

                                  {/* Folder Title */}
                                  <h4 className="text-sm font-bold text-slate-900 truncate group-hover:text-blue-600 mb-1">
                                    {folder.name}
                                  </h4>
                                  <p className="text-[11px] text-slate-400 line-clamp-1 mb-2">
                                    {folder.description || "Subfolder dokumen"}
                                  </p>
                                </div>

                                {/* Folder Meta Footer */}
                                <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                                  <span>{folder.filesCount || 0} Berkas</span>
                                  <span>{formatBytes(folder.totalSizeBytes || 0)}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Files Section */}
                    {(currentFiles.length > 0 || currentFolder !== null) && (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                            <FileText className="w-3.5 h-3.5 text-blue-600" />
                            <span>
                              {displayedFiles.length < currentFiles.length
                                ? `Berkas (${displayedFiles.length} dari ${currentFiles.length})`
                                : `Berkas (${currentFiles.length})`}
                            </span>
                          </h3>
                          <span className="text-xs text-slate-400">
                            Total: {formatBytes(currentFiles.reduce((acc, f) => acc + (f.size || 0), 0))}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                          {displayedFiles.map((file) => {
                            const itemKey = `file_${file.id}`;
                            const isSelected = selectedKeys.has(itemKey);

                            return (
                              <div
                                key={file.id}
                                data-selectable-key={itemKey}
                                onClick={(e) => handleItemClick(e, itemKey, "file", file)}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewFile(file);
                                }}
                                onContextMenu={(e) => handleContextMenu(e, "file", undefined, file)}
                                className={`bg-white border rounded-2xl overflow-hidden transition-all duration-200 group relative flex flex-col justify-between cursor-pointer select-none ${
                                  isSelected
                                    ? "border-blue-500 ring-2 ring-blue-500/50 bg-blue-50/20 shadow-md"
                                    : "border-slate-200 hover:border-blue-300 hover:shadow-md"
                                }`}
                              >
                                {/* Top Checkbox */}
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
                                  className={`absolute top-2.5 right-2.5 w-6 h-6 rounded-full flex items-center justify-center transition-all z-10 ${
                                    isSelected
                                      ? "bg-blue-600 text-white shadow-2xs"
                                      : "bg-white/90 text-slate-400 hover:bg-blue-100 hover:text-blue-600 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 border border-slate-200"
                                  }`}
                                  title={isSelected ? "Batal Pilih" : "Pilih Berkas"}
                                >
                                  <Check className={`w-3.5 h-3.5 stroke-[3] ${isSelected ? "text-white" : "text-slate-400"}`} />
                                </button>

                                {/* Large Thumbnail Preview Header */}
                                {renderLargeThumbnail(file)}

                                {/* Card Body */}
                                <div className="p-3.5 flex flex-col justify-between flex-1 gap-2">
                                  <div className="flex items-start gap-2">
                                    <div className="shrink-0 mt-0.5">
                                      {getFileSmallIcon(file.mimeType, file.originalName)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <h4
                                        className="text-xs sm:text-sm font-bold text-slate-900 truncate group-hover:text-blue-600"
                                        title={file.originalName}
                                      >
                                        {file.originalName}
                                      </h4>
                                      <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
                                        <span>{formatBytes(file.size || 0)}</span>
                                        <span>{new Date(file.updatedAt || file.createdAt).toLocaleDateString()}</span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Bottom Action Strip */}
                                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setPreviewFile(file);
                                      }}
                                      className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 transition-colors cursor-pointer"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                      <span>Pratinjau</span>
                                    </button>

                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          copyShareLink(file.id);
                                        }}
                                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                                        title="Salin tautan unduh"
                                      >
                                        {copiedId === file.id ? (
                                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                                        ) : (
                                          <Copy className="w-3.5 h-3.5" />
                                        )}
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          startFileDownload(file.id, file.originalName, file.size);
                                        }}
                                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                                        title="Unduh Berkas"
                                      >
                                        <Download className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
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
                  /* 2. LIST / TABLE VIEW MODE */
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                    <div className="overflow-x-auto w-full overscroll-x-contain">
                      <table className="w-full min-w-[650px] text-left text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px] whitespace-nowrap">
                          <tr>
                            <th className="py-3 px-4 w-10">
                              <input
                                type="checkbox"
                                checked={allVisibleItems.length > 0 && selectedCount === allVisibleItems.length}
                                onChange={handleSelectAll}
                                className="w-4 h-4 rounded-xs border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                              />
                            </th>
                            <th className="py-3 px-4">Nama</th>
                            <th className="py-3 px-4">Kategori</th>
                            <th className="py-3 px-4">Ukuran</th>
                            <th className="py-3 px-4">Tanggal Diubah</th>
                            <th className="py-3 px-4 text-right">Aksi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 whitespace-nowrap">
                          {/* Subfolders in List */}
                          {displayedFolders.map((folder) => {
                            const itemKey = `folder_${folder.id}`;
                            const isSelected = selectedKeys.has(itemKey);

                            return (
                              <tr
                                key={folder.id}
                                data-selectable-key={itemKey}
                                onClick={(e) => handleItemClick(e, itemKey, "folder", folder)}
                                onDoubleClick={() => handleEnterSubfolder(folder)}
                                onContextMenu={(e) => handleContextMenu(e, "folder", folder)}
                                className={`hover:bg-slate-50 cursor-pointer transition-colors ${
                                  isSelected ? "bg-blue-50/60" : ""
                                }`}
                              >
                                <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {
                                      const newKeys = new Set(selectedKeys);
                                      if (isSelected) newKeys.delete(itemKey);
                                      else newKeys.add(itemKey);
                                      setSelectedKeys(newKeys);
                                    }}
                                    className="w-4 h-4 rounded-xs border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                  />
                                </td>
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-2.5 font-bold text-slate-900">
                                    <FolderIcon className="w-4 h-4 text-amber-500 shrink-0" />
                                    <span className="truncate max-w-xs sm:max-w-md">{folder.name}</span>
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-slate-500">Folder Dokumen</td>
                                <td className="py-3 px-4 text-slate-500 font-mono">{formatBytes(folder.totalSizeBytes || 0)}</td>
                                <td className="py-3 px-4 text-slate-500">
                                  {new Date(folder.updatedAt || folder.createdAt).toLocaleDateString()}
                                </td>
                                <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    onClick={() => handleEnterSubfolder(folder)}
                                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors cursor-pointer"
                                  >
                                    Buka
                                  </button>
                                </td>
                              </tr>
                            );
                          })}

                          {/* Files in List */}
                          {displayedFiles.map((file) => {
                            const itemKey = `file_${file.id}`;
                            const isSelected = selectedKeys.has(itemKey);

                            return (
                              <tr
                                key={file.id}
                                data-selectable-key={itemKey}
                                onClick={(e) => handleItemClick(e, itemKey, "file", file)}
                                onDoubleClick={() => setPreviewFile(file)}
                                onContextMenu={(e) => handleContextMenu(e, "file", undefined, file)}
                                className={`hover:bg-slate-50 cursor-pointer transition-colors ${
                                  isSelected ? "bg-blue-50/60" : ""
                                }`}
                              >
                                <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {
                                      const newKeys = new Set(selectedKeys);
                                      if (isSelected) newKeys.delete(itemKey);
                                      else newKeys.add(itemKey);
                                      setSelectedKeys(newKeys);
                                    }}
                                    className="w-4 h-4 rounded-xs border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                  />
                                </td>
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-2.5 font-semibold text-slate-900">
                                    <div className="shrink-0">{getFileSmallIcon(file.mimeType, file.originalName)}</div>
                                    <span className="truncate max-w-xs sm:max-w-md">{file.originalName}</span>
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-slate-500 uppercase text-[10px] font-bold">
                                  {getFileCategory(file.mimeType, file.originalName)}
                                </td>
                                <td className="py-3 px-4 text-slate-500 font-mono">{formatBytes(file.size || 0)}</td>
                                <td className="py-3 px-4 text-slate-500">
                                  {new Date(file.updatedAt || file.createdAt).toLocaleDateString()}
                                </td>
                                <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      onClick={() => setPreviewFile(file)}
                                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                                      title="Pratinjau Berkas"
                                    >
                                      <Eye className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => startFileDownload(file.id, file.originalName, file.size)}
                                      className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                                      title="Unduh Berkas"
                                    >
                                      <Download className="w-4 h-4" />
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

                {/* INFINITE SCROLL SENTINEL & LOADING INDICATOR */}
                <div ref={loadMoreRef} className="pt-6 pb-2">
                  {isLoadingMore && (
                    <div className="flex flex-col items-center justify-center py-6 px-4 bg-white/90 backdrop-blur-xs border border-blue-100 rounded-2xl shadow-xs transition-all animate-in fade-in zoom-in duration-200 max-w-sm mx-auto">
                      <div className="flex items-center gap-3">
                        <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                        <span className="text-xs font-semibold text-slate-800">
                          Memuat 20 item selanjutnya...
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Menampilkan {displayedFolders.length + displayedFiles.length} dari {totalItemsCount} folder & berkas
                      </p>
                    </div>
                  )}

                  {!isLoadingMore && hasMoreItems && (
                    <div className="flex justify-center py-2">
                      <button
                        type="button"
                        onClick={handleLoadMore}
                        className="px-4 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-blue-600 border border-blue-200 shadow-2xs hover:border-blue-300 transition-all flex items-center gap-2 cursor-pointer active:scale-95"
                      >
                        <Loader2 className="w-3.5 h-3.5" />
                        <span>Muat 20 Item Lebih Banyak</span>
                        <span className="text-slate-400 font-normal">
                          ({displayedFolders.length + displayedFiles.length}/{totalItemsCount})
                        </span>
                      </button>
                    </div>
                  )}

                  {!hasMoreItems && totalItemsCount > PAGE_SIZE && (
                    <div className="text-center py-4 border-t border-slate-100">
                      <p className="text-xs text-slate-400 flex items-center justify-center gap-1.5 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Menampilkan seluruh {totalItemsCount} folder & berkas</span>
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </main>
      </div>

      {/* CONTEXT MENU (Adjusted for Permissions) */}
      <ContextMenu
        state={contextMenu}
        onClose={() => setContextMenu(null)}
        onOpenFolder={(folder) => {
          handleEnterSubfolder(folder);
        }}
        onDownloadFolder={(folder) => {
          handleDownloadZip();
        }}
        onPreviewFile={(file) => {
          setPreviewFile(file);
        }}
        onDownloadFile={(file) => {
          startFileDownload(file.id, file.originalName, file.size);
        }}
        onViewFileDetails={(file) => {
          setDetailsItem({ type: "file", data: file });
        }}
        onViewFolderDetails={(folder) => {
          setDetailsItem({ type: "folder", data: folder });
        }}
      />

      {/* ITEM DETAILS DRAWER */}
      <ItemDetailsDrawer
        item={detailsItem}
        onClose={() => setDetailsItem(null)}
        onPreviewFile={(file) => setPreviewFile(file)}
      />

      {/* FILE PREVIEW MODAL */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          filesList={currentFiles}
          onClose={() => setPreviewFile(null)}
          onNavigateFile={(next) => setPreviewFile(next)}
        />
      )}
    </div>
  );
};
