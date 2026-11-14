import type { FileEntry, FileListing } from "@superdrive/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";

export const folderKey = (storageId: string, folderId: string) => ["files", storageId, folderId] as const;
/** Opening a folder clears its "changed" badge on the server; mirror that in every cached listing so it vanishes at once. */
function clearBadge(storageId: string, folderId: string) {
  queryClient.setQueriesData({ queryKey: ["files", storageId] }, (old: any) => {
    const fix = (items: FileEntry[]) => (items.some((e) => e.id === folderId && e.changed) ? items.map((e) => (e.id === folderId ? { ...e, changed: false } : e)) : items);
    if (Array.isArray(old)) return fix(old);
    if (old?.pages) return { ...old, pages: old.pages.map((p: FileListing) => { const items = fix(p.items); return items === p.items ? p : { ...p, items }; }) };
    return old;
  });
}
const fetchPage = async (storageId: string, folderId: string, pageToken?: string, peek = false) => {
  const r = await api<FileListing>(`/files?storageId=${storageId}&folderId=${encodeURIComponent(folderId)}&limit=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}${peek ? "&peek=1" : ""}`);
  if (!peek && !pageToken && folderId !== "root") clearBadge(storageId, folderId);
  return r;
};

/** Folder contents with transparent paging: the next page is pulled in as soon as the first one lands. */
export function useFolder(storageId: string, folderId: string) {
  const q = useInfiniteQuery({
    queryKey: folderKey(storageId, folderId),
    queryFn: ({ pageParam }) => fetchPage(storageId, folderId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextPageToken ?? undefined,
    // Keep showing the previous folder's data until the new one is ready? No: show skeletons, folders are cached anyway.
    staleTime: 20_000, enabled: !!storageId,
  });
  useEffect(() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }, [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage]);
  const entries = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const folder = q.data?.pages[0]?.folder;
  return { entries, folder, isLoading: q.isLoading, isFetching: q.isFetching, error: q.error as Error | null, refetch: q.refetch, loadingMore: q.hasNextPage };
}

/** Warm the cache when the pointer rests on a folder, so opening it feels instant. */
export function prefetchFolder(storageId: string, folderId: string) {
  void queryClient.prefetchInfiniteQuery({ queryKey: folderKey(storageId, folderId), queryFn: ({ pageParam }) => fetchPage(storageId, folderId, pageParam, true), initialPageParam: undefined as string | undefined, staleTime: 20_000, pages: 1, getNextPageParam: (p: FileListing) => p.nextPageToken ?? undefined });
}

export type SortKey = "name" | "size" | "modified" | "type";
export interface SortState { key: SortKey; dir: "asc" | "desc" }
const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export function sortEntries(list: FileEntry[], s: SortState): FileEntry[] {
  const m = s.dir === "asc" ? 1 : -1;
  const ext = (f: FileEntry) => (f.isFolder ? "" : f.name.split(".").pop()?.toLowerCase() ?? "");
  return [...list].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1; // folders always first
    let r = 0;
    if (s.key === "size") r = (a.size ?? -1) - (b.size ?? -1);
    else if (s.key === "modified") r = (a.modifiedAt ?? "").localeCompare(b.modifiedAt ?? "");
    else if (s.key === "type") r = coll.compare(ext(a), ext(b));
    return (r || coll.compare(a.name, b.name) * (s.key === "name" ? 1 : 1)) * m;
  });
}
