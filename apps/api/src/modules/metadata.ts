import { execFile } from "node:child_process";
import { promisify } from "node:util";
import exifr from "exifr";
import sharp from "sharp";
import { db } from "../db.ts";
import type { RemoteFile, StorageProvider } from "../providers/types.ts";

const run = promisify(execFile);
export type MetaGroup = { title: string; rows: { k: string; v: string }[] };

const fmtDur = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.round(s % 60); return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const num = (v: unknown, d = 1) => (typeof v === "number" && isFinite(v) ? String(Math.round(v * 10 ** d) / 10 ** d) : null);
const put = (rows: MetaGroup["rows"], k: string, v: string | null | undefined) => { if (v) rows.push({ k, v }); };

async function readHead(p: StorageProvider, f: RemoteFile, bytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let n = 0;
  const { stream } = await p.read(f.id, { range: { start: 0, end: Math.min(bytes, Math.max(1, f.size ?? bytes)) - 1 } });
  for await (const c of stream as AsyncIterable<Buffer>) { chunks.push(c); n += c.length; if (n >= bytes) break; }
  (stream as any).destroy?.();
  return Buffer.concat(chunks).subarray(0, bytes);
}

async function imageMeta(p: StorageProvider, f: RemoteFile): Promise<MetaGroup[]> {
  const buf = await readHead(p, f, 512 * 1024);
  const groups: MetaGroup[] = []; const img: MetaGroup["rows"] = [];
  try { const m = await sharp(buf, { failOn: "none" }).metadata(); put(img, "Dimensi", m.width && m.height ? `${m.width} × ${m.height} px` : null); put(img, "Format", m.format?.toUpperCase()); put(img, "Ruang warna", m.space); put(img, "Kedalaman", m.depth); put(img, "Transparansi", m.hasAlpha ? "Ya" : null); } catch { /* header only */ }
  if (img.length) groups.push({ title: "Gambar", rows: img });
  try {
    const x: any = await exifr.parse(buf, { tiff: true, exif: true, gps: true, translateValues: true, reviveValues: true } as any);
    if (x) {
      const cam: MetaGroup["rows"] = [];
      put(cam, "Kamera", [x.Make, x.Model].filter(Boolean).join(" ").trim() || null); put(cam, "Lensa", x.LensModel);
      put(cam, "Diambil", x.DateTimeOriginal instanceof Date ? x.DateTimeOriginal.toISOString() : typeof x.DateTimeOriginal === "string" ? x.DateTimeOriginal : null);
      put(cam, "ISO", num(x.ISO, 0)); put(cam, "Bukaan", x.FNumber ? `f/${num(x.FNumber)}` : null);
      put(cam, "Waktu rana", x.ExposureTime ? (x.ExposureTime < 1 ? `1/${Math.round(1 / x.ExposureTime)} dtk` : `${x.ExposureTime} dtk`) : null);
      put(cam, "Panjang fokus", x.FocalLength ? `${num(x.FocalLength)} mm` : null); put(cam, "Orientasi", typeof x.Orientation === "string" ? x.Orientation : null); put(cam, "Perangkat lunak", x.Software);
      if (cam.length) groups.push({ title: "Kamera", rows: cam });
      if (typeof x.latitude === "number" && typeof x.longitude === "number") groups.push({ title: "Lokasi", rows: [{ k: "Koordinat", v: `${x.latitude.toFixed(5)}, ${x.longitude.toFixed(5)}` }] });
    }
  } catch { /* no EXIF */ }
  return groups;
}

async function videoMeta(p: StorageProvider, f: RemoteFile): Promise<MetaGroup[]> {
  if (!p.localPath) return [{ title: "Video", rows: [{ k: "Catatan", v: "Detail video hanya tersedia untuk penyimpanan di server ini." }] }];
  try {
    const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", p.localPath(f.id)], { timeout: 8000, maxBuffer: 2_000_000 });
    const j = JSON.parse(stdout); const v = j.streams?.find((s: any) => s.codec_type === "video"); const a = j.streams?.find((s: any) => s.codec_type === "audio");
    const rows: MetaGroup["rows"] = [];
    put(rows, "Durasi", j.format?.duration ? fmtDur(Number(j.format.duration)) : null); put(rows, "Dimensi", v?.width ? `${v.width} × ${v.height} px` : null);
    const fr = v?.avg_frame_rate?.split("/").map(Number); put(rows, "Frame rate", fr?.[1] ? `${num(fr[0]! / fr[1]!)} fps` : null);
    put(rows, "Codec video", v?.codec_name?.toUpperCase()); put(rows, "Codec audio", a?.codec_name?.toUpperCase()); put(rows, "Bitrate", j.format?.bit_rate ? `${Math.round(Number(j.format.bit_rate) / 1000)} kbps` : null);
    put(rows, "Dibuat", j.format?.tags?.creation_time);
    return [{ title: "Video", rows }];
  } catch { return []; }
}

/** Technical metadata (EXIF, video streams). Cached per file version; failures yield an empty list, never an error. */
export async function fileMetadata(storageId: string, p: StorageProvider, f: RemoteFile): Promise<MetaGroup[]> {
  if (f.isFolder) return [];
  const ver = f.version ?? String(f.modifiedAt ?? "");
  const hit = db.get<{ version: string; data: string }>("SELECT version, data FROM file_meta_cache WHERE storage_id = ? AND file_id = ?", storageId, f.id);
  if (hit && hit.version === ver) return JSON.parse(hit.data);
  const mime = f.mimeType ?? ""; let out: MetaGroup[] = [];
  try {
    if (/^image\/(jpeg|png|webp|tiff|heic|heif|avif|gif)/.test(mime) || /\.(jpe?g|png|webp|tiff?|heic|heif|avif|gif)$/i.test(f.name)) out = await imageMeta(p, f);
    else if (mime.startsWith("video/") || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f.name)) out = await videoMeta(p, f);
  } catch { out = []; }
  db.run("INSERT INTO file_meta_cache(storage_id, file_id, version, data) VALUES (?,?,?,?) ON CONFLICT(storage_id, file_id) DO UPDATE SET version = excluded.version, data = excluded.data", storageId, f.id, ver, JSON.stringify(out));
  return out;
}
