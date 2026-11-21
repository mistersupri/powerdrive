import type { PlaceDto, StorageConnectionDto } from "@superdrive/shared";

/** The file manager address of a folder somewhere in a storage: the default storage lives at /files, the others at /s/<id>. */
export function placeHref(storages: StorageConnectionDto[], p: PlaceDto): string {
  const base = storages.find((s) => s.id === p.storageId)?.isDefault ? "/files" : `/s/${p.storageId}`;
  return p.folderId ? `${base}?f=${encodeURIComponent(p.folderId)}` : base;
}
