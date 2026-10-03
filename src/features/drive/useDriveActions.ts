import { useCallback, useState } from "react";
import { api } from "../../services/api.ts";
import { FileItem, Folder, FolderPermission } from "../../types/frontend.ts";
import { useDialog } from "../../context/DialogContext.tsx";
import { useTransfer } from "../../context/TransferContext.tsx";
import { describeItemCount } from "../../lib/format.ts";
import type { ConflictItem, ConflictResolutionMode } from "../../components/FileConflictModal.tsx";
import type { OperationType } from "../../components/OperationLoadingModal.tsx";

// api.ts unwraps `data`, so bulk results arrive either flat or nested.
function failedCount(res: unknown): number {
  const r = res as { failedIds?: string[]; data?: { failedIds?: string[] } };
  return (r?.failedIds ?? r?.data?.failedIds ?? []).length;
}

export interface OperationState {
  isOpen: boolean;
  title: string;
  message?: string;
  type?: OperationType;
  subMessage?: string;
}

/**
 * The write operations of My Drive. Each one confirms when destructive, shows
 * progress for slow work, reports the outcome, and calls `onChanged` so the
 * listing refreshes.
 */
export function useDriveActions({
  currentFolderId,
  currentFolderName,
  allFolders,
  onChanged,
}: {
  currentFolderId: string | null;
  currentFolderName: string;
  allFolders: Folder[];
  onChanged: () => void;
}) {
  const { showAlert, showConfirm, showToast } = useDialog();
  const { startChunkUpload } = useTransfer();
  const [operation, setOperation] = useState<OperationState>({ isOpen: false, title: "" });
  const [conflicts, setConflicts] = useState<{ items: ConflictItem[]; files: File[] } | null>(null);

  const fail = (title: string, err: any, fallback: string) =>
    showAlert({ title, message: err?.message || fallback, type: "error" });

  const runOperation = async (state: Omit<OperationState, "isOpen">, work: () => Promise<void>) => {
    setOperation({ ...state, isOpen: true });
    try {
      await work();
    } finally {
      setOperation({ isOpen: false, title: "" });
    }
  };

  const createFolder = useCallback(
    async (name: string, description?: string) => {
      await api.createFolder({
        name,
        description,
        parentId: currentFolderId,
        permission: FolderPermission.VIEW,
      });
      showToast(`Folder "${name}" dibuat`, "success");
      onChanged();
    },
    [currentFolderId, onChanged, showToast]
  );

  const trashItems = useCallback(
    async (folders: Folder[], files: FileItem[]) => {
      if (folders.length === 0 && files.length === 0) return false;
      const single = folders.length + files.length === 1;
      const label = single ? `"${folders[0]?.name ?? files[0]?.originalName}"` : describeItemCount(folders.length, files.length);
      const ok = await showConfirm({
        title: "Pindahkan ke Sampah?",
        message: `${label} akan dipindahkan ke Sampah. Anda bisa memulihkannya dari menu Sampah kapan saja.`,
        confirmText: "Pindahkan ke Sampah",
        isDanger: true,
      });
      if (!ok) return false;
      try {
        let failed = 0;
        await runOperation({ title: "Memindahkan ke Sampah", message: label, type: "trash" }, async () => {
          // The bulk endpoints answer 200 even when some items fail, so count failures.
          if (files.length) failed += failedCount(await api.bulkDeleteFiles(files.map((f) => f.id)));
          if (folders.length) failed += failedCount(await api.bulkDeleteFolders(folders.map((f) => f.id)));
        });
        if (failed > 0) {
          showAlert({
            title: "Sebagian item tidak dipindahkan",
            message: `${failed} item tidak dapat dipindahkan ke Sampah. Periksa hak akses Anda untuk item tersebut.`,
            type: "warning",
          });
        } else {
          showToast(`${single ? label : label.charAt(0).toUpperCase() + label.slice(1)} dipindahkan ke Sampah`, "success");
        }
        onChanged();
        return true;
      } catch (err) {
        fail("Gagal memindahkan ke Sampah", err, "Item tidak dapat dipindahkan.");
        onChanged();
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onChanged, showConfirm, showToast]
  );

  const syncFiles = useCallback(
    async (files: FileItem[]) => {
      if (files.length === 0) return;
      try {
        if (files.length === 1) await api.syncSingleFile(files[0].id);
        else await api.bulkSyncFiles(files.map((f) => f.id));
        showToast(files.length === 1 ? `"${files[0].originalName}" masuk antrean sinkron` : `${files.length} berkas masuk antrean sinkron`, "info");
        onChanged();
      } catch (err) {
        fail("Sinkronisasi gagal", err, "Berkas tidak dapat disinkronkan.");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onChanged, showToast]
  );

  const syncFolder = useCallback(
    async (folder: Folder) => {
      try {
        showToast(`Menyinkronkan "${folder.name}" ke Google Drive`, "info");
        await api.syncFolder(folder.id);
        showToast(`"${folder.name}" tersinkron ke Google Drive`, "success");
        onChanged();
      } catch (err) {
        fail("Sinkronisasi folder gagal", err, "Folder tidak dapat disinkronkan.");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onChanged, showToast]
  );

  /** Move by drag and drop. `targetFolderId` null means the root of My Drive. */
  const moveItems = useCallback(
    async (targetFolderId: string | null, folderIds: string[], fileIds: string[]) => {
      if (folderIds.length === 0 && fileIds.length === 0) return;
      if (targetFolderId === null && fileIds.length > 0) {
        showAlert({
          title: "Berkas perlu folder",
          message: "Halaman awal Drive Saya hanya berisi folder. Pindahkan berkas ke dalam sebuah folder.",
          type: "warning",
        });
        return;
      }
      if (targetFolderId) {
        // A folder cannot go inside itself or one of its own subfolders.
        const children = new Map<string, string[]>();
        allFolders.forEach((f) => {
          if (!f.parentId) return;
          children.set(f.parentId, [...(children.get(f.parentId) || []), f.id]);
        });
        const descendants = new Set<string>();
        const stack = [...folderIds];
        while (stack.length) {
          const id = stack.pop()!;
          if (descendants.has(id)) continue;
          descendants.add(id);
          stack.push(...(children.get(id) || []));
        }
        if (descendants.has(targetFolderId)) {
          showAlert({
            title: "Tidak bisa dipindahkan",
            message: "Folder tidak dapat dipindahkan ke dalam dirinya sendiri atau subfoldernya.",
            type: "warning",
          });
          return;
        }
      }

      const label = describeItemCount(folderIds.length, fileIds.length);
      try {
        await runOperation({ title: "Memindahkan item", message: label, type: "sync" }, async () => {
          if (fileIds.length && targetFolderId) await api.bulkMoveFiles(fileIds, targetFolderId);
          for (const id of folderIds) await api.updateFolder(id, { parentId: targetFolderId });
        });
        showToast(`${label.charAt(0).toUpperCase() + label.slice(1)} dipindahkan`, "success");
      } catch (err) {
        fail("Gagal memindahkan", err, "Item tidak dapat dipindahkan.");
      } finally {
        onChanged();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allFolders, onChanged, showAlert, showToast]
  );

  const startUpload = useCallback(
    (files: File[], modes?: Map<string, ConflictResolutionMode>) => {
      startChunkUpload({
        targetFolderId: currentFolderId || "root",
        targetFolderName: currentFolderName,
        files,
        fileConflictModes: modes,
        onUploadComplete: onChanged,
      });
    },
    [currentFolderId, currentFolderName, onChanged, startChunkUpload]
  );

  /** Upload into the open folder, asking first when names collide with existing files. */
  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      try {
        const res = await api.checkConflicts(currentFolderId || "root", files.map((f) => f.name));
        const items: ConflictItem[] = (res.conflicts || [])
          .map((c) => {
            const newFile = files.find((f) => f.name === c.fileName);
            return newFile ? { newFile, existingFile: c.existingFile } : null;
          })
          .filter(Boolean) as ConflictItem[];
        if (items.length > 0) {
          setConflicts({ items, files });
          return;
        }
      } catch {
        // If the check fails the server still versions duplicates, so upload anyway.
      }
      startUpload(files);
    },
    [currentFolderId, startUpload]
  );

  const resolveConflicts = useCallback(
    (modes: Map<string, ConflictResolutionMode>) => {
      if (conflicts) startUpload(conflicts.files, modes);
      setConflicts(null);
    },
    [conflicts, startUpload]
  );

  return {
    operation,
    conflicts,
    cancelConflicts: () => setConflicts(null),
    resolveConflicts,
    createFolder,
    trashItems,
    syncFiles,
    syncFolder,
    moveItems,
    uploadFiles,
  };
}
