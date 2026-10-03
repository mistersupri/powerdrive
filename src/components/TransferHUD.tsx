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
        return <UploadCloud className="w-4 h-4 text-accent-500 shrink-0" />;
      case "MULTIPART_ZIP":
        return <Archive className="w-4 h-4 text-warn-500 shrink-0" />;
      case "DOWNLOAD":
      default:
        return <Download className="w-4 h-4 text-accent-500 shrink-0" />;
    }
  };

  const getStatusBadge = (transfer: ActiveTransfer) => {
    switch (transfer.status) {
      case "COMPLETED":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-ok-700 bg-ok-50 px-2 py-0.5 rounded-full border border-ok-200">
            <CheckCircle2 className="w-3 h-3 text-ok-600" />
            Selesai
          </span>
        );
      case "ACTIVE":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent-700 bg-accent-50 px-2 py-0.5 rounded-full border border-accent-200 animate-pulse">
            <RotateCw className="w-3 h-3 text-ink-500" />
            {transfer.type === "UPLOAD" ? "Mengunggah" : "Mengunduh"} ({transfer.percentage}%)
          </span>
        );
      case "ERROR":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-danger-700 bg-danger-50 px-2 py-0.5 rounded-full border border-danger-200">
            <AlertCircle className="w-3 h-3 text-danger-600" />
            Gagal
          </span>
        );
      case "CANCELLED":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-ink-600 bg-ink-100 px-2 py-0.5 rounded-full">
            Dibatalkan
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-ink-500 bg-ink-50 px-2 py-0.5 rounded-full">
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
      <div className="fixed bottom-16 left-3 right-3 sm:left-auto sm:right-4 sm:w-auto md:bottom-4 md:right-4 z-40 animate-fade-in">
        <button
          onClick={() => setIsMinimized(false)}
          className="flex items-center gap-3 px-4 py-2.5 rounded-full bg-night-900 text-white shadow-float hover:bg-night-800 ring-1 ring-white/10 transition text-xs font-semibold w-full sm:w-auto justify-between sm:justify-start"
        >
          <div className="flex items-center gap-2.5">
            {activeCount > 0 ? (
              <RotateCw className="w-4 h-4 text-night-300 animate-spin shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-ok-400 shrink-0" />
            )}

            <span className="truncate">
              {activeCount > 0
                ? `${activeCount} Transfer Berjalan (${activeItem?.percentage || 0}%)`
                : `${transfers.length} Transfer Selesai`}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeItem && activeItem.speedBytesPerSec > 0 && (
              <span className="text-[11px] text-night-300 font-mono bg-night-800 px-2 py-0.5 rounded-full">
                {formatSpeed(activeItem.speedBytesPerSec)}
              </span>
            )}

            <ChevronUp className="w-4 h-4 text-night-400 ml-1" />
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-16 left-3 right-3 sm:left-auto sm:right-4 sm:w-96 md:bottom-4 md:right-4 z-40 bg-surface rounded-2xl shadow-float border border-night-200 overflow-hidden animate-slide-up">
      {/* Header */}
      <div className="px-4 py-3 bg-night-900 text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-white/10 text-night-300 flex items-center justify-center">
            {activeCount > 0 ? (
              <RotateCw className="w-4 h-4 text-night-300 animate-spin" />
            ) : (
              <HardDrive className="w-4 h-4 text-ok-400" />
            )}
          </div>
          <div>
            <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
              <span>Transfer berkas</span>
              {activeCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-white/15 text-[10px] font-mono">
                  {activeCount}
                </span>
              )}
            </h4>
                      </div>
        </div>

        <div className="flex items-center gap-1">
          {transfers.some((t) => t.status === "COMPLETED" || t.status === "CANCELLED" || t.status === "ERROR") && (
            <button
              onClick={clearCompleted}
              className="p-1 text-night-400 hover:text-white rounded transition-colors text-[10px] px-1.5"
              title="Bersihkan riwayat selesai"
            >
              Bersihkan
            </button>
          )}

          <button
            onClick={() => setIsMinimized(true)}
            className="p-1 text-night-400 hover:text-white rounded transition-colors"
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
            className="p-1 text-night-400 hover:text-white rounded transition-colors"
            title="Tutup"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Transfer List Container */}
      <div className="max-h-72 overflow-y-auto divide-y divide-ink-100 p-1">
        {transfers.map((item) => {
          const isActive = item.status === "ACTIVE";

          return (
            <div key={item.id} className="p-3 hover:bg-ink-50/80 transition-colors rounded-xl space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <div className="mt-0.5">{getTransferIcon(item.type)}</div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ink-900 truncate" title={item.title}>
                      {item.title}
                    </p>
                    <p className="text-[10px] text-ink-400 truncate">
                      {item.subtitle || formatBytes(item.totalBytes)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {getStatusBadge(item)}

                  {isActive ? (
                    <button
                      onClick={() => cancelTransfer(item.id)}
                      className="p-1 text-ink-400 hover:text-danger-600 rounded transition-colors"
                      title="Batalkan Transfer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => removeTransfer(item.id)}
                      className="p-1 text-ink-300 hover:text-ink-600 rounded transition-colors"
                      title="Hapus dari daftar"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Real-time Progress Bar */}
              <div className="space-y-1">
                <div className="w-full h-2 bg-ink-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition duration-300 rounded-full ${
                      item.status === "COMPLETED"
                        ? "bg-ok-500"
                        : item.status === "ERROR"
                        ? "bg-danger-500"
                        : item.status === "CANCELLED"
                        ? "bg-ink-400"
                        : "bg-accent-600 bg-[linear-gradient(45deg,rgba(255,255,255,0.2)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.2)_50%,rgba(255,255,255,0.2)_75%,transparent_75%,transparent)] bg-[length:1rem_1rem] animate-[move-bg_1s_linear_infinite]"
                    }`}
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>

                {/* Progress Stats */}
                <div className="flex items-center justify-between text-[10px] text-ink-500 font-mono">
                  <span>
                    {formatBytes(item.loadedBytes)} / {formatBytes(item.totalBytes)} ({item.percentage}%)
                  </span>

                  {isActive && (
                    <span className="text-ink-600 font-medium">
                      {formatSpeed(item.speedBytesPerSec)} • {formatEta(item.etaSeconds)}
                    </span>
                  )}
                </div>
              </div>

              {item.errorMessage && (
                <p className="text-[10px] text-danger-500 bg-danger-50 p-1.5 rounded-lg border border-danger-100 break-words">
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
