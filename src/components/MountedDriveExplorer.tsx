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
  Trash2,
  UploadCloud,
  Plus,
  RefreshCw,
  Search,
  LayoutGrid,
  List as ListIcon,
  ChevronRight,
  CheckCircle2,
  Loader2,
  FolderPlus,
  Check,
  X,
  Share2,
  Edit3,
  Info,
  MoreVertical,
  CheckSquare,
  Square,
  SearchX,
  Copy,
  Move,
  Grid,
  CloudDownload,
  Cloud,
} from "lucide-react";
import {
  MountDrive,
  MountFileItem,
  MountBrowseResult,
  Folder,
  FileItem,
  SyncStatus,
  IndexerStatus,
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

  // Drag & Drop Internal Move State
  const [showMoveCopyModal, setShowMoveCopyModal] = useState<"move" | "copy" | null>(null);
  const [activeDragItem, setActiveDragItem] = useState<{
    key: string;
    type: "folder" | "file";
    relativePath: string;
    id: string;
  } | null>(null);
  const [activeDragOverId, setActiveDragOverId] = useState<string | null>(null);
  const [hoveredCrumbId, setHoveredCrumbId] = useState<string | null>(null);

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
        if (data.indexingStatus) {
          setIndexerStatus(data.indexingStatus);
        }
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

  // Fetch Indexer Status
  const fetchIndexerStatus = useCallback(async () => {
    try {
      const status = await api.getMountSyncStatus(mount.id);
      setIndexerStatus(status);
    } catch (err) {
      console.warn("Failed to fetch indexer status:", err);
    }
  }, [mount.id]);

  useEffect(() => {
    loadDirectory("");
    fetchIndexerStatus();
    setSelectedKeys(new Set());
    setLastSelectedKey(null);
  }, [mount.id, loadDirectory, fetchIndexerStatus]);

  // Handle Navigate Subpath
  const handleNavigate = (newSubPath: string) => {
    setSelectedKeys(new Set());
    setLastSelectedKey(null);
    loadDirectory(newSubPath);
  };

  // Raw items from API
  const rawItems = useMemo(() => {
    return browseData?.items || [];
  }, [browseData]);

  // Filter items by search & category
  const filteredItems = useMemo(() => {
    return rawItems.filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;

      if (categoryFilter === "ALL") return true;
      if (item.isDirectory) return true;

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

  // Combined visible items
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

  const selectedMountItems = useMemo(() => {
    return allVisibleItems.filter((it) => selectedKeys.has(it.key)).map((it) => it.item);
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

  // Internal Drag & Drop item handlers
  const handleDragStart = (e: React.DragEvent, key: string, type: "folder" | "file", item: MountFileItem) => {
    e.stopPropagation();

    let itemsToMove: MountFileItem[] = [];

    if (!selectedKeys.has(key)) {
      setSelectedKeys(new Set([key]));
      setLastSelectedKey(key);
      itemsToMove = [item];
    } else {
      allVisibleItems.forEach((it) => {
        if (selectedKeys.has(it.key)) {
          itemsToMove.push(it.item);
        }
      });
      if (!itemsToMove.some((it) => it.id === item.id)) {
        itemsToMove.push(item);
      }
    }

    const sourcePaths = itemsToMove.map((it) => it.relativePath);

    setActiveDragItem({ key, type, relativePath: item.relativePath, id: item.id });
    e.dataTransfer.setData("application/mounted-drive-items", JSON.stringify({ sourcePaths }));
    e.dataTransfer.effectAllowed = "move";

    try {
      const totalCount = itemsToMove.length;
      const primaryName = item.name;

      const ghost = document.createElement("div");
      ghost.id = "custom-drag-ghost-preview";
      ghost.style.position = "fixed";
      ghost.style.top = "-9999px";
      ghost.style.left = "-9999px";
      ghost.style.zIndex = "999999";
      ghost.style.pointerEvents = "none";

      const isFolder = type === "folder";
      const iconBg = isFolder ? "#fef3c7" : "#eff6ff";
      const iconColor = isFolder ? "#d97706" : "#2563eb";
      const iconSvg = isFolder
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="${iconColor}" stroke="${iconColor}" stroke-width="1.5"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`;

      const countDetail =
        totalCount > 1
          ? `${totalCount} item dipilih`
          : isFolder
          ? "1 Folder dipilih"
          : "1 Berkas dipilih";

      const escapeHtml = (text: string) =>
        text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");

      ghost.innerHTML = `
        <div style="position: relative; display: inline-flex; align-items: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          ${
            totalCount > 1
              ? `<div style="position: absolute; inset: 0; transform: translate(4px, 4px); background: #e0e7ff; border: 1.5px solid #c7d2fe; border-radius: 14px; opacity: 0.85; z-index: 0;"></div>`
              : ""
          }
          <div style="position: relative; z-index: 1; display: flex; align-items: center; gap: 10px; padding: 9px 14px; background: #ffffff; border: 1.5px solid #6366f1; border-radius: 14px; box-shadow: 0 14px 28px -4px rgba(79, 70, 229, 0.28), 0 8px 12px -4px rgba(15, 23, 42, 0.12); min-width: 190px; max-width: 280px;">
            <div style="width: 32px; height: 32px; border-radius: 8px; background: ${iconBg}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              ${iconSvg}
            </div>
            <div style="display: flex; flex-direction: column; min-width: 0; flex: 1;">
              <span style="font-size: 12.5px; font-weight: 700; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 165px;">
                ${escapeHtml(primaryName)}
              </span>
              <span style="font-size: 10.5px; font-weight: 600; color: ${totalCount > 1 ? "#4f46e5" : "#64748b"}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${countDetail}
              </span>
            </div>
            ${
              totalCount > 1
                ? `<div style="position: absolute; top: -7px; right: -7px; background: #4f46e5; color: #ffffff; font-size: 11px; font-weight: 800; border-radius: 9999px; height: 22px; min-width: 22px; padding: 0 6px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 5px rgba(79,70,229,0.4); border: 2px solid #ffffff; letter-spacing: -0.2px;">
                    ${totalCount}
                  </div>`
                : ""
            }
          </div>
        </div>
      `;

      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 25, 25);
      setTimeout(() => {
        if (ghost.parentNode) {
          ghost.parentNode.removeChild(ghost);
        }
      }, 0);
    } catch {
      // Fallback
    }
  };

  const handleDragEnd = () => {
    setActiveDragItem(null);
    setActiveDragOverId(null);
    setHoveredCrumbId(null);
  };

  const handleDragOverFolder = (e: React.DragEvent, folderRelPath: string) => {
    if (activeDragItem) {
      const isSelfOrSub =
        activeDragItem.relativePath === folderRelPath ||
        folderRelPath.startsWith(activeDragItem.relativePath + "/");
      if (!isSelfOrSub) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setActiveDragOverId(folderRelPath);
      }
    }
  };

  const handleDragLeaveFolder = (e: React.DragEvent) => {
    setActiveDragOverId(null);
  };

  const handleDropOnFolder = async (e: React.DragEvent, targetSubPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveDragOverId(null);
    setHoveredCrumbId(null);

    let sourcePaths: string[] = [];
    const dragData = e.dataTransfer.getData("application/mounted-drive-items");
    if (dragData) {
      try {
        const parsed = JSON.parse(dragData);
        if (parsed.sourcePaths) sourcePaths = parsed.sourcePaths;
      } catch (err) {
        console.warn("Failed to parse drag data:", err);
      }
    }

    if (sourcePaths.length === 0 && activeDragItem) {
      sourcePaths = [activeDragItem.relativePath];
    }

    if (sourcePaths.length > 0) {
      setOperationLoading({
        isOpen: true,
        title: "Memindahkan Item...",
        message: `Memindahkan ${sourcePaths.length} item ke folder tujuan`,
        type: "sync",
      });
      try {
        const res = await api.bulkMoveMountItems(mount.id, sourcePaths, targetSubPath);
        showToast(res.message, "success");
        setSelectedKeys(new Set());
        loadDirectory(subPath);
      } catch (err: any) {
        showAlert({
          title: "Gagal Memindahkan Item",
          message: err.message || "Terjadi kesalahan saat memindahkan item.",
          type: "error",
        });
      } finally {
        setOperationLoading({ isOpen: false, title: "" });
        setActiveDragItem(null);
      }
    }
  };

  // Handle Share Item
  const handleShareItem = (item: MountFileItem) => {
    if (item.isDirectory) {
      const folderObj = mountDirToFolder(item);
      setShareFolderModal(folderObj);
    } else {
      const link = `${window.location.origin}${api.getMountFileViewUrl(mount.id, item.relativePath)}`;
      navigator.clipboard.writeText(link);
      showToast(`Tautan berkas "${item.name}" berhasil disalin ke papan klip!`, "success");
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
    const handleMountUploadComplete = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.mountId === mount.id) {
        loadDirectory(subPath);
      }
    };
    window.addEventListener("mountUploadCompleted", handleMountUploadComplete);
    return () => {
      window.removeEventListener("mountUploadCompleted", handleMountUploadComplete);
    };
  }, [mount.id, subPath, loadDirectory]);

  // Handle Upload Files
  const handleUploadFiles = async (fileList: File[]) => {
    if (fileList.length === 0) return;
    setIsUploading(true);

    try {
      if (fileList.length === 1) {
        setOperationLoading({
          isOpen: true,
          title: "Mengunggah Berkas...",
          message: `Mengunggah ${fileList[0].name} ke storage ${mount.name}`,
          type: "upload",
        });

        await startMountUploadWithProgress({
          mountId: mount.id,
          mountName: mount.name,
          subPath,
          files: fileList,
        });

        showToast(`Berkas "${fileList[0].name}" berhasil diunggah`, "success");
      } else {
        showToast(
          `Memulai pengunggahan ${fileList.length} berkas ke antrean latar belakang...`,
          "info"
        );
        startMountUploadWithProgress({
          mountId: mount.id,
          mountName: mount.name,
          subPath,
          files: fileList,
        });
      }

      loadDirectory(subPath);
      onRefreshMounts();
    } catch (err: any) {
      console.error("Mount upload error:", err);
      showAlert({
        title: "Gagal Mengunggah Berkas",
        message: err.message || "Terjadi kesalahan saat mengunggah berkas ke storage.",
        type: "error",
      });
    } finally {
      setIsUploading(false);
      setOperationLoading({ isOpen: false, title: "" });
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Handle Sync Metadata
  const handleSyncMetadata = async () => {
    setIsSyncingMetadata(true);
    setOperationLoading({
      isOpen: true,
      title: "Menyingkronkan Metadata Storage",
      message: "Memindai ulang direktori fisik dan mengindeks seluruh berkas ke database PostgreSQL...",
      type: "sync",
    });

    try {
      const res = await api.syncMount(mount.id);
      showToast(res.message || "Metadata storage berhasil disinkronkan ke PostgreSQL", "success");
      loadDirectory(subPath);
      fetchIndexerStatus();
      onRefreshMounts();
    } catch (err: any) {
      showAlert({
        title: "Gagal Sinkronisasi DB",
        message: err.message || "Terjadi kesalahan saat memindai ulang metadata storage.",
        type: "error",
      });
    } finally {
      setIsSyncingMetadata(false);
      setOperationLoading({ isOpen: false, title: "" });
    }
  };

  // Handle Delete Single Item
  const handleDeleteItem = async (item: MountFileItem) => {
    const isDir = item.isDirectory;
    const confirmed = await showConfirm({
      title: `Hapus ${isDir ? "Folder" : "Berkas"}`,
      message: `Apakah Anda yakin ingin menghapus "${item.name}" secara permanen dari storage terpasang? Tindakan ini tidak dapat dibatalkan.`,
      confirmText: "Hapus Permanen",
      cancelText: "Batal",
      isDanger: true,
    });

    if (confirmed) {
      try {
        await api.deleteMountItem(mount.id, item.relativePath);
        showToast(`"${item.name}" berhasil dihapus`, "success");
        setSelectedKeys((prev) => {
          const next = new Set(prev);
          next.delete(isDir ? `folder_${item.id}` : `file_${item.id}`);
          return next;
        });
        loadDirectory(subPath);
        onRefreshMounts();
      } catch (err: any) {
        showAlert({
          title: "Gagal Menghapus Item",
          message: err.message || "Terjadi kesalahan saat menghapus item dari storage.",
          type: "error",
        });
      }
    }
  };

  // Handle Bulk Delete
  const handleBulkDelete = async () => {
    if (selectedCount === 0) return;
    const confirmed = await showConfirm({
      title: `Hapus ${selectedCount} Item Terpilih`,
      message: `Apakah Anda yakin ingin menghapus ${selectedCount} item terpilih dari storage terpasang secara permanen?`,
      confirmText: "Hapus Semua",
      cancelText: "Batal",
      isDanger: true,
    });

    if (confirmed) {
      let deleted = 0;
      setOperationLoading({
        isOpen: true,
        title: "Menghapus Item...",
        message: `Menghapus ${selectedCount} item terpilih`,
        type: "delete",
      });

      try {
        for (const item of selectedMountItems) {
          try {
            await api.deleteMountItem(mount.id, item.relativePath);
            deleted++;
          } catch (err) {
            console.error(`Failed to delete ${item.name}:`, err);
          }
        }
        showToast(`Berhasil menghapus ${deleted} item dari storage`, "success");
        setSelectedKeys(new Set());
        loadDirectory(subPath);
        onRefreshMounts();
      } finally {
        setOperationLoading({ isOpen: false, title: "" });
      }
    }
  };

  // Format Date Helper
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
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

  // Format Bytes Helper
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
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

  // Drag & Drop Handlers for Canvas (Desktop File Drop)
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
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm cursor-pointer"
              title="Buat folder baru di path saat ini"
            >
              <FolderPlus className="w-4 h-4 text-amber-500" />
              <span>Folder Baru</span>
            </button>

            {/* Upload Button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-sm shadow-blue-200 transition-colors cursor-pointer"
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
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm cursor-pointer"
              title="Bagikan akses tautan publik untuk storage ini"
            >
              <Share2 className="w-4 h-4 text-blue-600" />
              <span>Bagikan Storage</span>
            </button>

            {/* Sync DB Button */}
            <button
              onClick={handleSyncMetadata}
              disabled={isSyncingMetadata}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
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
              className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
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
                className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-sm cursor-pointer"
              >
                Buat
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCreatingFolder(false);
                  setNewFolderName("");
                }}
                className="px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-200/60 rounded-lg cursor-pointer"
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
              onDragOver={(e) => {
                if (activeDragItem && subPath !== "") {
                  e.preventDefault();
                  e.stopPropagation();
                  setHoveredCrumbId("root");
                }
              }}
              onDragLeave={() => setHoveredCrumbId(null)}
              onDrop={(e) => handleDropOnFolder(e, "")}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors cursor-pointer ${
                hoveredCrumbId === "root"
                  ? "bg-indigo-100 text-indigo-700 ring-2 ring-indigo-400 font-bold"
                  : subPath === ""
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
                    onDragOver={(e) => {
                      if (activeDragItem && subPath !== crumb.subPath) {
                        e.preventDefault();
                        e.stopPropagation();
                        setHoveredCrumbId(crumb.subPath);
                      }
                    }}
                    onDragLeave={() => setHoveredCrumbId(null)}
                    onDrop={(e) => handleDropOnFolder(e, crumb.subPath)}
                    className={`px-2 py-1 rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                      hoveredCrumbId === crumb.subPath
                        ? "bg-indigo-100 text-indigo-700 ring-2 ring-indigo-400 font-bold"
                        : isLast
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/80">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  viewMode === "grid"
                    ? "bg-white text-blue-600 shadow-xs font-bold"
                    : "text-slate-500 hover:text-slate-800"
                }`}
                title="Tampilan Grid"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  viewMode === "list"
                    ? "bg-white text-blue-600 shadow-xs font-bold"
                    : "text-slate-500 hover:text-slate-800"
                }`}
                title="Tampilan Daftar"
              >
                <ListIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* MULTI-SELECTION FLOATING ACTION TOOLBAR */}
        {selectedCount > 0 ? (
          <div className="mt-3 p-2.5 bg-indigo-950 text-white rounded-2xl shadow-xl flex flex-wrap items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-full bg-indigo-800 text-indigo-100 font-bold text-xs">
                {selectedCount} Terpilih
              </span>
              <button
                onClick={() => setSelectedKeys(new Set())}
                className="text-xs text-indigo-200 hover:text-white underline cursor-pointer"
              >
                Batal Pilih
              </button>
              <button
                onClick={handleSelectAll}
                className="text-xs text-indigo-200 hover:text-white underline ml-1 cursor-pointer"
              >
                Pilih Semua ({allVisibleItems.length})
              </button>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Preview single file */}
              {selectedFiles.length === 1 && selectedFolders.length === 0 && (
                <button
                  onClick={() => setPreviewFile(mountFileToFileItem(selectedFiles[0]))}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-800 hover:bg-indigo-700 text-white text-xs font-semibold transition-all cursor-pointer"
                  title="Pratinjau berkas terpilih"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Pratinjau</span>
                </button>
              )}

              {/* Download files */}
              {selectedFiles.length > 0 && (
                <button
                  onClick={() => {
                    selectedFiles.forEach((file) => {
                      startFileDownload(file.id, file.name, file.size);
                    });
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-all cursor-pointer shadow-xs"
                  title="Unduh berkas terpilih"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh ({selectedFiles.length})</span>
                </button>
              )}

              {/* Copy Actions */}
              <button
                onClick={() => setShowMoveCopyModal("copy")}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-all cursor-pointer shadow-xs"
                title="Salin item terpilih ke folder lain"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Salin</span>
              </button>

              {/* Move Actions */}
              <button
                onClick={() => setShowMoveCopyModal("move")}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-all cursor-pointer shadow-xs"
                title="Pindahkan item terpilih ke folder lain"
              >
                <Move className="w-3.5 h-3.5" />
                <span>Pindahkan</span>
              </button>

              {/* Delete Button */}
              <button
                onClick={handleBulkDelete}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition-all cursor-pointer shadow-xs"
                title="Hapus item terpilih"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Hapus ({selectedCount})</span>
              </button>
            </div>
          </div>
        ) : (
          /* CATEGORY FILTER CHIPS */
          <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none text-xs">
            {categoryFilters.map((cat) => {
              const isActive = categoryFilter === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setCategoryFilter(cat.id)}
                  className={`px-2.5 py-1 rounded-full whitespace-nowrap font-medium transition-all cursor-pointer ${
                    isActive
                      ? "bg-blue-600 text-white shadow-xs font-bold"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        )}
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
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-xs cursor-pointer"
              >
                <FolderPlus className="w-4 h-4 text-amber-500" />
                <span>Buat Folder</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm cursor-pointer"
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
                    const isDragOverTarget = activeDragOverId === dir.relativePath;

                    return (
                      <div
                        key={dir.id}
                        data-selectable-key={itemKey}
                        onClick={(e) => handleItemClick(e, itemKey, "folder", dir)}
                        onDoubleClick={() => handleNavigate(dir.relativePath)}
                        onContextMenu={(e) => handleContextMenu(e, "folder", dir)}
                        draggable="true"
                        onDragStart={(e) => handleDragStart(e, itemKey, "folder", dir)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOverFolder(e, dir.relativePath)}
                        onDragLeave={handleDragLeaveFolder}
                        onDrop={(e) => handleDropOnFolder(e, dir.relativePath)}
                        className={`group relative p-3.5 rounded-2xl border transition-all cursor-pointer select-none ${
                          isDragOverTarget
                            ? "border-indigo-500 ring-2 ring-indigo-500/50 bg-indigo-50/40 shadow-md scale-[1.02]"
                            : isSelected
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

                          {/* Checkbox Trigger */}
                          <div
                            onClick={(e) => handleToggleSelectKey(e, itemKey)}
                            className={`p-1 rounded transition-opacity cursor-pointer ${
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
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleShareItem(dir);
                              }}
                              className="p-1 hover:text-blue-600 hover:bg-blue-50 rounded cursor-pointer"
                              title="Bagikan folder"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenameItem({ type: "folder", data: folderObj, mountItem: dir });
                              }}
                              className="p-1 hover:text-slate-700 hover:bg-slate-100 rounded cursor-pointer"
                              title="Ubah nama"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDetailsItem({ type: "folder", data: folderObj });
                              }}
                              className="p-1 hover:text-indigo-600 hover:bg-indigo-50 rounded cursor-pointer"
                              title="Detail"
                            >
                              <Info className="w-3.5 h-3.5" />
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
                        draggable="true"
                        onDragStart={(e) => handleDragStart(e, itemKey, "file", file)}
                        onDragEnd={handleDragEnd}
                        className={`group relative p-3 rounded-2xl border transition-all cursor-pointer select-none flex flex-col justify-between ${
                          isSelected
                            ? "bg-blue-50/70 border-blue-400 ring-2 ring-blue-400/30 shadow-sm"
                            : "bg-white border-slate-200/80 hover:border-slate-300 hover:shadow-sm"
                        }`}
                      >
                        <div>
                          {/* File Header & Icon */}
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform border border-slate-100">
                              {renderItemIcon(file)}
                            </div>

                            <div className="flex items-center gap-1">
                              {/* Checkbox */}
                              <div
                                onClick={(e) => handleToggleSelectKey(e, itemKey)}
                                className={`p-1 rounded transition-opacity cursor-pointer ${
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
                          </div>

                          {/* Thumbnail / Image Preview Tile if file is image */}
                          {file.isImage ? (
                            <div className="h-24 w-full rounded-xl bg-slate-100 mb-2 overflow-hidden border border-slate-100 relative group-hover:shadow-inner">
                              <img
                                src={api.getMountFileViewUrl(mount.id, file.relativePath)}
                                alt={file.name}
                                className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                loading="lazy"
                              />
                            </div>
                          ) : null}

                          {/* File Name & Extension */}
                          <h4 className="text-xs font-semibold text-slate-800 truncate" title={file.name}>
                            {file.name}
                          </h4>
                          <span className="text-[10px] text-slate-400 font-mono mt-0.5 block">
                            {formatBytes(file.size)}
                          </span>
                        </div>

                        {/* File Footer Quick Actions */}
                        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                          <span className="truncate">{formatDate(file.modifiedAt)}</span>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewFile(fileObj);
                              }}
                              className="p-1 hover:text-blue-600 hover:bg-blue-50 rounded cursor-pointer"
                              title="Pratinjau berkas"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                startFileDownload(file.id, file.name, file.size);
                              }}
                              className="p-1 hover:text-emerald-600 hover:bg-emerald-50 rounded cursor-pointer"
                              title="Unduh berkas"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleShareItem(file);
                              }}
                              className="p-1 hover:text-indigo-600 hover:bg-indigo-50 rounded cursor-pointer"
                              title="Bagikan tautan"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setImportingItem(file);
                              }}
                              className="p-1 hover:text-amber-600 hover:bg-amber-50 rounded cursor-pointer"
                              title="Impor ke Google Drive"
                            >
                              <Cloud className="w-3.5 h-3.5" />
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
          /* LIST VIEW */
          <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4 w-10">
                      <button
                        onClick={handleSelectAll}
                        className="text-slate-400 hover:text-slate-600 cursor-pointer"
                        title="Pilih Semua"
                      >
                        {selectedCount === allVisibleItems.length && allVisibleItems.length > 0 ? (
                          <CheckSquare className="w-4 h-4 text-blue-600" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-4">Nama</th>
                    <th className="py-3 px-4">Terakhir Diubah</th>
                    <th className="py-3 px-4">Ukuran</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {/* Folders List Rows */}
                  {sortedDirectories.map((dir) => {
                    const itemKey = `folder_${dir.id}`;
                    const isSelected = selectedKeys.has(itemKey);
                    const folderObj = mountDirToFolder(dir);
                    const isDragOverTarget = activeDragOverId === dir.relativePath;

                    return (
                      <tr
                        key={dir.id}
                        data-selectable-key={itemKey}
                        onClick={(e) => handleItemClick(e, itemKey, "folder", dir)}
                        onDoubleClick={() => handleNavigate(dir.relativePath)}
                        onContextMenu={(e) => handleContextMenu(e, "folder", dir)}
                        draggable="true"
                        onDragStart={(e) => handleDragStart(e, itemKey, "folder", dir)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOverFolder(e, dir.relativePath)}
                        onDragLeave={handleDragLeaveFolder}
                        onDrop={(e) => handleDropOnFolder(e, dir.relativePath)}
                        className={`group transition-colors cursor-pointer ${
                          isDragOverTarget
                            ? "bg-indigo-50 border-y-2 border-indigo-500"
                            : isSelected
                            ? "bg-blue-50/70 text-blue-900 font-medium"
                            : "hover:bg-slate-50 text-slate-700"
                        }`}
                      >
                        <td className="py-3 px-4">
                          <button
                            onClick={(e) => handleToggleSelectKey(e, itemKey)}
                            className="text-slate-400 hover:text-slate-600 cursor-pointer"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-blue-600" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-800">
                          <div className="flex items-center gap-2.5">
                            <FolderIcon className="w-4 h-4 text-amber-500 fill-amber-500/20 shrink-0" />
                            <span className="truncate max-w-xs sm:max-w-md">{dir.name}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-500">{formatDate(dir.modifiedAt)}</td>
                        <td className="py-3 px-4 text-slate-400 font-mono">-</td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleShareItem(dir);
                              }}
                              className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded cursor-pointer"
                              title="Bagikan"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenameItem({ type: "folder", data: folderObj, mountItem: dir });
                              }}
                              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded cursor-pointer"
                              title="Ubah Nama"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteItem(dir);
                              }}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded cursor-pointer"
                              title="Hapus"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {/* Files List Rows */}
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
                        draggable="true"
                        onDragStart={(e) => handleDragStart(e, itemKey, "file", file)}
                        onDragEnd={handleDragEnd}
                        className={`group transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-blue-50/70 text-blue-900 font-medium"
                            : "hover:bg-slate-50 text-slate-700"
                        }`}
                      >
                        <td className="py-3 px-4">
                          <button
                            onClick={(e) => handleToggleSelectKey(e, itemKey)}
                            className="text-slate-400 hover:text-slate-600 cursor-pointer"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-blue-600" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-800">
                          <div className="flex items-center gap-2.5">
                            {renderItemIcon(file)}
                            <span className="truncate max-w-xs sm:max-w-md">{file.name}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-500">{formatDate(file.modifiedAt)}</td>
                        <td className="py-3 px-4 text-slate-500 font-mono">
                          {formatBytes(file.size)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewFile(fileObj);
                              }}
                              className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded cursor-pointer"
                              title="Pratinjau"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                startFileDownload(file.id, file.name, file.size);
                              }}
                              className="p-1 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded cursor-pointer"
                              title="Unduh"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleShareItem(file);
                              }}
                              className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded cursor-pointer"
                              title="Bagikan Tautan"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setImportingItem(file);
                              }}
                              className="p-1 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded cursor-pointer"
                              title="Impor ke Google Drive"
                            >
                              <Cloud className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteItem(file);
                              }}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded cursor-pointer"
                              title="Hapus"
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

      {/* FILE PREVIEW MODAL */}
      {previewFile && (
        <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      )}

      {/* SHARE FOLDER MODAL */}
      {shareFolderModal && (
        <ShareFolderModal
          folder={shareFolderModal}
          onClose={() => setShareFolderModal(null)}
          onPermissionsUpdated={() => {
            loadDirectory(subPath);
            onRefreshMounts();
          }}
        />
      )}

      {/* RENAME MODAL */}
      {renameItem && (
        <InlineRenameModal
          type={renameItem.type}
          currentName={
            renameItem.type === "folder"
              ? (renameItem.data as Folder).name
              : (renameItem.data as FileItem).originalName
          }
          onClose={() => setRenameItem(null)}
          onSave={handleSaveRename}
        />
      )}

      {/* MOVE & COPY MOUNT MODAL */}
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
            onRefreshMounts();
          }}
        />
      )}

      {/* DETAILS DRAWER */}
      {detailsItem && (
        <ItemDetailsDrawer
          type={detailsItem.type}
          folder={detailsItem.type === "folder" ? (detailsItem.data as Folder) : undefined}
          file={detailsItem.type === "file" ? (detailsItem.data as FileItem) : undefined}
          onClose={() => setDetailsItem(null)}
        />
      )}

      {/* IMPORT TO GOOGLE DRIVE MODAL */}
      {importingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl border border-slate-100 animate-scaleUp">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Cloud className="w-5 h-5 text-blue-600" />
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    Impor ke Google Drive
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 truncate max-w-xs">
                    {importingItem.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setImportingItem(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
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
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={async () => {
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
                }}
                disabled={isImporting || !selectedTargetFolderId}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-sm transition-colors cursor-pointer"
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
          onCopyFolder={() => setShowMoveCopyModal("copy")}
          onMoveFolder={() => setShowMoveCopyModal("move")}
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
          onCopyFile={() => setShowMoveCopyModal("copy")}
          onMoveFile={() => setShowMoveCopyModal("move")}
          onShareFile={(f) => {
            const match = sortedFiles.find((file) => file.id === f.id);
            if (match) handleShareItem(match);
          }}
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
