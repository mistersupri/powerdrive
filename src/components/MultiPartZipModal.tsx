import React, { useState, useEffect, useMemo } from "react";
import { Dialog, DialogHeader } from "../ui/Dialog.tsx";
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
  { label: "25 MB per bagian", bytes: 25 * 1024 * 1024 },
  { label: "50 MB per bagian", bytes: 50 * 1024 * 1024 },
  { label: "100 MB per bagian", bytes: 100 * 1024 * 1024 },
  { label: "250 MB per bagian", bytes: 250 * 1024 * 1024 },
  { label: "500 MB per bagian", bytes: 500 * 1024 * 1024 },
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
    <Dialog open onClose={onClose} size="lg" label="Unduh sebagai ZIP">
        <DialogHeader
          icon={<FolderArchive className="w-4 h-4" />}
          title="Unduh sebagai ZIP"
          description={
            selectedFolder
              ? `Isi folder "${selectedFolder.name}"`
              : `${totalFilesCount} berkas terpilih (${formatFileSize(totalSizeBytes)})`
          }
          onClose={onClose}
        />

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 text-xs">
          {/* Mode Selector */}
          <div className="space-y-2">
            <span className="text-sm font-semibold text-ink-800">Cara mengunduh</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Multipart Option */}
              <div
                onClick={() => setMode("MULTIPART")}
                className={`p-3.5 rounded-xl border-2 cursor-pointer transition ${
                  mode === "MULTIPART"
                    ? "border-accent-600 bg-accent-50/50 text-accent-950"
                    : "border-ink-200 hover:border-ink-300 bg-surface text-ink-700"
                }`}
              >
                <div className="flex items-center gap-2 font-bold mb-1">
                  <Layers className="w-4 h-4 text-accent-600" />
                  <span>Multi-Part ZIP</span>
                </div>
                <p className="text-[11px] text-ink-500">
                  Otomatis membagi berkas menjadi volume part terpisah (.zip) untuk menghindari timeout pada berkas besar.
                </p>
              </div>

              {/* Single Archive Option */}
              <div
                onClick={() => setMode("SINGLE")}
                className={`p-3.5 rounded-xl border-2 cursor-pointer transition ${
                  mode === "SINGLE"
                    ? "border-accent-600 bg-accent-50/50 text-accent-950"
                    : "border-ink-200 hover:border-ink-300 bg-surface text-ink-700"
                }`}
              >
                <div className="flex items-center gap-2 font-bold mb-1">
                  <Archive className="w-4 h-4 text-accent-600" />
                  <span>Arsip Tunggal (.zip)</span>
                </div>
                <p className="text-[11px] text-ink-500">
                  Menggabungkan semua berkas ke dalam satu file ZIP utuh. Cocok untuk total ukuran kecil (&lt; 100MB).
                </p>
              </div>
            </div>
          </div>

          {/* Multipart Configuration */}
          {mode === "MULTIPART" && (
            <div className="p-3.5 rounded-xl bg-ink-50 border border-ink-200 space-y-2">
              <label className="font-bold text-ink-800 flex items-center justify-between">
                <span>Batas Ukuran per Part (Volume Threshold):</span>
                <span className="text-accent-600 font-mono">
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
                        ? "bg-accent-600 text-accent-fg shadow-card"
                        : "bg-surface text-ink-700 border border-ink-200 hover:bg-ink-100"
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
            <label className="font-bold text-ink-800">Nama Berkas Arsip:</label>
            <input
              type="text"
              value={archiveName}
              onChange={(e) => setArchiveName(e.target.value)}
              placeholder="Contoh: Dokumen_Arsip_2026"
              className="w-full px-3.5 py-2 border border-ink-300 rounded-xl focus:ring-2 focus:ring-accent-500 focus:border-accent-500 text-ink-800 font-medium"
            />
          </div>

          {/* Session Breakdown & Part List */}
          {isPreparing ? (
            <div className="p-8 text-center text-ink-500 space-y-2 bg-ink-50 rounded-xl border border-ink-100">
              <Loader2 className="w-6 h-6 text-accent-600 animate-spin mx-auto" />
              <p className="font-medium">Menganalisis dan mempartisi berkas...</p>
            </div>
          ) : session ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between font-bold text-ink-800 border-b border-ink-200 pb-1.5">
                <span className="flex items-center gap-1.5">
                  <HardDrive className="w-4 h-4 text-accent-600" />
                  Rincian Part Arsip ({session.totalParts} Bagian)
                </span>
                <span className="text-ink-500 font-mono">
                  Total: {session.totalFiles} Berkas ({formatFileSize(session.totalSizeBytes)})
                </span>
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {session.parts.map((part) => (
                  <div
                    key={part.partIndex}
                    className="p-3 bg-ink-50 border border-ink-200 rounded-xl flex items-center justify-between gap-3 hover:bg-ink-100/70 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-accent-100 text-accent-700 font-bold flex items-center justify-center shrink-0 font-mono text-xs">
                        P{part.partIndex}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-ink-900 truncate" title={part.partName}>
                          {part.partName}
                        </p>
                        <p className="text-[11px] text-ink-500">
                          {part.files.length} berkas • {formatFileSize(part.totalBytes)}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleDownloadSinglePart(part.partIndex, part.partName, part.totalBytes)}
                      className="px-2.5 py-1.5 rounded-lg bg-surface border border-ink-200 hover:bg-accent-50 hover:border-accent-300 text-ink-700 hover:text-accent-700 font-semibold text-[11px] flex items-center gap-1 transition-colors shrink-0"
                      title="Unduh part ini secara terpisah"
                    >
                      <Download className="w-3.5 h-3.5 text-accent-600" />
                      <span>Unduh Part</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : errorMessage ? (
            <div className="p-3.5 bg-danger-50 border border-danger-200 rounded-xl text-danger-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          ) : null}
        </div>

        {/* Modal Footer Actions */}
        <div className="px-6 py-4 bg-ink-50 border-t border-ink-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-[11px] text-ink-500 flex items-center gap-1.5">
                        <span>Kemajuan unduhan tampil di pojok kanan bawah.</span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-ink-700 bg-surface border border-ink-300 hover:bg-ink-100 transition-colors w-full sm:w-auto"
            >
              Batal
            </button>

            <button
              onClick={handleDownloadAll}
              disabled={isPreparing || !session || session.parts.length === 0}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-accent-fg bg-accent-600 hover:bg-accent-700 active:bg-accent-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-card w-full sm:w-auto"
            >
              {isPreparing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowDownToLine className="w-4 h-4" />
              )}
              <span>
                {session?.parts.length === 1
                  ? "Unduh ZIP"
                  : `Unduh Semua ${session?.parts.length || 0} Part ZIP`}
              </span>
            </button>
          </div>
        </div>
    </Dialog>
  );
};
