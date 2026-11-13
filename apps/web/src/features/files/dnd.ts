import type { UploadInput } from "@/features/uploads/manager";

export const DRAG_MIME = "application/x-superdrive-items";
export interface DragPayload { storageId: string; ids: string[]; names: string[] }
/** dragover cannot read dataTransfer data, so the active internal drag is kept here. */
export let activeDrag: DragPayload | null = null;
export const setActiveDrag = (p: DragPayload | null) => { activeDrag = p; };

export const hasFiles = (dt: DataTransfer | null) => !!dt && [...dt.types].includes("Files");

/** Reads dropped files, walking directories so folder structure is kept as relative paths. */
export async function collectDropped(dt: DataTransfer): Promise<UploadInput[]> {
  const out: UploadInput[] = [];
  const items = [...dt.items].filter((i) => i.kind === "file");
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (!entries.length) return [...dt.files].map((file) => ({ file }));
  const readAll = (r: FileSystemDirectoryReader) => new Promise<FileSystemEntry[]>((res, rej) => {
    const acc: FileSystemEntry[] = [];
    const next = () => r.readEntries((b) => (b.length ? (acc.push(...b), next()) : res(acc)), rej);
    next();
  });
  const walk = async (e: FileSystemEntry, prefix: string): Promise<void> => {
    if (e.isFile) {
      const file = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      out.push({ file, relativePath: prefix + e.name });
    } else if (e.isDirectory) {
      const kids = await readAll((e as FileSystemDirectoryEntry).createReader());
      for (const k of kids) await walk(k, `${prefix}${e.name}/`);
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}
