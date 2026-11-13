import type { TransferJobDto } from "@superdrive/shared";
import { ACTIVE_TRANSFER_STATUSES } from "@superdrive/shared";
import { toast } from "sonner";
import { api, getWorkspaceId } from "@/lib/api";
import { createStore } from "@/lib/store";
import { queryClient } from "@/lib/query";

export interface JobView extends TransferJobDto { speed: number | null; eta: number | null }
interface State { jobs: JobView[]; connected: boolean }
export const transferStore = createStore<State>({ jobs: [], connected: false });

const samples = new Map<string, { t: number; b: number }[]>();
const prevStatus = new Map<string, string>();

function view(j: TransferJobDto): JobView {
  let speed: number | null = null; let eta: number | null = null;
  if (ACTIVE_TRANSFER_STATUSES.includes(j.status) && j.status !== "PAUSED") {
    const s = samples.get(j.id) ?? []; const now = Date.now();
    s.push({ t: now, b: j.transferredBytes });
    while (s.length > 2 && now - s[0]!.t > 6000) s.shift();
    samples.set(j.id, s);
    const first = s[0]!;
    if (s.length > 1 && now - first.t > 600) {
      speed = Math.max(0, (j.transferredBytes - first.b) / ((now - first.t) / 1000));
      if (speed > 0 && j.totalBytes) eta = (j.totalBytes - j.transferredBytes) / speed;
    }
  } else samples.delete(j.id);
  return { ...j, speed, eta };
}

const refreshLists = (j: TransferJobDto) => {
  void queryClient.invalidateQueries({ queryKey: ["files", j.destinationStorageId] });
  if (j.type === "MOVE") void queryClient.invalidateQueries({ queryKey: ["files", j.sourceStorageId] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  void queryClient.invalidateQueries({ queryKey: ["storages"] });
};

function upsert(j: TransferJobDto) {
  const was = prevStatus.get(j.id);
  prevStatus.set(j.id, j.status);
  transferStore.set((s) => {
    const v = view(j);
    const i = s.jobs.findIndex((x) => x.id === j.id);
    const jobs = i < 0 ? [v, ...s.jobs] : s.jobs.map((x, k) => (k === i ? v : x));
    return { ...s, jobs };
  });
  if (was && was !== j.status) {
    if (j.status === "COMPLETED") { toast.success(`Selesai: ${j.title}`, { description: `${j.sourceStorageName} → ${j.destinationStorageName}` }); refreshLists(j); }
    else if (j.status === "COPY_COMPLETED_SOURCE_RETAINED") { toast.warning(`Tersalin, tetapi sumber dipertahankan: ${j.title}`, { description: j.errorMessage ?? undefined }); refreshLists(j); }
    else if (j.status === "FAILED") { toast.error(`Transfer gagal: ${j.title}`, { description: j.errorMessage ?? undefined }); refreshLists(j); }
    else if (j.status === "CANCELLED") refreshLists(j);
  } else if (!was && j.status === "COMPLETED") refreshLists(j);
}

let es: EventSource | null = null;
export function connectTransfers() {
  disconnectTransfers();
  const ws = getWorkspaceId();
  es = new EventSource(`/api/v1/transfers/events${ws ? `?ws=${ws}` : ""}`);
  es.addEventListener("snapshot", (e) => {
    const list = JSON.parse((e as MessageEvent).data) as TransferJobDto[];
    list.forEach((j) => prevStatus.set(j.id, j.status));
    transferStore.set({ jobs: list.map(view), connected: true });
  });
  es.addEventListener("job", (e) => upsert(JSON.parse((e as MessageEvent).data)));
  es.onerror = () => transferStore.set((s) => ({ ...s, connected: false })); // EventSource reconnects by itself
}
export function disconnectTransfers() { es?.close(); es = null; transferStore.set({ jobs: [], connected: false }); prevStatus.clear(); samples.clear(); }

export const transferActions = {
  pause: (id: string) => api(`/transfers/${id}/pause`, { method: "POST", body: {} }),
  resume: (id: string) => api(`/transfers/${id}/resume`, { method: "POST", body: {} }),
  cancel: (id: string) => api(`/transfers/${id}/cancel`, { method: "POST", body: {} }),
  retry: (id: string) => api(`/transfers/${id}/retry`, { method: "POST", body: {} }),
};
