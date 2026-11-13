import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp, { type Sharp } from "sharp";
import { config } from "../config.ts";
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
/**
 * Jobs wait in a LIFO queue (the thumbnails the user is looking at *now* are the most recently requested) and are
 * dropped when every request waiting for them has gone away — scrolling past 100 photos must not leave 100 decodes
 * queued ahead of the ones on screen.
 */
interface Job { key: string; waiters: number; run: () => Promise<boolean>; resolve: (v: string | null) => void; out: string; started: boolean; priority: "high" | "low" }
const queue: Job[] = []; let active = 0;
function pump() {
  while (active < config.thumbnails.concurrency) {
    // High priority (requested by a person) first, newest first; background pre-generation only when nothing else waits.
    let i = -1;
    for (let k = queue.length - 1; k >= 0; k--) if (queue[k]!.priority === "high") { i = k; break; }
    if (i < 0) i = queue.findIndex((j) => j.priority === "low");
    if (i < 0) return;
    const [job] = queue.splice(i, 1) as [Job];
    if (job.waiters <= 0 && job.priority === "high") { inflight.delete(job.key); job.resolve(null); continue; }
    job.started = true; active++;
    job.run().then((ok) => { if (!ok) failures.set(job.key, Date.now()); job.resolve(ok ? job.out : null); }, () => job.resolve(null))
      .finally(() => { active--; inflight.delete(job.key); pump(); });
  }
}
const inflight = new Map<string, Promise<string | null>>();
const jobs = new Map<string, Job>();
const failures = new Map<string, number>();
export const thumbLog: { warn: (o: unknown, m?: string) => void } = { warn: () => {} };
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
  } catch (e) {
    thumbLog.warn({ err: (e as Error).message, file: file.name, size: file.size, mime }, "thumbnail generation failed");
    return false;
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {});
  }
}

/** Returns the cached file path, generating it if needed. `null` means "no thumbnail for this file". */
export async function getThumbnail(storageId: string, p: StorageProvider, file: RemoteFile, requested: number, opts: { signal?: AbortSignal; priority?: "high" | "low" } = {}): Promise<{ path: string; key: string } | null> {
  const size = pickSize(requested);
  const key = thumbKey(storageId, file.id, file.version, size);
  const out = thumbPath(key);
  if (await fsp.access(out).then(() => true, () => false)) return { path: out, key };
  const failedAt = failures.get(key);
  if (failedAt && Date.now() - failedAt < FAIL_TTL) return null;
  let job = jobs.get(key);
  if (!job) {
    let resolve!: (v: string | null) => void;
    const promise = new Promise<string | null>((r) => { resolve = r; });
    job = { key, waiters: 1, out, started: false, priority: opts.priority ?? "high", resolve: (v) => { jobs.delete(key); resolve(v); }, run: () => generate(storageId, p, file, size, out) };
    inflight.set(key, promise); jobs.set(key, job); queue.push(job); pump();
  } else { job.waiters++; if ((opts.priority ?? "high") === "high") job.priority = "high"; }
  const promise = inflight.get(key)!;
  const release = () => { job!.waiters--; };
  opts.signal?.addEventListener("abort", release, { once: true });
  const r = await promise.finally(() => opts.signal?.removeEventListener("abort", release));
  if (failures.size > 5000) for (const [k, t] of failures) if (Date.now() - t > FAIL_TTL) failures.delete(k);
  return r ? { path: r, key } : null;
}

/** Warm the cache in the background (e.g. right after an upload or transfer) without competing with people. */
export function prewarmThumbnail(storageId: string, p: StorageProvider, file: RemoteFile) {
  if (!file.hasThumbnail || file.isFolder) return;
  void getThumbnail(storageId, p, file, 256, { priority: "low" }).catch(() => {});
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
