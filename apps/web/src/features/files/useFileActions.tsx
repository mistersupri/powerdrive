import type { ConflictPolicy, FileEntry, Permission, StorageConnectionDto, TransferJobDto } from "@superdrive/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Eye, FolderInput, FolderOpen, FolderPlus, Pencil, RefreshCw, Share2, Star, Trash2, Upload } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { startTransfer, triggerDownload, type Destination } from "./transferApi";
import { previewable } from "@/lib/fileType";
import type { MenuItem } from "@/ui/Menu";
import { enqueueUploads, type UploadInput } from "@/features/uploads/manager";
import { DeleteDialog, NameDialog, TransferDialog } from "./dialogs";
import { Preview } from "@/features/preview/Preview";
import { ShareDialog } from "@/features/share/ShareDialog";
import { type Selection } from "./selection";

export { startTransfer, triggerDownload };
interface Args {
  storage: StorageConnectionDto | undefined; folderId: string; folderName: string; /** Path of the current folder, shown in the details panel. */ location?: string; entries: FileEntry[]; /** Everything in the folder, before filtering — used to recognise no-op drops. */ allEntries?: FileEntry[]; selection: Selection;
  onOpenFolder(id: string): void;
}

/** Everything a file view can do, with its dialogs. Pages render `dialogs` and use `menuFor` / handlers. */
export function useFileActions({ storage, folderId, folderName, location, entries, allEntries, selection, onOpenFolder }: Args) {
  const qc = useQueryClient();
  const perms = useMemo(() => new Set<Permission>(storage?.permissions ?? []), [storage]);
  const can = (p: Permission) => perms.has(p);
  const [shareTarget, setShareTarget] = useState<FileEntry | null>(null);
  const [dlg, setDlg] = useState<null | { t: "folder" } | { t: "rename"; e: FileEntry } | { t: "delete"; list: FileEntry[] } | { t: "transfer"; mode: "COPY" | "MOVE"; list: FileEntry[] }>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null); const dirInput = useRef<HTMLInputElement>(null);
  const storageId = storage?.id ?? "";
  const selectedEntries = useMemo(() => entries.filter((e) => selection.selected.has(e.id)), [entries, selection.selected]);
  const previewList = useMemo(() => entries.filter((e) => previewable(e)), [entries]);

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["files", storageId] }), [qc, storageId]);

  const open = useCallback((e: FileEntry) => {
    if (e.isFolder) return onOpenFolder(e.id);
    const i = previewList.findIndex((x) => x.id === e.id);
    if (i >= 0) setPreview(i); else triggerDownload(e.storageId, [e.id], e.name);
  }, [onOpenFolder, previewList]);

  const upload = useCallback((inputs: UploadInput[], targetFolderId = folderId, label = folderName) => {
    if (!storage || !inputs.length) return;
    if (!can("UPLOAD")) return void toast.error("Anda tidak punya izin mengunggah ke penyimpanan ini.");
    enqueueUploads(inputs, { storageId: storage.id, storageName: storage.name, parentId: targetFolderId, folderLabel: label });
  }, [storage, folderId, folderName]); // eslint-disable-line react-hooks/exhaustive-deps

  const star = useCallback(async (e: FileEntry) => {
    await api(`/files/${e.storageId}/${e.id}/star`, { body: { starred: !e.starred } });
    void refresh(); void qc.invalidateQueries({ queryKey: ["search"] });
  }, [refresh, qc]);

  const dropItems = useCallback(async (target: FileEntry | null, payload: { storageId: string; ids: string[] }, copy: boolean) => {
    const destFolder = target ? target.id : folderId;
    if (!storage) return;
    if (payload.storageId === storage.id && !copy && payload.ids.includes(destFolder)) return;
    // Dropping items back into the folder they already live in does nothing — no job, no progress dialog.
    const here = allEntries ?? entries;
    if (payload.storageId === storage.id && !copy && destFolder === folderId && payload.ids.every((id) => here.some((e) => e.id === id))) return;
    try { await startTransfer(copy ? "COPY" : "MOVE", payload.storageId, payload.ids, { storageId: storage.id, folderId: destFolder, folderName: target?.name ?? folderName }); }
    catch (e) { toast.error((e as Error).message); }
  }, [storage, folderId, folderName, allEntries, entries]);

  const menuFor = useCallback((e: FileEntry | null): MenuItem[] => {
    if (!e) return [
      { label: "Folder baru", icon: <FolderPlus />, hidden: !can("UPLOAD"), onSelect: () => setDlg({ t: "folder" }) },
      { label: "Unggah file", icon: <Upload />, hidden: !can("UPLOAD"), onSelect: () => fileInput.current?.click() },
      { label: "Muat ulang", icon: <RefreshCw />, divider: true, onSelect: () => { void refresh(); } },
    ];
    const list = selection.selected.has(e.id) && selection.selected.size > 1 ? selectedEntries : [e];
    const multi = list.length > 1;
    return [
      { label: e.isFolder ? "Buka" : "Pratinjau", icon: e.isFolder ? <FolderOpen /> : <Eye />, hidden: multi, onSelect: () => open(e) },
      { label: e.isFolder ? "Unduh sebagai ZIP" : "Unduh", icon: <Download />, hidden: !can("DOWNLOAD"), onSelect: () => triggerDownload(e.storageId, list.map((x) => x.id), list.length === 1 ? list[0]!.name : undefined) },
      { label: "Salin ke…", icon: <Copy />, hidden: !can("COPY"), divider: true, onSelect: () => setDlg({ t: "transfer", mode: "COPY", list }) },
      { label: "Pindahkan ke…", icon: <FolderInput />, hidden: !can("MOVE"), onSelect: () => setDlg({ t: "transfer", mode: "MOVE", list }) },
      { label: "Ganti nama", icon: <Pencil />, shortcut: "F2", hidden: multi || !can("RENAME"), onSelect: () => setDlg({ t: "rename", e }) },
      { label: "Bagikan…", icon: <Share2 />, hidden: multi || !can("SHARE"), onSelect: () => setShareTarget(e) },
      { label: e.starred ? "Hapus bintang" : "Beri bintang", icon: <Star />, hidden: multi, onSelect: () => { void star(e); } },
      { label: "Hapus", icon: <Trash2 />, danger: true, divider: true, hidden: !can("DELETE"), shortcut: "Del", onSelect: () => setDlg({ t: "delete", list }) },
    ];
  }, [perms, selection.selected, selectedEntries, open, star, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const keyAction = useCallback((a: "selectAll" | "delete" | "rename" | "clear") => {
    if (a === "selectAll") selection.selectAll(entries);
    if (a === "clear") selection.clear();
    if (a === "delete" && selectedEntries.length && can("DELETE")) setDlg({ t: "delete", list: selectedEntries });
    if (a === "rename" && selectedEntries.length === 1 && can("RENAME")) setDlg({ t: "rename", e: selectedEntries[0]! });
  }, [entries, selection, selectedEntries]); // eslint-disable-line react-hooks/exhaustive-deps

  const dialogs = (<>
    <input ref={fileInput} type="file" multiple hidden onChange={(e) => { upload([...(e.target.files ?? [])].map((file) => ({ file }))); e.target.value = ""; }} />
    <input ref={dirInput} type="file" hidden {...({ webkitdirectory: "", directory: "" } as object)} onChange={(e) => { upload([...(e.target.files ?? [])].map((file) => ({ file, relativePath: (file as File & { webkitRelativePath: string }).webkitRelativePath || file.name }))); e.target.value = ""; }} />
    <NameDialog open={dlg?.t === "folder"} title="Folder baru" label="Nama folder" action="Buat" onClose={() => setDlg(null)} onSubmit={async (name) => { await api("/files/folders", { body: { storageId, parentId: folderId, name } }); await refresh(); }} />
    <NameDialog open={dlg?.t === "rename"} title="Ganti nama" label="Nama baru" initial={dlg?.t === "rename" ? dlg.e.name : ""} action="Simpan" onClose={() => setDlg(null)}
      onSubmit={async (name) => { if (dlg?.t !== "rename") return; await api("/files/rename", { body: { storageId, fileId: dlg.e.id, name } }); await refresh(); }} />
    <DeleteDialog open={dlg?.t === "delete"} entries={dlg?.t === "delete" ? dlg.list : []} provider={storage?.provider} onClose={() => setDlg(null)}
      onConfirm={async () => {
        if (dlg?.t !== "delete") return;
        const list = dlg.list; let fail = 0;
        for (const e of list) { try { await api(`/files/${storageId}/${e.id}`, { method: "DELETE" }); } catch (err) { fail++; toast.error(`${e.name}: ${(err as Error).message}`); } }
        selection.clear(); await refresh();
        if (!fail) toast.success(list.length === 1 ? `“${list[0]!.name}” dihapus` : `${list.length} item dihapus`);
      }} />
    <TransferDialog open={dlg?.t === "transfer"} mode={dlg?.t === "transfer" ? dlg.mode : "COPY"} entries={dlg?.t === "transfer" ? dlg.list : []} fromStorageId={storageId} initialStorageId={storageId} initialFolderId={folderId} onClose={() => setDlg(null)}
      onConfirm={async (dest, policy) => { if (dlg?.t !== "transfer") return; await startTransfer(dlg.mode, storageId, dlg.list.map((e) => e.id), dest, policy); selection.clear(); }} />
    {preview !== null && <Preview location={location} storageName={storage?.isDefault ? "Semua file" : storage?.name} items={previewList} index={preview} onIndex={setPreview} onClose={() => setPreview(null)} onShare={can("SHARE") ? (f) => { setPreview(null); setShareTarget(f); } : undefined} canDownload={can("DOWNLOAD")} />}
    <ShareDialog open={!!shareTarget} storageId={storageId} file={shareTarget} onClose={() => setShareTarget(null)} />
  </>);

  return {
    can, dialogs, menuFor, open, upload, keyAction, dropItems, star, refresh, selectedEntries,
    pickFiles: () => fileInput.current?.click(), pickFolder: () => dirInput.current?.click(),
    newFolder: () => setDlg({ t: "folder" }), share: (e: FileEntry) => setShareTarget(e),
    transferSelected: (mode: "COPY" | "MOVE") => selectedEntries.length && setDlg({ t: "transfer", mode, list: selectedEntries }),
    deleteSelected: () => selectedEntries.length && setDlg({ t: "delete", list: selectedEntries }),
    downloadSelected: () => selectedEntries.length && triggerDownload(storageId, selectedEntries.map((e) => e.id), selectedEntries.length === 1 ? selectedEntries[0]!.name : undefined),
  };
}
