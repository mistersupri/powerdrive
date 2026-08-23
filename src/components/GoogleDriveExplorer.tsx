import React, { useState, useRef, useMemo, useEffect, useCallback } from "react";
import {
  Folder,
  FileItem,
  FolderPermission,
  SyncStatus,
  UserRole,
  StorageStats,
  SyncStats,
  GoogleDriveStatus,
} from "../types/frontend.ts";
import { api } from "../services/api.ts";
import { useAuth } from "../context/AuthContext.tsx";
import { useDialog } from "../context/DialogContext.tsx";
import { ContextMenu, ContextMenuState } from "./ContextMenu.tsx";
import { ShareFolderModal } from "./ShareFolderModal.tsx";
import { InlineRenameModal } from "./InlineRenameModal.tsx";
import { ItemDetailsDrawer } from "./ItemDetailsDrawer.tsx";
import { ImportGoogleDriveModal } from "./ImportGoogleDriveModal.tsx";
import { FilePreviewModal } from "./FilePreviewModal.tsx";
import { MultiPartZipModal } from "./MultiPartZipModal.tsx";
import { ChunkUploadModal } from "./ChunkUploadModal.tsx";
import { FileConflictModal, ConflictResolutionMode, ConflictItem } from "./FileConflictModal.tsx";
import { VideoThumbnail } from "./VideoThumbnail.tsx";
import { OperationLoadingModal, OperationType } from "./OperationLoadingModal.tsx";
import { MoveCopyModal } from "./MoveCopyModal.tsx";
import {
  Folder as FolderIcon,
  FolderPlus,
  FolderOpen,
  CloudDownload,
  UploadCloud,
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
} from "lucide-react";

interface GoogleDriveExplorerProps {
  folders: Folder[];
  files: FileItem[];
  googleStatus: GoogleDriveStatus | null;
  storageStats: StorageStats | null;
  syncStats: SyncStats | null;
  currentFolderId: string | null;
  onNavigateFolder: (folderId: string | null) => void;
  onRefreshData: () => void;
  isLoading?: boolean;
  onOpenSettings?: () => void;
}

export const GoogleDriveExplorer: React.FC<GoogleDriveExplorerProps> = ({
  folders,
  files,
  googleStatus,
  storageStats,
  syncStats,
  currentFolderId,
  onNavigateFolder,
  onRefreshData,
  isLoading = false,
}) => {
  const { user, isAdmin } = useAuth();
  const { showAlert, showConfirm, showToast } = useDialog();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const explorerRef = useRef<HTMLDivElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);

  // View & Filter States
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [isDragOver, setIsDragOver] = useState(false);

  // Server-Side Paginated Drive Data State (Limit 20 items per fetch)
  const [localFolders, setLocalFolders] = useState<Folder[]>([]);
  const [localFiles, setLocalFiles] = useState<FileItem[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [isFetchingPage, setIsFetchingPage] = useState<boolean>(true);
  const [isLoadingNextPage, setIsLoadingNextPage] = useState<boolean>(false);
  const [totalFoldersCount, setTotalFoldersCount] = useState<number>(0);
  const [totalFilesCount, setTotalFilesCount] = useState<number>(0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // Multi-Item Selection State
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
  const [showMoveCopyModal, setShowMoveCopyModal] = useState<"move" | "copy" | null>(null);
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [showImportGoogleDriveModal, setShowImportGoogleDriveModal] = useState(false);
  const [showMultiPartZipModal, setShowMultiPartZipModal] = useState(false);
  const [zipDownloadFolder, setZipDownloadFolder] = useState<Folder | null>(null);
  const [showChunkUploadModal, setShowChunkUploadModal] = useState(false);
  const [chunkUploadFiles, setChunkUploadFiles] = useState<globalThis.File[]>([]);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictItems, setConflictItems] = useState<ConflictItem[]>([]);
  const [pendingRawFiles, setPendingRawFiles] = useState<globalThis.File[]>([]);
  const [chunkUploadConflictModes, setChunkUploadConflictModes] = useState<
    Map<string, ConflictResolutionMode> | undefined
  >(undefined);

  // Operation Loading State (for delete, trash, sync, etc.)
  const [operationLoading, setOperationLoading] = useState<{
    isOpen: boolean;
    title: string;
    message?: string;
    type?: OperationType;
    subMessage?: string;
  }>({ isOpen: false, title: "" });

  // Right-Click Context Menu & Quick Action States
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [shareFolderModal, setShareFolderModal] = useState<Folder | null>(null);
  const [renameItem, setRenameItem] = useState<
    { type: "folder"; data: Folder } | { type: "file"; data: FileItem } | null
  >(null);
  const [detailsItem, setDetailsItem] = useState<
    { type: "folder"; data: Folder } | { type: "file"; data: FileItem } | null
  >(null);

  // Drag and drop states for moving files & folders
  const [activeDragItem, setActiveDragItem] = useState<{
    key: string;
    type: "folder" | "file";
    id: string;
  } | null>(null);
  const [activeDragOverId, setActiveDragOverId] = useState<string | null>(null);
  const [hoveredCrumbId, setHoveredCrumbId] = useState<string | null>(null);
  const [hoveredSubfolderId, setHoveredSubfolderId] = useState<string | null>(null);
  const hoverTimeoutRef = useRef<any>(null);

  // Clear selection when navigating to another folder
  useEffect(() => {
    setSelectedKeys(new Set());
    setLastSelectedKey(null);
  }, [currentFolderId]);

  // Current folder object
  const currentFolder = useMemo(() => {
    if (!currentFolderId) return null;
    return folders.find((f) => f.id === currentFolderId) || null;
  }, [folders, currentFolderId]);

  // Compute breadcrumbs path
  const breadcrumbs = useMemo(() => {
    const trail: { id: string | null; name: string }[] = [{ id: null, name: "Drive Saya" }];
    if (!currentFolder) return trail;

    const visited = new Set<string>();
    let curr: Folder | undefined = currentFolder;
    const path: { id: string; name: string }[] = [];

    while (curr && !visited.has(curr.id)) {
      visited.add(curr.id);
      path.unshift({ id: curr.id, name: curr.name });
      if (curr.parentId) {
        curr = folders.find((f) => f.id === curr!.parentId);
      } else {
        break;
      }
    }

    return [...trail, ...path];
  }, [folders, currentFolder]);

  // Fetch paginated data from backend (limit 20 items per page)
  const fetchPageData = useCallback(
    async (pageToLoad: number, append: boolean = false) => {
      if (append) {
        setIsLoadingNextPage(true);
      } else {
        setIsFetchingPage(true);
      }

      try {
        const queryTerm = searchQuery.trim() || undefined;
        const targetParentId = queryTerm ? undefined : (currentFolderId || "root");
        const targetFolderId = queryTerm ? undefined : (currentFolderId || "root");
        const isRootDriveView = currentFolderId === null && !queryTerm;

        const foldersPromise = api.listFolders({
          parentId: targetParentId,
          page: pageToLoad,
          limit: 20,
          search: queryTerm,
        });

        // Pada halaman awal "Drive Saya", data yang ditampilkan hanya folder (dibuat & diimport), berkas di dalam folder tidak dimuat
        const filesPromise = isRootDriveView
          ? Promise.resolve({ files: [], total: 0, page: 1, limit: 20, totalPages: 1, hasMore: false })
          : api.listFiles({
              folderId: targetFolderId,
              page: pageToLoad,
              limit: 20,
              syncStatus: statusFilter !== "ALL" ? (statusFilter as SyncStatus) : undefined,
              search: queryTerm,
            });

        const [foldersRes, filesRes] = await Promise.all([foldersPromise, filesPromise]);

        if (append) {
          setLocalFolders((prev) => {
            const existingIds = new Set(prev.map((f) => f.id));
            const newFolders = foldersRes.folders.filter((f) => !existingIds.has(f.id));
            return [...prev, ...newFolders];
          });
          setLocalFiles((prev) => {
            const existingIds = new Set(prev.map((f) => f.id));
            const newFiles = filesRes.files.filter((f) => !existingIds.has(f.id));
            return [...prev, ...newFiles];
          });
        } else {
          setLocalFolders(foldersRes.folders);
          setLocalFiles(filesRes.files);
        }

        setCurrentPage(pageToLoad);
        setTotalFoldersCount(foldersRes.total);
        setTotalFilesCount(filesRes.total);
        setHasMore(Boolean(foldersRes.hasMore || (!isRootDriveView && filesRes.hasMore)));
      } catch (err) {
        console.warn("Error fetching paginated drive items:", err);
      } finally {
        setIsFetchingPage(false);
        setIsLoadingNextPage(false);
      }
    },
    [currentFolderId, searchQuery, statusFilter]
  );

  // Trigger initial fetch or reset on folder/search/filter change
  useEffect(() => {
    setCurrentPage(1);
    fetchPageData(1, false);
  }, [fetchPageData]);

  // Derived lists for current view
  const isRootDriveView = currentFolderId === null && !searchQuery.trim();
  const currentFolders = localFolders;
  const currentFiles = localFiles;
  const displayedFolders = localFolders;
  const displayedFiles = localFiles;
  const totalItemsCount = isRootDriveView ? totalFoldersCount : totalFoldersCount + totalFilesCount;

  // Infinite Scroll Trigger (Fetching next page from server)
  const handleLoadMore = useCallback(() => {
    if (isLoadingNextPage || isFetchingPage || !hasMore) return;
    const nextPage = currentPage + 1;
    fetchPageData(nextPage, true);
  }, [isLoadingNextPage, isFetchingPage, hasMore, currentPage, fetchPageData]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !hasMore || isFetchingPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first && first.isIntersecting && !isLoadingNextPage && !isFetchingPage && hasMore) {
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
  }, [handleLoadMore, hasMore, isLoadingNextPage, isFetchingPage]);

  // Refresh helper for actions (upload, create, rename, delete)
  const refreshCurrentView = useCallback(() => {
    fetchPageData(1, false);
    onRefreshData();
  }, [fetchPageData, onRefreshData]);

  // Combined visible items array in sequence (for Shift+Click range selection and select all)
  const allVisibleItems = useMemo(() => {
    const list: { key: string; type: "folder" | "file"; data: Folder | FileItem }[] = [];
    displayedFolders.forEach((f) => list.push({ key: `folder_${f.id}`, type: "folder", data: f }));
    displayedFiles.forEach((f) => list.push({ key: `file_${f.id}`, type: "file", data: f }));
    return list;
  }, [displayedFolders, displayedFiles]);

  // Selected lists derived from selectedKeys
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

  // Touch & Hold (Long-press) handling for Mobile (One-click = open, Hold = select)
  const touchTimerRef = useRef<{
    timer: any;
    startX: number;
    startY: number;
    isLongPress: boolean;
    key: string;
  } | null>(null);
  const touchHandledRef = useRef<boolean>(false);

  const handleTouchStart = (
    e: React.TouchEvent,
    key: string,
    type: "folder" | "file",
    data: Folder | FileItem
  ) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];

    if (touchTimerRef.current?.timer) {
      clearTimeout(touchTimerRef.current.timer);
    }

    const timer = setTimeout(() => {
      if (touchTimerRef.current) {
        touchTimerRef.current.isLongPress = true;
        // Haptic feedback vibration on mobile if supported
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          try {
            navigator.vibrate(40);
          } catch {
            // ignore
          }
        }
        // Enter multi-select mode and toggle/select this item
        setSelectedKeys((prev) => {
          const next = new Set(prev);
          if (next.has(key)) {
            next.delete(key);
          } else {
            next.add(key);
          }
          return next;
        });
        setLastSelectedKey(key);
      }
    }, 450); // 450ms hold to select

    touchTimerRef.current = {
      timer,
      startX: touch.clientX,
      startY: touch.clientY,
      isLongPress: false,
      key,
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchTimerRef.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchTimerRef.current.startX);
    const dy = Math.abs(touch.clientY - touchTimerRef.current.startY);
    // If finger moves more than 8px (user is scrolling), cancel hold
    if (dx > 8 || dy > 8) {
      clearTimeout(touchTimerRef.current.timer);
      touchTimerRef.current = null;
    }
  };

  const handleTouchEnd = (
    e: React.TouchEvent,
    key: string,
    type: "folder" | "file",
    data: Folder | FileItem
  ) => {
    if (!touchTimerRef.current) return;
    clearTimeout(touchTimerRef.current.timer);

    const wasLongPress = touchTimerRef.current.isLongPress;
    touchTimerRef.current = null;

    if (wasLongPress) {
      // Long press already handled selection
      touchHandledRef.current = true;
      e.preventDefault();
      setTimeout(() => {
        touchHandledRef.current = false;
      }, 300);
      return;
    }

    // It was a short tap!
    touchHandledRef.current = true;
    setTimeout(() => {
      touchHandledRef.current = false;
    }, 300);

    // If currently in selection mode: tap toggles selection
    if (selectedKeys.size > 0) {
      e.preventDefault();
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
      setLastSelectedKey(key);
      return;
    }

    // Mobile Normal Tap (NOT in selection mode): ONE CLICK = OPEN!
    e.preventDefault();
    if (type === "folder") {
      onNavigateFolder((data as Folder).id);
    } else {
      setPreviewFile(data as FileItem);
    }
  };

  // Handle Item Click with Shift + Click, Ctrl/Cmd + Click, and Mobile fallback
  const handleItemClick = (
    e: React.MouseEvent,
    key: string,
    type: "folder" | "file",
    data: Folder | FileItem
  ) => {
    e.stopPropagation();

    // If touch gesture was already executed, skip simulated mouse click
    if (touchHandledRef.current) {
      return;
    }

    const isTouchOrMobile =
      window.innerWidth < 768 ||
      (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);

    // On mobile screens when NOT in multi-selection mode: single click opens!
    if (isTouchOrMobile && selectedKeys.size === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if (type === "folder") {
        onNavigateFolder((data as Folder).id);
      } else {
        setPreviewFile(data as FileItem);
      }
      return;
    }

    // 1. Shift + Click (Range Selection)
    if (e.shiftKey && lastSelectedKey) {
      const fromIndex = allVisibleItems.findIndex((item) => item.key === lastSelectedKey);
      const toIndex = allVisibleItems.findIndex((item) => item.key === key);

      if (fromIndex !== -1 && toIndex !== -1) {
        const start = Math.min(fromIndex, toIndex);
        const end = Math.max(fromIndex, toIndex);
        const newKeys = new Set(selectedKeys);
        for (let i = start; i <= end; i++) {
          newKeys.add(allVisibleItems[i].key);
        }
        setSelectedKeys(newKeys);
        return;
      }
    }

    // 2. Ctrl / Cmd + Click (Toggle Item) or clicking while selection mode is active on mobile
    if (e.ctrlKey || e.metaKey || (isTouchOrMobile && selectedKeys.size > 0)) {
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

    // 3. Normal Single Click on Desktop (Select only this item)
    setSelectedKeys(new Set([key]));
    setLastSelectedKey(key);
  };

  // Select All Handler
  const handleSelectAll = () => {
    setSelectedKeys(new Set(allVisibleItems.map((item) => item.key)));
  };

  // Keyboard shortcuts: Escape to deselect, Ctrl/Cmd+A to select all
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      if (e.key === "Escape") {
        if (selectedKeys.size > 0) {
          setSelectedKeys(new Set());
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        handleSelectAll();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedKeys, allVisibleItems]);

  // Rubberband Marquee Drag Selection Handlers
  const handleMouseDownOnContainer = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Only left-click
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, [data-prevent-marquee]")) {
      return;
    }

    // If clicking directly on a selectable item, don't initiate marquee drag
    const itemEl = target.closest("[data-selectable-key]");
    if (itemEl) return;

    hasDraggedMarqueeRef.current = false;
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

      // Only calculate collision if cursor dragged by at least 4 pixels
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
      // Keep hasDraggedMarqueeRef active momentarily to suppress subsequent click event
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
    if (hasDraggedMarqueeRef.current) {
      return;
    }
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

  const handleRenameSubmit = async (newName: string) => {
    if (!renameItem) return;
    if (renameItem.type === "folder") {
      await api.updateFolder(renameItem.data.id, { name: newName });
    } else {
      await api.renameFile(renameItem.data.id, newName);
    }
    setSelectedKeys(new Set());
    refreshCurrentView();
  };

  // Create Folder Form
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderDesc, setNewFolderDesc] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // Upload Management
  const [uploadQueue, setUploadQueue] = useState<{
    id: string;
    name: string;
    size: number;
    status: "uploading" | "success" | "error";
    error?: string;
  }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadDrawerOpen, setIsUploadDrawerOpen] = useState(false);

  // Check upload permission for current folder
  const canUploadToCurrentFolder = useMemo(() => {
    if (!currentFolder) return false;
    if (isAdmin) return true;
    if (currentFolder.ownerId && currentFolder.ownerId === user?.id) return true;
    return currentFolder.permission !== FolderPermission.VIEW;
  }, [currentFolder, isAdmin, user]);

  // Create Folder Handler
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    setIsCreatingFolder(true);
    try {
      await api.createFolder({
        name: newFolderName.trim(),
        description: newFolderDesc.trim() || undefined,
        parentId: currentFolderId || null,
        permission: FolderPermission.VIEW,
      });
      setNewFolderName("");
      setNewFolderDesc("");
      setShowCreateFolderModal(false);
      showToast("Folder baru berhasil dibuat", "success");
      refreshCurrentView();
    } catch (err: any) {
      showAlert({
        title: "Gagal Membuat Folder",
        message: err.message,
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

    if (!canUploadToCurrentFolder) {
      showAlert({
        title: "Akses Dibatasi",
        message:
          "Folder ini memiliki izin 'Hanya Lihat (VIEW)'. Anda tidak diizinkan mengunggah berkas ke folder ini.",
        type: "warning",
      });
      return;
    }

    const targetFolderId = currentFolderId || (folders.length > 0 ? folders[0].id : "");
    if (!targetFolderId) {
      showAlert({
        title: "Pilih Folder Target",
        message: "Harap buat atau buka folder terlebih dahulu sebelum mengunggah berkas.",
        type: "info",
      });
      return;
    }

    // Check for filename conflicts in the target folder
    try {
      const conflictRes = await api.checkConflicts(
        targetFolderId,
        rawFiles.map((f) => f.name)
      );

      if (conflictRes.conflicts && conflictRes.conflicts.length > 0) {
        const conflictList: ConflictItem[] = [];
        for (const conf of conflictRes.conflicts) {
          const matchedFile = rawFiles.find((f) => f.name === conf.fileName);
          if (matchedFile) {
            conflictList.push({
              newFile: matchedFile,
              existingFile: conf.existingFile,
            });
          }
        }

        if (conflictList.length > 0) {
          setPendingRawFiles(rawFiles);
          setConflictItems(conflictList);
          setShowConflictModal(true);
          return;
        }
      }
    } catch (err) {
      console.warn("Could not check conflicts beforehand, proceeding to upload", err);
    }

    // No conflict, proceed immediately with default create_version
    setChunkUploadConflictModes(undefined);
    setChunkUploadFiles(rawFiles);
    setShowChunkUploadModal(true);
  };

  const handleConflictResolved = (resolutions: Map<string, ConflictResolutionMode>) => {
    setShowConflictModal(false);
    setConflictItems([]);
    setChunkUploadConflictModes(resolutions);
    setChunkUploadFiles(pendingRawFiles);
    setShowChunkUploadModal(true);
  };

  const handleChunkUploadComplete = () => {
    refreshCurrentView();
  };

  // Delete Folder Handler
  const handleDeleteFolder = async (folder: Folder) => {
    const confirmed = await showConfirm({
      title: "Pindahkan Folder ke Sampah",
      message: `Apakah Anda yakin ingin memindahkan folder "${folder.name}" ke Sampah? Folder dan isinya dapat dipulihkan kapan saja dari menu Sampah.`,
      confirmText: "Pindahkan ke Sampah",
      cancelText: "Batal",
      isDanger: true,
    });
    if (!confirmed) return;

    setOperationLoading({
      isOpen: true,
      title: "Memindahkan Folder ke Sampah",
      message: folder.name,
      type: "trash",
      subMessage: "Sedang memindahkan folder dan isinya ke tempat sampah...",
    });
    try {
      await api.deleteFolder(folder.id);
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        next.delete(`folder_${folder.id}`);
        return next;
      });
      showToast(`Folder "${folder.name}" dipindahkan ke Sampah`, "success");
      refreshCurrentView();
    } catch (err: any) {
      showAlert({
        title: "Gagal Menghapus Folder",
        message: err.message,
        type: "error",
      });
    } finally {
      setOperationLoading((prev) => ({ ...prev, isOpen: false }));
    }
  };

  // Delete File Handler
  const handleDeleteFile = async (file: FileItem) => {
    const confirmed = await showConfirm({
      title: "Pindahkan Berkas ke Sampah",
      message: `Apakah Anda yakin ingin memindahkan berkas "${file.originalName}" ke Sampah? Berkas dapat dipulihkan kembali dari menu Sampah.`,
      confirmText: "Pindahkan ke Sampah",
      cancelText: "Batal",
      isDanger: true,
    });
    if (!confirmed) return;

    setOperationLoading({
      isOpen: true,
      title: "Memindahkan Berkas ke Sampah",
      message: file.originalName,
      type: "trash",
      subMessage: "Sedang memindahkan berkas ke tempat sampah...",
    });
    try {
      await api.deleteFile(file.id);
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        next.delete(`file_${file.id}`);
        return next;
      });
      showToast(`Berkas "${file.originalName}" dipindahkan ke Sampah`, "success");
      refreshCurrentView();
    } catch (err: any) {
      showAlert({
        title: "Gagal Menghapus Berkas",
        message: err.message,
        type: "error",
      });
    } finally {
      setOperationLoading((prev) => ({ ...prev, isOpen: false }));
    }
  };

  // Bulk Operations
  const handleBulkDownload = () => {
    if (selectedFiles.length === 0) return;
    selectedFiles.forEach((file, index) => {
      setTimeout(() => {
        const link = document.createElement("a");
        link.href = api.getDownloadUrl(file.id);
        link.download = file.originalName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }, index * 250);
    });
    showToast(`Mengunduh ${selectedFiles.length} berkas...`, "info");
  };

  const handleBulkSync = async () => {
    if (selectedFiles.length === 0) return;
    try {
      await api.bulkSyncFiles(selectedFiles.map((f) => f.id));
      showToast(`Memicu sinkronisasi untuk ${selectedFiles.length} berkas`, "info");
      refreshCurrentView();
    } catch (err: any) {
      showAlert({
        title: "Gagal Menyinkronkan",
        message: err.message,
        type: "error",
      });
    }
  };

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
      title: "Pindahkan ke Sampah",
      message: `Apakah Anda yakin ingin memindahkan ${itemDesc} yang dipilih ke Sampah? Item dapat dipulihkan kembali dari menu Sampah.`,
      confirmText: "Pindahkan ke Sampah",
      cancelText: "Batal",
      isDanger: true,
    });
    if (!confirmed) return;

    setOperationLoading({
      isOpen: true,
      title: "Memindahkan ke Sampah",
      message: itemDesc,
      type: "trash",
      subMessage: "Sedang memindahkan seluruh item terpilih ke tempat sampah...",
    });
    try {
      if (fileCount > 0) {
        await api.bulkDeleteFiles(selectedFiles.map((f) => f.id));
      }
      if (folderCount > 0) {
        for (const f of selectedFolders) {
          await api.deleteFolder(f.id);
        }
      }
      setSelectedKeys(new Set());
      showToast(`Berhasil memindahkan ${itemDesc} ke Sampah`, "success");
      refreshCurrentView();
    } catch (err: any) {
      showAlert({
        title: "Gagal Menghapus Item",
        message: err.message,
        type: "error",
      });
    } finally {
      setOperationLoading((prev) => ({ ...prev, isOpen: false }));
    }
  };

  // Single Sync Handler
  const handleSyncFile = async (file: FileItem) => {
    try {
      await api.syncSingleFile(file.id);
      showToast(`Memicu sinkronisasi untuk "${file.originalName}"`, "info");
      refreshCurrentView();
    } catch (err: any) {
      showAlert({
        title: "Gagal Menyinkronkan",
        message: err.message,
        type: "error",
      });
    }
  };

  // Folder Sync Handler
  const handleSyncFolder = async (folder: Folder) => {
    try {
      showToast(`Menyinkronkan folder "${folder.name}" ke Google Drive...`, "info");
      await api.syncFolder(folder.id);
      showToast(`Folder "${folder.name}" berhasil disinkronkan ke Google Drive!`, "success");
      refreshCurrentView();
    } catch (err: any) {
      showAlert({
        title: "Gagal Sinkronisasi Folder",
        message: err.message || "Gagal menyinkronkan folder ke Google Drive",
        type: "error",
      });
    }
  };

  // Format Helper
  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
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

  // Small file icon for list view & header
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

  // Large thumbnail or custom enlarged visual icon for Grid view
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
            <div className="w-14 h-14 rounded-2xl bg-purple-100 flex items-center justify-center shadow-xs">
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
        <div className="w-full h-36 sm:h-40 bg-linear-to-b from-rose-50 to-rose-100/60 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-rose-100 select-none">
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
        <div className="w-full h-36 sm:h-40 bg-linear-to-b from-emerald-50 to-emerald-100/60 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-emerald-100 select-none">
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
        <div className="w-full h-36 sm:h-40 bg-linear-to-b from-blue-50 to-blue-100/60 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-blue-100 select-none">
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
        <div className="w-full h-36 sm:h-40 bg-linear-to-b from-teal-50 to-teal-100/60 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-teal-100 select-none">
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
        <div className="w-full h-36 sm:h-40 bg-linear-to-b from-amber-50 to-amber-100/60 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-amber-100 select-none">
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
        <div className="w-full h-36 sm:h-40 bg-linear-to-b from-indigo-50 to-indigo-100/60 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-indigo-100 select-none">
          <div className="w-16 h-16 rounded-2xl bg-white shadow-md border border-indigo-200 flex items-center justify-center text-indigo-600 group-hover:scale-105 transition-transform">
            <FileCode className="w-9 h-9" />
          </div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-700 bg-white/90 border border-indigo-200 px-2.5 py-0.5 rounded-full shadow-2xs">
            SKRIP / KODE ({ext})
          </span>
        </div>
      );
    }

    // Default / Other files
    return (
      <div className="w-full h-36 sm:h-40 bg-linear-to-b from-slate-50 to-slate-100 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-slate-200 select-none">
        <div className="w-16 h-16 rounded-2xl bg-white shadow-md border border-slate-200 flex items-center justify-center text-slate-500 group-hover:scale-105 transition-transform">
          <FileGenericIcon className="w-9 h-9" />
        </div>
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-600 bg-white/90 border border-slate-200 px-2.5 py-0.5 rounded-full shadow-2xs">
          BERKAS ({ext})
        </span>
      </div>
    );
  };

  // Internal Drag & Drop handlers for moving files/folders
  const executeMoveItems = async (targetFolderId: string | null, overrideItems?: { files: string[]; folders: string[] }) => {
    const filesToMove = overrideItems ? overrideItems.files : selectedFiles.map((f) => f.id);
    const foldersToMove = overrideItems ? overrideItems.folders : selectedFolders.map((f) => f.id);

    const fileCount = filesToMove.length;
    const folderCount = foldersToMove.length;

    if (folderCount === 0 && fileCount === 0) return;

    // Prevent dragging a folder into itself or its own descendants
    if (targetFolderId) {
      const descendants = new Set<string>();
      const findDescendants = (id: string) => {
        folders.forEach((f) => {
          if (f.parentId === id) {
            descendants.add(f.id);
            findDescendants(f.id);
          }
        });
      };
      
      for (const folderId of foldersToMove) {
        if (folderId === targetFolderId) {
          showAlert({
            title: "Tindakan Tidak Valid",
            message: "Tidak dapat memindahkan folder ke dalam dirinya sendiri.",
            type: "error",
          });
          return;
        }
        findDescendants(folderId);
        if (descendants.has(targetFolderId)) {
          showAlert({
            title: "Tindakan Tidak Valid",
            message: "Tidak dapat memindahkan folder ke dalam subfoldernya sendiri.",
            type: "error",
          });
          return;
        }
      }
    }

    let itemDesc = "";
    if (folderCount > 0 && fileCount > 0) {
      itemDesc = `${folderCount} folder dan ${fileCount} berkas`;
    } else if (folderCount > 0) {
      itemDesc = `${folderCount} folder`;
    } else {
      itemDesc = `${fileCount} berkas`;
    }

    setOperationLoading({
      isOpen: true,
      title: "Memindahkan Item",
      message: itemDesc,
      type: "sync",
      subMessage: `Sedang memindahkan ${itemDesc} ke folder tujuan...`,
    });

    try {
      // 1. Move Files
      if (fileCount > 0) {
        await api.bulkMoveFiles(filesToMove, targetFolderId || "root");
      }

      // 2. Move Folders
      if (folderCount > 0) {
        for (const folderId of foldersToMove) {
          await api.updateFolder(folderId, { parentId: targetFolderId });
        }
      }

      setSelectedKeys(new Set());
      showToast(`Berhasil memindahkan ${itemDesc}`, "success");
      refreshCurrentView();
    } catch (err: any) {
      showAlert({
        title: "Gagal Memindahkan Item",
        message: err.message,
        type: "error",
      });
    } finally {
      setOperationLoading({ isOpen: false, title: "" });
    }
  };

  const handleDragStart = (e: React.DragEvent, key: string, type: "folder" | "file", id: string) => {
    e.stopPropagation();

    let files: string[] = [];
    let foldersToMove: string[] = [];

    if (!selectedKeys.has(key)) {
      setSelectedKeys(new Set([key]));
      setLastSelectedKey(key);
      if (type === "file") {
        files = [id];
      } else {
        foldersToMove = [id];
      }
    } else {
      selectedKeys.forEach((k) => {
        const [kType, kId] = k.split("_");
        if (kType === "file") {
          files.push(kId);
        } else if (kType === "folder") {
          foldersToMove.push(kId);
        }
      });
    }

    setActiveDragItem({ key, type, id });
    e.dataTransfer.setData("application/my-drive-items", JSON.stringify({ files, folders: foldersToMove }));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setActiveDragItem(null);
    setActiveDragOverId(null);
    setHoveredCrumbId(null);
  };

  const handleDragOverFolder = (e: React.DragEvent, folderId: string) => {
    if (activeDragItem) {
      const isTargetDragged = selectedKeys.has(`folder_${folderId}`);
      if (!isTargetDragged) {
        e.preventDefault();
        e.stopPropagation();
        setActiveDragOverId(folderId);
      }
    }
  };

  const handleDragLeaveFolder = (e: React.DragEvent) => {
    setActiveDragOverId(null);
  };

  const handleDropOnFolder = (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveDragOverId(null);
    setHoveredCrumbId(null);

    const dragData = e.dataTransfer.getData("application/my-drive-items");
    if (dragData) {
      try {
        const { files, folders } = JSON.parse(dragData);
        executeMoveItems(targetFolderId, { files, folders });
      } catch (err) {
        console.error("Failed to parse drag data:", err);
      }
    }
  };

  // Drag-and-drop to upload files
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Only show file upload overlay if physical files are being dragged from outside,
    // not when dragging our internal files/folders
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
              Lepaskan berkas di sini untuk mengunggah ke "
              {currentFolder ? currentFolder.name : "Drive Saya"}"
            </span>
          </div>
        </div>
      )}

      {/* TOP STICKY HEADER WRAPPER */}
      <div className="sticky top-0 z-20 shadow-xs transition-all" onClick={(e) => e.stopPropagation()}>
        {/* 1. PERMANENT BREADCRUMBS TOOLBAR (Always present and never replaced) */}
        <div className="bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-3 sm:px-6 py-2 flex items-center justify-between gap-2">
          <div className={`flex items-center gap-1.5 text-xs sm:text-sm font-medium py-0.5 max-w-full ${activeDragItem ? "overflow-visible" : "overflow-x-auto"}`}>
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              const isCurrent = crumb.id === currentFolderId;
              const isHovered = hoveredCrumbId === crumb.id && !isCurrent && !!activeDragItem;
              
              // Check if any file is being dragged in the current selection
              const isDraggingAnyFile = Array.from(selectedKeys).some(k => String(k).startsWith("file_")) || (activeDragItem && activeDragItem.type === "file");
              const isDropAllowedOnCrumb = !(crumb.id === null && isDraggingAnyFile);
              
              // Find all subfolders of this breadcrumb folder to display in popover
              const availableFoldersForCrumb = isHovered
                ? folders.filter((f) => {
                    const matchesParent = (crumb.id === null)
                      ? (f.parentId === null || f.parentId === undefined)
                      : (f.parentId === crumb.id);
                    // Exclude folders that are currently selected/dragged
                    const isBeingDragged = selectedKeys.has(`folder_${f.id}`);
                    return matchesParent && !isBeingDragged;
                  })
                : [];

              return (
                <div key={crumb.id || "root"} className="flex items-center">
                  {idx > 0 && <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 mr-1.5" />}
                  
                  <div
                    className="relative"
                    onDragOver={(e) => {
                      if (activeDragItem && !isCurrent) {
                        e.preventDefault();
                        if (hoverTimeoutRef.current) {
                          clearTimeout(hoverTimeoutRef.current);
                          hoverTimeoutRef.current = null;
                        }
                        setHoveredCrumbId(crumb.id);
                      }
                    }}
                    onDragLeave={() => {
                      if (hoverTimeoutRef.current) {
                        clearTimeout(hoverTimeoutRef.current);
                      }
                      hoverTimeoutRef.current = setTimeout(() => {
                        setHoveredCrumbId(null);
                        setHoveredSubfolderId(null);
                      }, 150);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (hoverTimeoutRef.current) {
                        clearTimeout(hoverTimeoutRef.current);
                        hoverTimeoutRef.current = null;
                      }
                      setHoveredCrumbId(null);
                      setHoveredSubfolderId(null);
                      if (activeDragItem && !isCurrent && isDropAllowedOnCrumb) {
                        const dragData = e.dataTransfer.getData("application/my-drive-items");
                        if (dragData) {
                          try {
                            const { files, folders: fids } = JSON.parse(dragData);
                            executeMoveItems(crumb.id, { files, folders: fids });
                          } catch (err) {
                            executeMoveItems(crumb.id);
                          }
                        } else {
                          executeMoveItems(crumb.id);
                        }
                      }
                    }}
                  >
                    <button
                      onClick={() => onNavigateFolder(crumb.id)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all shrink-0 select-none ${
                        isLast
                          ? "text-slate-900 font-bold bg-slate-100"
                          : "text-slate-600 hover:text-indigo-600 hover:bg-slate-50 cursor-pointer"
                      } ${
                        isHovered && isDropAllowedOnCrumb
                          ? "ring-2 ring-indigo-500 bg-indigo-50 text-indigo-700 font-bold border-indigo-200 shadow-xs"
                          : ""
                      }`}
                    >
                      {idx === 0 ? (
                        <Home className="w-4 h-4 text-indigo-600" />
                      ) : (
                        <FolderIcon className="w-4 h-4 text-amber-500" />
                      )}
                      <span>{crumb.name}</span>
                    </button>

                    {/* Beautiful Dropdown popup positioned directly under the hovered breadcrumb button */}
                    {isHovered && availableFoldersForCrumb.length > 0 && (
                      <div
                        className="absolute top-full left-0 mt-2 z-50 min-w-[240px] max-w-[320px] bg-white border border-slate-200/80 rounded-2xl shadow-xl p-2.5 flex flex-col gap-1.5 text-xs text-slate-700 animate-fadeIn"
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (hoverTimeoutRef.current) {
                            clearTimeout(hoverTimeoutRef.current);
                            hoverTimeoutRef.current = null;
                          }
                        }}
                        onDragLeave={() => {
                          if (hoverTimeoutRef.current) {
                            clearTimeout(hoverTimeoutRef.current);
                          }
                          hoverTimeoutRef.current = setTimeout(() => {
                            setHoveredCrumbId(null);
                            setHoveredSubfolderId(null);
                          }, 150);
                        }}
                      >
                        <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100/80 mb-1 flex items-center justify-between">
                          <span>Subfolder dari "{crumb.name}"</span>
                          <span className="bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded text-[9px] font-medium capitalize">Tujuan</span>
                        </div>
                        <div className="max-h-[200px] overflow-y-auto flex flex-col gap-0.5 custom-scrollbar">
                          {availableFoldersForCrumb.map((subFolder) => {
                            const isSubFolderHovered = hoveredSubfolderId === subFolder.id;
                            return (
                              <button
                                key={subFolder.id}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setHoveredSubfolderId(subFolder.id);
                                  if (hoverTimeoutRef.current) {
                                    clearTimeout(hoverTimeoutRef.current);
                                    hoverTimeoutRef.current = null;
                                  }
                                }}
                                onDragLeave={() => {
                                  setHoveredSubfolderId(null);
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (hoverTimeoutRef.current) {
                                    clearTimeout(hoverTimeoutRef.current);
                                    hoverTimeoutRef.current = null;
                                  }
                                  setHoveredCrumbId(null);
                                  setHoveredSubfolderId(null);
                                  const dragData = e.dataTransfer.getData("application/my-drive-items");
                                  if (dragData) {
                                    try {
                                      const { files, folders: fids } = JSON.parse(dragData);
                                      executeMoveItems(subFolder.id, { files, folders: fids });
                                    } catch (err) {
                                      executeMoveItems(subFolder.id);
                                    }
                                  } else {
                                    executeMoveItems(subFolder.id);
                                  }
                                }}
                                className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center gap-2.5 transition-all cursor-pointer font-semibold border ${
                                  isSubFolderHovered
                                    ? "bg-indigo-50 border-indigo-200 text-indigo-900 scale-[1.02] shadow-xs"
                                    : "border-transparent text-slate-700 hover:bg-slate-50"
                                }`}
                              >
                                <FolderIcon className="w-4 h-4 text-amber-400 shrink-0 fill-amber-300" />
                                <span className="truncate">{subFolder.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick Item Counter / Path Info Badge on Breadcrumbs Bar */}
          <div className="hidden sm:flex items-center gap-1 text-[11px] font-medium text-slate-400 shrink-0">
            <span>{currentFolders.length} folder</span>
            <span>•</span>
            <span>{currentFiles.length} berkas</span>
          </div>
        </div>

        {/* 2. ACTION TOOLBAR (Swaps between Default Actions and Selection Action Bar) */}
        {selectedCount > 0 ? (
          /* SELECTION ACTION BAR (Replaces the action toolbar when items are selected) */
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
                    href={api.getDownloadUrl(singleSelectedItem.data.id)}
                    download={singleSelectedItem.data.originalName}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold transition-all shadow-xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Unduh</span>
                  </a>
                  {singleSelectedItem.data.syncStatus === SyncStatus.SYNCED &&
                  singleSelectedItem.data.googleDriveWebViewLink ? (
                    <a
                      href={singleSelectedItem.data.googleDriveWebViewLink}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-all shadow-xs"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Google Drive</span>
                    </a>
                  ) : googleStatus?.isConnected ? (
                    <button
                      onClick={() => handleSyncFile(singleSelectedItem.data)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold transition-all cursor-pointer shadow-xs"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Sinkronkan</span>
                    </button>
                  ) : null}
                </>
              )}

              {/* If single Folder selected */}
              {singleSelectedItem && singleSelectedItem.type === "folder" && (
                <>
                  <button
                    onClick={() => onNavigateFolder(singleSelectedItem.data.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white text-blue-700 hover:bg-blue-50 text-xs font-bold transition-all cursor-pointer shadow-xs"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Buka Folder</span>
                  </button>
                  <button
                    onClick={() => {
                      setZipDownloadFolder(singleSelectedItem.data);
                      setShowMultiPartZipModal(true);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all cursor-pointer shadow-xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Unduh Folder</span>
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
              {selectedCount > 1 && (
                <>
                  {selectedFiles.length > 0 && (
                    <>
                      <button
                        onClick={() => {
                          setZipDownloadFolder(null);
                          setShowMultiPartZipModal(true);
                        }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-all cursor-pointer shadow-xs"
                        title="Unduh Semua Berkas Terpilih (ZIP / Individual)"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Unduh ({selectedFiles.length})</span>
                      </button>
                      {googleStatus?.isConnected && (
                        <button
                          onClick={handleBulkSync}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold transition-all cursor-pointer shadow-xs"
                          title="Sinkronkan Berkas Terpilih ke Google Drive"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Sinkronkan ({selectedFiles.length})</span>
                        </button>
                      )}
                    </>
                  )}
                </>
              )}

              {/* Copy and Move Actions for Files */}
              {selectedFiles.length > 0 && (
                <>
                  <button
                    onClick={() => setShowMoveCopyModal("copy")}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-all cursor-pointer shadow-xs"
                    title="Salin berkas terpilih ke folder lain"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Salin</span>
                  </button>
                  <button
                    onClick={() => setShowMoveCopyModal("move")}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-all cursor-pointer shadow-xs"
                    title="Pindahkan berkas terpilih ke folder lain"
                  >
                    <Move className="w-3.5 h-3.5" />
                    <span>Pindahkan</span>
                  </button>
                </>
              )}

              {/* Delete button (Single or Multiple) */}
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
          /* PRIMARY ACTION TOOLBAR (Rendered when no items are selected) */
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

            {/* Action Buttons & Filters */}
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

              {/* Import from Google Drive - directly available for Google accounts without separate setup - ONLY SHOW AT ROOT DRIVE */}
              {currentFolderId === null && (user?.authProvider === "GOOGLE" || googleStatus?.isConnected || (user as any)?.isGoogleConnected) && (
                <button
                  id="btn-import-gdrive-folder"
                  onClick={() => setShowImportGoogleDriveModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold border border-emerald-200 transition-all active:scale-95 cursor-pointer shadow-2xs"
                  title="Import folder dari Google Drive ke dalam portal"
                >
                  <CloudDownload className="w-4 h-4 text-emerald-600" />
                  <span className="hidden sm:inline">Import dari Drive</span>
                </button>
              )}

              {/* New Folder Button */}
              <button
                id="btn-new-folder"
                onClick={() => setShowCreateFolderModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200 transition-all active:scale-95 cursor-pointer shadow-2xs"
              >
                <FolderPlus className="w-4 h-4 text-blue-600" />
                <span className="hidden sm:inline">
                  {currentFolderId === null ? "Folder Baru" : "Subfolder Baru"}
                </span>
              </button>

              {/* Upload Button - only visible when a folder has been created and opened */}
              {currentFolderId !== null && (
                <button
                  disabled={!canUploadToCurrentFolder}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 ${
                    canUploadToCurrentFolder
                      ? "bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-500/20 cursor-pointer"
                      : "bg-slate-200 text-slate-400 cursor-not-allowed"
                  }`}
                >
                  <UploadCloud className="w-4 h-4" />
                  <span className="hidden sm:inline">Unggah Berkas</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area (With Rubberband Marquee Drag Selection) */}
      <div
        ref={contentAreaRef}
        onMouseDown={handleMouseDownOnContainer}
        className="p-3.5 sm:p-6 flex-1 space-y-8 relative overflow-y-auto"
        onClick={handleContainerClick}
      >
        {/* TOP INDETERMINATE PROGRESS BAR ON ANY FETCHING */}
        {(isLoading || isFetchingPage || isLoadingNextPage) && (
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

        {/* 1. FETCHING LOADING COMPONENT (Rendered on every page/folder/search/filter fetch) */}
        {isLoading || isFetchingPage ? (
          <div className="py-8 px-2 sm:px-6 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-200">
            <div className="flex flex-col items-center justify-center py-8 px-6 bg-white/80 backdrop-blur-xs border border-blue-100 rounded-3xl shadow-xs text-center">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center mb-3.5 shadow-2xs">
                <Loader2 className="w-7 h-7 text-blue-600 animate-spin" />
              </div>
              <h3 className="text-sm font-bold text-slate-800 mb-1">
                {searchQuery.trim()
                  ? `Mencari "${searchQuery.trim()}"...`
                  : statusFilter !== "ALL"
                  ? `Menyaring Berkas (${statusFilter})...`
                  : isRootDriveView
                  ? "Memuat Folder Drive Saya..."
                  : currentFolder
                  ? `Memuat Folder "${currentFolder.name}"...`
                  : "Memuat Data..."}
              </h3>
              <p className="text-xs text-slate-400 max-w-sm">
                {searchQuery.trim()
                  ? "Memindai seluruh folder dan berkas yang cocok..."
                  : isRootDriveView
                  ? "Mengambil daftar folder yang dibuat dan diimport (20 folder per halaman)..."
                  : "Mengambil daftar berkas dan subfolder..."}
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

            {/* Skeletons for Files (Hanya jika di dalam folder atau mode pencarian) */}
            {!isRootDriveView && (
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
            )}
          </div>
        ) : (isRootDriveView ? currentFolders.length === 0 : (currentFolders.length === 0 && currentFiles.length === 0)) ? (
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
            /* 2. REGULAR EMPTY STATE (No folders/files created yet) */
            <div className="bg-white border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-3xl p-10 sm:p-14 text-center max-w-2xl mx-auto my-4 transition-all shadow-2xs">
              <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-4 border border-blue-100 shadow-2xs">
                {currentFolderId === null ? (
                  <FolderPlus className="w-8 h-8 text-blue-600" />
                ) : (
                  <UploadCloud className="w-8 h-8 animate-pulse text-blue-600" />
                )}
              </div>
              <h4 className="text-base font-bold text-slate-900 mb-1.5">
                {currentFolder
                  ? `Folder "${currentFolder.name}" Masih Kosong`
                  : "Belum Ada Folder Dibuat"}
              </h4>
              <p className="text-xs text-slate-500 max-w-md mx-auto mb-6 leading-relaxed">
                {currentFolderId === null
                  ? "Anda belum memiliki folder. Silakan buat folder baru atau import folder dari Google Drive terlebih dahulu untuk mulai mengunggah dan mengelola berkas."
                  : "Folder ini masih kosong. Silakan unggah berkas baru atau buat subfolder di dalamnya."}
              </p>

              <div className="flex flex-wrap items-center justify-center gap-3">
                {/* Only show upload button if inside an opened folder */}
                {currentFolderId !== null && (
                  <button
                    disabled={!canUploadToCurrentFolder}
                    onClick={() => fileInputRef.current?.click()}
                    className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                      canUploadToCurrentFolder
                        ? "bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-500/20 active:scale-95 cursor-pointer"
                        : "bg-slate-200 text-slate-400 cursor-not-allowed"
                    }`}
                  >
                    <UploadCloud className="w-4 h-4" />
                    <span>Unggah Berkas Sekarang</span>
                  </button>
                )}

                <button
                  onClick={() => setShowCreateFolderModal(true)}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer flex items-center gap-2 ${
                    currentFolderId === null
                      ? "bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
                  }`}
                >
                  <FolderPlus className={`w-4 h-4 ${currentFolderId === null ? "text-white" : "text-blue-600"}`} />
                  <span>{currentFolderId === null ? "Buat Folder Baru" : "Buat Subfolder"}</span>
                </button>

                {currentFolderId === null && (
                  <button
                    onClick={() => setShowImportGoogleDriveModal(true)}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 transition-all active:scale-95 cursor-pointer flex items-center gap-2"
                  >
                    <CloudDownload className="w-4 h-4 text-emerald-600" />
                    <span>Import dari Drive</span>
                  </button>
                )}
              </div>
            </div>
          )
        ) : (
          <>
            {/* VIEW MODE: GRID VIEW */}
            {viewMode === "grid" ? (
              <div className="space-y-8">
                {/* Folders in Grid */}
                {displayedFolders.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        {currentFolderId !== null
                          ? displayedFolders.length < currentFolders.length
                            ? `Subfolder (${displayedFolders.length} dari ${currentFolders.length})`
                            : `Subfolder (${currentFolders.length})`
                          : displayedFolders.length < currentFolders.length
                          ? `Folder (${displayedFolders.length} dari ${currentFolders.length})`
                          : `Folder (${currentFolders.length})`}
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
                      {displayedFolders.map((folder) => {
                        const itemKey = `folder_${folder.id}`;
                        const isSelected = selectedKeys.has(itemKey);

                        return (
                          <div
                            key={folder.id}
                            data-selectable-key={itemKey}
                            onTouchStart={(e) => handleTouchStart(e, itemKey, "folder", folder)}
                            onTouchMove={handleTouchMove}
                            onTouchEnd={(e) => handleTouchEnd(e, itemKey, "folder", folder)}
                            onClick={(e) => handleItemClick(e, itemKey, "folder", folder)}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              onNavigateFolder(folder.id);
                            }}
                            onContextMenu={(e) => handleContextMenu(e, "folder", folder)}
                            draggable="true"
                            onDragStart={(e) => handleDragStart(e, itemKey, "folder", folder.id)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => handleDragOverFolder(e, folder.id)}
                            onDragLeave={handleDragLeaveFolder}
                            onDrop={(e) => handleDropOnFolder(e, folder.id)}
                            className={`bg-white border rounded-2xl p-4 transition-all duration-200 group relative flex flex-col justify-between cursor-pointer select-none ${
                              activeDragOverId === folder.id
                                ? "border-indigo-500 ring-2 ring-indigo-500/50 bg-indigo-50/40 shadow-md scale-[1.02]"
                                : isSelected
                                ? "border-blue-500 ring-2 ring-blue-500/50 bg-blue-50/40 shadow-md"
                                : "border-slate-200 hover:border-blue-300 hover:shadow-md"
                            }`}
                          >
                            {/* Selected Checkmark Badge / Tap to select trigger */}
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
                              <Check className={`w-3.5 h-3.5 stroke-[3] ${isSelected ? "text-white" : "text-slate-400"}`} />
                            </button>

                            <div>
                              {/* Top Icon */}
                              <div className="flex items-start justify-between gap-2 mb-3">
                                <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-500 border border-amber-100 flex items-center justify-center group-hover:scale-105 transition-transform shadow-2xs">
                                  <FolderIcon className="w-7 h-7 fill-amber-400 text-amber-500" />
                                </div>
                                {folder.syncToGoogleDrive && folder.googleDriveFolderId ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
                                    <CloudDownload className="w-3 h-3 text-blue-600" />
                                    Google Drive
                                  </span>
                                ) : googleStatus?.isConnected ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSyncFolder(folder);
                                    }}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 shrink-0 transition-colors cursor-pointer shadow-2xs"
                                    title="Sinkronkan folder ini ke Google Drive"
                                  >
                                    <RefreshCw className="w-3 h-3 text-indigo-600" />
                                    <span>Sinkronkan</span>
                                  </button>
                                ) : null}
                              </div>

                              {/* Folder Name */}
                              <h4 className="text-sm font-bold text-slate-900 truncate group-hover:text-blue-600 mb-1">
                                {folder.name}
                              </h4>
                              <p className="text-[11px] text-slate-400 line-clamp-1 mb-2">
                                {folder.description || "Folder dokumen"}
                              </p>
                            </div>

                            {/* Metadata Footer */}
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

                {/* Files in Grid (Hanya ditampilkan jika berada di dalam folder atau dalam pencarian) */}
                {!isRootDriveView && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      {displayedFiles.length < currentFiles.length
                        ? `Berkas (${displayedFiles.length} dari ${currentFiles.length})`
                        : `Berkas (${currentFiles.length})`}
                    </h3>
                    {currentFiles.length > 0 && (
                      <span className="text-xs text-slate-400">
                        Total:{" "}
                        {formatBytes(
                          currentFiles.reduce((acc, f) => acc + (f.size || 0), 0)
                        )}
                      </span>
                    )}
                  </div>

                  {currentFiles.length === 0 ? (
                    <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center">
                      <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-3">
                        <UploadCloud className="w-6 h-6" />
                      </div>
                      <h4 className="text-sm font-bold text-slate-800 mb-1">
                        Belum ada berkas dalam folder ini
                      </h4>
                      <p className="text-xs text-slate-400 max-w-sm mx-auto mb-4">
                        Tarik dan lepaskan berkas ke sini, atau klik tombol di bawah untuk mengunggah berkas.
                      </p>
                      <button
                        disabled={!canUploadToCurrentFolder}
                        onClick={() => fileInputRef.current?.click()}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                          canUploadToCurrentFolder
                            ? "bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-500/20 cursor-pointer"
                            : "bg-slate-200 text-slate-400 cursor-not-allowed"
                        }`}
                      >
                        Unggah Berkas Sekarang
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {displayedFiles.map((file) => {
                        const itemKey = `file_${file.id}`;
                        const isSynced = file.syncStatus === SyncStatus.SYNCED;
                        const isPending =
                          file.syncStatus === SyncStatus.PENDING ||
                          file.syncStatus === SyncStatus.PROCESSING ||
                          file.syncStatus === SyncStatus.RETRYING;
                        const isSelected = selectedKeys.has(itemKey);

                        return (
                          <div
                            key={file.id}
                            data-selectable-key={itemKey}
                            onTouchStart={(e) => handleTouchStart(e, itemKey, "file", file)}
                            onTouchMove={handleTouchMove}
                            onTouchEnd={(e) => handleTouchEnd(e, itemKey, "file", file)}
                            onClick={(e) => handleItemClick(e, itemKey, "file", file)}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              setPreviewFile(file);
                            }}
                            onContextMenu={(e) => handleContextMenu(e, "file", undefined, file)}
                            draggable="true"
                            onDragStart={(e) => handleDragStart(e, itemKey, "file", file.id)}
                            onDragEnd={handleDragEnd}
                            className={`bg-white border rounded-2xl overflow-hidden transition-all duration-200 group flex flex-col justify-between cursor-pointer select-none relative ${
                              isSelected
                                ? "border-blue-500 ring-2 ring-blue-500/50 bg-blue-50/30 shadow-md"
                                : "border-slate-200 hover:border-blue-300 hover:shadow-md"
                            }`}
                          >
                            {/* Selected Checkmark Badge / Tap to select trigger */}
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
                              <Check className={`w-3.5 h-3.5 stroke-[3] ${isSelected ? "text-white" : "text-white/80"}`} />
                            </button>

                            {/* Version Badge (if v2+) */}
                            {file.version && file.version > 1 && (
                              <span className="absolute top-3 left-3 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-600/90 text-white shadow-xs z-10">
                                v{file.version}
                              </span>
                            )}

                            {/* Large Thumbnail / Large Icon Preview Area */}
                            {renderLargeThumbnail(file)}

                            {/* Card Content Footer */}
                            <div className="p-3.5 flex flex-col justify-between flex-1">
                              <div>
                                <div className="flex items-start justify-between gap-1 mb-1">
                                  <h4
                                    className="text-xs font-bold text-slate-900 truncate group-hover:text-blue-600 transition-colors"
                                    title={file.originalName}
                                  >
                                    {file.originalName}
                                  </h4>
                                </div>
                                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-2 font-medium">
                                  <span>{formatBytes(file.size)}</span>
                                  {file.version && file.version > 1 && (
                                    <>
                                      <span>•</span>
                                      <span className="text-blue-600 font-bold">v{file.version}</span>
                                    </>
                                  )}
                                  <span>•</span>
                                  <span className="truncate">
                                    {file.user?.name || "Staf"}
                                  </span>
                                </div>
                              </div>

                              {/* Sync Status Badge */}
                              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                                {(() => {
                                  const targetFolder = folders.find((f) => f.id === file.folderId);
                                  const isFolderSynced = !!(targetFolder?.syncToGoogleDrive && targetFolder?.googleDriveFolderId);
                                  if (!isFolderSynced || file.syncStatus === SyncStatus.LOCAL_ONLY) {
                                    return <span />; // Keeps layout space consistent
                                  }
                                  if (isSynced) {
                                    return (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                        Tersinkron
                                      </span>
                                    );
                                  }
                                  if (isPending) {
                                    return (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                        <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                                        Antrean
                                      </span>
                                    );
                                  }
                                  return (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                      <AlertCircle className="w-3 h-3 text-rose-600" />
                                      Gagal
                                    </span>
                                  );
                                })()}

                                <span className="text-[10px] text-slate-400">
                                  {new Date(file.createdAt).toLocaleDateString("id-ID", {
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
                  )}
                </div>
              )}
            </div>
          ) : (
              /* VIEW MODE: LIST / TABLE VIEW (Folders AND Files both in list!) */
              <div className="space-y-6">
                {/* 1. Folders Table */}
                {displayedFolders.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        {displayedFolders.length < currentFolders.length
                          ? `Folder (${displayedFolders.length} dari ${currentFolders.length})`
                          : `Folder (${currentFolders.length})`}
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
                                    displayedFolders.length > 0 &&
                                    displayedFolders.every((f) => selectedKeys.has(`folder_${f.id}`))
                                  }
                                  onChange={(e) => {
                                    const newKeys = new Set(selectedKeys);
                                    if (e.target.checked) {
                                      displayedFolders.forEach((f) => newKeys.add(`folder_${f.id}`));
                                    } else {
                                      displayedFolders.forEach((f) => newKeys.delete(`folder_${f.id}`));
                                    }
                                    setSelectedKeys(newKeys);
                                  }}
                                  className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                                />
                              </th>
                              <th className="py-3 px-4">Nama Folder</th>
                              <th className="py-3 px-4">Hak Akses</th>
                              <th className="py-3 px-4">Pemilik</th>
                              <th className="py-3 px-4">Jumlah Berkas</th>
                              <th className="py-3 px-4">Ukuran Total</th>
                              <th className="py-3 px-4">Tanggal Dibuat</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 whitespace-nowrap">
                            {displayedFolders.map((folder) => {
                              const itemKey = `folder_${folder.id}`;
                              const isSelected = selectedKeys.has(itemKey);

                              return (
                                <tr
                                  key={folder.id}
                                  data-selectable-key={itemKey}
                                  onTouchStart={(e) => handleTouchStart(e, itemKey, "folder", folder)}
                                  onTouchMove={handleTouchMove}
                                  onTouchEnd={(e) => handleTouchEnd(e, itemKey, "folder", folder)}
                                  onClick={(e) => handleItemClick(e, itemKey, "folder", folder)}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    onNavigateFolder(folder.id);
                                  }}
                                  onContextMenu={(e) => handleContextMenu(e, "folder", folder)}
                                  draggable="true"
                                  onDragStart={(e) => handleDragStart(e, itemKey, "folder", folder.id)}
                                  onDragEnd={handleDragEnd}
                                  onDragOver={(e) => handleDragOverFolder(e, folder.id)}
                                  onDragLeave={handleDragLeaveFolder}
                                  onDrop={(e) => handleDropOnFolder(e, folder.id)}
                                  className={`cursor-pointer transition-all select-none ${
                                    activeDragOverId === folder.id
                                      ? "bg-indigo-50 text-indigo-950 font-bold border-l-4 border-l-indigo-600 shadow-xs"
                                      : isSelected
                                      ? "bg-blue-50/90 text-blue-900 font-semibold border-l-4 border-l-blue-600"
                                      : "hover:bg-slate-50"
                                  }`}
                                >
                                  <td className="py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
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
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className="font-bold text-slate-900 truncate hover:text-blue-600 transition-colors">
                                            {folder.name}
                                          </span>
                                          {folder.syncToGoogleDrive && folder.googleDriveFolderId ? (
                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
                                              <CloudDownload className="w-2.5 h-2.5 text-blue-600" />
                                              Google Drive
                                            </span>
                                          ) : googleStatus?.isConnected ? (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleSyncFolder(folder);
                                              }}
                                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 shrink-0 transition-colors cursor-pointer"
                                              title="Sinkronkan folder ini ke Google Drive"
                                            >
                                              <RefreshCw className="w-2.5 h-2.5 text-indigo-600" />
                                              Sinkronkan
                                            </button>
                                          ) : null}
                                        </div>
                                        {folder.description && (
                                          <div className="text-[11px] text-slate-400 truncate">
                                            {folder.description}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-3 px-4">
                                    {folder.permission === FolderPermission.VIEW ? (
                                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                        <Lock className="w-3 h-3" />
                                        Hanya Lihat (VIEW)
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                        <Check className="w-3 h-3" />
                                        Bisa Edit (EDIT)
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-3 px-4 text-slate-700">
                                    {folder.ownerName || "Pengguna"}
                                  </td>
                                  <td className="py-3 px-4 text-slate-700 font-medium">
                                    {folder.filesCount || 0} berkas
                                  </td>
                                  <td className="py-3 px-4 text-slate-700 font-mono">
                                    {formatBytes(folder.totalSizeBytes || 0)}
                                  </td>
                                  <td className="py-3 px-4 text-slate-500 text-[11px]">
                                    {new Date(folder.createdAt).toLocaleDateString("id-ID", {
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

                {/* 2. Files Table (Hanya ditampilkan jika berada di dalam folder atau dalam pencarian) */}
                {!isRootDriveView && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      {displayedFiles.length < currentFiles.length
                        ? `Berkas (${displayedFiles.length} dari ${currentFiles.length})`
                        : `Berkas (${currentFiles.length})`}
                    </h3>
                    {currentFiles.length > 0 && (
                      <span className="text-xs text-slate-400">
                        Total:{" "}
                        {formatBytes(
                          currentFiles.reduce((acc, f) => acc + (f.size || 0), 0)
                        )}
                      </span>
                    )}
                  </div>

                  {currentFiles.length === 0 ? (
                    <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-8 text-center">
                      <p className="text-xs text-slate-400">Belum ada berkas di folder ini.</p>
                    </div>
                  ) : (
                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                      <div className="overflow-x-auto w-full overscroll-x-contain">
                        <table className="w-full min-w-[760px] text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px] whitespace-nowrap">
                              <th className="py-3 px-3 w-8 text-center">
                                <input
                                  type="checkbox"
                                  checked={
                                    displayedFiles.length > 0 &&
                                    displayedFiles.every((f) => selectedKeys.has(`file_${f.id}`))
                                  }
                                  onChange={(e) => {
                                    const newKeys = new Set(selectedKeys);
                                    if (e.target.checked) {
                                      displayedFiles.forEach((f) => newKeys.add(`file_${f.id}`));
                                    } else {
                                      displayedFiles.forEach((f) => newKeys.delete(`file_${f.id}`));
                                    }
                                    setSelectedKeys(newKeys);
                                  }}
                                  className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                                />
                              </th>
                              <th className="py-3 px-4">Nama Berkas</th>
                              <th className="py-3 px-4">Status Google Drive</th>
                              <th className="py-3 px-4">Pengunggah</th>
                              <th className="py-3 px-4">Ukuran</th>
                              <th className="py-3 px-4">Tanggal Diunggah</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 whitespace-nowrap">
                            {displayedFiles.map((file) => {
                              const itemKey = `file_${file.id}`;
                              const isSynced = file.syncStatus === SyncStatus.SYNCED;
                              const isPending =
                                file.syncStatus === SyncStatus.PENDING ||
                                file.syncStatus === SyncStatus.PROCESSING ||
                                file.syncStatus === SyncStatus.RETRYING;
                              const isSelected = selectedKeys.has(itemKey);

                              return (
                                <tr
                                  key={file.id}
                                  data-selectable-key={itemKey}
                                  onTouchStart={(e) => handleTouchStart(e, itemKey, "file", file)}
                                  onTouchMove={handleTouchMove}
                                  onTouchEnd={(e) => handleTouchEnd(e, itemKey, "file", file)}
                                  onClick={(e) => handleItemClick(e, itemKey, "file", file)}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    setPreviewFile(file);
                                  }}
                                  onContextMenu={(e) => handleContextMenu(e, "file", undefined, file)}
                                  draggable="true"
                                  onDragStart={(e) => handleDragStart(e, itemKey, "file", file.id)}
                                  onDragEnd={handleDragEnd}
                                  className={`cursor-pointer transition-colors select-none ${
                                    isSelected
                                      ? "bg-blue-50/90 text-blue-900 font-semibold border-l-4 border-l-blue-600"
                                      : "hover:bg-slate-50"
                                  }`}
                                >
                                  <td className="py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
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
                                        {getFileIcon(file.mimeType, file.originalName)}
                                      </div>
                                      <div className="min-w-0 max-w-xs sm:max-w-md">
                                        <div className="flex items-center gap-1.5">
                                          <span
                                            className="font-bold text-slate-900 truncate hover:text-blue-600 transition-colors"
                                            title={file.originalName}
                                          >
                                            {file.originalName}
                                          </span>
                                          {file.version && file.version > 1 && (
                                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200 shrink-0">
                                              v{file.version}
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-[11px] text-slate-400 truncate">
                                          {file.mimeType}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-3 px-4">
                                    {(() => {
                                      const targetFolder = folders.find((f) => f.id === file.folderId);
                                      const isFolderSynced = !!(targetFolder?.syncToGoogleDrive && targetFolder?.googleDriveFolderId);
                                      if (!isFolderSynced || file.syncStatus === SyncStatus.LOCAL_ONLY) {
                                        return <span className="text-slate-400 font-mono">-</span>;
                                      }
                                      if (isSynced) {
                                        return (
                                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                            Tersinkron di Drive
                                          </span>
                                        );
                                      }
                                      if (isPending) {
                                        return (
                                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                                            Dalam Antrean
                                          </span>
                                        );
                                      }
                                      return (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                          <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                                          Gagal Sinkron
                                        </span>
                                      );
                                    })()}
                                  </td>
                                  <td className="py-3 px-4 text-slate-700">
                                    {file.user?.name || "Pengguna"}
                                  </td>
                                  <td className="py-3 px-4 text-slate-700 font-mono">
                                    {formatBytes(file.size)}
                                  </td>
                                  <td className="py-3 px-4 text-slate-500">
                                    {new Date(file.createdAt).toLocaleDateString("id-ID", {
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
                  )}
                </div>
              )}
            </div>
          )}

          {/* INFINITE SCROLL SENTINEL & LOADING INDICATOR */}
          <div ref={loadMoreRef} className="pt-6 pb-2">
            {isLoadingNextPage && (
              <div className="flex flex-col items-center justify-center py-6 px-4 bg-white/90 backdrop-blur-xs border border-blue-100 rounded-2xl shadow-xs transition-all animate-in fade-in zoom-in duration-200 max-w-sm mx-auto">
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                  <span className="text-xs font-semibold text-slate-800">
                    Memuat 20 item berikutnya (Halaman {currentPage + 1})...
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Menampilkan {displayedFolders.length + displayedFiles.length} dari {totalItemsCount} folder & berkas
                </p>
              </div>
            )}

            {!isLoadingNextPage && hasMore && (
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

            {!hasMore && totalItemsCount > 20 && (
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

      {/* CREATE FOLDER MODAL */}
      {showCreateFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
                <FolderPlus className="w-5 h-5 text-blue-600" />
                <span>Buat Folder Baru</span>
              </div>
              <button
                onClick={() => setShowCreateFolderModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateFolder} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Nama Folder
                </label>
                <input
                  type="text"
                  required
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Contoh: Laporan Penataan Ruang 2026"
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Keterangan / Deskripsi (Opsional)
                </label>
                <textarea
                  rows={2}
                  value={newFolderDesc}
                  onChange={(e) => setNewFolderDesc(e.target.value)}
                  placeholder="Deskripsi singkat isi folder..."
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateFolderModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isCreatingFolder}
                  className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white rounded-xl shadow-lg shadow-blue-500/20 disabled:opacity-50 cursor-pointer"
                >
                  {isCreatingFolder ? "Membuat..." : "Buat Folder"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FLOATING UPLOAD DRAWER */}
      {isUploadDrawerOpen && uploadQueue.length > 0 && (
        <div className="fixed bottom-16 left-3 right-3 sm:left-auto sm:right-4 sm:w-96 md:bottom-4 md:right-4 z-40 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden animate-slide-up">
          <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold">
              <UploadCloud className="w-4 h-4 text-blue-400" />
              <span>
                {isUploading
                  ? `Mengunggah ${uploadQueue.filter((q) => q.status === "uploading").length} berkas...`
                  : `Unggahan Selesai (${uploadQueue.filter((q) => q.status === "success").length}/${uploadQueue.length})`}
              </span>
            </div>
            <button
              onClick={() => setIsUploadDrawerOpen(false)}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 p-2 text-xs">
            {uploadQueue.map((item) => (
              <div key={item.id} className="py-2 px-2 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-800 truncate">{item.name}</div>
                  <div className="text-[10px] text-slate-400">{formatBytes(item.size)}</div>
                </div>
                <div>
                  {item.status === "uploading" ? (
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  ) : item.status === "success" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <span title={item.error}>
                      <AlertCircle className="w-4 h-4 text-rose-600" />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RIGHT-CLICK CONTEXT MENU */}
      <ContextMenu
        state={contextMenu}
        googleStatus={googleStatus}
        onClose={() => setContextMenu(null)}
        onOpenFolder={(f) => onNavigateFolder(f.id)}
        onDownloadFolder={(folder) => {
          setZipDownloadFolder(folder);
          setShowMultiPartZipModal(true);
        }}
        onSyncFolder={handleSyncFolder}
        onShareFolder={(f) => setShareFolderModal(f)}
        onRenameFolder={(f) => setRenameItem({ type: "folder", data: f })}
        onViewFolderDetails={(f) => setDetailsItem({ type: "folder", data: f })}
        onDeleteFolder={handleDeleteFolder}
        onPreviewFile={(file) => setPreviewFile(file)}
        onDownloadFile={(file) => {
          const link = document.createElement("a");
          link.href = api.getDownloadUrl(file.id);
          link.download = file.originalName;
          link.click();
        }}
        onCopyFile={(file) => {
          setSelectedKeys(new Set([`file_${file.id}`]));
          setShowMoveCopyModal("copy");
        }}
        onMoveFile={(file) => {
          setSelectedKeys(new Set([`file_${file.id}`]));
          setShowMoveCopyModal("move");
        }}
        onRenameFile={(file) => setRenameItem({ type: "file", data: file })}
        onOpenInGoogleDrive={(file) => {
          if (file.googleDriveWebViewLink) window.open(file.googleDriveWebViewLink, "_blank");
        }}
        onSyncFile={handleSyncFile}
        onViewFileDetails={(file) => setDetailsItem({ type: "file", data: file })}
        onDeleteFile={handleDeleteFile}
      />

      {/* FILE INLINE PREVIEW MODAL */}
      <FilePreviewModal
        file={previewFile}
        filesList={currentFiles}
        onClose={() => setPreviewFile(null)}
        onNavigateFile={(f) => setPreviewFile(f)}
      />

      {/* SHARE FOLDER MODAL */}
      {shareFolderModal && (
        <ShareFolderModal
          folder={shareFolderModal}
          onClose={() => setShareFolderModal(null)}
          onPermissionUpdated={() => {
            onRefreshData();
          }}
        />
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
          googleStatus={googleStatus}
          onClose={() => setDetailsItem(null)}
          onPreviewFile={(f) => setPreviewFile(f)}
          onShareFolder={(f) => setShareFolderModal(f)}
          onSyncFolder={handleSyncFolder}
          onSyncFile={handleSyncFile}
          onRename={(item) => setRenameItem(item)}
        />
      )}

      {/* IMPORT GOOGLE DRIVE FOLDER MODAL */}
      <ImportGoogleDriveModal
        isOpen={showImportGoogleDriveModal}
        onClose={() => setShowImportGoogleDriveModal(false)}
        onSuccess={(importedFolder) => {
          onRefreshData();
          if (importedFolder?.id) {
            onNavigateFolder(importedFolder.id);
          }
        }}
        currentFolderId={currentFolderId}
        existingFolders={folders}
      />

      {/* MULTI-PART ZIP & BULK DOWNLOAD MODAL */}
      <MultiPartZipModal
        isOpen={showMultiPartZipModal}
        onClose={() => {
          setShowMultiPartZipModal(false);
          setZipDownloadFolder(null);
        }}
        selectedFiles={zipDownloadFolder ? [] : (selectedFiles as any)}
        selectedFolder={zipDownloadFolder || undefined}
      />

      {/* FILE CONFLICT RESOLUTION MODAL */}
      <FileConflictModal
        isOpen={showConflictModal}
        conflicts={conflictItems}
        onClose={() => {
          setShowConflictModal(false);
          setConflictItems([]);
          setPendingRawFiles([]);
          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
        }}
        onResolve={handleConflictResolved}
      />

      {/* CHUNK UPLOAD MODAL */}
      {showChunkUploadModal && (
        <ChunkUploadModal
          isOpen={showChunkUploadModal}
          targetFolderId={currentFolderId || (folders.length > 0 ? folders[0].id : "")}
          targetFolderName={currentFolder?.name || "Drive Saya"}
          files={chunkUploadFiles}
          fileConflictModes={chunkUploadConflictModes}
          onClose={() => {
            setShowChunkUploadModal(false);
            setChunkUploadFiles([]);
            setChunkUploadConflictModes(undefined);
            setPendingRawFiles([]);
            if (fileInputRef.current) {
              fileInputRef.current.value = "";
            }
            refreshCurrentView();
          }}
          onUploadComplete={handleChunkUploadComplete}
        />
      )}

      {/* MOVE & COPY FILES MODAL */}
      {showMoveCopyModal && (
        <MoveCopyModal
          files={selectedFiles}
          mode={showMoveCopyModal}
          onClose={() => setShowMoveCopyModal(null)}
          onSuccess={(msg) => {
            setSelectedKeys(new Set());
            showToast(msg, "success");
            refreshCurrentView();
          }}
        />
      )}

      {/* OPERATION LOADING MODAL */}
      <OperationLoadingModal {...operationLoading} />
    </div>
  );
};
