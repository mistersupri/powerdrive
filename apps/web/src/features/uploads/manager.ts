import type { ConflictPolicy, FileEntry, UploadDto } from "@superdrive/shared";
import { toast } from "sonner";
import { api, ApiError, getWorkspaceId } from "@/lib/api";
import { queryClient } from "@/lib/query";
import { createStore } from "@/lib/store";

export type UploadStatus = "queued" | "uploading" | "processing" | "done" | "skipped" | "error" | "cancelled";
export interface UploadTask {
  id: string; name: string; relativePath: string; size: number; storageId: string; storageName: string; parentId: string; folderLabel: string;
  status: UploadStatus; sent: number; pushed: number; error: string | null; speed: number | null; startedAt: number | null;
  policy: ConflictPolicy; serverId?: string; file: File; result?: FileEntry;
}
export const uploadStore = createStore<{ tasks: UploadTask[] }>({ tasks: [] });

const CONCURRENCY = 4;
const live = new Map<string, { xhr?: XMLHttpRequest; cancelled: boolean }>();
const patch = (id: string, p: Partial<UploadTask>) => uploadStore.set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...p } : t)) }));
const get = (id: string) => uploadStore.get().tasks.find((t) => t.id === id);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface UploadTarget { storageId: string; storageName: string; parentId: string; folderLabel: string }
export interface UploadInput { file: File; relativePath?: string }

// Folders that were created for this session, keyed by "parent/segment", so a tree upload creates each folder once.
const folderCache = new Map<string, Promise<string>>();
async function ensureFolder(storageId: string, parentId: string, name: string): Promise<string> {
  const key = `${storageId}/${parentId}/${name}`;
  let p = folderCache.get(key);
  if (!p) {
    p = api<FileEntry>("/files/folders", { body: { storageId, parentId, name } }).then((f) => f.id).catch(async (e) => {
      if (!(e instanceof ApiError) || e.status !== 409) throw e;
      // Already exists: reuse it.
      let token: string | undefined;
      do {
        const r = await api<{ items: FileEntry[]; nextPageToken: string | null }>(`/files?storageId=${storageId}&folderId=${encodeURIComponent(parentId)}&limit=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`);
        const hit = r.items.find((i) => i.isFolder && i.name === name); if (hit) return hit.id;
        token = r.nextPageToken ?? undefined;
      } while (token);
      throw e;
    });
    folderCache.set(key, p);
  }
  return p;
}

export function enqueueUploads(inputs: UploadInput[], target: UploadTarget, policy: ConflictPolicy = "RENAME") {
  const tasks: UploadTask[] = inputs.map(({ file, relativePath }) => ({
    id: crypto.randomUUID(), name: file.name, relativePath: relativePath ?? file.name, size: file.size, storageId: target.storageId, storageName: target.storageName,
    parentId: target.parentId, folderLabel: target.folderLabel, status: "queued", sent: 0, pushed: 0, error: null, speed: null, startedAt: null, policy, file,
  }));
  uploadStore.set((s) => ({ tasks: [...tasks, ...s.tasks] }));
  pump();
}

let running = 0;
function pump() {
  const queue = uploadStore.get().tasks.filter((t) => t.status === "queued").reverse(); // oldest first
  while (running < CONCURRENCY && queue.length) {
    const t = queue.shift()!; running++;
    void run(t.id).finally(() => { running--; pump(); maybeSummarize(); });
  }
}

let batchTotal = 0;
function maybeSummarize() {
  const ts = uploadStore.get().tasks;
  if (ts.some((t) => ["queued", "uploading", "processing"].includes(t.status))) return;
  const done = ts.filter((t) => t.status === "done").length; const failed = ts.filter((t) => t.status === "error").length;
  if (done + failed > 0 && done + failed !== batchTotal) {
    batchTotal = done + failed;
    if (failed) toast.error(`${failed} unggahan gagal`, { description: `${done} berhasil. Buka panel unggahan untuk mencoba lagi.` });
    else if (done > 1) toast.success(`${done} file berhasil diunggah`);
  }
}

const fingerprint = (t: UploadTask) => `sd-up:${t.storageId}:${t.parentId}:${t.relativePath}:${t.size}:${t.file.lastModified}`;

async function run(id: string) {
  const t0 = get(id)!; const ctl = { cancelled: false } as { xhr?: XMLHttpRequest; cancelled: boolean }; live.set(id, ctl);
  patch(id, { status: "uploading", startedAt: Date.now() });
  try {
    // Re-create the folder path for tree uploads.
    let parent = t0.parentId;
    const segs = t0.relativePath.split("/").slice(0, -1);
    for (const s of segs) parent = await ensureFolder(t0.storageId, parent, s);
    const t = { ...t0, parentId: parent };

    // Resume a previous attempt of the very same file when the server still has its partial data.
    let prevUp: UploadDto | null = null;
    try { const prev = localStorage.getItem(fingerprint(t)); if (prev) prevUp = await api<UploadDto>(`/uploads/${prev}`).catch(() => null); } catch { /* storage unavailable */ }
    let up: UploadDto = prevUp && prevUp.status === "RECEIVING"
      ? prevUp
      : await api<UploadDto>("/uploads", { body: { storageId: t.storageId, parentId: parent, name: t.name, size: t.size, mimeType: t.file.type || null, conflictPolicy: t.policy } });
    try { localStorage.setItem(fingerprint(t), up.id); } catch { /* ignore */ }
    patch(id, { serverId: up.id, sent: up.offset });

    let offset = up.offset; const chunk = up.chunkSize;
    while (offset < t.size && up.status === "RECEIVING") {
      if (ctl.cancelled) throw new Error("cancelled");
      const end = Math.min(offset + chunk, t.size);
      up = await sendChunk(id, ctl, up.id, t.file.slice(offset, end), offset);
      offset = up.offset;
    }
    patch(id, { status: "processing", sent: t.size });
    // The server now pushes the file to the destination. Poll until it finishes.
    for (;;) {
      if (ctl.cancelled) throw new Error("cancelled");
      const s: UploadDto = up.status === "DONE" || up.status === "FAILED" ? up : await api<UploadDto>(`/uploads/${up.id}`);
      up = s;
      patch(id, { pushed: s.pushed ?? 0 });
      if (s.status === "DONE") break;
      if (s.status === "FAILED") throw new Error(s.errorMessage ?? "Gagal menyimpan file.");
      await sleep(300);
    }
    try { localStorage.removeItem(fingerprint(t)); } catch { /* ignore */ }
    patch(id, { status: up.skipped ? "skipped" : "done", result: up.file, sent: t.size });
    void queryClient.invalidateQueries({ queryKey: ["files", t.storageId] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  } catch (e) {
    if (ctl.cancelled || (e as Error).message === "cancelled") { patch(id, { status: "cancelled" }); return; }
    patch(id, { status: "error", error: e instanceof Error ? e.message : String(e) });
  } finally { live.delete(id); }
}

/** One chunk with retries. Uses XHR because fetch cannot report upload progress. */
async function sendChunk(taskId: string, ctl: { xhr?: XMLHttpRequest; cancelled: boolean }, uploadId: string, blob: Blob, offset: number): Promise<UploadDto> {
  let attempt = 0;
  for (;;) {
    try {
      return await new Promise<UploadDto>((resolve, reject) => {
        const xhr = new XMLHttpRequest(); ctl.xhr = xhr;
        xhr.open("PATCH", `/api/v1/uploads/${uploadId}`);
        xhr.setRequestHeader("upload-offset", String(offset));
        xhr.setRequestHeader("content-type", "application/octet-stream");
        xhr.setRequestHeader("x-requested-with", "superdrive");
        const ws = getWorkspaceId(); if (ws) xhr.setRequestHeader("x-workspace-id", ws);
        let last = Date.now(), lastB = 0;
        xhr.upload.onprogress = (e) => {
          const now = Date.now();
          const speed = now - last > 500 ? ((e.loaded - lastB) / ((now - last) / 1000)) : undefined;
          if (speed !== undefined) { last = now; lastB = e.loaded; }
          patch(taskId, { sent: offset + e.loaded, ...(speed !== undefined ? { speed } : {}) });
        };
        xhr.onload = () => {
          let body: any = null; try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
          if (xhr.status >= 200 && xhr.status < 300 && body?.success) return resolve(body.data);
          reject(new ApiError(xhr.status, body?.error?.code ?? "UPLOAD", body?.error?.message ?? "Unggahan gagal."));
        };
        xhr.onerror = () => reject(new ApiError(0, "NETWORK", "Koneksi terputus."));
        xhr.onabort = () => reject(new Error("cancelled"));
        xhr.send(blob);
      });
    } catch (e) {
      if (ctl.cancelled) throw e;
      // Offset drifted (e.g. an earlier attempt landed): ask the server where it is and continue from there.
      if (e instanceof ApiError && e.code === "OFFSET_MISMATCH") { const s = await api<UploadDto>(`/uploads/${uploadId}`); if (s.offset !== offset) return s; }
      const retryable = e instanceof ApiError && (e.status === 0 || e.status >= 500 || e.status === 429);
      if (!retryable || ++attempt > 5) throw e;
      await sleep(Math.min(8000, 500 * 2 ** attempt) * (0.5 + Math.random()));
      const s = await api<UploadDto>(`/uploads/${uploadId}`).catch(() => null);
      if (s && s.offset > offset) return s;
    }
  }
}

export const uploadActions = {
  cancel(id: string) {
    const t = get(id); const c = live.get(id);
    if (c) { c.cancelled = true; c.xhr?.abort(); }
    else if (t?.status === "queued") patch(id, { status: "cancelled" });
    if (t?.serverId && t.status !== "done") void api(`/uploads/${t.serverId}`, { method: "DELETE" }).catch(() => {});
  },
  retry(id: string) { patch(id, { status: "queued", error: null, sent: 0, pushed: 0 }); pump(); },
  clearFinished() { uploadStore.set((s) => ({ tasks: s.tasks.filter((t) => ["queued", "uploading", "processing"].includes(t.status)) })); batchTotal = 0; },
};
