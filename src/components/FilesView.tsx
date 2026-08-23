import React, { useState } from "react";
import {
  FileText,
  Search,
  Filter,
  ExternalLink,
  RefreshCw,
  Download,
  Trash2,
  CheckCircle2,
  Clock,
  RotateCw,
  XCircle,
  Folder as FolderIcon,
  HardDrive,
  Loader2,
  X,
  Eye,
  Archive,
  Layers,
} from "lucide-react";
import { FileItem, Folder, GoogleDriveStatus, SyncStatus } from "../types/frontend.ts";
import { api } from "../services/api.ts";
import { useAuth } from "../context/AuthContext.tsx";
import { useDialog } from "../context/DialogContext.tsx";
import { useTransfer } from "../context/TransferContext.tsx";
import { FilePreviewModal } from "./FilePreviewModal.tsx";
import { MultiPartZipModal } from "./MultiPartZipModal.tsx";
import { OperationLoadingModal, OperationType } from "./OperationLoadingModal.tsx";

interface FilesViewProps {
  files: FileItem[];
  folders: Folder[];
  googleStatus?: GoogleDriveStatus | null;
  isLoading: boolean;
  onRefresh: () => void;
}

export const FilesView: React.FC<FilesViewProps> = ({
  files,
  folders,
  googleStatus,
  isLoading,
  onRefresh,
}) => {
  const { isAdmin } = useAuth();
  const { showAlert, showConfirm, showToast } = useDialog();
  const { startFileDownload } = useTransfer();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFolderFilter, setSelectedFolderFilter] = useState("ALL");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("ALL");
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  
  // Multi-selection state
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [isBulkLoading, setIsBulkLoading] = useState<boolean>(false);
  const [bulkActionMessage, setBulkActionMessage] = useState<string | null>(null);

  // Operation loading modal
  const [operationLoading, setOperationLoading] = useState<{
    isOpen: boolean;
    title: string;
    message?: string;
    type?: OperationType;
    subMessage?: string;
  }>({ isOpen: false, title: "" });

  // Multi-part zip modal state
  const [isMultiPartModalOpen, setIsMultiPartModalOpen] = useState<boolean>(false);
  const [modalTargetFiles, setModalTargetFiles] = useState<FileItem[]>([]);

  // Verification & Preview Modal State
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleString("id-ID", {
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

  // Filter logic
  const filteredFiles = files.filter((f) => {
    const matchesSearch = f.originalName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFolder = selectedFolderFilter === "ALL" || f.folderId === selectedFolderFilter;
    const matchesStatus = selectedStatusFilter === "ALL" || f.syncStatus === selectedStatusFilter;
    return matchesSearch && matchesFolder && matchesStatus;
  });

  const isAllSelected = filteredFiles.length > 0 && filteredFiles.every((f) => selectedFileIds.has(f.id));
  const isSomeSelected = filteredFiles.some((f) => selectedFileIds.has(f.id)) && !isAllSelected;

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedFileIds(new Set());
    } else {
      setSelectedFileIds(new Set(filteredFiles.map((f) => f.id)));
    }
  };

  const handleToggleSelectFile = (fileId: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  const handleBulkSync = async () => {
    if (selectedFileIds.size === 0) return;
    setIsBulkLoading(true);
    setBulkActionMessage(null);
    try {
      const res = await api.bulkSyncFiles(Array.from(selectedFileIds));
      setBulkActionMessage(`Berhasil memicu sinkronisasi untuk ${res.data.triggeredCount} berkas.`);
      showToast(`Memicu sinkronisasi untuk ${res.data.triggeredCount} berkas`, "info");
      onRefresh();
      setTimeout(() => setBulkActionMessage(null), 4000);
    } catch (err: any) {
      showAlert({
        title: "Gagal Menyinkronkan Massal",
        message: err.message,
        type: "error",
      });
    } finally {
      setIsBulkLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    const count = selectedFileIds.size;
    if (count === 0) return;

    const confirmed = await showConfirm({
      title: "Hapus Berkas Terpilih",
      message: `Yakin ingin memindahkan ${count} berkas yang dipilih ke tempat sampah?`,
      confirmText: "Ya, Pindahkan ke Sampah",
      cancelText: "Batal",
      isDanger: true,
    });
    if (!confirmed) return;

    setIsBulkLoading(true);
    setBulkActionMessage(null);
    setOperationLoading({
      isOpen: true,
      title: "Memindahkan Berkas ke Sampah",
      message: `${count} berkas terpilih`,
      type: "trash",
      subMessage: "Sedang memindahkan berkas terpilih ke tempat sampah...",
    });
    try {
      const res = await api.bulkDeleteFiles(Array.from(selectedFileIds));
      setSelectedFileIds(new Set());
      const deletedCount = res.data.count ?? res.data.processedIds.length;
      setBulkActionMessage(`Berhasil memindahkan ${deletedCount} berkas ke sampah.`);
      showToast(`Berhasil memindahkan ${deletedCount} berkas ke sampah`, "success");
      onRefresh();
      setTimeout(() => setBulkActionMessage(null), 4000);
    } catch (err: any) {
      showAlert({
        title: "Gagal Menghapus Berkas",
        message: err.message,
        type: "error",
      });
    } finally {
      setIsBulkLoading(false);
      setOperationLoading((prev) => ({ ...prev, isOpen: false }));
    }
  };

  const getStatusBadge = (status: SyncStatus, attempts: number) => {
    switch (status) {
      case SyncStatus.SYNCED:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Tersinkronisasi
          </span>
        );
      case SyncStatus.PROCESSING:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <RotateCw className="w-3.5 h-3.5 text-blue-600 animate-spin" />
            Memproses...
          </span>
        );
      case SyncStatus.RETRYING:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            Mencoba Ulang ({attempts}/5)
          </span>
        );
      case SyncStatus.FAILED:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="w-3.5 h-3.5 text-rose-600" />
            Gagal ({attempts}x)
          </span>
        );
      case SyncStatus.PENDING:
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            Dalam Antrean
          </span>
        );
    }
  };

  const handleTriggerSync = async (fileId: string) => {
    setActionLoadingId(fileId);
    try {
      await api.syncSingleFile(fileId);
      showToast("Memicu sinkronisasi berkas", "info");
      onRefresh();
    } catch (err: any) {
      showAlert({
        title: "Gagal Menyinkronkan",
        message: err.message,
        type: "error",
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeleteFile = async (fileId: string, fileName: string) => {
    const confirmed = await showConfirm({
      title: "Hapus Berkas",
      message: `Pindahkan berkas "${fileName}" ke tempat sampah?`,
      confirmText: "Ya, Pindahkan",
      cancelText: "Batal",
      isDanger: true,
    });
    if (!confirmed) return;

    setActionLoadingId(fileId);
    setOperationLoading({
      isOpen: true,
      title: "Memindahkan Berkas ke Sampah",
      message: fileName,
      type: "trash",
      subMessage: "Sedang memindahkan berkas ke tempat sampah...",
    });
    try {
      await api.deleteFile(fileId);
      showToast(`Berkas "${fileName}" berhasil dipindahkan ke sampah`, "success");
      onRefresh();
    } catch (err: any) {
      showAlert({
        title: "Gagal Menghapus Berkas",
        message: err.message,
        type: "error",
      });
    } finally {
      setActionLoadingId(null);
      setOperationLoading((prev) => ({ ...prev, isOpen: false }));
    }
  };

  return (
    <div className="space-y-5 relative">
      
      {/* Top Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Cari nama berkas (contoh: KJP, Laporan, SK)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {/* Folder & Status Filters */}
          <div className="flex flex-wrap items-center gap-2.5">
            
            {/* Folder Dropdown */}
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <FolderIcon className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={selectedFolderFilter}
                onChange={(e) => setSelectedFolderFilter(e.target.value)}
                className="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              >
                <option value="ALL">Semua Folder ({folders.length})</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Dropdown */}
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={selectedStatusFilter}
                onChange={(e) => setSelectedStatusFilter(e.target.value)}
                className="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              >
                <option value="ALL">Semua Status</option>
                <option value={SyncStatus.SYNCED}>Tersinkronisasi (SYNCED)</option>
                <option value={SyncStatus.PENDING}>Dalam Antrean (PENDING)</option>
                <option value={SyncStatus.PROCESSING}>Sedang Memproses (PROCESSING)</option>
                <option value={SyncStatus.RETRYING}>Mencoba Ulang (RETRYING)</option>
                <option value={SyncStatus.FAILED}>Gagal (FAILED)</option>
              </select>
            </div>

            {/* Refresh Button */}
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="p-2 text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
              title="Perbarui Data"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-indigo-600" : ""}`} />
            </button>
          </div>

        </div>
      </div>

      {/* Bulk Action Message Alert */}
      {bulkActionMessage && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-medium">{bulkActionMessage}</span>
          </div>
          <button onClick={() => setBulkActionMessage(null)} className="text-emerald-600 hover:text-emerald-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Floating / Sticky Bulk Action Toolbar */}
      {selectedFileIds.size > 0 && (
        <div className="bg-indigo-900 text-white rounded-xl p-3.5 shadow-lg border border-indigo-700 flex flex-wrap items-center justify-between gap-3 animate-fadeIn">
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded-md bg-indigo-700 font-bold font-mono">
              {selectedFileIds.size}
            </span>
            <span className="font-medium">Berkas dipilih</span>
            <span className="text-indigo-300 text-[11px]">
              ({formatFileSize(files.filter((f) => selectedFileIds.has(f.id)).reduce((acc, f) => acc + f.size, 0))})
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              onClick={() => {
                const targetFiles = files.filter((f) => selectedFileIds.has(f.id));
                setModalTargetFiles(targetFiles);
                setIsMultiPartModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 active:bg-amber-600 font-bold text-slate-950 shadow-xs transition-colors cursor-pointer"
              title="Unduh berkas terpilih dalam format ZIP atau Part terpecah"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Unduh Massal (ZIP / Multi-Part)</span>
            </button>

            {googleStatus?.isConnected && (
              <button
                onClick={handleBulkSync}
                disabled={isBulkLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 font-semibold text-white shadow-xs transition-colors cursor-pointer"
              >
                {isBulkLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                <span>Sinkron Ulang Terpilih</span>
              </button>
            )}

            <button
              onClick={handleBulkDelete}
              disabled={isBulkLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 active:bg-rose-700 font-semibold text-white shadow-xs transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Hapus Terpilih</span>
            </button>

            <button
              onClick={() => setSelectedFileIds(new Set())}
              className="px-2.5 py-1.5 rounded-lg bg-indigo-800 hover:bg-indigo-700 text-indigo-200 text-xs font-medium transition-colors"
            >
              Batal
            </button>
          </div>
        </div>
      )}

      {/* Files Table Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-600" />
            Daftar Berkas &amp; Status Google Drive ({filteredFiles.length})
          </h3>
          <span className="text-xs text-slate-400 font-medium">
            Total Kapasitas: {formatFileSize(filteredFiles.reduce((acc, f) => acc + f.size, 0))}
          </span>
        </div>

        {filteredFiles.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/75 border-b border-slate-200/80 text-slate-500 font-semibold tracking-wider uppercase text-[10px]">
                  <th className="py-3 px-4 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      ref={(input) => {
                        if (input) input.indeterminate = isSomeSelected;
                      }}
                      onChange={handleToggleSelectAll}
                      className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer"
                      title="Pilih Semua Berkas"
                    />
                  </th>
                  <th className="py-3 px-4">Nama Berkas</th>
                  <th className="py-3 px-4">Folder Aplikasi</th>
                  <th className="py-3 px-4">Ukuran</th>
                  <th className="py-3 px-4">Status Sinkronisasi</th>
                  <th className="py-3 px-4">Waktu Unggah</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredFiles.map((file) => {
                  const targetFolder = folders.find((f) => f.id === file.folderId);
                  const isActionBusy = actionLoadingId === file.id;
                  const isSelected = selectedFileIds.has(file.id);

                  return (
                    <tr
                      key={file.id}
                      className={`transition-colors ${
                        isSelected ? "bg-indigo-50/60 hover:bg-indigo-50/80" : "hover:bg-slate-50/70"
                      }`}
                    >
                      {/* Selection Checkbox */}
                      <td className="py-3.5 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectFile(file.id)}
                          className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer"
                        />
                      </td>
                      
                      {/* Name & Type */}
                      <td className="py-3.5 px-4 font-medium text-slate-900 max-w-xs">
                        <div className="flex items-center gap-2.5">
                          <div
                            onClick={() => setPreviewFile(file)}
                            className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-blue-50 border border-slate-200 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
                            title="Pratinjau Berkas"
                          >
                            <FileText className="w-4 h-4 text-slate-600 hover:text-blue-600" />
                          </div>
                          <div className="min-w-0">
                            <p
                              onClick={() => setPreviewFile(file)}
                              className="font-semibold text-slate-900 truncate hover:text-blue-600 transition-colors cursor-pointer"
                              title={file.originalName}
                            >
                              {file.originalName}
                            </p>
                            <p className="text-[10px] text-slate-400 truncate font-mono">
                              ID: {file.id}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Folder Mapped */}
                      <td className="py-3.5 px-4 text-slate-600">
                        <span className="inline-flex items-center gap-1 font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                          <FolderIcon className="w-3 h-3 text-slate-500" />
                          {targetFolder?.name || "Folder"}
                        </span>
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate font-mono max-w-[140px]">
                          {targetFolder?.targetFolderPath}
                        </div>
                      </td>

                      {/* Size */}
                      <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap font-mono">
                        {formatFileSize(file.size)}
                      </td>

                      {/* Sync Status Badge */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {(() => {
                          const isFolderSynced = !!(targetFolder?.syncToGoogleDrive && targetFolder?.googleDriveFolderId);
                          if (!isFolderSynced || file.syncStatus === SyncStatus.LOCAL_ONLY) {
                            return null;
                          }
                          return (
                            <>
                              {getStatusBadge(file.syncStatus, file.syncAttempts)}
                              {file.syncedAt && (
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                  Sinkron: {formatDate(file.syncedAt)}
                                </div>
                              )}
                              {file.lastError && (
                                <div className="text-[10px] text-rose-500 mt-0.5 max-w-[160px] truncate" title={file.lastError}>
                                  Err: {file.lastError}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </td>

                      {/* Created At */}
                      <td className="py-3.5 px-4 text-slate-500 whitespace-nowrap text-[11px]">
                        {formatDate(file.createdAt)}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Inline File Preview */}
                          <button
                            onClick={() => setPreviewFile(file)}
                            className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg border border-blue-200/60 transition-colors inline-flex items-center gap-1 cursor-pointer"
                            title="Pratinjau Berkas"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span className="text-[11px] font-medium hidden sm:inline">Pratinjau</span>
                          </button>
                          
                          {/* Google Drive Link Preview */}
                          {file.syncStatus === SyncStatus.SYNCED && file.googleDriveWebViewLink ? (
                            <a
                              href={file.googleDriveWebViewLink}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg border border-blue-200/60 transition-colors inline-flex items-center gap-1"
                              title="Buka Berkas di Google Drive"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span className="text-[11px] font-medium hidden sm:inline">Buka Drive</span>
                            </a>
                          ) : googleStatus?.isConnected ? (
                            <button
                              onClick={() => handleTriggerSync(file.id)}
                              disabled={isActionBusy}
                              className="p-1.5 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg border border-indigo-200/60 transition-colors inline-flex items-center gap-1 cursor-pointer"
                              title="Sinkronkan ke Google Drive Sekarang"
                            >
                              {isActionBusy ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <RotateCw className="w-3.5 h-3.5" />
                              )}
                              <span className="text-[11px] font-medium hidden sm:inline">Sync</span>
                            </button>
                          ) : null}

                          {/* Real-time Streaming Download */}
                          <button
                            onClick={() => startFileDownload(file.id, file.originalName, file.size)}
                            className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg border border-slate-200 hover:border-blue-200 transition-colors cursor-pointer"
                            title="Unduh Berkas (Real-time Progress)"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete File */}
                          <button
                            onClick={() => handleDeleteFile(file.id, file.originalName)}
                            disabled={isActionBusy}
                            className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg border border-slate-200 hover:border-rose-200 transition-colors cursor-pointer"
                            title="Hapus Berkas"
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
        ) : (
          <div className="p-12 text-center">
            <FileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-slate-700">Belum Ada Berkas</h4>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              Tidak ada berkas yang cocok dengan kriteria pencarian atau filter yang dipilih.
            </p>
          </div>
        )}
      </div>

      {/* File Inline Preview Modal */}
      <FilePreviewModal
        file={previewFile}
        filesList={filteredFiles}
        onClose={() => setPreviewFile(null)}
        onNavigateFile={(f) => setPreviewFile(f)}
      />

      {/* Multi-Part ZIP / Bulk Download Modal */}
      <MultiPartZipModal
        isOpen={isMultiPartModalOpen}
        onClose={() => setIsMultiPartModalOpen(false)}
        selectedFiles={modalTargetFiles}
      />

      {/* Operation Loading Component */}
      <OperationLoadingModal {...operationLoading} />

    </div>
  );
};
