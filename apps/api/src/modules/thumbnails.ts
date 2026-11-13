import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp, { type Sharp } from "sharp";
import { config } from "../config.ts";
import { Semaphore } from "../providers/http.ts";
import type { RemoteFile, StorageProvider } from "../providers/types.ts";

const run = promisify(execFile);
sharp.cache({ memory: 128, files: 0, items: 100 });
sharp.concurrency(Math.max(1, Math.min(4, config.thumbnails.concurrency)));

/**
 * Thumbnail pipeline. Goals: never decode the same image twice, never download an original when
 * the provider can hand us a thumbnail, and never let a page of 100 photos stampede the CPU.
 *
 *  1. Content-addressed disk cache — key = storage + file + version + size, so edits invalidate by themselves.
 *  2. In-flight dedupe — concurrent requests for the same key share one job.
 *  3. Bounded concurrency — N decodes at a time, the rest queue.
 *  4. Negative cache — files that cannot be thumbnailed are remembered for a while.
 */
const limiter = new Semaphore(config.thumbnails.concurrency);
const inflight = new Map<string, Promise<string | null>>();
const failures = new Map<string, number>();
const FAIL_TTL = 10 * 60_000;
const dir = path.join(config.cacheDir, "thumbs");

let hasFfmpeg: Promise<boolean> | null = null;
const ffmpegAvailable = () => (hasFfmpeg ??= run("ffmpeg", ["-version"]).then(() => true, () => false));

export const pickSize = (req: number) => config.thumbnails.sizes.find((s) => s >= req) ?? config.thumbnails.sizes.at(-1)!;
export const thumbKey = (storageId: string, fileId: string, version: string | null, size: number) =>
  crypto.createHash("sha1").update(`${storageId}\0${fileId}\0${version ?? ""}\0${size}`).digest("hex");
export const thumbPath = (key: string) => path.join(dir, key.slice(0, 2), `${key}.webp`);

const IMG = /^image\/(jpeg|png|webp|gif|avif|tiff)$/;
const toWebp = (s: Sharp, size: number) =>
  s.rotate().resize({ width: size, height: size, fit: "inside", withoutEnlargement: true }).webp({ quality: size >= 512 ? 78 : 70, effort: 2 });

async function generate(storageId: string, p: StorageProvider, file: RemoteFile, size: number, out: string): Promise<boolean> {
  const mime = file.mimeType ?? "";
  const tmp = `${out}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fsp.mkdir(path.dirname(out), { recursive: true });
  try {
    let done = false;
    // 1) Local file on this server: let libvips read it directly (shrink-on-load for JPEG makes this very fast).
    if (p.localPath && IMG.test(mime)) {
      await toWebp(sharp(p.localPath(file.id), { failOn: "none", limitInputPixels: 268_000_000, sequentialRead: true }), size).toFile(tmp);
      done = true;
    } else if (p.localPath && mime.startsWith("video/") && (await ffmpegAvailable())) {
      const { stdout } = await run("ffmpeg", ["-v", "error", "-ss", "1", "-i", p.localPath(file.id), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
        { encoding: "buffer", maxBuffer: 32 * 1024 * 1024, timeout: 20_000 }).catch(() =>
        // Very short clips have no frame at 1s.
        run("ffmpeg", ["-v", "error", "-i", p.localPath!(file.id), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-"], { encoding: "buffer", maxBuffer: 32 * 1024 * 1024, timeout: 20_000 }));
      await toWebp(sharp(stdout as Buffer, { failOn: "none" }), size).toFile(tmp);
      done = true;
    }
    // 2) Provider-generated thumbnail: tiny transfer, no original download.
    if (!done && p.thumbnail && p.capabilities.nativeThumbnails) {
      const t = await p.thumbnail(file, size).catch(() => null);
      if (t) {
        const pipe = toWebp(sharp({ failOn: "none" }), size);
        t.stream.pipe(pipe);
        await pipe.toFile(tmp);
        done = true;
      }
    }
    // 3) Last resort for images: stream the original through libvips, capped by size.
    if (!done && IMG.test(mime) && file.size !== null && file.size <= config.thumbnails.maxSourceBytes) {
      const r = await p.read(file.id);
      const pipe = toWebp(sharp({ failOn: "none", limitInputPixels: 268_000_000 }), size);
      r.stream.on("error", (e) => pipe.destroy(e));
      r.stream.pipe(pipe);
      await pipe.toFile(tmp);
      done = true;
    }
    if (!done) return false;
    await fsp.rename(tmp, out);
    return true;
  } catch {
    return false;
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {});
  }
}

/** Returns the cached file path, generating it if needed. `null` means "no thumbnail for this file". */
export async function getThumbnail(storageId: string, p: StorageProvider, file: RemoteFile, requested: number): Promise<{ path: string; key: string } | null> {
  const size = pickSize(requested);
  const key = thumbKey(storageId, file.id, file.version, size);
  const out = thumbPath(key);
  if (await fsp.access(out).then(() => true, () => false)) return { path: out, key };
  const failedAt = failures.get(key);
  if (failedAt && Date.now() - failedAt < FAIL_TTL) return null;
  let job = inflight.get(key);
  if (!job) {
    job = limiter.run(async () => (await generate(storageId, p, file, size, out)) ? out : null)
      .then((r) => { if (!r) failures.set(key, Date.now()); return r; })
      .finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  const r = await job;
  if (failures.size > 5000) for (const [k, t] of failures) if (Date.now() - t > FAIL_TTL) failures.delete(k);
  return r ? { path: r, key } : null;
}

export const thumbStream = (p: string) => fs.createReadStream(p, { highWaterMark: 64 * 1024 });

/** Remove cache files that have not been read in `days` days (run from the maintenance job). */
export async function pruneThumbnailCache(days = 60) {
  const cutoff = Date.now() - days * 86_400_000; let removed = 0;
  const subs = await fsp.readdir(dir).catch(() => [] as string[]);
  for (const s of subs) {
    const files = await fsp.readdir(path.join(dir, s)).catch(() => [] as string[]);
    for (const f of files) {
      const fp = path.join(dir, s, f);
      const st = await fsp.stat(fp).catch(() => null);
      if (st && Math.max(st.atimeMs, st.mtimeMs) < cutoff) { await fsp.rm(fp, { force: true }); removed++; }
    }
  }
  return removed;
}
