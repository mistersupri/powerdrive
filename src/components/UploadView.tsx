import React, { useState, useRef, useEffect } from "react";
import {
  UploadCloud,
  Folder,
  File,
  FileText,
  FileSpreadsheet,
  FileCode,
  Image,
  Film,
  Music,
  Archive,
  X,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  HardDrive,
  Info,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Folder as FolderType, FileItem } from "../types/frontend.ts";
import { api } from "../services/api.ts";
import { ChunkUploadModal } from "./ChunkUploadModal.tsx";

interface UploadViewProps {
  folders: FolderType[];
  onUploadSuccess: (uploadedFiles: FileItem[]) => void;
  onNavigateToFiles: () => void;
  onNavigateToFolders: () => void;
}

export const UploadView: React.FC<UploadViewProps> = ({
  folders,
  onUploadSuccess,
  onNavigateToFiles,
  onNavigateToFolders,
}) => {
  const [selectedFolderId, setSelectedFolderId] = useState<string>(folders[0]?.id || "");
  const [selectedFiles, setSelectedFiles] = useState<globalThis.File[]>([]);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isChunkModalOpen, setIsChunkModalOpen] = useState<boolean>(false);
  const [uploadFilesForModal, setUploadFilesForModal] = useState<globalThis.File[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recentUploads, setRecentUploads] = useState<FileItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!selectedFolderId && folders.length > 0) {
      setSelectedFolderId(folders[0].id);
    }
  }, [folders, selectedFolderId]);

  const selectedFolder = folders.find((f) => f.id === selectedFolderId);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getFileIcon = (fileName: string, mimeType: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext === "pdf") return <FileText className="w-5 h-5 text-rose-500" />;
    if (["xls", "xlsx", "csv"].includes(ext || "")) return <FileSpreadsheet className="w-5 h-5 text-emerald-500" />;
    if (["doc", "docx"].includes(ext || "")) return <FileText className="w-5 h-5 text-blue-500" />;
    if (["jpg", "jpeg", "png", "webp", "svg"].includes(ext || "")) return <Image className="w-5 h-5 text-purple-500" />;
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext || "")) return <Archive className="w-5 h-5 text-amber-500" />;
    if (["mp4", "mkv", "avi", "mov"].includes(ext || "")) return <Film className="w-5 h-5 text-indigo-500" />;
    if (["mp3", "wav", "flac"].includes(ext || "")) return <Music className="w-5 h-5 text-pink-500" />;
    return <File className="w-5 h-5 text-slate-400" />;
  };

  const handleFilesAdded = (newFiles: FileList | globalThis.File[]) => {
    setErrorMessage(null);
    const addedArray = Array.from(newFiles);
    
    // Check 2GB limit per file for chunked upload
    const maxSizeBytes = 2048 * 1024 * 1024;
    for (const f of addedArray) {
      if (f.size > maxSizeBytes) {
        setErrorMessage(`Berkas "${f.name}" melebihi batas ukuran maksimal 2GB (${formatFileSize(f.size)}).`);
        return;
      }
    }

    // Merge distinct files
    setSelectedFiles((prev) => {
      const existingNames = new Set(prev.map((p) => p.name));
      const filtered = addedArray.filter((f) => !existingNames.has(f.name));
      return [...prev, ...filtered];
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesAdded(e.dataTransfer.files);
    }
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUploadSubmit = () => {
    if (!selectedFolderId) {
      setErrorMessage("Silakan pilih folder tujuan terlebih dahulu.");
      return;
    }

    if (selectedFiles.length === 0) {
      setErrorMessage("Silakan pilih atau tarik berkas untuk diunggah.");
      return;
    }

    setErrorMessage(null);
    setUploadFilesForModal([...selectedFiles]);
    setIsChunkModalOpen(true);
  };

  const handleChunkUploadComplete = (completed: FileItem[]) => {
    setRecentUploads(completed);
    setSelectedFiles([]);
    onUploadSuccess(completed);
  };

  const totalBatchSize = selectedFiles.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="space-y-6">
      
      {/* Top Banner & Folder Target Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-indigo-600" />
              Unggah Berkas ke Portal &amp; Sinkronisasi Otomatis
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Berkas disimpan aman pada buffer lokal terenkripsi SHA-256 dan disinkronkan langsung ke Google Drive sesuai hierarki folder.
            </p>
          </div>

          {/* Target Folder Selector */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <label className="text-xs font-semibold text-slate-700 whitespace-nowrap">
              Folder Tujuan:
            </label>
            {folders.length > 0 ? (
              <select
                value={selectedFolderId}
                onChange={(e) => setSelectedFolderId(e.target.value)}
                className="w-full sm:w-72 px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    📁 {f.name} ({f.targetFolderPath})
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-amber-600 font-medium">Belum ada folder aktif</span>
                <button
                  onClick={onNavigateToFolders}
                  className="px-2.5 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors"
                >
                  + Buat Folder
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Selected Folder Metadata Pill */}
        {selectedFolder && (
          <div className="mt-4 pt-3.5 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="font-medium text-slate-700">Target Google Drive:</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-50/80 text-indigo-700 font-mono text-[11px] border border-indigo-100">
              <Folder className="w-3.5 h-3.5 text-indigo-500" />
              {selectedFolder.targetFolderPath}
            </span>
            <span className="text-slate-400">•</span>
            <span>Tipe Drive: <strong className="text-slate-700">{selectedFolder.targetDriveType}</strong></span>
            {selectedFolder.description && (
              <>
                <span className="text-slate-400">•</span>
                <span className="text-slate-500 italic">{selectedFolder.description}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-3 text-xs animate-fadeIn">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <strong className="font-semibold">Terjadi Kesalahan:</strong> {errorMessage}
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-rose-500 hover:text-rose-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Drag and Drop Zone or No Folder Warning */}
      {folders.length === 0 ? (
        <div className="border-2 border-dashed border-amber-200 bg-amber-50/50 rounded-2xl p-8 sm:p-12 text-center shadow-xs">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-4 shadow-inner">
            <Folder className="w-7 h-7" />
          </div>
          <h3 className="text-base font-semibold text-slate-800 tracking-tight">
            Belum Ada Folder Aktif
          </h3>
          <p className="text-xs text-slate-600 mt-1 max-w-md mx-auto">
            Anda harus membuat setidaknya satu folder tujuan sebelum dapat mengunggah berkas ke portal ini.
          </p>
          <div className="mt-5">
            <button
              onClick={onNavigateToFolders}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm shadow-indigo-600/30 transition-all cursor-pointer"
            >
              <span>+ Buat Folder Sekarang</span>
            </button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer transition-all duration-200 ${
            isDragging
              ? "border-indigo-500 bg-indigo-50/50 scale-[1.005]"
              : "border-slate-300 hover:border-indigo-400 bg-white hover:bg-slate-50/60 shadow-xs"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => e.target.files && handleFilesAdded(e.target.files)}
            className="hidden"
          />

          <div className="w-14 h-14 rounded-2xl bg-indigo-100/70 text-indigo-600 flex items-center justify-center mx-auto mb-4 shadow-inner">
            <UploadCloud className="w-7 h-7" />
          </div>

          <h3 className="text-base font-semibold text-slate-800 tracking-tight">
            Tarik &amp; Letakkan Berkas di Sini, atau <span className="text-indigo-600 underline">Pilih Berkas</span>
          </h3>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            Mendukung semua format dokumen (PDF, Word, Excel, ZIP, Gambar, Video). Maksimal <strong>200 MB per berkas</strong>.
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded-md">
              <ShieldCheck className="w-3 h-3 text-emerald-600" /> Hash SHA-256 Otomatis
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded-md">
              <HardDrive className="w-3 h-3 text-blue-600" /> Buffer Lokal Partisi Tanggal
            </span>
          </div>
        </div>
      )}

      {/* Selected Files Queue Staging List */}
      {selectedFiles.length > 0 && folders.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold text-slate-800">
                Antrean Berkas Siap Diunggah ({selectedFiles.length})
              </h4>
              <span className="text-xs text-slate-500 font-medium">
                • Total: {formatFileSize(totalBatchSize)}
              </span>
            </div>
            <button
              onClick={() => setSelectedFiles([])}
              className="text-xs text-rose-600 hover:text-rose-700 font-medium"
            >
              Hapus Semua
            </button>
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {selectedFiles.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 hover:bg-slate-100/70 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {getFileIcon(file.name, file.type)}
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800 truncate">{file.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {formatFileSize(file.size)} • {file.type || "Berkas Binary"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveFile(index)}
                  className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Action Upload Trigger */}
          <div className="mt-5 pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              Folder Tujuan: <strong className="text-slate-800">{selectedFolder?.name}</strong>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <button
                onClick={() => setSelectedFiles([])}
                className="w-1/2 sm:w-auto px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handleUploadSubmit}
                disabled={selectedFiles.length === 0}
                className="w-1/2 sm:w-auto px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 rounded-lg shadow-sm shadow-indigo-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <UploadCloud className="w-4 h-4" />
                <span>Mulai Unggah ({selectedFiles.length} Berkas)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resumable Chunk Upload Modal */}
      {selectedFolder && (
        <ChunkUploadModal
          isOpen={isChunkModalOpen}
          targetFolderId={selectedFolder.id}
          targetFolderName={selectedFolder.name}
          files={uploadFilesForModal}
          onClose={() => setIsChunkModalOpen(false)}
          onUploadComplete={handleChunkUploadComplete}
        />
      )}

      {/* Success Recent Uploads Notification */}
      {recentUploads.length > 0 && (
        <div className="bg-emerald-50/70 rounded-xl border border-emerald-200 p-5 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span>{recentUploads.length} Berkas Berhasil Diunggah ke Buffer Lokal!</span>
            </div>
            <button
              onClick={() => setRecentUploads([])}
              className="text-emerald-600 hover:text-emerald-800 text-xs"
            >
              Tutup
            </button>
          </div>
          
          <p className="text-xs text-emerald-700 mt-1">
            Checksum SHA-256 telah diverifikasi. Pekerjaan sinkronisasi Google Drive telah dimasukkan ke antrean sistem.
          </p>

          <div className="mt-3 space-y-1.5">
            {recentUploads.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between p-2 rounded-lg bg-white/80 border border-emerald-200 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-slate-800 truncate">{f.originalName}</span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    SHA: {f.checksumSha256.substring(0, 10)}...
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                  {f.syncStatus}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-end">
            <button
              onClick={onNavigateToFiles}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 rounded-lg transition-colors"
            >
              <span>Pantau Status Sinkronisasi di Daftar Berkas</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
