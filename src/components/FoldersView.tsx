import React, { useState } from "react";
import {
  FolderTree,
  FolderPlus,
  CloudDownload,
  Folder as FolderIcon,
  HardDrive,
  Clock,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  FolderCheck,
  ChevronRight,
  Archive,
  Download,
  RefreshCw,
} from "lucide-react";
import { DriveType, Folder } from "../types/frontend.ts";
import { api } from "../services/api.ts";
import { useAuth } from "../context/AuthContext.tsx";
import { useDialog } from "../context/DialogContext.tsx";
import { ImportGoogleDriveModal } from "./ImportGoogleDriveModal.tsx";
import { MultiPartZipModal } from "./MultiPartZipModal.tsx";
import { OperationLoadingModal, OperationType } from "./OperationLoadingModal.tsx";

interface FoldersViewProps {
  folders: Folder[];
  isLoading: boolean;
  onRefresh: () => void;
  onSelectFolderForUpload: (folderId: string) => void;
}

export const FoldersView: React.FC<FoldersViewProps> = ({
  folders,
  isLoading,
  onRefresh,
  onSelectFolderForUpload,
}) => {
  const { user, isAdmin } = useAuth();
  const { showAlert, showConfirm, showToast } = useDialog();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Folder zip modal state
  const [zipTargetFolder, setZipTargetFolder] = useState<Folder | null>(null);

  // Multi-selection state for folders
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState<boolean>(false);
  const [bulkActionMessage, setBulkActionMessage] = useState<string | null>(null);

  // Operation loading modal
  const [operationLoading, setOperationLoading] = useState<{
    isOpen: boolean;
    title: string;
    message?: string;
    type?: OperationType;
    subMessage?: string;
  }>({ isOpen: false, title: "" });

  // Form State
  const [folderName, setFolderName] = useState("");
  const [targetFolderPath, setTargetFolderPath] = useState("2026/");
  const [targetDriveType, setTargetDriveType] = useState<DriveType>(DriveType.MY_DRIVE);
  const [description, setDescription] = useState("");

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return "Belum pernah";
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

  const handleToggleSelectFolder = (id: string) => {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleBulkDeleteFolders = async () => {
    const count = selectedFolderIds.size;
    if (count === 0) return;

    const confirmed = await showConfirm({
      title: "Hapus Folder Terpilih",
      message: `Yakin ingin menghapus ${count} folder yang dipilih beserta relasi berkasnya?`,
      confirmText: "Ya, Hapus Folder",
      cancelText: "Batal",
      isDanger: true,
    });
    if (!confirmed) return;

    setIsBulkDeleting(true);
    setBulkActionMessage(null);
    setOperationLoading({
      isOpen: true,
      title: "Memindahkan Folder ke Sampah",
      message: `${count} folder terpilih`,
      type: "trash",
      subMessage: "Sedang memindahkan folder terpilih beserta isinya ke sampah...",
    });
    try {
      const res = await api.bulkDeleteFolders(Array.from(selectedFolderIds));
      setSelectedFolderIds(new Set());
      const deletedCount = res.data.count ?? res.data.processedIds.length;
      setBulkActionMessage(`Berhasil memindahkan ${deletedCount} folder ke sampah.`);
      showToast(`Berhasil memindahkan ${deletedCount} folder ke sampah`, "success");
      onRefresh();
      setTimeout(() => setBulkActionMessage(null), 4000);
    } catch (err: any) {
      showAlert({
        title: "Gagal Menghapus Folder",
        message: err.message,
        type: "error",
      });
    } finally {
      setIsBulkDeleting(false);
      setOperationLoading((prev) => ({ ...prev, isOpen: false }));
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderName.trim() || !targetFolderPath.trim()) {
      setErrorMessage("Nama folder dan jalur Google Drive wajib diisi.");
      return;
    }

    setIsCreating(true);
    setErrorMessage(null);
    try {
      await api.createFolder({
        name: folderName.trim(),
        targetFolderPath: targetFolderPath.trim(),
        targetDriveType,
        description: description.trim() || undefined,
      });
      setShowCreateModal(false);
      setFolderName("");
      setTargetFolderPath("2026/");
      setDescription("");
      showToast("Folder berhasil dibuat", "success");
      onRefresh();
    } catch (err: any) {
      setErrorMessage(err.message || "Gagal membuat folder");
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteFolder = async (id: string, name: string) => {
    const confirmed = await showConfirm({
      title: "Hapus Folder",
      message: `Hapus konfigurasi folder "${name}"?`,
      confirmText: "Ya, Hapus",
      cancelText: "Batal",
      isDanger: true,
    });
    if (!confirmed) return;

    setOperationLoading({
      isOpen: true,
      title: "Memindahkan Folder ke Sampah",
      message: name,
      type: "trash",
      subMessage: "Sedang memindahkan folder ke tempat sampah...",
    });
    try {
      await api.deleteFolder(id);
      showToast(`Folder "${name}" berhasil dihapus`, "success");
      onRefresh();
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

  const handleSyncFolder = async (folder: Folder) => {
    try {
      showToast(`Menyinkronkan folder "${folder.name}" ke Google Drive...`, "info");
      await api.syncFolder(folder.id);
      showToast(`Folder "${folder.name}" berhasil disinkronkan ke Google Drive!`, "success");
      onRefresh();
    } catch (err: any) {
      showAlert({
        title: "Gagal Sinkronisasi Folder",
        message: err.message || "Gagal menyinkronkan folder ke Google Drive",
        type: "error",
      });
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header & Create Action */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <FolderTree className="w-5 h-5 text-indigo-600" />
            Struktur Folder Aplikasi &amp; Pemetaan Google Drive
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Setiap folder dihubungkan langsung ke hierarki jalur direktori Google Drive (My Drive / Shared Drive).
          </p>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 shrink-0">
            {user?.authProvider === "GOOGLE" && (
              <button
                onClick={() => setShowImportModal(true)}
                className="px-3.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg shadow-2xs flex items-center gap-2 transition-all cursor-pointer"
                title="Import folder beserta subfolder dan berkas dari Google Drive"
              >
                <CloudDownload className="w-4 h-4 text-emerald-600" />
                <span>Import dari Drive</span>
              </button>
            )}
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-lg shadow-sm shadow-indigo-600/20 flex items-center gap-2 transition-all cursor-pointer"
            >
              <FolderPlus className="w-4 h-4" />
              <span>+ Buat Folder Baru</span>
            </button>
          </div>
        )}
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

      {/* Floating / Sticky Bulk Action Toolbar for Folders */}
      {isAdmin && selectedFolderIds.size > 0 && (
        <div className="bg-indigo-900 text-white rounded-xl p-3.5 shadow-lg border border-indigo-700 flex flex-wrap items-center justify-between gap-3 animate-fadeIn">
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded-md bg-indigo-700 font-bold font-mono">
              {selectedFolderIds.size}
            </span>
            <span className="font-medium">Folder dipilih</span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={handleBulkDeleteFolders}
              disabled={isBulkDeleting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 active:bg-rose-700 font-semibold text-white shadow-xs transition-colors cursor-pointer"
            >
              {isBulkDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              <span>Hapus Folder Terpilih</span>
            </button>

            <button
              onClick={() => setSelectedFolderIds(new Set())}
              className="px-2.5 py-1.5 rounded-lg bg-indigo-800 hover:bg-indigo-700 text-indigo-200 text-xs font-medium transition-colors cursor-pointer"
            >
              Batal
            </button>
          </div>
        </div>
      )}

      {/* Folders Grid */}
      {folders.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {folders.map((folder) => {
            const isSelected = selectedFolderIds.has(folder.id);

            return (
              <div
                key={folder.id}
                className={`bg-white rounded-xl border p-5 shadow-xs transition-all flex flex-col justify-between ${
                  isSelected
                    ? "border-indigo-500 ring-2 ring-indigo-500/20 bg-indigo-50/20"
                    : "border-slate-200 hover:border-indigo-300 hover:shadow-md"
                }`}
              >
                <div>
                  
                  {/* Top Meta */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      {isAdmin && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectFolder(folder.id)}
                          className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer"
                        />
                      )}
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                        <FolderIcon className="w-5 h-5" />
                      </div>
                    </div>
                    {folder.syncToGoogleDrive && folder.googleDriveFolderId ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                        <CloudDownload className="w-3 h-3 text-blue-600" />
                        Google Drive
                      </span>
                    ) : (
                      <button
                        onClick={() => handleSyncFolder(folder)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition-colors cursor-pointer"
                        title="Sinkronkan folder ini ke Google Drive"
                      >
                        <RefreshCw className="w-3 h-3 text-indigo-600" />
                        <span>Sinkronkan ke Drive</span>
                      </button>
                    )}
                  </div>

                  {/* Title & Description */}
                  <h3 className="text-sm font-bold text-slate-900 mt-3 truncate" title={folder.name}>
                    {folder.name}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 min-h-[32px]">
                    {folder.description || "Tidak ada keterangan tambahan."}
                  </p>

                  {/* Target Path Breadcrumb */}
                  <div className="mt-3.5 p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-[11px] font-mono text-indigo-700 flex items-center gap-1.5 truncate">
                    <FolderCheck className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    <span className="truncate">{folder.targetFolderPath}</span>
                  </div>

                  {/* Folder Metrics */}
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs border-t border-slate-100 pt-3">
                    <div>
                      <span className="text-[10px] text-slate-400 block">Total Berkas</span>
                      <span className="font-semibold text-slate-800">{folder.filesCount || 0} berkas</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">Kapasitas</span>
                      <span className="font-semibold text-slate-800 font-mono">
                        {formatFileSize(folder.totalSizeBytes)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 text-[10px] text-slate-400">
                    Sinkron terakhir: {formatDate(folder.lastSyncedAt)}
                  </div>

                </div>

                {/* Card Actions */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onSelectFolderForUpload(folder.id)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                    >
                      <span>Unggah</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => setZipTargetFolder(folder)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-amber-700 bg-slate-100 hover:bg-amber-50 px-2 py-1 rounded-md border border-slate-200 hover:border-amber-200 transition-colors cursor-pointer"
                      title="Unduh semua berkas dalam folder ini sebagai ZIP / Multi-Part"
                    >
                      <Archive className="w-3 h-3 text-amber-600" />
                      <span>Unduh ZIP</span>
                    </button>
                  </div>

                  {isAdmin && (
                    <button
                      onClick={() => handleDeleteFolder(folder.id, folder.name)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                      title="Hapus Folder"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
            <FolderPlus className="w-7 h-7" />
          </div>
          <h4 className="text-sm font-bold text-slate-800 mb-1">
            Belum Ada Folder
          </h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4 leading-relaxed">
            Belum ada folder. User harus membuat folder terlebih dahulu sebelum dapat mengunggah atau mengorganisasi berkas.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-500/20 transition-all active:scale-95 cursor-pointer"
          >
            <FolderPlus className="w-4 h-4" />
            <span>Buat Folder Baru</span>
          </button>
        </div>
      )}

      {/* Create Folder Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center">
                  <FolderPlus className="w-4 h-4" />
                </div>
                <h4 className="text-sm font-bold text-slate-900">Buat Folder Aplikasi Baru</h4>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            {errorMessage && (
              <div className="mt-3 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                {errorMessage}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-3.5 text-xs">
              
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Nama Folder Aplikasi <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Pendataan KJP Plus Tahap 1"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Jalur Hierarki Google Drive <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="2026/Pendataan/KJP_Tahap_1"
                  value={targetFolderPath}
                  onChange={(e) => setTargetFolderPath(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-indigo-700 focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Sistem otomatis membuat struktur subdirektori rekursif di Google Drive bila belum ada.
                </p>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Tipe Target Google Drive
                </label>
                <select
                  value={targetDriveType}
                  onChange={(e) => setTargetDriveType(e.target.value as DriveType)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500"
                >
                  <option value={DriveType.MY_DRIVE}>Personal My Drive (Drive Saya)</option>
                  <option value={DriveType.SHARED_DRIVE}>Shared Drive (Drive Bersama / Tim)</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Keterangan / Deskripsi
                </label>
                <textarea
                  rows={2}
                  placeholder="Keterangan peruntukan dokumen berkas..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  disabled={isCreating}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center gap-2 shadow-xs"
                >
                  {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  <span>Simpan Folder</span>
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

      {/* Import Google Drive Folder Modal */}
      <ImportGoogleDriveModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onSuccess={() => {
          onRefresh();
        }}
        currentFolderId={null}
        existingFolders={folders}
      />

      {/* Multi-Part ZIP / Bulk Download Modal for Folder */}
      <MultiPartZipModal
        isOpen={Boolean(zipTargetFolder)}
        onClose={() => setZipTargetFolder(null)}
        selectedFolder={zipTargetFolder || undefined}
      />

      {/* Operation Loading Component */}
      <OperationLoadingModal {...operationLoading} />

    </div>
  );
};
