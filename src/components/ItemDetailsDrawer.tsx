import React, { useState } from "react";
import { Folder, FileItem, SyncStatus, FolderPermission, GoogleDriveStatus } from "../types/frontend.ts";
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
              {item.type === "folder" ? "Informasi Folder" : "Informasi Berkas"}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body / Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 divide-y divide-slate-100 text-xs">
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
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-xs transition-colors"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Bagikan</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRename?.(item)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl font-semibold transition-colors"
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
                  title="Unduh Berkas (Real-time Progress)"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* 1. GENERAL METADATA */}
        <div className="pt-4 space-y-3">
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
        <div className="pt-4 space-y-3">
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
                  className="flex items-center gap-1 text-[11px] font-mono text-blue-600 hover:text-blue-700 font-semibold"
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
        <div className="pt-4 space-y-3">
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
          <div className="pt-4 space-y-3">
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
      </div>
    </div>
  );
};
