import React, { useState } from "react";
import {
  AlertTriangle,
  Layers,
  Copy,
  RefreshCw,
  Ban,
  FileText,
  FileSpreadsheet,
  Image,
  Archive,
  Film,
  Music,
  File as FileIcon,
  ArrowRight,
  CheckCircle2,
  Calendar,
  HardDrive,
  Clock,
  Sparkles,
} from "lucide-react";
import { FileItem } from "../types/frontend.ts";

export type ConflictResolutionMode = "create_version" | "rename" | "overwrite" | "skip";

export interface ConflictItem {
  newFile: globalThis.File;
  existingFile: FileItem;
}

interface FileConflictModalProps {
  isOpen: boolean;
  conflicts: ConflictItem[];
  targetFolderName?: string;
  onResolve: (resolutions: Map<string, ConflictResolutionMode>) => void;
  onCancel?: () => void;
  onClose?: () => void;
}

export const FileConflictModal: React.FC<FileConflictModalProps> = ({
  isOpen,
  conflicts,
  targetFolderName = "Drive Saya",
  onResolve,
  onCancel,
  onClose,
}) => {
  const handleClose = () => {
    if (onClose) onClose();
    else if (onCancel) onCancel();
  };
  const [selectedModes, setSelectedModes] = useState<Map<string, ConflictResolutionMode>>(() => {
    const map = new Map<string, ConflictResolutionMode>();
    conflicts.forEach((c) => map.set(c.newFile.name, "create_version"));
    return map;
  });

  const [applyToAll, setApplyToAll] = useState<ConflictResolutionMode | null>(null);

  if (!isOpen || conflicts.length === 0) return null;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formatDate = (dateStr?: string | number | Date | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext === "pdf") return <FileText className="w-5 h-5 text-danger-500" />;
    if (["xls", "xlsx", "csv"].includes(ext || ""))
      return <FileSpreadsheet className="w-5 h-5 text-ok-500" />;
    if (["jpg", "jpeg", "png", "webp", "svg"].includes(ext || ""))
      return <Image className="w-5 h-5 text-accent-500" />;
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext || ""))
      return <Archive className="w-5 h-5 text-warn-500" />;
    if (["mp4", "mkv", "avi", "mov"].includes(ext || ""))
      return <Film className="w-5 h-5 text-accent-500" />;
    if (["mp3", "wav"].includes(ext || ""))
      return <Music className="w-5 h-5 text-accent-500" />;
    return <FileIcon className="w-5 h-5 text-ink-400" />;
  };

  const handleModeChange = (fileName: string, mode: ConflictResolutionMode) => {
    setSelectedModes((prev) => {
      const next = new Map(prev);
      next.set(fileName, mode);
      return next;
    });
    setApplyToAll(null);
  };

  const handleApplyAll = (mode: ConflictResolutionMode) => {
    setApplyToAll(mode);
    const next = new Map<string, ConflictResolutionMode>();
    conflicts.forEach((c) => next.set(c.newFile.name, mode));
    setSelectedModes(next);
  };

  const handleConfirm = () => {
    onResolve(selectedModes);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-night-950/45 animate-fade-in">
      <div className="bg-surface w-full max-w-3xl rounded-2xl shadow-float border border-ink-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-ink-100 bg-warn-50/70 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-warn-100 text-warn-700 flex items-center justify-center shadow-card">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink-900 tracking-tight flex items-center gap-2">
                Berkas Dengan Nama Sama Ditemukan
                <span className="bg-warn-200 text-warn-900 px-2 py-0.5 rounded-full text-xs font-extrabold">
                  {conflicts.length} Berkas
                </span>
              </h3>
              <p className="text-xs text-ink-500">
                Folder tujuan: <strong className="text-ink-700">{targetFolderName}</strong>
              </p>
            </div>
          </div>
        </div>

        {/* Global Batch Action Buttons */}
        <div className="px-6 py-3 bg-ink-50 border-b border-ink-200/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="font-semibold text-ink-600">Pilih Aksi Cepat Untuk Semua:</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleApplyAll("create_version")}
              className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer ${
                applyToAll === "create_version"
                  ? "bg-accent-600 text-accent-fg shadow-card"
                  : "bg-surface border border-ink-200 text-ink-700 hover:bg-accent-50 hover:text-accent-700 hover:border-accent-200"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Buat Versi Baru</span>
            </button>

            <button
              type="button"
              onClick={() => handleApplyAll("rename")}
              className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer ${
                applyToAll === "rename"
                  ? "bg-accent-600 text-accent-fg shadow-card"
                  : "bg-surface border border-ink-200 text-ink-700 hover:bg-accent-50 hover:text-accent-700 hover:border-accent-200"
              }`}
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Simpan Keduanya</span>
            </button>

            <button
              type="button"
              onClick={() => handleApplyAll("overwrite")}
              className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer ${
                applyToAll === "overwrite"
                  ? "bg-accent-600 text-accent-fg shadow-card"
                  : "bg-surface border border-ink-200 text-ink-700 hover:bg-accent-50 hover:text-accent-700 hover:border-accent-200"
              }`}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Timpa Berkas</span>
            </button>

            <button
              type="button"
              onClick={() => handleApplyAll("skip")}
              className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer ${
                applyToAll === "skip"
                  ? "bg-danger-600 text-white shadow-card"
                  : "bg-surface border border-ink-200 text-ink-700 hover:bg-danger-50 hover:text-danger-700 hover:border-danger-200"
              }`}
            >
              <Ban className="w-3.5 h-3.5" />
              <span>Lewati</span>
            </button>
          </div>
        </div>

        {/* Conflict List & Comparisons */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {conflicts.map((conflict, idx) => {
            const currentMode = selectedModes.get(conflict.newFile.name) || "create_version";
            const sizeDiff = conflict.newFile.size - conflict.existingFile.size;
            const sizeDiffText =
              sizeDiff === 0
                ? "Ukuran sama"
                : sizeDiff > 0
                ? `+${formatBytes(sizeDiff)} lebih besar`
                : `-${formatBytes(Math.abs(sizeDiff))} lebih kecil`;

            const currentVersion = conflict.existingFile.version || 1;
            const nextVersion = currentVersion + 1;

            return (
              <div
                key={conflict.newFile.name + idx}
                className="bg-surface rounded-2xl border border-ink-200 p-4 shadow-card hover:border-accent-300 transition space-y-4"
              >
                {/* File Header */}
                <div className="flex items-center gap-3 pb-3 border-b border-ink-100">
                  <div className="w-10 h-10 rounded-xl bg-ink-100 flex items-center justify-center shrink-0">
                    {getFileIcon(conflict.newFile.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-bold text-ink-900 truncate">
                      {conflict.newFile.name}
                    </h4>
                    <p className="text-xs text-ink-400">
                      Terdapat berkas dengan nama yang sama di folder ini
                    </p>
                  </div>
                </div>

                {/* Side-by-Side Comparison */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {/* Existing File */}
                  <div className="bg-ink-50 rounded-xl p-3.5 border border-ink-200/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-ink-600 text-[10px]">
                        Berkas Lama di Drive
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-ink-200 text-ink-700">
                        Versi {currentVersion}
                      </span>
                    </div>

                    <div className="space-y-1 text-ink-600">
                      <div className="flex items-center justify-between">
                        <span className="text-ink-400">Ukuran:</span>
                        <span className="font-semibold text-ink-800">
                          {formatBytes(conflict.existingFile.size)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-ink-400">Tanggal Unggah:</span>
                        <span className="font-medium text-ink-700">
                          {formatDate(conflict.existingFile.createdAt)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-ink-400">Pengunggah:</span>
                        <span className="font-medium text-ink-700">
                          {conflict.existingFile.user?.name || "Staf"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Incoming New File */}
                  <div className="bg-accent-50/50 rounded-xl p-3.5 border border-accent-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-accent-900 text-[10px]">
                        Berkas Baru (Akan Diunggah)
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-accent-100 text-accent-800">
                        {currentMode === "create_version"
                          ? `Versi Baru (v${nextVersion})`
                          : currentMode === "rename"
                          ? "Ganti Nama Otomatis"
                          : currentMode === "overwrite"
                          ? "Timpa (v1)"
                          : "Dilewati"}
                      </span>
                    </div>

                    <div className="space-y-1 text-ink-600">
                      <div className="flex items-center justify-between">
                        <span className="text-ink-400">Ukuran:</span>
                        <span className="font-semibold text-ink-800">
                          {formatBytes(conflict.newFile.size)}{" "}
                          <span
                            className={`text-[10px] font-bold ${
                              sizeDiff > 0
                                ? "text-warn-600"
                                : sizeDiff < 0
                                ? "text-ok-600"
                                : "text-ink-400"
                            }`}
                          >
                            ({sizeDiffText})
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-ink-400">Dimodifikasi:</span>
                        <span className="font-medium text-ink-700">
                          {formatDate(conflict.newFile.lastModified)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-ink-400">Status:</span>
                        <span className="font-bold text-accent-700">Siap Diproses</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Action Choice Buttons for this item */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleModeChange(conflict.newFile.name, "create_version")}
                    className={`p-2.5 rounded-xl text-left border transition cursor-pointer ${
                      currentMode === "create_version"
                        ? "bg-accent-50 border-accent-500 ring-2 ring-accent-500/20 text-accent-900"
                        : "bg-surface border-ink-200 hover:border-ink-300 text-ink-700"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs mb-0.5">
                      <Layers className="w-3.5 h-3.5 text-accent-600 shrink-0" />
                      <span>Versi Baru (v{nextVersion})</span>
                    </div>
                    <p className="text-[10px] text-ink-500 line-clamp-2">
                      Simpan riwayat versi lama dan jadikan ini versi terbaru.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleModeChange(conflict.newFile.name, "rename")}
                    className={`p-2.5 rounded-xl text-left border transition cursor-pointer ${
                      currentMode === "rename"
                        ? "bg-accent-50 border-accent-500 ring-2 ring-accent-500/20 text-accent-900"
                        : "bg-surface border-ink-200 hover:border-ink-300 text-ink-700"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs mb-0.5">
                      <Copy className="w-3.5 h-3.5 text-accent-600 shrink-0" />
                      <span>Simpan Keduanya</span>
                    </div>
                    <p className="text-[10px] text-ink-500 line-clamp-2">
                      Ganti nama otomatis menjadi nama (1), (2), dst.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleModeChange(conflict.newFile.name, "overwrite")}
                    className={`p-2.5 rounded-xl text-left border transition cursor-pointer ${
                      currentMode === "overwrite"
                        ? "bg-warn-50 border-warn-500 ring-2 ring-warn-500/20 text-warn-900"
                        : "bg-surface border-ink-200 hover:border-ink-300 text-ink-700"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs mb-0.5">
                      <RefreshCw className="w-3.5 h-3.5 text-warn-600 shrink-0" />
                      <span>Timpa Berkas</span>
                    </div>
                    <p className="text-[10px] text-ink-500 line-clamp-2">
                      Gantikan data berkas lama dengan berkas baru.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleModeChange(conflict.newFile.name, "skip")}
                    className={`p-2.5 rounded-xl text-left border transition cursor-pointer ${
                      currentMode === "skip"
                        ? "bg-danger-50 border-danger-500 ring-2 ring-danger-500/20 text-danger-900"
                        : "bg-surface border-ink-200 hover:border-ink-300 text-ink-700"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs mb-0.5">
                      <Ban className="w-3.5 h-3.5 text-danger-600 shrink-0" />
                      <span>Lewati</span>
                    </div>
                    <p className="text-[10px] text-ink-500 line-clamp-2">
                      Jangan mengunggah berkas ini ke dalam folder.
                    </p>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-ink-100 bg-ink-50/80 flex items-center justify-between">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-xs font-bold text-ink-600 hover:text-ink-900 hover:bg-ink-200 rounded-xl transition cursor-pointer"
          >
            Batal Mengunggah
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            className="px-5 py-2.5 bg-accent-600 hover:bg-accent-500 text-accent-fg text-xs font-bold rounded-xl shadow-card transition flex items-center gap-2 cursor-pointer"
          >
            <span>Lanjutkan Unggah ({conflicts.length} Berkas)</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
