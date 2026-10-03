const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return "0 B";
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(1))} ${UNITS[i]}`;
}

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "03 Okt 2026" */
export function formatDate(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "-";
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

/** "03 Okt" */
export function formatShortDate(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "-";
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

/** "03 Okt 2026, 14.05" */
export function formatDateTime(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "-";
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "2 folder dan 3 berkas", "1 folder", "4 berkas" */
export function describeItemCount(folderCount: number, fileCount: number): string {
  if (folderCount > 0 && fileCount > 0) return `${folderCount} folder dan ${fileCount} berkas`;
  if (folderCount > 0) return `${folderCount} folder`;
  return `${fileCount} berkas`;
}
