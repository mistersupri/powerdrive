import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../services/api.ts";
import { FileItem, Folder } from "../../types/frontend.ts";
import { useDebouncedValue } from "../../lib/useDebouncedValue.ts";

const PAGE_SIZE = 30;

// Mounted-drive (/mnt) items have their own explorer and never appear in My Drive.
const isMountFolder = (f: Folder) => !!f.storageId || !!f.targetFolderPath?.startsWith("/mnt");
const isMountFile = (f: FileItem) => !!f.storageId || !!f.storagePath?.startsWith("/mnt");

function mergeById<T extends { id: string }>(prev: T[], next: T[]) {
  const seen = new Set(prev.map((x) => x.id));
  return [...prev, ...next.filter((x) => !seen.has(x.id))];
}

/**
 * Paged folder and file listing for one folder of My Drive (or a search).
 * - Search is debounced, and responses that arrive after a newer request are dropped.
 * - Refreshes keep the current items on screen; only navigation shows the skeleton.
 * - The root of My Drive lists folders only; files always live inside a folder.
 */
export function useDriveListing(
  currentFolderId: string | null,
  searchInput: string,
  /** Shared links search inside the shared folder only, never across the account. */
  opts: { scopedSearch?: boolean } = {}
) {
  const search = useDebouncedValue(searchInput.trim(), 250);
  const scoped = !!opts.scopedSearch;
  const isRoot = currentFolderId === null && !search && !scoped;

  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(
    async (pageToLoad: number, mode: "replace" | "append" | "refresh") => {
      const id = ++requestId.current;
      if (mode === "append") setIsLoadingMore(true);
      else if (mode === "refresh") setIsRefreshing(true);
      else setStatus("loading");

      try {
        const parent = search && !scoped ? undefined : currentFolderId || "root";
        const [foldersRes, filesRes] = await Promise.all([
          api.listFolders({ parentId: parent, page: pageToLoad, limit: PAGE_SIZE, search: search || undefined }),
          isRoot
            ? Promise.resolve({ files: [] as FileItem[], total: 0, hasMore: false })
            : api.listFiles({ folderId: parent, page: pageToLoad, limit: PAGE_SIZE, search: search || undefined }),
        ]);
        if (id !== requestId.current) return;

        const nextFolders = (foldersRes.folders || []).filter((f) => !isMountFolder(f));
        const nextFiles = (filesRes.files || []).filter((f) => !isMountFile(f));
        if (mode === "append") {
          setFolders((prev) => mergeById(prev, nextFolders));
          setFiles((prev) => mergeById(prev, nextFiles));
        } else {
          setFolders(nextFolders);
          setFiles(nextFiles);
        }
        setPage(pageToLoad);
        setTotal((foldersRes.total || 0) + (filesRes.total || 0));
        setHasMore(Boolean(foldersRes.hasMore || filesRes.hasMore));
        setError(null);
        setStatus("ready");
      } catch (err: any) {
        if (id !== requestId.current) return;
        if (mode === "append") return;
        setError(err?.message || "Terjadi kesalahan saat memuat data.");
        if (mode === "replace") setStatus("error");
      } finally {
        if (id === requestId.current) {
          setIsRefreshing(false);
          setIsLoadingMore(false);
        }
      }
    },
    [currentFolderId, search, isRoot, scoped]
  );

  // Navigation clears the list (skeleton) so items from the previous folder never
  // show; a new search keeps the current items visible until results arrive.
  const loadedFolderRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const navigated = loadedFolderRef.current !== currentFolderId;
    loadedFolderRef.current = currentFolderId;
    if (navigated) {
      setFolders([]);
      setFiles([]);
      setHasMore(false);
    }
    load(1, navigated ? "replace" : "refresh");
  }, [load, currentFolderId]);

  const refresh = useCallback(() => load(1, "refresh"), [load]);
  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore || status !== "ready") return;
    load(page + 1, "append");
  }, [hasMore, isLoadingMore, status, load, page]);

  // Uploads and sync jobs finishing in the background announce themselves here.
  useEffect(() => {
    const onRefresh = () => refresh();
    window.addEventListener("powerdrive:refresh-data", onRefresh);
    return () => window.removeEventListener("powerdrive:refresh-data", onRefresh);
  }, [refresh]);

  return {
    folders,
    files,
    total,
    hasMore,
    status,
    error,
    isRefreshing,
    isLoadingMore,
    isSearching: !!search,
    isRoot,
    isSearchPending: search !== searchInput.trim(),
    refresh,
    retry: () => load(1, "replace"),
    loadMore,
  };
}
