import React, { useState } from "react";
import {
  Download,
  UploadCloud,
  Archive,
  X,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  Clock,
  Zap,
  RotateCw,
  Trash2,
  Maximize2,
  Minimize2,
  HardDrive,
} from "lucide-react";
import { useTransfer } from "../context/TransferContext.tsx";
import { ActiveTransfer, TransferType } from "../types/frontend.ts";

export const TransferHUD: React.FC = () => {
  const {
    transfers,
    isHubOpen,
    setIsHubOpen,
    activeCount,
    cancelTransfer,
    clearCompleted,
    removeTransfer,
    startFileDownload,
  } = useTransfer();

  const [isMinimized, setIsMinimized] = useState<boolean>(false);

  if (transfers.length === 0) {
    return null;
  }

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatSpeed = (speedBytes: number) => {
    if (!speedBytes || speedBytes === 0) return "0 KB/s";
    if (speedBytes < 1024 * 1024) return `${(speedBytes / 1024).toFixed(1)} KB/s`;
    return `${(speedBytes / (1024 * 1024)).toFixed(2)} MB/s`;
  };

  const formatEta = (seconds: number) => {
    if (!seconds || seconds <= 0) return "Menyelesaikan...";
    if (seconds < 60) return `${seconds}s tersisa`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s tersisa`;
  };

  const getTransferIcon = (type: TransferType) => {
    switch (type) {
      case "UPLOAD":
        return <UploadCloud className="w-4 h-4 text-indigo-500 shrink-0" />;
      case "MULTIPART_ZIP":
        return <Archive className="w-4 h-4 text-amber-500 shrink-0" />;
      case "DOWNLOAD":
      default:
        return <Download className="w-4 h-4 text-blue-500 shrink-0" />;
    }
  };

  const getStatusBadge = (transfer: ActiveTransfer) => {
    switch (transfer.status) {
      case "COMPLETED":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Selesai
          </span>
        );
      case "ACTIVE":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200 animate-pulse">
            <Zap className="w-3 h-3 text-blue-600" />
            {transfer.type === "UPLOAD" ? "Mengunggah" : "Mengunduh"} ({transfer.percentage}%)
          </span>
        );
      case "ERROR":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
            <AlertCircle className="w-3 h-3 text-rose-600" />
            Gagal
          </span>
        );
      case "CANCELLED":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
            Dibatalkan
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-full">
            <Clock className="w-3 h-3" />
            Antrean
          </span>
        );
    }
  };

  // Minimized floating dock pill
  if (isMinimized) {
    const activeItem = transfers.find((t) => t.status === "ACTIVE");
    return (
      <div className="fixed bottom-16 left-3 right-3 sm:left-auto sm:right-4 sm:w-auto md:bottom-4 md:right-4 z-40 animate-fadeIn">
        <button
          onClick={() => setIsMinimized(false)}
          className="flex items-center gap-3 px-4 py-2.5 rounded-full bg-slate-900 text-white shadow-xl hover:bg-slate-800 border border-slate-700 transition-all text-xs font-semibold w-full sm:w-auto justify-between sm:justify-start"
        >
          <div className="flex items-center gap-2.5">
            {activeCount > 0 ? (
              <RotateCw className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}

            <span className="truncate">
              {activeCount > 0
                ? `${activeCount} Transfer Berjalan (${activeItem?.percentage || 0}%)`
                : `${transfers.length} Transfer Selesai`}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeItem && activeItem.speedBytesPerSec > 0 && (
              <span className="text-[11px] text-blue-300 font-mono bg-slate-800 px-2 py-0.5 rounded-full">
                {formatSpeed(activeItem.speedBytesPerSec)}
              </span>
            )}

            <ChevronUp className="w-4 h-4 text-slate-400 ml-1" />
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-16 left-3 right-3 sm:left-auto sm:right-4 sm:w-96 md:bottom-4 md:right-4 z-40 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-slideUp">
      {/* Header */}
      <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center">
            {activeCount > 0 ? (
              <Zap className="w-4 h-4 text-blue-400 animate-pulse" />
            ) : (
              <HardDrive className="w-4 h-4 text-emerald-400" />
            )}
          </div>
          <div>
            <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
              <span>Pusat Transfer Berkas</span>
              {activeCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-blue-600 text-[10px] font-mono">
                  {activeCount}
                </span>
              )}
            </h4>
            <p className="text-[10px] text-slate-400">Real-time Speed &amp; Progress</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {transfers.some((t) => t.status === "COMPLETED" || t.status === "CANCELLED" || t.status === "ERROR") && (
            <button
              onClick={clearCompleted}
              className="p-1 text-slate-400 hover:text-white rounded transition-colors text-[10px] px-1.5"
              title="Bersihkan riwayat selesai"
            >
              Bersihkan
            </button>
          )}

          <button
            onClick={() => setIsMinimized(true)}
            className="p-1 text-slate-400 hover:text-white rounded transition-colors"
            title="Kecilkan"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => {
              if (activeCount === 0) {
                clearCompleted();
              } else {
                setIsMinimized(true);
              }
            }}
            className="p-1 text-slate-400 hover:text-white rounded transition-colors"
            title="Tutup"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Transfer List Container */}
      <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 p-1">
        {transfers.map((item) => {
          const isActive = item.status === "ACTIVE";

          return (
            <div key={item.id} className="p-3 hover:bg-slate-50/80 transition-colors rounded-xl space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <div className="mt-0.5">{getTransferIcon(item.type)}</div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 truncate" title={item.title}>
                      {item.title}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">
                      {item.subtitle || formatBytes(item.totalBytes)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {getStatusBadge(item)}

                  {isActive ? (
                    <button
                      onClick={() => cancelTransfer(item.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                      title="Batalkan Transfer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => removeTransfer(item.id)}
                      className="p-1 text-slate-300 hover:text-slate-600 rounded transition-colors"
                      title="Hapus dari daftar"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Real-time Progress Bar */}
              <div className="space-y-1">
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 rounded-full ${
                      item.status === "COMPLETED"
                        ? "bg-emerald-500"
                        : item.status === "ERROR"
                        ? "bg-rose-500"
                        : item.status === "CANCELLED"
                        ? "bg-slate-400"
                        : "bg-blue-600 bg-[linear-gradient(45deg,rgba(255,255,255,0.2)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.2)_50%,rgba(255,255,255,0.2)_75%,transparent_75%,transparent)] bg-[length:1rem_1rem] animate-[move-bg_1s_linear_infinite]"
                    }`}
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>

                {/* Progress Stats */}
                <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                  <span>
                    {formatBytes(item.loadedBytes)} / {formatBytes(item.totalBytes)} ({item.percentage}%)
                  </span>

                  {isActive && (
                    <span className="text-slate-600 font-medium">
                      {formatSpeed(item.speedBytesPerSec)} • {formatEta(item.etaSeconds)}
                    </span>
                  )}
                </div>
              </div>

              {item.errorMessage && (
                <p className="text-[10px] text-rose-500 bg-rose-50 p-1.5 rounded-lg border border-rose-100 break-words">
                  {item.errorMessage}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
