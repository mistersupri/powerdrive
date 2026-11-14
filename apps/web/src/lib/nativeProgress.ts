import { ACTIVE_TRANSFER_STATUSES } from "@superdrive/shared";
import { uploadStore } from "@/features/uploads/manager";
import { transferStore } from "@/features/transfers/store";

type Bridge = { progress?(json: string): void };
const bridge = () => (window as unknown as { SuperDriveAndroid?: Bridge }).SuperDriveAndroid;

/** Inside the Android app: mirror upload and transfer progress into a system notification (the app shows it, and keeps itself alive while it runs). */
export function startNativeProgress(): () => void {
  const b = bridge();
  if (!b?.progress) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null; let last = 0;
  const send = () => {
    timer = null; last = Date.now();
    const ups = uploadStore.get().tasks; const jobs = transferStore.get().jobs;
    const upActive = ups.filter((t) => t.status === "queued" || t.status === "uploading" || t.status === "processing");
    const jobActive = jobs.filter((j) => ACTIVE_TRANSFER_STATUSES.includes(j.status) && j.status !== "PAUSED");
    const active = upActive.length + jobActive.length;
    const done = ups.filter((t) => t.status === "done" || t.status === "skipped").length + jobs.filter((j) => j.status === "COMPLETED").length;
    const failed = ups.filter((t) => t.status === "error").length + jobs.filter((j) => j.status === "FAILED").length;
    // Share of the bytes of everything still in flight (plus what already finished in this batch).
    const batch = ups.filter((t) => t.status !== "cancelled");
    let total = batch.reduce((n, t) => n + t.size, 0) + jobActive.reduce((n, j) => n + (j.totalBytes ?? 0), 0);
    let sent = batch.reduce((n, t) => n + (t.status === "done" || t.status === "skipped" || t.status === "processing" ? t.size : Math.min(t.sent, t.size)), 0) + jobActive.reduce((n, j) => n + j.transferredBytes, 0);
    if (!total) { total = 1; sent = 0; }
    const kind = upActive.length && !jobActive.length ? "Mengunggah" : jobActive.length && !upActive.length ? "Memindahkan" : "Memproses";
    const label = active === 1 ? (upActive[0]?.name ?? jobActive[0]?.title ?? "") : `${active} berkas`;
    try { b.progress!(JSON.stringify({ active, done, failed, percent: Math.min(100, Math.floor((sent / total) * 100)), title: `${kind} ${label}`.trim() })); } catch { /* the app may be closing */ }
  };
  const schedule = () => {
    if (timer) return;
    const wait = Math.max(0, 700 - (Date.now() - last));
    timer = setTimeout(send, wait);
  };
  const off = [uploadStore.subscribe(schedule), transferStore.subscribe(schedule)];
  return () => { off.forEach((f) => f()); if (timer) clearTimeout(timer); };
}
