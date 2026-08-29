import React, { useEffect, useRef } from "react";
import {
  Folder,
  FileItem,
  FolderPermission,
  GoogleDriveStatus,
  SyncStatus,
} from "../types/frontend.ts";
import {
  FolderOpen,
  Share2,
  Edit2,
  Lock,
  Info,
  Trash2,
  Download,
  ShieldCheck,
  ExternalLink,
  RefreshCw,
  Eye,
  CheckCircle2,
  Copy,
  Move,
} from "lucide-react";

export interface ContextMenuState {
  x: number;
  y: number;
  type: "folder" | "file";
  folder?: Folder;
  file?: FileItem;
}

interface ContextMenuProps {
  state: ContextMenuState | null;
  googleStatus?: GoogleDriveStatus | null;
  onClose: () => void;
  onOpenFolder?: (folder: Folder) => void;
  onDownloadFolder?: (folder: Folder) => void;
  onSyncFolder?: (folder: Folder) => void;
  onShareFolder?: (folder: Folder) => void;
  onRenameFolder?: (folder: Folder) => void;
  onManagePermissions?: (folder: Folder) => void;
  onViewFolderDetails?: (folder: Folder) => void;
  onDeleteFolder?: (folder: Folder) => void;
  onPreviewFile?: (file: FileItem) => void;
  onDownloadFile?: (file: FileItem) => void;
  onCopyFile?: (file: FileItem) => void;
  onMoveFile?: (file: FileItem) => void;
  onRenameFile?: (file: FileItem) => void;
  onOpenInGoogleDrive?: (file: FileItem) => void;
  onSyncFile?: (file: FileItem) => void;
  onViewFileDetails?: (file: FileItem) => void;
  onDeleteFile?: (file: FileItem) => void;
  onShareFile?: (file: FileItem) => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  state,
  googleStatus,
  onClose,
  onOpenFolder,
  onDownloadFolder,
  onSyncFolder,
  onShareFolder,
  onRenameFolder,
  onManagePermissions,
  onViewFolderDetails,
  onDeleteFolder,
  onPreviewFile,
  onDownloadFile,
  onCopyFile,
  onMoveFile,
  onRenameFile,
  onOpenInGoogleDrive,
  onSyncFile,
  onViewFileDetails,
  onDeleteFile,
  onShareFile,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const handleScroll = () => {
      onClose();
    };

    if (state) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
      window.addEventListener("scroll", handleScroll, true);
      window.addEventListener("resize", handleScroll);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [state, onClose]);

  if (!state) return null;

  // Calculate clamped coordinates so menu is never off-screen
  const menuWidth = 240;
  const menuHeight = state.type === "folder" ? 280 : 320;
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;

  let posX = state.x;
  let posY = state.y;

  if (posX + menuWidth > screenWidth - 10) {
    posX = screenWidth - menuWidth - 12;
  }
  if (posY + menuHeight > screenHeight - 10) {
    posY = screenHeight - menuHeight - 12;
  }
  if (posX < 10) posX = 10;
  if (posY < 10) posY = 10;

  return (
    <div
      ref={menuRef}
      style={{ top: `${posY}px`, left: `${posX}px` }}
      className="fixed z-50 w-56 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl shadow-2xl py-1.5 text-xs text-slate-800 animate-scale-in select-none font-sans"
    >
      {/* Title / Name Header in menu */}
      <div className="px-3 py-1.5 border-b border-slate-100 mb-1 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
        <span className="font-bold text-slate-900 truncate">
          {state.type === "folder" ? state.folder?.name : state.file?.originalName}
        </span>
      </div>

      {/* 1. FOLDER CONTEXT MENU ITEMS */}
      {state.type === "folder" && state.folder && (
        <div className="space-y-0.5 px-1">
          <button
            onClick={() => {
              onOpenFolder?.(state.folder!);
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition-colors text-left font-medium"
          >
            <FolderOpen className="w-4 h-4 text-amber-500" />
            <span>Buka Folder</span>
          </button>

          {onDownloadFolder && (
            <button
              onClick={() => {
                onDownloadFolder?.(state.folder!);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition-colors text-left font-medium"
            >
              <Download className="w-4 h-4 text-emerald-600" />
              <span>Unduh Folder (.zip)</span>
            </button>
          )}

          {onSyncFolder && googleStatus?.isConnected && (
            <button
              onClick={() => {
                onSyncFolder?.(state.folder!);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition-colors text-left font-medium"
            >
              <RefreshCw className="w-4 h-4 text-indigo-600" />
              <span>{state.folder?.syncToGoogleDrive ? "Sinkronisasi Ulang ke Drive" : "Sinkronkan ke Google Drive"}</span>
            </button>
          )}

          <button
            onClick={() => {
              onShareFolder?.(state.folder!);
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition-colors text-left font-medium"
          >
            <Share2 className="w-4 h-4 text-blue-600" />
            <span>Bagikan &amp; Izin Tautan</span>
          </button>

          <button
            onClick={() => {
              onRenameFolder?.(state.folder!);
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition-colors text-left font-medium"
          >
            <Edit2 className="w-4 h-4 text-slate-600" />
            <span>Ubah Nama</span>
          </button>

          <button
            onClick={() => {
              onViewFolderDetails?.(state.folder!);
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition-colors text-left font-medium"
          >
            <Info className="w-4 h-4 text-indigo-600" />
            <span>Lihat Detail</span>
          </button>

          <div className="border-t border-slate-100 my-1" />

          <button
            onClick={() => {
              onDeleteFolder?.(state.folder!);
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-rose-50 text-rose-600 font-semibold transition-colors text-left"
          >
            <Trash2 className="w-4 h-4" />
            <span>Pindahkan ke Sampah</span>
          </button>
        </div>
      )}

      {/* 2. FILE CONTEXT MENU ITEMS */}
      {state.type === "file" && state.file && (
        <div className="space-y-0.5 px-1">
          <button
            onClick={() => {
              onPreviewFile?.(state.file!);
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-blue-50/70 text-blue-700 hover:bg-blue-100/70 transition-colors text-left font-semibold"
          >
            <Eye className="w-4 h-4 text-blue-600" />
            <span>Pratinjau Berkas</span>
          </button>

          <button
            onClick={() => {
              onDownloadFile?.(state.file!);
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition-colors text-left font-medium"
          >
            <Download className="w-4 h-4 text-blue-600" />
            <span>Unduh Berkas</span>
          </button>

          <button
            onClick={() => {
              onShareFile?.(state.file!);
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition-colors text-left font-medium"
          >
            <Share2 className="w-4 h-4 text-blue-600" />
            <span>Bagikan &amp; Tautan</span>
          </button>

          {onCopyFile && (
            <button
              onClick={() => {
                onCopyFile?.(state.file!);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition-colors text-left font-medium"
            >
              <Copy className="w-4 h-4 text-indigo-600" />
              <span>Salin Berkas</span>
            </button>
          )}

          {onMoveFile && (
            <button
              onClick={() => {
                onMoveFile?.(state.file!);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition-colors text-left font-medium"
            >
              <Move className="w-4 h-4 text-indigo-600" />
              <span>Pindahkan Berkas</span>
            </button>
          )}

          <button
            onClick={() => {
              onRenameFile?.(state.file!);
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition-colors text-left font-medium"
          >
            <Edit2 className="w-4 h-4 text-slate-600" />
            <span>Ubah Nama</span>
          </button>

          {state.file.syncStatus === SyncStatus.SYNCED && state.file.googleDriveWebViewLink ? (
            <button
              onClick={() => {
                onOpenInGoogleDrive?.(state.file!);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition-colors text-left font-medium"
            >
              <ExternalLink className="w-4 h-4 text-blue-600" />
              <span>Buka di Google Drive</span>
            </button>
          ) : googleStatus?.isConnected ? (
            <button
              onClick={() => {
                onSyncFile?.(state.file!);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition-colors text-left font-medium"
            >
              <RefreshCw className="w-4 h-4 text-blue-600" />
              <span>Sinkronkan ke Drive</span>
            </button>
          ) : null}

          <button
            onClick={() => {
              onViewFileDetails?.(state.file!);
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition-colors text-left font-medium"
          >
            <Info className="w-4 h-4 text-indigo-600" />
            <span>Lihat Detail</span>
          </button>

          <div className="border-t border-slate-100 my-1" />

          <button
            onClick={() => {
              onDeleteFile?.(state.file!);
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-rose-50 text-rose-600 font-semibold transition-colors text-left"
          >
            <Trash2 className="w-4 h-4" />
            <span>Pindahkan ke Sampah</span>
          </button>
        </div>
      )}
    </div>
  );
};
