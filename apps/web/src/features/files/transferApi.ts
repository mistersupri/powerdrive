import type { ConflictPolicy, TransferJobDto } from "@superdrive/shared";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { startDownload } from "@/lib/download";

export interface Destination { storageId: string; folderId: string; folderName: string }

export async function startTransfer(type: "COPY" | "MOVE", storageId: string, ids: string[], dest: Destination, policy: ConflictPolicy = "RENAME") {
  const job = await api<TransferJobDto>("/transfers", { body: { type, source: { storageId, fileIds: ids }, destination: { storageId: dest.storageId, folderId: dest.folderId }, conflictPolicy: policy, idempotencyKey: crypto.randomUUID() } });
  toast(`${type === "COPY" ? "Menyalin" : "Memindahkan"} ${ids.length} item ke ${dest.folderName}`, { description: "Kemajuan tampil di panel kanan bawah." });
  return job;
}

/** One item downloads straight from its URL; several items are posted so the browser saves one streamed ZIP. */
export function triggerDownload(storageId: string, ids: string[], label?: string) {
  const name = label ?? (ids.length === 1 ? "file" : `${ids.length} item (ZIP)`);
  if (ids.length === 1) return startDownload(`/api/v1/files/${storageId}/${ids[0]}/download`, name);
  startDownload({ action: "/api/v1/files/zip", fields: [["storageId", storageId], ...ids.map((id) => ["id", id] as [string, string])] }, name);
}
