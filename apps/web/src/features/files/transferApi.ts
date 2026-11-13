import type { ConflictPolicy, TransferJobDto } from "@superdrive/shared";
import { toast } from "sonner";
import { api } from "@/lib/api";

export interface Destination { storageId: string; folderId: string; folderName: string }

export async function startTransfer(type: "COPY" | "MOVE", storageId: string, ids: string[], dest: Destination, policy: ConflictPolicy = "RENAME") {
  const job = await api<TransferJobDto>("/transfers", { body: { type, source: { storageId, fileIds: ids }, destination: { storageId: dest.storageId, folderId: dest.folderId }, conflictPolicy: policy, idempotencyKey: crypto.randomUUID() } });
  toast(`${type === "COPY" ? "Menyalin" : "Memindahkan"} ${ids.length} item ke ${dest.folderName}`, { description: "Kemajuan tampil di panel kanan bawah." });
  return job;
}

/**
 * One item downloads straight from its URL (the browser handles progress, cancel and resume with Range).
 * Several items are posted as a form so the browser downloads one streamed ZIP the same native way.
 */
export function triggerDownload(storageId: string, ids: string[]) {
  if (ids.length === 1) {
    const a = document.createElement("a"); a.href = `/api/v1/files/${storageId}/${ids[0]}/download`; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
    return;
  }
  const f = document.createElement("form"); f.method = "POST"; f.action = "/api/v1/files/zip"; f.style.display = "none";
  const add = (k: string, v: string) => { const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; f.appendChild(i); };
  add("storageId", storageId); ids.forEach((id) => add("id", id));
  document.body.appendChild(f); f.submit(); f.remove();
}
