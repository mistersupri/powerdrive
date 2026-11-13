import { ProviderError, ROOT } from "./types.ts";

/** Path-based providers (SFTP, WebDAV, SMB) use the relative path as the id. Root is "" internally, "root" at the boundary. */
export const relOf = (id: string): string => {
  if (id === ROOT) return "";
  if (id.split("/").some((s) => s === ".." || s === "." || s === "")) throw new ProviderError("Path tidak valid.", "other");
  return id;
};
export const idOf = (rel: string) => (rel === "" ? ROOT : rel);
export const joinRel = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
export const parentOf = (rel: string) => { const i = rel.lastIndexOf("/"); return i < 0 ? "" : rel.slice(0, i); };
export const baseOf = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1);
export const TRASH = ".superdrive-trash";
export const hiddenName = (n: string) => n === TRASH || n.endsWith(".sdpart");

/** Characters that cannot appear in a name on any of the protocols (the strictest set is SMB/Windows). */
export function checkName(name: string, strict = false) {
  const bad = strict ? /[\\/\0-\x1f"*:<>?|]/ : /[\\/\0]/;
  if (!name || name === "." || name === ".." || bad.test(name) || name.length > 255) throw new ProviderError("Nama tidak valid.", "other");
  if (hiddenName(name)) throw new ProviderError("Nama ini dicadangkan oleh sistem.", "other");
}

export const byFoldersThenName = <T extends { isFolder: boolean; name: string }>(a: T, b: T) =>
  Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

export const THUMB_MIME = /^image\/(jpeg|png|webp|gif|avif|tiff)$/;
