import React, { useState, useEffect } from "react";
import { Folder, FileItem, SyncStatus, FolderPermission, GoogleDriveStatus, AuditLog } from "../types/frontend.ts";
import { api } from "../services/api.ts";
import { useTransfer } from "../context/TransferContext.tsx";
import {
  X,
  Folder as FolderIcon,
  FileText,
  Download,
  ShieldCheck,
  ExternalLink,
  RefreshCw,
  Copy,
  Check,
  Calendar,
  User,
  HardDrive,
  Lock,
  Eye,
  Edit3,
  Share2,
  FileCheck,
  Hash,
  AlertCircle,
  Clock,
  Layers,
  History,
  Activity,
  UploadCloud,
  FolderPlus,
  Trash2,
  RotateCcw,
  CheckCircle2,
  Tag,
} from "lucide-react";

interface ItemDetailsDrawerProps {
  item: { type: "folder"; data: Folder } | { type: "file"; data: FileItem } | null;
  googleStatus?: GoogleDriveStatus | null;
  onClose: () => void;
  onPreviewFile?: (file: FileItem) => void;
  onShareFolder?: (folder: Folder) => void;
  onSyncFolder?: (folder: Folder) => void;
  onSyncFile?: (file: FileItem) => void;
  onRename?: (item: { type: "folder"; data: Folder } | { type: "file"; data: FileItem }) => void;
}

export const ItemDetailsDrawer: React.FC<ItemDetailsDrawerProps> = ({
  item,
  googleStatus,
  onClose,
  onPreviewFile,
  onShareFolder,
  onSyncFolder,
  onSyncFile,
  onRename,
}) => {
  const { startFileDownload } = useTransfer();
  const [copiedHash, setCopiedHash] = useState(false);
  const [activeTab, setActiveTab] = useState<"metadata" | "history">("metadata");
  const [activities, setActivities] = useState<AuditLog[]>([]);
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);

  // Load activities when folder is selected or viewed
  const loadFolderActivities = async (folderId: string) => {
    setIsLoadingActivities(true);
    setActivitiesError(null);
    try {
      const res = await api.getFolderActivities(folderId);
      setActivities(res.activities || []);
    } catch (err: any) {
      console.error("[ItemDetailsDrawer] Failed to fetch folder activities:", err);
      setActivitiesError(err.message || "Gagal memuat riwayat aktivitas");
    } finally {
      setIsLoadingActivities(false);
    }
  };

  useEffect(() => {
    if (item && item.type === "folder") {
      loadFolderActivities(item.data.id);
    } else {
      setActivities([]);
    }
  }, [item?.type, item?.type === "folder" ? item.data.id : null]);

  if (!item) return null;

  const handleCopySha256 = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2500);
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  const formatRelativeTime = (dateStr: string) => {
    const diffSec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diffSec < 60) return "Baru saja";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} mnt lalu`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} jam lalu`;
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)} hari lalu`;
    return new Date(dateStr).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  };

  const getActivityIcon = (action: string) => {
    switch (action) {
      case "FOLDER_CREATE":
      case "FOLDER_CREATED":
        return <FolderPlus className="w-3.5 h-3.5 text-blue-600" />;
      case "FOLDER_SYNC":
      case "FOLDER_SYNCED":
      case "FILE_SYNC":
      case "FILE_SYNCED":
      case "SYNC_COMPLETED":
        return <RefreshCw className="w-3.5 h-3.5 text-indigo-600" />;
      case "FOLDER_SHARE":
      case "SHARE_LINK_CREATED":
        return <Share2 className="w-3.5 h-3.5 text-purple-600" />;
      case "FILE_UPLOAD":
      case "FILE_UPLOADED":
      case "FILE_UPLOAD_STARTED":
      case "FILE_UPLOAD_COMPLETED":
        return <UploadCloud className="w-3.5 h-3.5 text-emerald-600" />;
      case "FILE_RENAME":
      case "FILE_RENAMED":
        return <Tag className="w-3.5 h-3.5 text-amber-600" />;
      case "FOLDER_UPDATE":
      case "FOLDER_UPDATED":
        return <Edit3 className="w-3.5 h-3.5 text-amber-600" />;
      case "FILE_DELETE":
      case "FILE_TRASHED":
      case "FOLDER_TRASHED":
      case "FOLDER_DELETED":
      case "FILE_DELETED":
        return <Trash2 className="w-3.5 h-3.5 text-rose-600" />;
      case "FOLDER_RESTORED":
      case "FILE_RESTORED":
        return <RotateCcw className="w-3.5 h-3.5 text-teal-600" />;
      case "FILE_DOWNLOAD":
      case "FILE_DOWNLOADED":
        return <Download className="w-3.5 h-3.5 text-teal-600" />;
      default:
        return <Activity className="w-3.5 h-3.5 text-slate-600" />;
    }
  };

  const formatActionLabel = (action: string, details?: any): React.ReactNode => {
    const fileName = details?.fileName || details?.originalName;
    const oldName = details?.oldName;
    const newName = details?.newName || details?.name;
    const folderName = details?.folderName || details?.targetFolderPath || "Folder Utama";
    const sizeStr = details?.size !== undefined ? ` (${formatBytes(details.size)})` : "";

    switch (action) {
      // FOLDER ACTIONS
      case "FOLDER_CREATE":
      case "FOLDER_CREATED":
        return (
          <span>
            Membuat folder baru <strong className="text-slate-900 font-bold">"{newName || "Tanpa Nama"}"</strong>
          </span>
        );
      case "FOLDER_UPDATE":
      case "FOLDER_UPDATED":
        if (details?.oldName && details?.newName) {
          return (
            <span>
              Mengubah nama folder dari <strong className="text-slate-700 line-through font-medium">"{details.oldName}"</strong> menjadi <strong className="text-blue-600 font-bold">"{details.newName}"</strong>
            </span>
          );
        }
        if (details?.permission) {
          return (
            <span>
              Mengubah izin folder menjadi <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-md font-mono text-[10px]">{details.permission}</span>
            </span>
          );
        }
        if (details?.action === "MANUAL_SYNC_TO_GDRIVE") {
          return (
            <span>
              Menghubungkan folder ke Google Drive
            </span>
          );
        }
        return <span>Pengaturan folder diperbarui</span>;

      case "FOLDER_SYNC":
      case "FOLDER_SYNCED":
        return (
          <span>
            Sinkronisasi folder ke Google Drive berhasil
          </span>
        );
      case "FOLDER_SHARE":
      case "SHARE_LINK_CREATED":
        return (
          <span>
            Membuat tautan berbagi publik untuk folder
          </span>
        );
      case "FOLDER_TRASHED":
        return (
          <span>
            Memindahkan folder <strong className="text-slate-900 font-bold">"{details?.name || ""}"</strong> ke sampah
          </span>
        );
      case "FOLDER_RESTORED":
        return (
          <span>
            Memulihkan folder <strong className="text-slate-900 font-bold">"{details?.name || ""}"</strong> dari sampah
          </span>
        );
      case "FOLDER_DELETED":
        return (
          <span>
            Menghapus folder <strong className="text-rose-600 font-bold">"{details?.name || ""}"</strong> secara permanen
          </span>
        );

      // FILE UPLOADS
      case "FILE_UPLOAD":
      case "FILE_UPLOADED":
      case "FILE_UPLOAD_COMPLETED":
        // Check if this FILE_UPLOAD_COMPLETED was actually a rename operation
        if (oldName && newName) {
          return (
            <span>
              Mengubah nama berkas dari <strong className="text-slate-700 line-through font-medium">"{oldName}"</strong> menjadi <strong className="text-blue-600 font-bold">"{newName}"</strong>
            </span>
          );
        }
        return (
          <span>
            Mengunggah berkas <strong className="text-slate-900 font-bold">"{fileName || "tanpa nama"}"</strong>{sizeStr} ke folder <strong className="text-indigo-600 font-bold">"{folderName}"</strong>
          </span>
        );

      case "FILE_UPLOAD_STARTED":
        return (
          <span>
            Memulai unggahan berkas <strong className="text-slate-900 font-bold">"{fileName || "tanpa nama"}"</strong>
          </span>
        );

      // FILE DELETIONS
      case "FILE_DELETE":
      case "FILE_TRASHED":
        return (
          <span>
            Memindahkan berkas <strong className="text-slate-900 font-bold">"{fileName || "tanpa nama"}"</strong> ke sampah
          </span>
        );
      case "FILE_RESTORED":
        return (
          <span>
            Memulihkan berkas <strong className="text-slate-900 font-bold">"{fileName || "tanpa nama"}"</strong> dari sampah
          </span>
        );
      case "FILE_DELETED":
        return (
          <span>
            Menghapus berkas <strong className="text-rose-600 font-bold">"{fileName || "tanpa nama"}"</strong> secara permanen
          </span>
        );

      // FILE SYNCING
      case "FILE_SYNC":
      case "FILE_SYNCED":
      case "SYNC_COMPLETED":
        return (
          <span>
            Sinkronisasi berkas <strong className="text-emerald-600 font-bold">"{fileName || "tanpa nama"}"</strong> ke Google Drive berhasil
          </span>
        );
      case "SYNC_STARTED":
        return (
          <span>
            Memulai sinkronisasi berkas <strong className="text-slate-900 font-bold">"{fileName || "tanpa nama"}"</strong> ke Google Drive
          </span>
        );
      case "SYNC_FAILED":
        return (
          <span>
            Sinkronisasi berkas <strong className="text-rose-600 font-bold">"{fileName || "tanpa nama"}"</strong> gagal: <span className="text-rose-500 font-medium">{details?.error || "Koneksi terputus"}</span>
          </span>
        );
      case "SYNC_RETRY":
        return (
          <span>
            Mencoba kembali sinkronisasi berkas <strong className="text-amber-600 font-bold">"{fileName || "tanpa nama"}"</strong> (percobaan {details?.attempts || 1})
          </span>
        );

      // FILE DOWNLOADS
      case "FILE_DOWNLOAD":
      case "FILE_DOWNLOADED":
        return (
          <span>
            Mengunduh berkas <strong className="text-slate-900 font-bold">"{fileName || "tanpa nama"}"</strong>{sizeStr}
          </span>
        );

      case "GOOGLE_DRIVE_IMPORT":
        return (
          <span>
            Mengimpor berkas <strong className="text-indigo-600 font-bold">"{fileName || "tanpa nama"}"</strong> dari Google Drive
          </span>
        );

      default:
        // Humanize default enum string nicely
        return (
          <span>
            {action.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
            {fileName && <> berkas <strong className="text-slate-900 font-bold">"{fileName}"</strong></>}
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-sm bg-white border-l border-slate-200 shadow-2xl flex flex-col animate-slide-left font-sans text-slate-900">
      {/* Header */}
      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            {item.type === "folder" ? (
              <FolderIcon className="w-4 h-4 text-amber-500 fill-amber-400" />
            ) : (
              <FileText className="w-4 h-4 text-blue-600" />
            )}
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-900">Detail &amp; Metadata</h3>
            <p className="text-[11px] text-slate-400">
              {item.type === "folder" ? "Informasi & Riwayat Folder" : "Informasi Berkas"}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs Selector for Folder view */}
      {item.type === "folder" && (
        <div className="px-4 pt-3 pb-1 border-b border-slate-100">
          <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab("metadata")}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === "metadata"
                  ? "bg-white text-slate-900 shadow-xs font-bold"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <HardDrive className="w-3.5 h-3.5 text-slate-500" />
              <span>Metadata</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === "history"
                  ? "bg-white text-slate-900 shadow-xs font-bold text-blue-600"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <History className="w-3.5 h-3.5 text-blue-600" />
              <span>Riwayat</span>
              {activities.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-blue-100 text-blue-700">
                  {activities.length}
                </span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Body / Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
        {/* Item Preview Card */}
        <div className="flex flex-col items-center justify-center p-5 bg-slate-50 rounded-2xl border border-slate-100 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white shadow-xs border border-slate-200 flex items-center justify-center mb-3 relative">
            {item.type === "folder" ? (
              <FolderIcon className="w-9 h-9 text-amber-500 fill-amber-400" />
            ) : (
              <FileText className="w-9 h-9 text-blue-600" />
            )}
            {item.type === "file" && (
              <span className="absolute -top-1.5 -right-1.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-600 text-white shadow-xs">
                v{item.data.version || 1}
              </span>
            )}
          </div>
          <h4 className="font-bold text-sm text-slate-900 max-w-[260px] truncate">
            {item.type === "folder" ? item.data.name : item.data.originalName}
          </h4>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {item.type === "folder"
              ? `${item.data.filesCount || 0} Berkas • ${formatBytes(item.data.totalSizeBytes || 0)}`
              : `${formatBytes(item.data.size)} • Versi ${item.data.version || 1}`}
          </p>

          {/* Quick Action Buttons */}
          <div className="flex items-center gap-2 mt-4">
            {item.type === "folder" ? (
              <>
                <button
                  type="button"
                  onClick={() => onShareFolder?.(item.data)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-xs transition-colors cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Bagikan</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRename?.(item)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl font-semibold transition-colors cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Ubah Nama</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onPreviewFile?.(item.data)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-xs transition-colors cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Pratinjau</span>
                </button>
                <button
                  type="button"
                  onClick={() => startFileDownload(item.data.id, item.data.originalName, item.data.size)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-bold shadow-xs transition-colors cursor-pointer"
                  title="Unduh Berkas"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* FOLDER HISTORY TAB VIEW */}
        {item.type === "folder" && activeTab === "history" ? (
          <div className="space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between">
              <h5 className="font-bold text-slate-800 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-blue-600" />
                <span>Riwayat Aktivitas Folder</span>
              </h5>
              <button
                type="button"
                onClick={() => loadFolderActivities(item.data.id)}
                disabled={isLoadingActivities}
                className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 font-semibold p-1 rounded hover:bg-blue-50 transition-colors cursor-pointer disabled:opacity-50"
                title="Perbarui Riwayat"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingActivities ? "animate-spin" : ""}`} />
                <span>Muat Ulang</span>
              </button>
            </div>

            {isLoadingActivities ? (
              <div className="py-8 text-center space-y-2">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto text-blue-600" />
                <p className="text-xs text-slate-400">Memuat catatan aktivitas folder...</p>
              </div>
            ) : activitiesError ? (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <AlertCircle className="w-4 h-4 text-rose-600" />
                  <span>Gagal Memuat Riwayat</span>
                </div>
                <p className="text-[11px] text-rose-600">{activitiesError}</p>
              </div>
            ) : activities.length === 0 ? (
              <div className="py-8 text-center bg-slate-50 rounded-2xl border border-slate-100 p-4 space-y-1.5">
                <History className="w-6 h-6 mx-auto text-slate-300" />
                <p className="font-semibold text-slate-700 text-xs">Belum Ada Riwayat Aktivitas</p>
                <p className="text-[11px] text-slate-400">
                  Aktivitas seperti pembuatan, unggahan berkas, pengubahan izin, atau sinkronisasi akan dicatat di sini.
                </p>
              </div>
            ) : (
              <div className="relative pl-3 space-y-4 before:absolute before:left-3.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-100">
                {activities.map((log) => (
                  <div key={log.id} className="relative flex items-start gap-3 group">
                    {/* Activity Dot / Icon */}
                    <div className="relative z-10 w-6 h-6 rounded-full bg-white border border-slate-200 shadow-xs flex items-center justify-center shrink-0 mt-0.5">
                      {getActivityIcon(log.action)}
                    </div>

                    {/* Activity Details Card */}
                    <div className="flex-1 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/80 rounded-xl p-2.5 transition-colors">
                      <div className="flex items-start justify-between gap-1.5">
                        <span className="font-bold text-slate-800 text-xs leading-snug">
                          {formatActionLabel(log.action, log.details)}
                        </span>
                        <span className="text-[10px] font-medium text-slate-400 shrink-0">
                          {formatRelativeTime(log.createdAt)}
                        </span>
                      </div>

                      {/* Additional Details */}
                      {log.details && Object.keys(log.details).length > 0 && (
                        <div className="mt-1 space-y-0.5 text-[10px] text-slate-500">
                          {(log.details as any).fileName && (
                            <div className="truncate font-medium text-slate-700">
                              Berkas: {(log.details as any).fileName}
                            </div>
                          )}
                          {(log.details as any).size !== undefined && (
                            <div>Ukuran: {formatBytes((log.details as any).size)}</div>
                          )}
                          {(log.details as any).targetFolderPath && (
                            <div className="font-mono text-[9px] text-slate-400 truncate">
                              Path: {(log.details as any).targetFolderPath}
                            </div>
                          )}
                        </div>
                      )}

                      {/* User Attribution & Timestamp */}
                      <div className="mt-1.5 pt-1.5 border-t border-slate-200/60 flex items-center justify-between text-[10px] text-slate-400">
                        <div className="flex items-center gap-1">
                          <User className="w-2.5 h-2.5 text-slate-400" />
                          <span className="font-medium text-slate-600 truncate max-w-[120px]">
                            {log.user?.name || log.user?.email || "Sistem"}
                          </span>
                        </div>
                        <span title={formatDate(log.createdAt)}>
                          {new Date(log.createdAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* METADATA & GENERAL INFO VIEW */
          <>
            {/* 1. GENERAL METADATA */}
            <div className="space-y-3">
              <h5 className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">
                Informasi Umum
              </h5>

              <div className="space-y-2.5">
                <div className="flex justify-between items-start gap-2">
                  <span className="text-slate-400">Tipe:</span>
                  <span className="font-semibold text-slate-700 text-right">
                    {item.type === "folder" ? "Folder Aplikasi" : item.data.mimeType || "File"}
                  </span>
                </div>

                <div className="flex justify-between items-start gap-2">
                  <span className="text-slate-400">Ukuran:</span>
                  <span className="font-semibold text-slate-700 text-right">
                    {item.type === "folder"
                      ? formatBytes(item.data.totalSizeBytes || 0)
                      : formatBytes(item.data.size)}
                  </span>
                </div>

                <div className="flex justify-between items-start gap-2">
                  <span className="text-slate-400">Lokasi / Jalur:</span>
                  <span className="font-mono text-[11px] text-slate-600 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200 text-right break-all max-w-[200px]">
                    {item.type === "folder"
                      ? item.data.targetFolderPath || item.data.name
                      : item.data.folder?.targetFolderPath || item.data.storagePath}
                  </span>
                </div>

                <div className="flex justify-between items-start gap-2">
                  <span className="text-slate-400">Pemilik / Pengunggah:</span>
                  <span className="font-semibold text-slate-700 text-right">
                    {item.type === "folder"
                      ? item.data.ownerName || "Pengguna"
                      : item.data.user?.name || "Pengguna"}
                  </span>
                </div>

                <div className="flex justify-between items-start gap-2">
                  <span className="text-slate-400">Dibuat pada:</span>
                  <span className="font-medium text-slate-600 text-right">
                    {formatDate(item.data.createdAt)}
                  </span>
                </div>
              </div>
            </div>

            {/* 2. SECURITY & PERMISSION */}
            <div className="pt-4 border-t border-slate-100 space-y-3">
              <h5 className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">
                Hak Akses &amp; Keamanan
              </h5>

              {item.type === "folder" ? (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-medium">Izin Folder:</span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[10px] ${
                        item.data.permission === FolderPermission.VIEW
                          ? "bg-amber-100 text-amber-800"
                          : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {item.data.permission === FolderPermission.VIEW ? (
                        <>
                          <Eye className="w-3 h-3" />
                          Hanya Lihat (VIEW)
                        </>
                      ) : (
                        <>
                          <Edit3 className="w-3 h-3" />
                          Bisa Edit (EDIT)
                        </>
                      )}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {item.data.permission === FolderPermission.VIEW
                      ? "Pengguna lain hanya dapat melihat berkas. Pengunggahan dibatasi."
                      : "Pengguna lain dapat mengunggah dan mengelola berkas di folder ini."}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">SHA-256 Checksum:</span>
                    <button
                      onClick={() => handleCopySha256(item.data.checksumSha256)}
                      className="flex items-center gap-1 text-[11px] font-mono text-blue-600 hover:text-blue-700 font-semibold cursor-pointer"
                    >
                      {copiedHash ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span>Tersalin</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Salin Hash</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div className="p-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-[10px] text-slate-600 break-all select-all">
                    {item.data.checksumSha256}
                  </div>
                </div>
              )}
            </div>

            {/* 3. GOOGLE DRIVE SYNC STATUS */}
            <div className="pt-4 border-t border-slate-100 space-y-3">
              <h5 className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">
                Status Google Drive
              </h5>

              {item.type === "file" ? (
                (() => {
                  const isFolderSynced = !!(item.data.folder?.syncToGoogleDrive && item.data.folder?.googleDriveFolderId);
                  if (!isFolderSynced || item.data.syncStatus === SyncStatus.LOCAL_ONLY) {
                    return (
                      <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500 text-xs">Status Sinkron:</span>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[10px] bg-slate-100 text-slate-600">
                            <Lock className="w-3 h-3" />
                            Lokal Saja
                          </span>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Status Sinkron:</span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[10px] ${
                            item.data.syncStatus === SyncStatus.SYNCED
                              ? "bg-emerald-100 text-emerald-800"
                              : item.data.syncStatus === SyncStatus.FAILED
                              ? "bg-rose-100 text-rose-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {item.data.syncStatus === SyncStatus.SYNCED ? (
                            <>
                              <Check className="w-3 h-3" />
                              Tersinkron ke Drive
                            </>
                          ) : item.data.syncStatus === SyncStatus.FAILED ? (
                            <>
                              <AlertCircle className="w-3 h-3" />
                              Gagal Sinkron
                            </>
                          ) : (
                            <>
                              <Clock className="w-3 h-3" />
                              {item.data.syncStatus}
                            </>
                          )}
                        </span>
                      </div>

                      {item.data.googleDriveWebViewLink && (
                        <a
                          href={item.data.googleDriveWebViewLink}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-center gap-1.5 w-full py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg font-bold text-xs transition-colors cursor-pointer"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Buka di Google Drive</span>
                        </a>
                      )}

                      {onSyncFile && googleStatus?.isConnected && item.data.syncStatus === SyncStatus.FAILED && (
                        <button
                          type="button"
                          onClick={() => onSyncFile(item.data)}
                          className="flex items-center justify-center gap-1.5 w-full py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 rounded-lg font-bold text-xs transition-colors cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Coba Sinkronisasi Ulang</span>
                        </button>
                      )}
                    </div>
                  );
                })()
              ) : (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Status Google Drive:</span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[10px] ${
                        item.data.syncToGoogleDrive && item.data.googleDriveFolderId
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {item.data.syncToGoogleDrive && item.data.googleDriveFolderId ? (
                        <>
                          <Check className="w-3 h-3" />
                          Tersinkron ke Drive
                        </>
                      ) : (
                        "Lokal (Belum Disinkronkan)"
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Target Google Drive:</span>
                    <span className="font-semibold text-slate-800">Personal My Drive</span>
                  </div>
                  {item.data.googleDriveFolderId && (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">Google Drive Folder ID:</span>
                      <span className="font-mono text-[10px] text-slate-600 truncate max-w-[140px]">
                        {item.data.googleDriveFolderId}
                      </span>
                    </div>
                  )}
                  {onSyncFolder && googleStatus?.isConnected && (
                    <button
                      type="button"
                      onClick={() => onSyncFolder(item.data)}
                      className="flex items-center justify-center gap-1.5 w-full py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 rounded-lg font-bold text-xs transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>
                        {item.data.syncToGoogleDrive && item.data.googleDriveFolderId
                          ? "Sinkronisasi Ulang ke Drive"
                          : "Sinkronkan Folder Ini ke Google Drive"}
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 4. VERSION HISTORY (if file has versions) */}
            {item.type === "file" && (
              <div className="pt-4 border-t border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <h5 className="font-bold text-slate-800 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-blue-600" />
                    <span>Riwayat Versi Berkas</span>
                  </h5>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                    {1 + (item.data.versionHistory?.length || 0)} Versi Tersimpan
                  </span>
                </div>

                <div className="space-y-2">
                  {/* Current Active Version */}
                  <div className="p-3 rounded-xl bg-blue-50/50 border border-blue-200 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-blue-900 text-xs flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                        Versi {item.data.version || 1} (Terbaru / Aktif)
                      </span>
                      <span className="font-semibold text-slate-700 font-mono text-[11px]">
                        {formatBytes(item.data.size)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                      <span>{formatDate(item.data.updatedAt || item.data.createdAt)}</span>
                      <span>{item.data.user?.name || "Pengguna"}</span>
                    </div>
                  </div>

                  {/* Previous Versions */}
                  {item.data.versionHistory && item.data.versionHistory.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {item.data.versionHistory
                        .slice()
                        .reverse()
                        .map((ver, vIdx) => (
                          <div
                            key={vIdx}
                            className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-700 text-xs">
                                Versi {ver.version}
                              </span>
                              <span className="font-mono text-[11px] text-slate-600">
                                {formatBytes(ver.size)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-slate-400">
                              <span>{formatDate(ver.createdAt)}</span>
                              <span>{ver.uploadedBy || "Pengunggah Sebelumnya"}</span>
                            </div>
                            <div className="pt-1 text-[9px] font-mono text-slate-400 truncate" title={ver.checksumSha256}>
                              SHA: {ver.checksumSha256.substring(0, 16)}...
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
