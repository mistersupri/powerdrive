import React, { useState, useEffect, useRef } from "react";
import {
  UploadCloud,
  Pause,
  Play,
  RotateCw,
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  Zap,
  HardDrive,
  Layers,
  FileText,
  FileSpreadsheet,
  Image,
  Archive,
  Film,
  Music,
  File as FileIcon,
  Maximize2,
  Minimize2,
  ChevronUp,
} from "lucide-react";
import { FileItem } from "../types/frontend.ts";
import { api } from "../services/api.ts";

export interface UploadTask {
  id: string;
  file: globalThis.File;
  uploadId: string | null;
  status: "pending" | "uploading" | "paused" | "error" | "assembling" | "completed" | "cancelled";
  bytesSent: number;
  totalBytes: number;
  currentChunkIndex: number;
  totalChunks: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  errorMessage: string | null;
  completedRecord?: FileItem;
}

interface ChunkUploadModalProps {
  isOpen: boolean;
  targetFolderId: string;
  targetFolderName: string;
  files: globalThis.File[];
  fileConflictModes?: Map<string, "create_version" | "overwrite" | "rename" | "skip">;
  onClose: () => void;
  onUploadComplete: (completedFiles: FileItem[]) => void;
}

const CHUNK_SIZE = 1024 * 1024 * 2; // 2MB chunk for optimal throughput and quick pause/resume

export const ChunkUploadModal: React.FC<ChunkUploadModalProps> = ({
  isOpen,
  targetFolderId,
  targetFolderName,
  files,
  fileConflictModes,
  onClose,
  onUploadComplete,
}) => {
  const [viewMode, setViewMode] = useState<"compact" | "full">("compact");
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [isAllPaused, setIsAllPaused] = useState<boolean>(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  // References to keep track of active upload loops and cancellation flags
  const abortFlagsRef = useRef<Map<string, boolean>>(new Map());
  const completedRecordsRef = useRef<FileItem[]>([]);
  const isRunningRef = useRef<boolean>(false);

  // Initialize upload tasks when files are provided
  useEffect(() => {
    if (!isOpen || files.length === 0) return;

    const initialTasks: UploadTask[] = files.map((file, index) => {
      const mode = fileConflictModes?.get(file.name);
      return {
        id: `task_${Date.now()}_${index}_${file.name}`,
        file,
        uploadId: null,
        status: mode === "skip" ? "completed" : "pending",
        bytesSent: mode === "skip" ? file.size : 0,
        totalBytes: file.size,
        currentChunkIndex: 0,
        totalChunks: Math.ceil(file.size / CHUNK_SIZE) || 1,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        errorMessage: null,
      };
    });

    setTasks(initialTasks);
    completedRecordsRef.current = [];
    abortFlagsRef.current.clear();
    setIsAllPaused(false);
    setViewMode("compact");
  }, [isOpen, files, fileConflictModes]);

  // Queue runner
  useEffect(() => {
    if (!isOpen || tasks.length === 0) return;

    const runQueue = async () => {
      if (isRunningRef.current) return;
      isRunningRef.current = true;

      // Find next pending or active task
      for (const task of tasks) {
        if (task.status === "pending" && !abortFlagsRef.current.get(task.id)) {
          await processUploadTask(task.id);
        }
      }

      isRunningRef.current = false;
    };

    runQueue();
  }, [isOpen, tasks]);

  const processUploadTask = async (taskId: string) => {
    let currentTask = tasks.find((t) => t.id === taskId);
    if (!currentTask) return;

    const file = currentTask.file;
    const conflictMode = fileConflictModes?.get(file.name) || "create_version";

    if (conflictMode === "skip") {
      updateTask(taskId, { status: "completed", bytesSent: file.size });
      return;
    }

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE) || 1;
    let uploadId = currentTask.uploadId;
    let uploadedChunks = new Set<number>();

    // 1. Initialize upload session if not initialized
    if (!uploadId) {
      updateTask(taskId, { status: "uploading", errorMessage: null });
      try {
        const initRes = await api.initChunkUpload({
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || "application/octet-stream",
          folderId: targetFolderId,
          chunkSize: CHUNK_SIZE,
          totalChunks,
          conflictMode,
        });
        uploadId = initRes.uploadId;
        uploadedChunks = new Set(initRes.uploadedChunks || []);
        updateTask(taskId, { uploadId });
      } catch (err: any) {
        updateTask(taskId, {
          status: "error",
          errorMessage: err.message || "Gagal menginisialisasi sesi unggah",
        });
        return;
      }
    } else {
      // Check server for existing chunks (in case of resume)
      try {
        const statusRes = await api.getChunkUploadStatus(uploadId);
        uploadedChunks = new Set(statusRes.uploadedChunks || []);
      } catch {
        // If session was lost, restart init
        try {
          const initRes = await api.initChunkUpload({
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || "application/octet-stream",
            folderId: targetFolderId,
            chunkSize: CHUNK_SIZE,
            totalChunks,
            conflictMode,
          });
          uploadId = initRes.uploadId;
          uploadedChunks = new Set(initRes.uploadedChunks || []);
          updateTask(taskId, { uploadId });
        } catch (err: any) {
          updateTask(taskId, {
            status: "error",
            errorMessage: err.message || "Gagal memperbarui status chunk",
          });
          return;
        }
      }
    }

    updateTask(taskId, { status: "uploading", errorMessage: null });

    let lastTime = Date.now();
    let lastBytesSent = Array.from(uploadedChunks).reduce((acc, idx) => {
      const start = idx * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      return acc + (end - start);
    }, 0);

    // 2. Upload chunks sequentially
    for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
      // Check if paused or cancelled
      if (abortFlagsRef.current.get(taskId)) {
        updateTask(taskId, { status: "paused", speedBytesPerSec: 0, etaSeconds: 0 });
        return;
      }

      // Skip already uploaded chunk
      if (uploadedChunks.has(chunkIdx)) {
        continue;
      }

      const start = chunkIdx * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunkBlob = file.slice(start, end);

      try {
        let chunkLoadedBytes = 0;
        await api.uploadSingleChunk(
          uploadId,
          chunkIdx,
          chunkBlob,
          (loaded) => {
            if (abortFlagsRef.current.get(taskId)) return;
            chunkLoadedBytes = loaded;
            const currentTotalSent = lastBytesSent + chunkLoadedBytes;
            const now = Date.now();
            const timeDiff = (now - lastTime) / 1000;
            let speed = 0;
            let eta = 0;
            if (timeDiff > 0.4) {
              speed = chunkLoadedBytes / timeDiff;
              const remainingBytes = file.size - currentTotalSent;
              eta = speed > 0 ? Math.ceil(remainingBytes / speed) : 0;
            }

            updateTask(taskId, {
              bytesSent: Math.min(currentTotalSent, file.size),
              currentChunkIndex: chunkIdx + 1,
              speedBytesPerSec: speed,
              etaSeconds: eta,
            });
          }
        );

        uploadedChunks.add(chunkIdx);
        lastBytesSent += (end - start);
        lastTime = Date.now();

        updateTask(taskId, {
          bytesSent: lastBytesSent,
          currentChunkIndex: chunkIdx + 1,
        });
      } catch (err: any) {
        if (abortFlagsRef.current.get(taskId)) {
          updateTask(taskId, { status: "paused" });
          return;
        }
        updateTask(taskId, {
          status: "error",
          errorMessage: err.message || `Gagal mengirim bagian ${chunkIdx + 1}/${totalChunks}. Tekan Lanjutkan untuk mencoba lagi.`,
          speedBytesPerSec: 0,
          etaSeconds: 0,
        });
        return;
      }
    }

    // 3. Assemble and complete file
    if (abortFlagsRef.current.get(taskId)) {
      updateTask(taskId, { status: "paused" });
      return;
    }

    updateTask(taskId, {
      status: "assembling",
      bytesSent: file.size,
      speedBytesPerSec: 0,
      etaSeconds: 0,
    });

    try {
      const completeRes = await api.completeChunkUpload(uploadId);
      completedRecordsRef.current.push(completeRes.file);
      updateTask(taskId, {
        status: "completed",
        completedRecord: completeRes.file,
        bytesSent: file.size,
      });

      onUploadComplete(completedRecordsRef.current);
    } catch (err: any) {
      updateTask(taskId, {
        status: "error",
        errorMessage: err.message || "Gagal menggabungkan berkas",
      });
    }
  };

  const updateTask = (taskId: string, patch: Partial<UploadTask>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t))
    );
  };

  const handlePause = (taskId: string) => {
    abortFlagsRef.current.set(taskId, true);
    updateTask(taskId, { status: "paused", speedBytesPerSec: 0, etaSeconds: 0 });
  };

  const handleResume = (taskId: string) => {
    abortFlagsRef.current.set(taskId, false);
    updateTask(taskId, { status: "pending", errorMessage: null });
    processUploadTask(taskId);
  };

  const handleRetry = (taskId: string) => {
    abortFlagsRef.current.set(taskId, false);
    updateTask(taskId, { status: "pending", errorMessage: null });
    processUploadTask(taskId);
  };

  const handleCancelTask = async (taskId: string) => {
    abortFlagsRef.current.set(taskId, true);
    const task = tasks.find((t) => t.id === taskId);
    if (task?.uploadId) {
      try {
        await api.cancelChunkUpload(task.uploadId);
      } catch (e) {
        console.warn("Error cancelling session:", e);
      }
    }
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  };

  const handlePauseAll = () => {
    setIsAllPaused(true);
    tasks.forEach((t) => {
      if (t.status === "uploading" || t.status === "pending") {
        handlePause(t.id);
      }
    });
  };

  const handleResumeAll = () => {
    setIsAllPaused(false);
    tasks.forEach((t) => {
      if (t.status === "paused" || t.status === "error") {
        handleResume(t.id);
      }
    });
  };

  const handleRetryAllFailed = () => {
    tasks.forEach((t) => {
      if (t.status === "error" || t.status === "cancelled") {
        handleRetry(t.id);
      }
    });
  };

  if (!isOpen) return null;

  // Aggregate stats
  const totalBatchBytes = tasks.reduce((acc, t) => acc + t.totalBytes, 0);
  const totalBatchSent = tasks.reduce((acc, t) => acc + t.bytesSent, 0);
  const overallPercentage = totalBatchBytes > 0 ? Math.min(100, (totalBatchSent / totalBatchBytes) * 100) : 0;
  const activeSpeed = tasks.reduce((acc, t) => acc + (t.status === "uploading" ? t.speedBytesPerSec : 0), 0);
  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const errorCount = tasks.filter((t) => t.status === "error").length;
  const isAllDone = tasks.length > 0 && completedCount === tasks.length;
  const currentActiveTask = tasks.find((t) => t.status === "uploading" || t.status === "assembling") || tasks.find((t) => t.status === "pending") || tasks[0];

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec <= 0) return "0 KB/s";
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
  };

  const formatEta = (seconds: number) => {
    if (seconds <= 0) return "--";
    if (seconds < 60) return `${seconds} dtk`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext === "pdf") return <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-rose-500 shrink-0" />;
    if (["xls", "xlsx", "csv"].includes(ext || "")) return <FileSpreadsheet className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500 shrink-0" />;
    if (["jpg", "jpeg", "png", "webp", "svg"].includes(ext || "")) return <Image className="w-4 h-4 sm:w-5 sm:h-5 text-purple-500 shrink-0" />;
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext || "")) return <Archive className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500 shrink-0" />;
    if (["mp4", "mkv", "avi", "mov"].includes(ext || "")) return <Film className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-500 shrink-0" />;
    if (["mp3", "wav"].includes(ext || "")) return <Music className="w-4 h-4 sm:w-5 sm:h-5 text-pink-500 shrink-0" />;
    return <FileIcon className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 shrink-0" />;
  };

  // ==========================================
  // 1. COMPACT PROGRESS DIALOG (Default)
  // Desktop: bottom-right (md:bottom-4 md:right-4)
  // Mobile: bottom above nav bar (bottom-16 left-3 right-3)
  // ==========================================
  if (viewMode === "compact") {
    return (
      <div className="fixed bottom-16 left-3 right-3 sm:left-auto sm:right-4 sm:w-[420px] md:bottom-4 md:right-4 z-40 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-slideUp">
        {/* Compact Header */}
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
              {isAllDone ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : errorCount > 0 ? (
                <AlertCircle className="w-4 h-4 text-rose-400" />
              ) : (
                <RotateCw className="w-4 h-4 text-indigo-400 animate-spin" />
              )}
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-white flex items-center gap-1.5 truncate">
                <span>{isAllDone ? "Unggahan Selesai" : `Mengunggah ${tasks.length} Berkas`}</span>
                <span className="px-1.5 py-0.2 rounded-full bg-indigo-600 text-[10px] font-mono shrink-0">
                  {overallPercentage.toFixed(0)}%
                </span>
              </h4>
              <p className="text-[10px] text-slate-400 truncate">
                Folder: {targetFolderName} • {completedCount}/{tasks.length} selesai
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Detail Button to switch to Full Dialog */}
            <button
              onClick={() => setViewMode("full")}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-medium border border-slate-700 transition-colors cursor-pointer"
              title="Buka dialog penuh dengan rincian lengkap per bagian berkas"
            >
              <Maximize2 className="w-3.5 h-3.5 text-indigo-400" />
              <span className="font-semibold">Detail</span>
            </button>

            {!isAllDone && (
              isAllPaused ? (
                <button
                  onClick={handleResumeAll}
                  className="p-1 text-slate-300 hover:text-emerald-400 rounded transition-colors cursor-pointer"
                  title="Lanjutkan Semua"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                </button>
              ) : (
                <button
                  onClick={handlePauseAll}
                  className="p-1 text-slate-300 hover:text-amber-400 rounded transition-colors cursor-pointer"
                  title="Jeda Semua"
                >
                  <Pause className="w-3.5 h-3.5 fill-current" />
                </button>
              )
            )}

            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-white rounded transition-colors cursor-pointer"
              title="Tutup Jendela"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Compact Body */}
        <div className="p-3.5 space-y-3 bg-white">
          {/* Real-time Aggregate Progress Bar */}
          <div className="space-y-1.5">
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  isAllDone
                    ? "bg-emerald-500"
                    : isAllPaused
                    ? "bg-amber-400"
                    : "bg-indigo-600 bg-[linear-gradient(45deg,rgba(255,255,255,0.2)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.2)_50%,rgba(255,255,255,0.2)_75%,transparent_75%,transparent)] bg-[length:1rem_1rem] animate-[move-bg_1s_linear_infinite]"
                }`}
                style={{ width: `${overallPercentage}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
              <span>
                {formatFileSize(totalBatchSent)} / {formatFileSize(totalBatchBytes)} ({overallPercentage.toFixed(1)}%)
              </span>
              <span>
                {activeSpeed > 0 ? (
                  `${formatSpeed(activeSpeed)} • sisa ${formatEta(currentActiveTask?.etaSeconds || 0)}`
                ) : isAllDone ? (
                  "100% Selesai"
                ) : (
                  "Resumable Chunk"
                )}
              </span>
            </div>
          </div>

          {/* Current Active File Preview */}
          {currentActiveTask && (
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {getFileIcon(currentActiveTask.file.name)}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-800 truncate" title={currentActiveTask.file.name}>
                    {currentActiveTask.file.name}
                  </p>
                  <p className="text-[10px] text-slate-400 font-mono truncate">
                    {currentActiveTask.status === "completed"
                      ? "Unggahan berhasil diverifikasi"
                      : currentActiveTask.status === "assembling"
                      ? "Menyusun potongan berkas..."
                      : `Bagian ${currentActiveTask.currentChunkIndex}/${currentActiveTask.totalChunks} chunk • ${formatFileSize(currentActiveTask.bytesSent)} / ${formatFileSize(currentActiveTask.totalBytes)}`}
                  </p>
                </div>
              </div>

              <div className="shrink-0">
                {currentActiveTask.status === "completed" ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Selesai
                  </span>
                ) : currentActiveTask.status === "uploading" ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200 animate-pulse">
                    <Zap className="w-3 h-3 text-indigo-600" /> Mengunggah
                  </span>
                ) : currentActiveTask.status === "assembling" ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                    Menyusun
                  </span>
                ) : currentActiveTask.status === "paused" ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                    Dijeda
                  </span>
                ) : currentActiveTask.status === "error" ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                    Galat
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-500 font-semibold bg-slate-100 px-2 py-0.5 rounded-full">
                    Antrean
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Error Notice in Compact View */}
          {errorCount > 0 && (
            <div className="p-2 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-between text-xs text-rose-700">
              <div className="flex items-center gap-1.5 truncate">
                <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span className="truncate">{errorCount} berkas gagal diunggah</span>
              </div>
              <button
                onClick={handleRetryAllFailed}
                className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold shrink-0 transition-colors cursor-pointer"
              >
                Coba Lagi
              </button>
            </div>
          )}

          {/* Compact Footer Action Bar */}
          <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
            <button
              onClick={() => setViewMode("full")}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer py-0.5"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Lihat Rincian Lengkap ({tasks.length} Berkas)</span>
            </button>

            {isAllDone && (
              <button
                onClick={onClose}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer shadow-xs"
              >
                Selesai
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // 2. FULL PROGRESS DIALOG (When Detail is opened)
  // Replaces the compact dialog with the comprehensive full view
  // ==========================================
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-scaleUp">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center shadow-xs shrink-0">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 tracking-tight truncate">
                Pengunggahan Berkas Chunk Resumable
              </h3>
              <p className="text-xs text-slate-500 truncate">
                Target Folder: <strong className="text-slate-700">{targetFolderName}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Button to minimize back to compact mode */}
            <button
              onClick={() => setViewMode("compact")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer"
              title="Kecilkan ke mode compact di pojok kanan bawah"
            >
              <Minimize2 className="w-3.5 h-3.5 text-slate-600" />
              <span>Kecilkan</span>
            </button>

            {errorCount > 0 && (
              <button
                onClick={handleRetryAllFailed}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                title="Coba lagi semua berkas yang gagal"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Coba Lagi ({errorCount})
              </button>
            )}

            {!isAllDone && (
              isAllPaused ? (
                <button
                  onClick={handleResumeAll}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Lanjutkan Semua
                </button>
              ) : (
                <button
                  onClick={handlePauseAll}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer"
                >
                  <Pause className="w-3.5 h-3.5 fill-current" />
                  Jeda Semua
                </button>
              )
            )}

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
              title="Tutup Jendela"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Real-time Aggregate Progress Bar Banner */}
        <div className="p-5 border-b border-slate-100 bg-white">
          <div className="flex items-center justify-between text-xs mb-2 font-medium">
            <div className="flex items-center gap-2 text-slate-800">
              <HardDrive className="w-4 h-4 text-indigo-600" />
              <span>
                Total Terkirim: <strong className="font-semibold text-slate-900">{formatFileSize(totalBatchSent)}</strong> / {formatFileSize(totalBatchBytes)}
              </span>
              <span className="text-indigo-600 font-bold ml-1">
                ({overallPercentage.toFixed(1)}%)
              </span>
            </div>

            <div className="flex items-center gap-4 text-slate-500 text-[11px]">
              <span className="inline-flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-amber-500" /> {formatSpeed(activeSpeed)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" /> {isAllDone ? "Selesai" : "Mengunggah..."}
              </span>
            </div>
          </div>

          {/* Animated Progress Bar */}
          <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden relative">
            <div
              className={`h-full transition-all duration-300 rounded-full ${
                isAllDone
                  ? "bg-emerald-500"
                  : isAllPaused
                  ? "bg-amber-400"
                  : "bg-indigo-600 shadow-sm shadow-indigo-600/30"
              }`}
              style={{ width: `${overallPercentage}%` }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <Layers className="w-3 h-3 text-slate-400" />
              Potongan chunk 2MB otomatis dengan integritas SHA-256
            </span>
            <span>
              {completedCount} dari {tasks.length} berkas selesai
            </span>
          </div>
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3 divide-y divide-slate-100">
          {tasks.map((task) => {
            const taskPct = task.totalBytes > 0 ? Math.min(100, (task.bytesSent / task.totalBytes) * 100) : 0;

            return (
              <div key={task.id} className="pt-3 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="mt-0.5">{getFileIcon(task.file.name)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold text-slate-800 truncate" title={task.file.name}>
                          {task.file.name}
                        </p>
                        {task.status === "completed" && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Selesai
                          </span>
                        )}
                        {task.status === "uploading" && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 animate-pulse">
                            Mengunggah
                          </span>
                        )}
                        {task.status === "assembling" && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                            Menyusun Berkas...
                          </span>
                        )}
                        {task.status === "paused" && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            Dijeda
                          </span>
                        )}
                        {task.status === "error" && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                            Galat Jaringan
                          </span>
                        )}
                      </div>

                      {/* File Progress Details */}
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                        <span>
                          {formatFileSize(task.bytesSent)} / {formatFileSize(task.totalBytes)} ({taskPct.toFixed(1)}%)
                        </span>
                        <span>•</span>
                        <span>
                          Bagian {task.currentChunkIndex} dari {task.totalChunks} chunk
                        </span>
                        {task.status === "uploading" && (
                          <>
                            <span>•</span>
                            <span className="text-slate-700 font-mono font-medium">
                              {formatSpeed(task.speedBytesPerSec)}
                            </span>
                            <span>•</span>
                            <span>Sisa {formatEta(task.etaSeconds)}</span>
                          </>
                        )}
                      </div>

                      {/* Per-file Progress Bar */}
                      <div className="mt-2 w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-200 ${
                            task.status === "completed"
                              ? "bg-emerald-500"
                              : task.status === "error"
                              ? "bg-rose-500"
                              : task.status === "paused"
                              ? "bg-amber-400"
                              : "bg-indigo-600"
                          }`}
                          style={{ width: `${taskPct}%` }}
                        />
                      </div>

                      {/* Error Message display */}
                      {task.errorMessage && (
                        <div className="mt-2 p-2 rounded bg-rose-50 border border-rose-200 text-rose-800 text-[11px] flex items-start gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                          <span>{task.errorMessage}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Per-item Action Buttons */}
                  <div className="flex items-center gap-1">
                    {task.status === "uploading" && (
                      <button
                        onClick={() => handlePause(task.id)}
                        className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                        title="Jeda Pengunggahan"
                      >
                        <Pause className="w-4 h-4" />
                      </button>
                    )}

                    {task.status === "paused" && (
                      <button
                        onClick={() => handleResume(task.id)}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                        title="Lanjutkan Pengunggahan"
                      >
                        <Play className="w-4 h-4" />
                      </button>
                    )}

                    {task.status === "error" && (
                      <button
                        onClick={() => handleRetry(task.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors cursor-pointer"
                        title="Coba Lagi Pengunggahan"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                        <span>Coba Lagi</span>
                      </button>
                    )}

                    {task.status !== "completed" && (
                      <button
                        onClick={() => handleCancelTask(task.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        title="Batalkan Berkas"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {isAllDone ? (
              <span className="text-emerald-700 font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Seluruh berkas berhasil diunggah dan diverifikasi!
              </span>
            ) : (
              <span>Dukungan otomatis jeda &amp; lanjutkan saat koneksi internet terputus.</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode("compact")}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              Mode Kompak
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer"
            >
              {isAllDone ? "Selesai" : "Tutup Jendela"}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
