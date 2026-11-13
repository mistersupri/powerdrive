import type { FastifyReply, FastifyRequest } from "fastify";
import { ZipArchive } from "archiver";
import path from "node:path";
import { PassThrough } from "node:stream";
import { ROOT, type RemoteFile, type StorageProvider } from "../providers/types.ts";
import { mapProviderError } from "./storages.ts";
import fs from "node:fs";
import { db } from "../db.ts";
import { getThumbnail, pickSize } from "./thumbnails.ts";

/** Types that are safe to render inline from our own origin. Everything else is downloaded, never rendered. */
const INLINE_OK = /^(image\/(png|jpe?g|webp|gif|avif|bmp|tiff)|video\/(mp4|webm|ogg|quicktime)|audio\/(mpeg|mp3|wav|x-wav|ogg|webm|aac|mp4|flac)|application\/pdf)$/;
const TEXTLIKE = /^(text\/|application\/(json|xml|javascript|x-sh))/;

export const contentDisposition = (type: "inline" | "attachment", name: string) =>
  `${type}; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16))}`;

function parseRange(h: string | undefined, size: number | null): { start: number; end?: number } | "invalid" | null {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null; // multi-range / malformed: serve whole file
  if (m[1] === "") { // suffix range: last N bytes
    if (size === null) return null;
    const n = Math.min(Number(m[2]), size); return n === 0 ? "invalid" : { start: size - n, end: size - 1 };
  }
  const start = Number(m[1]); const end = m[2] === "" ? undefined : Number(m[2]);
  if (size !== null && (start >= size || (end !== undefined && end < start))) return "invalid";
  return { start, end: end !== undefined && size !== null ? Math.min(end, size - 1) : end };
}

/** Streams a file with HTTP Range support. Works for any adapter; bytes are never buffered in memory. */
export async function sendFile(req: FastifyRequest, reply: FastifyReply, p: StorageProvider, storageId: string, file: RemoteFile, inline: boolean) {
  try {
    const mime = file.mimeType ?? "application/octet-stream";
    const canInline = inline && (INLINE_OK.test(mime) || TEXTLIKE.test(mime));
    const range = p.capabilities.rangeRead ? parseRange(req.headers.range, file.size) : null;
    if (range === "invalid") return reply.status(416).header("content-range", `bytes */${file.size}`).send();
    const etag = file.version ? `"${Buffer.from(file.version).toString("base64url").slice(0, 40)}"` : null;
    if (etag && req.headers["if-none-match"] === etag && !range) return reply.status(304).send();

    const r = await p.read(file.id, { range: range ?? undefined });
    reply.header("accept-ranges", p.capabilities.rangeRead ? "bytes" : "none");
    reply.header("content-disposition", contentDisposition(canInline ? "inline" : "attachment", file.name));
    // Text is served as text/plain so browsers never execute it; unknown/active types are forced to download.
    reply.header("content-type", canInline && TEXTLIKE.test(mime) ? "text/plain; charset=utf-8" : canInline ? mime : "application/octet-stream");
    reply.header("cache-control", "private, max-age=0, must-revalidate");
    if (etag) reply.header("etag", etag);
    if (canInline) reply.header("content-security-policy", "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'");
    if (r.range) {
      reply.status(206).header("content-range", `bytes ${r.range.start}-${r.range.end}/${r.range.total}`).header("content-length", r.range.end - r.range.start + 1);
    } else if (r.size !== null) reply.header("content-length", r.size);
    // If the client goes away, stop pulling bytes from the provider.
    req.raw.on("close", () => { if (!r.stream.destroyed) r.stream.destroy(); });
    return reply.send(r.stream);
  } catch (e) { mapProviderError(e, storageId); }
}

/** Streams a folder as a ZIP built on the fly. Entries are appended one at a time so memory stays flat. */
export async function sendFolderZip(req: FastifyRequest, reply: FastifyReply, p: StorageProvider, storageId: string, folder: RemoteFile) {
  return sendZip(req, reply, p, [folder], `${folder.name}.zip`);
}

/** Streams any selection (files and folders) as one ZIP built on the fly. */
export async function sendZip(req: FastifyRequest, reply: FastifyReply, p: StorageProvider, roots: RemoteFile[], zipName: string) {
  const zip = new ZipArchive({ zlib: { level: 1 }, forceZip64: true });
  const out = new PassThrough({ highWaterMark: 1024 * 1024 });
  zip.pipe(out);
  let aborted = false;
  req.raw.on("close", () => { aborted = true; zip.abort(); out.destroy(); });
  zip.on("error", () => out.destroy());

  const walk = async (id: string, prefix: string) => {
    let token: string | null = null;
    do {
      const page = await p.list(id, { pageToken: token, limit: 500 });
      token = page.nextPageToken;
      if (!page.items.length && !token && prefix) zip.append("", { name: prefix + "/" });
      for (const f of page.items) {
        if (aborted) return;
        const name = path.posix.join(prefix, f.name);
        if (f.isFolder) await walk(f.id, name);
        else {
          const r = await p.read(f.id);
          await new Promise<void>((res, rej) => {
            zip.once("entry", () => res());
            r.stream.on("error", rej);
            zip.append(r.stream, { name });
          });
        }
      }
    } while (token);
  };
  const used = new Set<string>();
  const unique = (n: string) => { let c = n, i = 2; while (used.has(c)) { const d = n.lastIndexOf("."); c = d > 0 ? `${n.slice(0, d)} (${i})${n.slice(d)}` : `${n} (${i})`; i++; } used.add(c); return c; };
  const addFile = async (f: RemoteFile, name: string) => {
    const r = await p.read(f.id);
    await new Promise<void>((res, rej) => { zip.once("entry", () => res()); r.stream.on("error", rej); zip.append(r.stream, { name }); });
  };
  void (async () => {
    try {
      for (const r of roots) {
        if (aborted) break;
        const name = unique(r.name);
        if (r.isFolder) await walk(r.id === ROOT ? ROOT : r.id, name); else await addFile(r, name);
      }
      if (!aborted) await zip.finalize();
    }
    catch (e) { req.log.warn({ err: e }, "zip aborted"); zip.abort(); out.destroy(e as Error); }
  })();
  reply.header("content-type", "application/zip");
  reply.header("content-disposition", contentDisposition("attachment", zipName));
  reply.header("cache-control", "no-store");
  return reply.send(out);
}


/** Metadata for a file: index first (no provider round-trip), provider as fallback. */
export async function metaOf(storageId: string, p: StorageProvider, rawId: string): Promise<RemoteFile> {
  const r = db.get<any>("SELECT * FROM files WHERE storage_id = ? AND file_id = ?", storageId, rawId);
  if (r) return { id: r.file_id, parentId: r.parent_id, name: r.name, isFolder: !!r.is_folder, mimeType: r.mime_type, size: r.size, modifiedAt: r.modified_at, createdAt: r.created_at_remote, checksum: r.checksum, version: r.version, hasThumbnail: !!r.has_thumbnail };
  try { return await p.stat(rawId); } catch (e) { return mapProviderError(e, storageId); }
}

/** Cached thumbnail with ETag/304 and version-pinned immutable caching. Shared by the app and public share links. */
export async function sendThumbnail(req: FastifyRequest, reply: FastifyReply, storageId: string, p: StorageProvider, raw: string, requested: number, version?: string) {
  const meta = await metaOf(storageId, p, raw);
  if (meta.isFolder || !meta.hasThumbnail) return reply.status(404).header("cache-control", "private, max-age=300").send();
  const size = pickSize(requested);
  const etag = `"t-${storageId.slice(0, 8)}-${Buffer.from(`${raw}|${meta.version}|${size}`).toString("base64url").slice(-24)}"`;
  if (req.headers["if-none-match"] === etag) return reply.status(304).send();
  // If the browser gives up on this image (scrolled away), its queued decode is dropped.
  const ac = new AbortController(); req.raw.on("close", () => ac.abort());
  const t = await getThumbnail(storageId, p, meta, size, { signal: ac.signal });
  if (ac.signal.aborted) return reply.status(499).send();
  if (!t) return reply.status(404).header("cache-control", "private, max-age=300").send();
  reply.header("cache-control", version ? "private, max-age=31536000, immutable" : "private, max-age=0, must-revalidate");
  reply.header("etag", etag).header("content-type", "image/webp");
  return reply.send(fs.createReadStream(t.path, { highWaterMark: 64 * 1024 }));
}
