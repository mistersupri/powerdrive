import React, { useState, useEffect } from "react";
import { Folder, FileItem } from "../types/frontend.ts";
import { api } from "../services/api.ts";
import {
  X,
  Search,
  FolderOpen,
  Copy,
  Move,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Folder as FolderIcon,
  Cloud,
} from "lucide-react";

interface MoveCopyModalProps {
  files: FileItem[];
  mode: "move" | "copy";
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export const MoveCopyModal: React.FC<MoveCopyModalProps> = ({
  files,
  mode,
  onClose,
  onSuccess,
}) => {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [isLoadingFolders, setIsLoadingFolders] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load all folders
  useEffect(() => {
    let isMounted = true;
    const fetchFolders = async () => {
      setIsLoadingFolders(true);
      setErrorMessage(null);
      try {
        const response = await api.listFolders({ limit: 1000 });
        if (isMounted) {
          // Sort folders alphabetically by name
          const sorted = [...response.folders].sort((a, b) =>
            a.name.localeCompare(b.name)
          );
          setFolders(sorted);
        }
      } catch (err: any) {
        console.error("Failed to load folders:", err);
        if (isMounted) {
          setErrorMessage("Gagal memuat daftar folder. Silakan coba lagi.");
        }
      } finally {
        if (isMounted) {
          setIsLoadingFolders(false);
        }
      }
    };

    fetchFolders();
    return () => {
      isMounted = false;
    };
  }, []);

  // Filter folders by search query
  const filteredFolders = folders.filter((folder) => {
    const term = searchQuery.toLowerCase();
    return (
      folder.name.toLowerCase().includes(term) ||
      (folder.targetFolderPath && folder.targetFolderPath.toLowerCase().includes(term))
    );
  });

  const handleSubmit = async () => {
    if (!selectedFolderId) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    const fileIds = files.map((f) => f.id);

    try {
      if (mode === "move") {
        const res = await api.bulkMoveFiles(fileIds, selectedFolderId);
        if (res.success) {
          onSuccess(res.message);
          onClose();
        } else {
          setErrorMessage(res.message || "Gagal memindahkan beberapa berkas.");
        }
      } else {
        const res = await api.bulkCopyFiles(fileIds, selectedFolderId);
        if (res.success) {
          onSuccess(res.message);
          onClose();
        } else {
          setErrorMessage(res.message || "Gagal menyalin beberapa berkas.");
        }
      }
    } catch (err: any) {
      console.error(`Failed to ${mode} files:`, err);
      setErrorMessage(
        err.message || `Terjadi kesalahan saat ${mode === "move" ? "memindahkan" : "menyalin"} berkas.`
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedFolder = folders.find((f) => f.id === selectedFolderId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-night-950/45 animate-fade-in" id="move-copy-modal-overlay">
      <div className="bg-surface rounded-2xl w-full max-w-lg shadow-float border border-ink-100 overflow-hidden flex flex-col max-h-[90vh] animate-scaleUp">
        {/* Header */}
        <div className="px-6 py-4 border-b border-ink-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {mode === "move" ? (
              <Move className="w-5 h-5 text-accent-600" />
            ) : (
              <Copy className="w-5 h-5 text-accent-600" />
            )}
            <h2 className="text-base font-bold text-ink-800">
              {mode === "move" ? "Pindahkan" : "Salin"} {files.length} Berkas
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink-400 hover:text-ink-600 hover:bg-ink-50 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Selected Files Preview */}
        <div className="px-6 py-3 bg-ink-50/50 border-b border-ink-100">
          <span className="text-[11px] font-bold text-ink-500 block mb-1">
            Berkas yang terpilih:
          </span>
          <div className="text-xs font-semibold text-ink-700 truncate max-w-full">
            {files.length === 1
              ? files[0].originalName
              : `${files[0].originalName} dan ${files.length - 1} berkas lainnya`}
          </div>
        </div>

        {/* Main Body */}
        <div className="p-6 flex-1 overflow-y-auto flex flex-col gap-4 min-h-0">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Cari folder tujuan..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs bg-ink-50 hover:bg-ink-100/70 focus:bg-surface border border-ink-200 focus:border-accent-500 rounded-xl transition outline-hidden text-ink-700"
            />
          </div>

          {/* Folder List */}
          <div className="flex-1 border border-ink-100 rounded-xl overflow-hidden bg-ink-50/20 flex flex-col min-h-[220px]">
            {isLoadingFolders ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-ink-400">
                <Loader2 className="w-6 h-6 animate-spin text-accent-600" />
                <span className="text-xs">Memuat daftar folder...</span>
              </div>
            ) : errorMessage && folders.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-ink-400">
                <AlertTriangle className="w-6 h-6 text-warn-500" />
                <span className="text-xs text-center">{errorMessage}</span>
              </div>
            ) : filteredFolders.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-ink-400">
                <FolderIcon className="w-8 h-8 text-ink-300" />
                <span className="text-xs text-center">
                  {searchQuery ? "Tidak ada folder yang cocok." : "Belum ada folder yang dibuat."}
                </span>
              </div>
            ) : (
              <div className="overflow-y-auto max-h-[300px] divide-y divide-ink-100">
                {filteredFolders.map((folder) => {
                  const isGDrive = folder.isImported || !!folder.googleDriveFolderId;
                  const isSelected = folder.id === selectedFolderId;
                  return (
                    <button
                      key={folder.id}
                      onClick={() => setSelectedFolderId(folder.id)}
                      className={`w-full text-left px-4 py-3 flex items-center justify-between transition cursor-pointer ${
                        isSelected
                          ? "bg-accent-50 text-accent-950 font-bold"
                          : "hover:bg-ink-50 text-ink-700 bg-surface"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 pr-2">
                        <FolderIcon
                          className={`w-4 h-4 shrink-0 ${
                            isSelected ? "text-accent-600" : "text-ink-400"
                          }`}
                        />
                        <div className="truncate text-xs">
                          <div className="font-semibold truncate">{folder.name}</div>
                          {folder.targetFolderPath && (
                            <div className="text-[10px] text-ink-400 truncate mt-0.5 font-normal">
                              {folder.targetFolderPath}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Folder badges */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isGDrive && (
                          <span className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md font-semibold select-none ${
                            isSelected
                              ? "bg-accent-100 text-accent-800"
                              : "bg-ok-50 text-ok-700 border border-ok-100"
                          }`}>
                            <Cloud className="w-2.5 h-2.5" />
                            <span>G-Drive</span>
                          </span>
                        )}
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          isSelected ? "bg-accent-600" : "bg-transparent"
                        }`} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Feedback message inside body */}
          {errorMessage && folders.length > 0 && (
            <div className="p-3 bg-danger-50 border border-danger-100 text-danger-800 rounded-xl flex items-start gap-2.5 text-xs animate-fade-in">
              <AlertTriangle className="w-4 h-4 text-danger-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Target Sync Notice if folder is G-Drive */}
          {selectedFolder && (selectedFolder.isImported || !!selectedFolder.googleDriveFolderId) && (
            <div className="p-3 bg-ok-50 border border-ok-100 text-ok-800 rounded-xl flex items-start gap-2.5 text-xs animate-fade-in">
              <Cloud className="w-4 h-4 text-ok-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block mb-0.5">Sinkronisasi Google Drive Aktif</span>
                <span className="text-[11px] text-ok-700/90 leading-relaxed block">
                  Folder tujuan terintegrasi dengan Google Drive. Berkas yang {mode === "move" ? "dipindahkan" : "disalin"} akan segera diunggah secara otomatis ke cloud.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-ink-50 border-t border-ink-100 flex items-center justify-between">
          <div className="text-[11px] text-ink-500">
            {selectedFolderId ? (
              <span className="font-semibold text-ink-700">
                Tujuan: {selectedFolder?.name}
              </span>
            ) : (
              <span>Pilih folder tujuan untuk melanjutkan.</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold text-ink-700 bg-surface hover:bg-ink-100 border border-ink-200 rounded-xl transition cursor-pointer disabled:opacity-50"
            >
              Batal
            </button>
            <button
              onClick={handleSubmit}
              disabled={!selectedFolderId || isSubmitting}
              className="px-4 py-2 text-xs font-semibold text-accent-fg bg-accent-600 hover:bg-accent-700 rounded-xl transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-card"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>
                {mode === "move" ? "Pindahkan" : "Salin"} Sekarang
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
