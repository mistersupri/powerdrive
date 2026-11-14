import type { FileEntry } from "@superdrive/shared";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { downloadUrl, previewUrl, thumbUrl } from "@/lib/api";

/** Where the browser fetches a file's bytes from. The app uses authenticated routes; public share pages swap in token-based ones. */
export interface FileUrls { thumb(f: FileEntry, size?: number): string; download(f: FileEntry): string; preview(f: FileEntry): string }

export const appUrls: FileUrls = {
  thumb: (f, size = 256) => thumbUrl(f.storageId, f.id, f.version, size),
  download: (f) => downloadUrl(f.storageId, f.id),
  preview: (f) => previewUrl(f.storageId, f.id),
};
/** `root` is the API path of the share, e.g. "/public/share/<token>" or "/shared/share/<id>" (direct shares to a member). */
export const shareUrls = (root: string): FileUrls => {
  const base = `/api/v1${root}/files`;
  return {
    thumb: (f, size = 256) => `${base}/${f.id}/thumbnail?s=${size}${f.version ? `&v=${encodeURIComponent(f.version)}` : ""}`,
    download: (f) => `${base}/${f.id}/download`,
    preview: (f) => `${base}/${f.id}/preview`,
  };
};
const Ctx = createContext<FileUrls>(appUrls);
export const useFileUrls = () => useContext(Ctx);
export function FileUrlsProvider({ root, children }: { root: string; children: ReactNode }) {
  const v = useMemo(() => shareUrls(root), [root]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
