export { formatBytes } from "@superdrive/shared";

const rtf = new Intl.RelativeTimeFormat("id", { numeric: "auto" });
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 45) return "baru saja";
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}
export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—";

export function formatEta(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return "—";
  if (sec < 60) return `${Math.max(1, Math.round(sec))} dtk`;
  if (sec < 3600) return `${Math.floor(sec / 60)} mnt ${Math.round(sec % 60)} dtk`;
  return `${Math.floor(sec / 3600)} j ${Math.floor((sec % 3600) / 60)} mnt`;
}
export const formatSpeed = (bps: number | null) => bps === null ? "—" : `${(bps / 1048576).toFixed(bps >= 10 * 1048576 ? 0 : 1)} MB/dtk`;
export const percent = (done: number, total: number | null) => (total ? Math.min(100, Math.floor((done / total) * 100)) : 0);
