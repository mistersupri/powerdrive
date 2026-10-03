import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../services/api.ts";
import { MountFileItem } from "../../types/frontend.ts";
import { useDebouncedValue } from "../../lib/useDebouncedValue.ts";

const PAGE_SIZE = 100;

/**
 * One directory of a mounted drive, paged and searched on the server. Responses
 * that arrive after a newer request (fast navigation, typing) are discarded.
 */
export function useMountListing(mountId: string, subPath: string, searchInput: string) {
  const search = useDebouncedValue(searchInput.trim(), 250);
  const [items, setItems] = useState<MountFileItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const requestId = useRef(0);
  const loadedPathRef = useRef<string | undefined>(undefined);

  const load = useCallback(
    async (pageToLoad: number, mode: "replace" | "append" | "refresh") => {
      const id = ++requestId.current;
      if (mode === "append") setIsLoadingMore(true);
      else if (mode === "refresh") setIsRefreshing(true);
      else setStatus("loading");
      try {
        const res = await api.browseMountDirectory(mountId, subPath, {
          page: pageToLoad,
          limit: PAGE_SIZE,
          search: search || undefined,
        });
        if (id !== requestId.current) return;
        const next = res.items || [];
        setItems((prev) => {
          if (mode !== "append") return next;
          const seen = new Set(prev.map((i) => i.id));
          return [...prev, ...next.filter((i) => !seen.has(i.id))];
        });
        setPage(pageToLoad);
        setTotalPages(res.totalPages || 1);
        setTotal(res.totalItems ?? next.length);
        setError(null);
        setStatus("ready");
      } catch (err: any) {
        if (id !== requestId.current || mode === "append") return;
        setError(err?.message || "Direktori tidak dapat dibaca.");
        if (mode === "replace") setStatus("error");
      } finally {
        if (id === requestId.current) {
          setIsRefreshing(false);
          setIsLoadingMore(false);
        }
      }
    },
    [mountId, subPath, search]
  );

  useEffect(() => {
    const navigated = loadedPathRef.current !== subPath;
    loadedPathRef.current = subPath;
    if (navigated) setItems([]);
    load(1, navigated ? "replace" : "refresh");
  }, [load, subPath]);

  const hasMore = page < totalPages;
  return {
    items,
    folders: items.filter((i) => i.isDirectory),
    files: items.filter((i) => !i.isDirectory),
    total,
    hasMore,
    status,
    error,
    isRefreshing,
    isLoadingMore,
    isSearching: !!search,
    isSearchPending: search !== searchInput.trim(),
    refresh: () => load(1, "refresh"),
    retry: () => load(1, "replace"),
    loadMore: () => {
      if (hasMore && !isLoadingMore && status === "ready") load(page + 1, "append");
    },
  };
}
