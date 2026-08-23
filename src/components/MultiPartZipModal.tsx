import React, { useState, useEffect, useMemo } from "react";
import {
  Archive,
  Download,
  Layers,
  FileText,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  FolderArchive,
  HardDrive,
  Sparkles,
  ChevronRight,
  ArrowDownToLine,
  Zap,
} from "lucide-react";
import { ArchiveSession, FileItem, Folder } from "../types/frontend.ts";
import { api } from "../services/api.ts";
import { useTransfer } from "../context/TransferContext.tsx";
import { useDialog } from "../context/DialogContext.tsx";

interface MultiPartZipModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedFiles?: FileItem[];
  selectedFolder?: Folder;
}

const PART_SIZE_PRESETS = [
  { label: "25 MB / Part", bytes: 25 * 1024 * 1024 },
  { label: "50 MB / Part (Rekomendasi)", bytes: 50 * 1024 * 1024 },
  { label: "100 MB / Part", bytes: 100 * 1024 * 1024 },
  { label: "250 MB / Part", bytes: 250 * 1024 * 1024 },
  { label: "500 MB / Part", bytes: 500 * 1024 * 1024 },
];

export const MultiPartZipModal: React.FC<MultiPartZipModalProps> = ({
  isOpen,
  onClose,
  selectedFiles = [],
  selectedFolder,
}) => {
  const { startArchivePartDownload, startBulkArchiveAllParts, startFileDownload } = useTransfer();
  const { showToast, showAlert } = useDialog();

  const [mode, setMode] = useState<"SINGLE" | "MULTIPART">("MULTIPART");
  const [partSizeBytes, setPartSizeBytes] = useState<number>(50 * 1024 * 1024);
  const [archiveName, setArchiveName] = useState<string>("");
  const [session, setSession] = useState<ArchiveSession | null>(null);
  const [isPreparing, setIsPreparing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const totalFilesCount = selectedFiles.length;
  const totalSizeBytes = selectedFiles.reduce((acc, f) => acc + f.size, 0);

  // Compute stable primitive strings of file IDs and folder ID to prevent infinite rendering loops
  const selectedFilesIdsString = useMemo(() => {
    return (selectedFiles || []).map((f) => f.id).join(",");
  }, [selectedFiles]);

  const selectedFolderId = selectedFolder?.id;

  // 1. Initialize archive name and reset session ONLY when modal opens or files/folder change
  useEffect(() => {
    if (isOpen) {
      if (selectedFolder) {
        setArchiveName(`Arsip_Folder_${selectedFolder.name.replace(/\s+/g, "_")}`);
      } else if (selectedFiles && selectedFiles.length > 0) {
        setArchiveName(`Arsip_Berkas_Cloud_${new Date().toISOString().slice(0, 10)}`);
      } else {
        setArchiveName("Arsip_Berkas_Cloud");
      }
      setSession(null);
      setErrorMessage(null);
    }
  }, [isOpen, selectedFilesIdsString, selectedFolderId]);

  // 2. Prepare the archive session ONLY when options change (and archiveName is ready)
  useEffect(() => {
    if (!isOpen) return;
    if (!archiveName) return; // Wait until archiveName is initialized

    handlePrepareArchive(archiveName);
  }, [isOpen, mode, partSizeBytes, archiveName, selectedFilesIdsString, selectedFolderId]);

  const formatFileSize = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const handlePrepareArchive = async (customName?: string) => {
    setIsPreparing(true);
    setErrorMessage(null);
    try {
      const fileIds = selectedFilesIdsString ? selectedFilesIdsString.split(",") : [];
      const effectivePartSize = mode === "SINGLE" ? 10 * 1024 * 1024 * 1024 : partSizeBytes; // 10GB for single
      const activeName = customName || archiveName;

      const res = await api.prepareBulkArchive({
        fileIds: fileIds.length > 0 ? fileIds : undefined,
        folderId: selectedFolderId,
        partSizeBytes: effectivePartSize,
        archiveName: activeName.trim() || "arsip_berkas",
      });

      setSession(res.session);
    } catch (err: any) {
      console.error("[MultiPartZipModal] Prepare archive error:", err);
      setErrorMessage(err.message || "Gagal menyiapkan part arsip ZIP.");
    } finally {
      setIsPreparing(false);
    }
  };

  const handleDownloadAll = async () => {
    if (!session) return;
    onClose();
    await startBulkArchiveAllParts(session);
  };

  const handleDownloadSinglePart = async (partIndex: number, partName: string, expectedSize: number) => {
    if (!session) return;
    await startArchivePartDownload({
      sessionId: session.sessionId,
      partIndex,
      partName,
      expectedSize,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-indigo-900 to-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 flex items-center justify-center">
              <FolderArchive className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Unduh Massal &amp; Multi-Part ZIP Zipping</span>
              </h3>
              <p className="text-xs text-indigo-200">
                {selectedFolder
                  ? `Mengarsipkan isi folder "${selectedFolder.name}"`
                  : `Mengarsipkan ${totalFilesCount} berkas terpilih (${formatFileSize(totalSizeBytes)})`}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-indigo-200 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 text-xs">
          {/* Mode Selector */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-800">Pilih Mode Unduhan Kompresi ZIP:</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Multipart Option */}
              <div
                onClick={() => setMode("MULTIPART")}
                className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                  mode === "MULTIPART"
                    ? "border-indigo-600 bg-indigo-50/50 text-indigo-950"
                    : "border-slate-200 hover:border-slate-300 bg-white text-slate-700"
                }`}
              >
                <div className="flex items-center gap-2 font-bold mb-1">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  <span>Multi-Part ZIP</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Otomatis membagi berkas menjadi volume part terpisah (.zip) untuk menghindari timeout pada berkas besar.
                </p>
              </div>

              {/* Single Archive Option */}
              <div
                onClick={() => setMode("SINGLE")}
                className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                  mode === "SINGLE"
                    ? "border-indigo-600 bg-indigo-50/50 text-indigo-950"
                    : "border-slate-200 hover:border-slate-300 bg-white text-slate-700"
                }`}
              >
                <div className="flex items-center gap-2 font-bold mb-1">
                  <Archive className="w-4 h-4 text-indigo-600" />
                  <span>Arsip Tunggal (.zip)</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Menggabungkan semua berkas ke dalam satu file ZIP utuh. Cocok untuk total ukuran kecil (&lt; 100MB).
                </p>
              </div>
            </div>
          </div>

          {/* Multipart Configuration */}
          {mode === "MULTIPART" && (
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <label className="font-bold text-slate-800 flex items-center justify-between">
                <span>Batas Ukuran per Part (Volume Threshold):</span>
                <span className="text-indigo-600 font-mono">
                  {formatFileSize(partSizeBytes)}
                </span>
              </label>

              <div className="flex flex-wrap gap-2">
                {PART_SIZE_PRESETS.map((preset) => (
                  <button
                    key={preset.bytes}
                    type="button"
                    onClick={() => setPartSizeBytes(preset.bytes)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      partSizeBytes === preset.bytes
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Archive Name Field */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-800">Nama Berkas Arsip:</label>
            <input
              type="text"
              value={archiveName}
              onChange={(e) => setArchiveName(e.target.value)}
              placeholder="Contoh: Dokumen_Arsip_2026"
              className="w-full px-3.5 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-800 font-medium"
            />
          </div>

          {/* Session Breakdown & Part List */}
          {isPreparing ? (
            <div className="p-8 text-center text-slate-500 space-y-2 bg-slate-50 rounded-xl border border-slate-100">
              <Loader2 className="w-6 h-6 text-indigo-600 animate-spin mx-auto" />
              <p className="font-medium">Menganalisis dan mempartisi berkas...</p>
            </div>
          ) : session ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between font-bold text-slate-800 border-b border-slate-200 pb-1.5">
                <span className="flex items-center gap-1.5">
                  <HardDrive className="w-4 h-4 text-indigo-600" />
                  Rincian Part Arsip ({session.totalParts} Bagian)
                </span>
                <span className="text-slate-500 font-mono">
                  Total: {session.totalFiles} Berkas ({formatFileSize(session.totalSizeBytes)})
                </span>
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {session.parts.map((part) => (
                  <div
                    key={part.partIndex}
                    className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3 hover:bg-slate-100/70 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center shrink-0 font-mono text-xs">
                        P{part.partIndex}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate" title={part.partName}>
                          {part.partName}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {part.files.length} berkas • {formatFileSize(part.totalBytes)}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleDownloadSinglePart(part.partIndex, part.partName, part.totalBytes)}
                      className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-indigo-50 hover:border-indigo-300 text-slate-700 hover:text-indigo-700 font-semibold text-[11px] flex items-center gap-1 transition-colors shrink-0"
                      title="Unduh part ini secara terpisah"
                    >
                      <Download className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Unduh Part</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : errorMessage ? (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          ) : null}
        </div>

        {/* Modal Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span>Progress unduhan streaming akan dipantau real-time di pojok kanan bawah.</span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 transition-colors w-full sm:w-auto"
            >
              Batal
            </button>

            <button
              onClick={handleDownloadAll}
              disabled={isPreparing || !session || session.parts.length === 0}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-xs w-full sm:w-auto"
            >
              {isPreparing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowDownToLine className="w-4 h-4" />
              )}
              <span>
                {session?.parts.length === 1
                  ? "Unduh Arsip ZIP (Real-Time)"
                  : `Unduh Semua ${session?.parts.length || 0} Part ZIP`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
