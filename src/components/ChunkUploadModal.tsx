import React, { useState } from "react";
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
import { useTransfer, UploadTask } from "../context/TransferContext.tsx";

interface ChunkUploadModalProps {
  isOpen?: boolean;
  targetFolderId?: string;
  targetFolderName?: string;
  files?: globalThis.File[];
  fileConflictModes?: Map<string, "create_version" | "overwrite" | "rename" | "skip">;
  onClose?: () => void;
  onUploadComplete?: (completedFiles: any[]) => void;
}

export const ChunkUploadModal: React.FC<ChunkUploadModalProps> = () => {
  const {
    chunkSession,
    setChunkSessionViewMode,
    closeChunkSession,
    pauseChunkTask,
    resumeChunkTask,
    retryChunkTask,
    cancelChunkTask,
    pauseAllChunkTasks,
    resumeAllChunkTasks,
    retryAllFailedChunkTasks,
  } = useTransfer();

  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  if (!chunkSession || !chunkSession.isOpen || chunkSession.tasks.length === 0) {
    return null;
  }

  const { viewMode, targetFolderName, tasks, isAllPaused } = chunkSession;

  // Aggregate statistics
  const totalBatchBytes = tasks.reduce((acc, t) => acc + t.totalBytes, 0);
  const totalBatchSent = tasks.reduce((acc, t) => acc + t.bytesSent, 0);
  const overallPercentage =
    totalBatchBytes > 0 ? Math.min(100, (totalBatchSent / totalBatchBytes) * 100) : 0;
  const activeSpeed = tasks.reduce(
    (acc, t) => acc + (t.status === "uploading" ? t.speedBytesPerSec : 0),
    0
  );
  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const errorCount = tasks.filter((t) => t.status === "error").length;
  const isAllDone = tasks.length > 0 && completedCount === tasks.length;
  const currentActiveTask =
    tasks.find((t) => t.status === "uploading" || t.status === "assembling") ||
    tasks.find((t) => t.status === "pending") ||
    tasks[0];

  const formatFileSize = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
    if (["xls", "xlsx", "csv"].includes(ext || ""))
      return <FileSpreadsheet className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500 shrink-0" />;
    if (["jpg", "jpeg", "png", "webp", "svg"].includes(ext || ""))
      return <Image className="w-4 h-4 sm:w-5 sm:h-5 text-purple-500 shrink-0" />;
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext || ""))
      return <Archive className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500 shrink-0" />;
    if (["mp4", "mkv", "avi", "mov"].includes(ext || ""))
      return <Film className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-500 shrink-0" />;
    if (["mp3", "wav"].includes(ext || ""))
      return <Music className="w-4 h-4 sm:w-5 sm:h-5 text-pink-500 shrink-0" />;
    return <FileIcon className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 shrink-0" />;
  };

  // ==========================================
  // 1. COMPACT PROGRESS DIALOG (Floating Dock - Resilient to Navigation)
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
                Folder: <span className="text-slate-200 font-medium">{targetFolderName}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Expand to Full Detail Modal Button */}
            <button
              onClick={() => setChunkSessionViewMode("full")}
              className="px-2.5 py-1 text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
              title="Buka rincian lengkap chunk upload"
            >
              <Maximize2 className="w-3 h-3" />
              <span className="hidden sm:inline">Rincian</span>
            </button>

            {/* Quick Pause/Resume All */}
            {!isAllDone && (
              isAllPaused ? (
                <button
                  onClick={resumeAllChunkTasks}
                  className="p-1 text-emerald-400 hover:text-emerald-300 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                  title="Lanjutkan Semua"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                </button>
              ) : (
                <button
                  onClick={pauseAllChunkTasks}
                  className="p-1 text-amber-400 hover:text-amber-300 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                  title="Jeda Semua"
                >
                  <Pause className="w-3.5 h-3.5 fill-current" />
                </button>
              )
            )}

            {/* Close or dismiss */}
            <button
              onClick={closeChunkSession}
              className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title={isAllDone ? "Tutup" : "Sembunyikan / Batal"}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Compact Progress Bar */}
        <div className="p-3 bg-white space-y-2">
          <div className="space-y-1">
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  isAllDone
                    ? "bg-emerald-500"
                    : isAllPaused
                    ? "bg-amber-400"
                    : errorCount > 0
                    ? "bg-rose-500"
                    : "bg-indigo-600"
                }`}
                style={{ width: `${overallPercentage}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
              <span className="truncate">
                {formatFileSize(totalBatchSent)} / {formatFileSize(totalBatchBytes)}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {!isAllDone && activeSpeed > 0 && (
                  <span className="text-indigo-600 font-semibold">{formatSpeed(activeSpeed)}</span>
                )}
                <span>
                  {completedCount}/{tasks.length} selesai
                </span>
              </div>
            </div>
          </div>

          {/* Currently Uploading File Line */}
          {currentActiveTask && !isAllDone && (
            <div className="flex items-center justify-between gap-2 p-2 bg-slate-50 rounded-xl text-[11px] border border-slate-100">
              <div className="flex items-center gap-2 min-w-0">
                {getFileIcon(currentActiveTask.file.name)}
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 truncate" title={currentActiveTask.file.name}>
                    {currentActiveTask.file.name}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Chunk {currentActiveTask.currentChunkIndex}/{currentActiveTask.totalChunks}
                    {currentActiveTask.etaSeconds > 0 && ` • Sisa ${formatEta(currentActiveTask.etaSeconds)}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {currentActiveTask.status === "uploading" && (
                  <button
                    onClick={() => pauseChunkTask(currentActiveTask.id)}
                    className="p-1 text-slate-400 hover:text-amber-600 rounded transition-colors cursor-pointer"
                    title="Jeda berkas ini"
                  >
                    <Pause className="w-3.5 h-3.5" />
                  </button>
                )}
                {currentActiveTask.status === "paused" && (
                  <button
                    onClick={() => resumeChunkTask(currentActiveTask.id)}
                    className="p-1 text-slate-400 hover:text-emerald-600 rounded transition-colors cursor-pointer"
                    title="Lanjutkan berkas ini"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                )}
                {currentActiveTask.status === "error" && (
                  <button
                    onClick={() => retryChunkTask(currentActiveTask.id)}
                    className="p-1 text-slate-400 hover:text-indigo-600 rounded transition-colors cursor-pointer"
                    title="Coba lagi berkas ini"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          {errorCount > 0 && (
            <div className="flex items-center justify-between text-[11px] text-rose-600 bg-rose-50 px-2.5 py-1.5 rounded-lg border border-rose-200">
              <span className="flex items-center gap-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {errorCount} berkas gagal diunggah
              </span>
              <button
                onClick={retryAllFailedChunkTasks}
                className="text-xs font-bold underline hover:text-rose-800 cursor-pointer"
              >
                Coba Lagi
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==========================================
  // 2. FULL PROGRESS DIALOG (Modal View)
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
                Pengunggahan Berkas Resumable (Chunked)
              </h3>
              <p className="text-xs text-slate-500 truncate">
                Target Folder: <strong className="text-slate-700">{targetFolderName}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Button to minimize back to compact mode */}
            <button
              onClick={() => setChunkSessionViewMode("compact")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer"
              title="Kecilkan ke mode floating dock di pojok kanan bawah"
            >
              <Minimize2 className="w-3.5 h-3.5 text-slate-600" />
              <span>Kecilkan</span>
            </button>

            {errorCount > 0 && (
              <button
                onClick={retryAllFailedChunkTasks}
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
                  onClick={resumeAllChunkTasks}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Lanjutkan Semua
                </button>
              ) : (
                <button
                  onClick={pauseAllChunkTasks}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer"
                >
                  <Pause className="w-3.5 h-3.5 fill-current" />
                  Jeda Semua
                </button>
              )
            )}

            <button
              onClick={closeChunkSession}
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
              Potongan chunk 2MB otomatis dengan integritas data SHA-256
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
                        onClick={() => pauseChunkTask(task.id)}
                        className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                        title="Jeda Pengunggahan"
                      >
                        <Pause className="w-4 h-4" />
                      </button>
                    )}

                    {task.status === "paused" && (
                      <button
                        onClick={() => resumeChunkTask(task.id)}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                        title="Lanjutkan Pengunggahan"
                      >
                        <Play className="w-4 h-4" />
                      </button>
                    )}

                    {task.status === "error" && (
                      <button
                        onClick={() => retryChunkTask(task.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors cursor-pointer"
                        title="Coba Lagi Pengunggahan"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                        <span>Coba Lagi</span>
                      </button>
                    )}

                    {task.status !== "completed" && (
                      <button
                        onClick={() => cancelChunkTask(task.id)}
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
      </div>
    </div>
  );
};
