import type { AutomationAction, AutomationConditions, AutomationDto, AutomationFileKind } from "@superdrive/shared";

export const EVENT_LABEL = { "transfer.failed": "Saat transfer gagal", "transfer.completed": "Saat transfer selesai", "share.opened": "Saat tautan berbagi dibuka", "upload.failed": "Saat unggahan gagal" } as const;
export const KIND_LABEL: Record<AutomationFileKind, string> = { image: "Gambar", video: "Video", audio: "Audio", pdf: "PDF", document: "Dokumen", archive: "Arsip" };
export const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const p = (n: number) => String(n).padStart(2, "0");

/** The server runs schedules in UTC; people think in their own clock. These convert a time of day (and a weekday) between the two. */
export function localToUtc(at: string, weekday?: number) {
  const [h, m] = at.split(":").map(Number) as [number, number]; const d = new Date(); d.setHours(h, m, 0, 0);
  if (weekday !== undefined) d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
  return { at: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`, weekday: weekday === undefined ? undefined : d.getUTCDay() };
}
export function utcToLocal(at: string, weekday?: number) {
  const [h, m] = at.split(":").map(Number) as [number, number]; const d = new Date(); d.setUTCHours(h, m, 0, 0);
  if (weekday !== undefined) d.setUTCDate(d.getUTCDate() + ((weekday - d.getUTCDay() + 7) % 7));
  return { at: `${p(d.getHours())}:${p(d.getMinutes())}`, weekday: weekday === undefined ? undefined : d.getDay() };
}

export const whereOf = (a: Pick<AutomationDto, "storageName" | "folderPath" | "recursive">) =>
  `${a.storageName ?? ""}${a.folderPath && a.folderPath !== "/" ? a.folderPath : ""}${a.recursive ? " dan folder di bawahnya" : ""}`;

export function describeTrigger(a: AutomationDto): string {
  const t = a.trigger;
  if (t.type === "file.created") return `Saat file baru masuk ke ${whereOf(a)}`;
  if (t.type === "event") return EVENT_LABEL[t.event];
  const l = t.every === "daily" || t.every === "weekly" ? utcToLocal(t.at ?? "02:00", t.weekday) : null;
  const when = t.every === "minutes" ? `Setiap ${t.n ?? 15} menit` : t.every === "hourly" ? "Setiap jam" : t.every === "daily" ? `Setiap hari pukul ${l!.at}` : `Setiap ${DAYS[l!.weekday ?? 0]} pukul ${l!.at}`;
  return `${when} · ${whereOf(a)}`;
}

export function describeConditions(c: AutomationConditions): string[] {
  const out: string[] = [];
  if (c.name) out.push(`nama mengandung “${c.name}”`);
  if (c.ext?.length) out.push(`ekstensi ${c.ext.map((e) => `.${e}`).join(", ")}`);
  if (c.kinds?.length) out.push(`jenis ${c.kinds.map((k) => KIND_LABEL[k]).join(", ")}`);
  if (c.minSize) out.push(`ukuran ≥ ${Math.round(c.minSize / 1_048_576)} MB`);
  if (c.maxSize) out.push(`ukuran ≤ ${Math.round(c.maxSize / 1_048_576)} MB`);
  if (c.olderThanDays !== undefined) out.push(`lebih lama dari ${c.olderThanDays} hari`);
  return out;
}

export function describeAction(x: AutomationAction): string {
  switch (x.type) {
    case "move": return `Pindahkan ke ${x.label ?? "folder tujuan"}`;
    case "copy": return `${x.mirror ? "Sinkronkan ke" : "Salin ke"} ${x.label ?? "folder tujuan"}`;
    case "tag": return `Beri tag “${x.tag}”`;
    case "star": return "Beri bintang";
    case "trash": return "Pindahkan ke sampah";
    case "notify": return "Kirim notifikasi";
    case "webhook": { try { return `Kirim webhook ke ${new URL(x.url).host}`; } catch { return "Kirim webhook"; } }
  }
}
