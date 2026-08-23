import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { ActiveTransfer, TransferProgress, TransferType, ArchiveSession } from "../types/frontend.ts";
import { api } from "../services/api.ts";
import { useDialog } from "./DialogContext.tsx";

interface TransferContextValue {
  transfers: ActiveTransfer[];
  isHubOpen: boolean;
  setIsHubOpen: (open: boolean) => void;
  activeCount: number;
  startFileDownload: (fileId: string, fileName: string, expectedSize?: number) => Promise<boolean>;
  startArchivePartDownload: (params: {
    sessionId: string;
    partIndex: number;
    partName: string;
    expectedSize?: number;
  }) => Promise<boolean>;
  startBulkArchiveAllParts: (session: ArchiveSession) => Promise<void>;
  startUploadWithProgress: (folderId: string, files: File[]) => Promise<void>;
  cancelTransfer: (id: string) => void;
  clearCompleted: () => void;
  removeTransfer: (id: string) => void;
}

const TransferContext = createContext<TransferContextValue | null>(null);

export const TransferProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [transfers, setTransfers] = useState<ActiveTransfer[]>([]);
  const [isHubOpen, setIsHubOpen] = useState<boolean>(false);
  const { showToast, showAlert } = useDialog();

  const activeTransfersRef = useRef<Map<string, AbortController>>(new Map());

  const activeCount = transfers.filter((t) => t.status === "ACTIVE" || t.status === "PENDING").length;

  const updateTransfer = useCallback((id: string, updates: Partial<ActiveTransfer>) => {
    setTransfers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  }, []);

  const triggerBrowserDownload = (blob: Blob, fileName: string) => {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  };

  const triggerDirectDownload = (url: string, fileName: string) => {
    try {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = url;
      document.body.appendChild(iframe);
      setTimeout(() => {
        try {
          document.body.removeChild(iframe);
        } catch (e) {}
      }, 30000);
    } catch (err) {
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  /**
   * Start a single file download with real-time progress bar
   */
  const startFileDownload = useCallback(
    async (fileId: string, fileName: string, expectedSize?: number): Promise<boolean> => {
      const transferId = `dl_${fileId}_${Date.now()}`;
      const abortController = new AbortController();
      activeTransfersRef.current.set(transferId, abortController);

      const newTransfer: ActiveTransfer = {
        id: transferId,
        type: "DOWNLOAD",
        title: fileName,
        subtitle: "Menghubungkan ke server...",
        status: "ACTIVE",
        loadedBytes: 0,
        totalBytes: expectedSize || 0,
        percentage: 0,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        fileId,
        startedAt: Date.now(),
        abortController,
      };

      setTransfers((prev) => [newTransfer, ...prev]);
      setIsHubOpen(true);
      showToast(`Mulai mengunduh "${fileName}"`, "info");

      try {
        const token = localStorage.getItem("auth_token");
        const url = token
          ? `/api/storage/files/${fileId}/download?token=${encodeURIComponent(token)}`
          : `/api/storage/files/${fileId}/download`;

        const response = await fetch(url, { signal: abortController.signal });
        if (!response.ok) {
          throw new Error(`Server returned status ${response.status}`);
        }

        const reader = response.body?.getReader();
        const contentLength = parseInt(response.headers.get("content-length") || "0", 10) || expectedSize || 0;

        if (!reader) {
          triggerDirectDownload(url, fileName);
          return true;
        }

        const chunks: Uint8Array[] = [];
        let receivedLength = 0;
        const startedTime = Date.now();

        updateTransfer(transferId, { subtitle: "Mengunduh aliran data..." });

        while (true) {
          if (abortController.signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }

          const { done, value } = await reader.read();
          if (done) break;

          chunks.push(value);
          receivedLength += value.length;

          const percentage = contentLength ? Math.min(Math.round((receivedLength / contentLength) * 100), 99) : 0;
          const elapsedSecs = (Date.now() - startedTime) / 1000;
          const speedBytesPerSec = elapsedSecs > 0 ? Math.round(receivedLength / elapsedSecs) : 0;
          const remainingBytes = contentLength - receivedLength;
          const etaSeconds = speedBytesPerSec > 0 ? Math.ceil(remainingBytes / speedBytesPerSec) : 0;

          updateTransfer(transferId, {
            loadedBytes: receivedLength,
            totalBytes: contentLength || receivedLength,
            percentage,
            speedBytesPerSec,
            etaSeconds,
          });
        }

        const blob = new Blob(chunks);
        triggerBrowserDownload(blob, fileName);

        updateTransfer(transferId, {
          status: "COMPLETED",
          percentage: 100,
          loadedBytes: receivedLength,
          totalBytes: receivedLength,
          completedAt: Date.now(),
          subtitle: "Unduhan selesai",
        });
        showToast(`Unduhan "${fileName}" selesai!`, "success");
        return true;
      } catch (err: any) {
        if (err.name === "AbortError" || abortController.signal.aborted) {
          updateTransfer(transferId, {
            status: "CANCELLED",
            subtitle: "Unduhan dibatalkan oleh pengguna",
          });
          return false;
        }

        console.error("[TransferContext] Download error:", err);
        updateTransfer(transferId, {
          status: "ERROR",
          errorMessage: err.message || "Gagal mengunduh berkas",
          subtitle: "Gagal mengunduh",
        });
        showAlert({
          title: "Gagal Mengunduh",
          message: err.message || "Terjadi kesalahan saat mengunduh berkas.",
          type: "error",
        });
        return false;
      } finally {
        activeTransfersRef.current.delete(transferId);
      }
    },
    [showToast, showAlert, updateTransfer]
  );

  /**
   * Start downloading a single part of a multi-part ZIP
   */
  const startArchivePartDownload = useCallback(
    async (params: {
      sessionId: string;
      partIndex: number;
      partName: string;
      expectedSize?: number;
    }): Promise<boolean> => {
      const transferId = `arc_${params.sessionId}_p${params.partIndex}_${Date.now()}`;
      const abortController = new AbortController();
      activeTransfersRef.current.set(transferId, abortController);

      const newTransfer: ActiveTransfer = {
        id: transferId,
        type: "MULTIPART_ZIP",
        title: params.partName,
        subtitle: `Menghubungkan Part ${params.partIndex}...`,
        status: "ACTIVE",
        loadedBytes: 0,
        totalBytes: params.expectedSize || 0,
        percentage: 0,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        archiveSessionId: params.sessionId,
        currentPart: params.partIndex,
        startedAt: Date.now(),
        abortController,
      };

      setTransfers((prev) => [newTransfer, ...prev]);
      setIsHubOpen(true);
      showToast(`Mengunduh part arsip "${params.partName}"`, "info");

      try {
        const token = localStorage.getItem("auth_token");
        const url = token
          ? `/api/storage/bulk-download/part/${params.sessionId}/${params.partIndex}?token=${encodeURIComponent(token)}`
          : `/api/storage/bulk-download/part/${params.sessionId}/${params.partIndex}`;

        const response = await fetch(url, { signal: abortController.signal });
        if (!response.ok) {
          throw new Error(`Server returned status ${response.status}`);
        }

        const reader = response.body?.getReader();
        const contentLength = parseInt(response.headers.get("content-length") || "0", 10) || params.expectedSize || 0;

        if (!reader) {
          triggerDirectDownload(url, params.partName);
          return true;
        }

        const chunks: Uint8Array[] = [];
        let receivedLength = 0;
        const startedTime = Date.now();

        updateTransfer(transferId, { subtitle: `Mengunduh data part ${params.partIndex}...` });

        while (true) {
          if (abortController.signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }

          const { done, value } = await reader.read();
          if (done) break;

          chunks.push(value);
          receivedLength += value.length;

          const percentage = contentLength ? Math.min(Math.round((receivedLength / contentLength) * 100), 99) : 0;
          const elapsedSecs = (Date.now() - startedTime) / 1000;
          const speedBytesPerSec = elapsedSecs > 0 ? Math.round(receivedLength / elapsedSecs) : 0;
          const remainingBytes = contentLength - receivedLength;
          const etaSeconds = speedBytesPerSec > 0 ? Math.ceil(remainingBytes / speedBytesPerSec) : 0;

          updateTransfer(transferId, {
            loadedBytes: receivedLength,
            totalBytes: contentLength || receivedLength,
            percentage,
            speedBytesPerSec,
            etaSeconds,
          });
        }

        const blob = new Blob(chunks, { type: "application/zip" });
        triggerBrowserDownload(blob, params.partName);

        updateTransfer(transferId, {
          status: "COMPLETED",
          percentage: 100,
          loadedBytes: receivedLength,
          totalBytes: receivedLength,
          completedAt: Date.now(),
          subtitle: "Part ZIP berhasil diunduh",
        });
        showToast(`Part "${params.partName}" berhasil diunduh!`, "success");
        return true;
      } catch (err: any) {
        if (err.name === "AbortError" || abortController.signal.aborted) {
          updateTransfer(transferId, {
            status: "CANCELLED",
            subtitle: "Part ZIP dibatalkan oleh pengguna",
          });
          return false;
        }

        console.error("[TransferContext] Archive part download error:", err);
        updateTransfer(transferId, {
          status: "ERROR",
          errorMessage: err.message || "Gagal mengunduh part arsip ZIP",
          subtitle: "Gagal mengunduh part",
        });
        showAlert({
          title: "Gagal Mengunduh Part ZIP",
          message: err.message || "Terjadi kesalahan saat mengunduh part arsip ZIP.",
          type: "error",
        });
        return false;
      } finally {
        activeTransfersRef.current.delete(transferId);
      }
    },
    [showToast, showAlert, updateTransfer]
  );

  /**
   * Sequentially download all parts of a multi-part ZIP session
   */
  const startBulkArchiveAllParts = useCallback(
    async (session: ArchiveSession) => {
      setIsHubOpen(true);
      showToast(`Mempersiapkan pengunduhan ${session.totalParts} part arsip...`, "info");

      for (let i = 0; i < session.parts.length; i++) {
        const part = session.parts[i];
        const success = await startArchivePartDownload({
          sessionId: session.sessionId,
          partIndex: part.partIndex,
          partName: part.partName,
          expectedSize: part.totalBytes,
        });
        if (!success) {
          console.log("[TransferContext] Bulk download aborted sequentially.");
          break;
        }
      }
    },
    [startArchivePartDownload, showToast]
  );

  /**
   * Upload multiple files with real-time progress
   */
  const startUploadWithProgress = useCallback(
    async (folderId: string, files: File[]) => {
      const transferId = `upl_${Date.now()}`;
      const abortController = new AbortController();
      activeTransfersRef.current.set(transferId, abortController);

      const totalSize = files.reduce((acc, f) => acc + f.size, 0);
      const title =
        files.length === 1 ? files[0].name : `${files.length} Berkas (${files[0].name}...)`;

      const newTransfer: ActiveTransfer = {
        id: transferId,
        type: "UPLOAD",
        title,
        subtitle: "Mengunggah ke buffer lokal...",
        status: "ACTIVE",
        loadedBytes: 0,
        totalBytes: totalSize,
        percentage: 0,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        startedAt: Date.now(),
        abortController,
      };

      setTransfers((prev) => [newTransfer, ...prev]);
      setIsHubOpen(true);
      showToast(`Mengunggah ${files.length} berkas...`, "info");

      try {
        const res = await api.uploadFilesWithProgress({
          folderId,
          files,
          signal: abortController.signal,
          onProgress: (progress: TransferProgress) => {
            updateTransfer(transferId, {
              loadedBytes: progress.loadedBytes,
              totalBytes: progress.totalBytes,
              percentage: progress.percentage,
              speedBytesPerSec: progress.speedBytesPerSec,
              etaSeconds: progress.etaSeconds,
            });
          },
        });

        updateTransfer(transferId, {
          status: "COMPLETED",
          percentage: 100,
          loadedBytes: totalSize,
          totalBytes: totalSize,
          completedAt: Date.now(),
          subtitle: "Unggahan selesai & siap disinkronkan",
        });

        showToast(`Berhasil mengunggah ${res.files?.length || files.length} berkas!`, "success");
      } catch (err: any) {
        if (err.name === "AbortError" || abortController.signal.aborted) {
          updateTransfer(transferId, {
            status: "CANCELLED",
            subtitle: "Unggahan dibatalkan",
          });
        } else {
          console.error("[TransferContext] Upload error:", err);
          updateTransfer(transferId, {
            status: "ERROR",
            errorMessage: err.message || "Gagal mengunggah berkas",
            subtitle: "Gagal mengunggah",
          });
          showAlert({
            title: "Gagal Mengunggah Berkas",
            message: err.message || "Terjadi kesalahan saat mengunggah berkas.",
            type: "error",
          });
        }
      } finally {
        activeTransfersRef.current.delete(transferId);
      }
    },
    [showToast, showAlert, updateTransfer]
  );

  const cancelTransfer = useCallback((id: string) => {
    const controller = activeTransfersRef.current.get(id);
    if (controller) {
      controller.abort();
    }
    updateTransfer(id, {
      status: "CANCELLED",
      subtitle: "Dibatalkan oleh pengguna",
    });
  }, [updateTransfer]);

  const clearCompleted = useCallback(() => {
    setTransfers((prev) =>
      prev.filter((t) => t.status === "ACTIVE" || t.status === "PENDING")
    );
  }, []);

  const removeTransfer = useCallback((id: string) => {
    setTransfers((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <TransferContext.Provider
      value={{
        transfers,
        isHubOpen,
        setIsHubOpen,
        activeCount,
        startFileDownload,
        startArchivePartDownload,
        startBulkArchiveAllParts,
        startUploadWithProgress,
        cancelTransfer,
        clearCompleted,
        removeTransfer,
      }}
    >
      {children}
    </TransferContext.Provider>
  );
};

export const useTransfer = (): TransferContextValue => {
  const context = useContext(TransferContext);
  if (!context) {
    throw new Error("useTransfer must be used within a TransferProvider");
  }
  return context;
};
