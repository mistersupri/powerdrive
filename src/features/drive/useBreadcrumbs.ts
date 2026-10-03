import { useEffect, useRef, useState } from "react";
import { api } from "../../services/api.ts";
import { Folder } from "../../types/frontend.ts";

export interface Crumb {
  id: string | null;
  name: string;
}

export const ROOT_NAME = "Drive Saya";

/**
 * Breadcrumb trail and record for the open folder. Shows the locally known path
 * immediately, then replaces it with the server's full trail.
 */
export function useBreadcrumbs(currentFolderId: string | null, knownFolders: Folder[]) {
  const [trail, setTrail] = useState<Crumb[]>([{ id: null, name: ROOT_NAME }]);
  const [folder, setFolder] = useState<Folder | null>(null);
  const knownRef = useRef(knownFolders);
  knownRef.current = knownFolders;

  useEffect(() => {
    if (!currentFolderId) {
      setFolder(null);
      setTrail([{ id: null, name: ROOT_NAME }]);
      return;
    }

    // Optimistic trail from folders we already have.
    const byId = new Map(knownRef.current.map((f) => [f.id, f]));
    const local: Crumb[] = [];
    const seen = new Set<string>();
    let cur = byId.get(currentFolderId);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      local.unshift({ id: cur.id, name: cur.name });
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    const known = byId.get(currentFolderId);
    setFolder(known || null);
    if (local.length) setTrail([{ id: null, name: ROOT_NAME }, ...local]);

    let cancelled = false;
    api
      .getFolder(currentFolderId)
      .then((res) => {
        if (cancelled) return;
        if (res.folder) setFolder(res.folder);
        const crumbs = res.breadcrumbs?.length
          ? res.breadcrumbs.map((b) => ({ id: b.id, name: b.name }))
          : res.folder
            ? [{ id: res.folder.id, name: res.folder.name }]
            : [];
        setTrail([{ id: null, name: ROOT_NAME }, ...crumbs]);
      })
      .catch(() => {
        // Keep the optimistic trail; the listing shows its own error state.
      });
    return () => {
      cancelled = true;
    };
  }, [currentFolderId]);

  return { trail, folder };
}
