import type { FastifyReply, FastifyRequest } from "fastify";
import { ZipArchive } from "archiver";
import path from "node:path";
import { PassThrough } from "node:stream";
import { ProviderError, ROOT, type RemoteFile, type StorageProvider } from "../providers/types.ts";
import { mapProviderError } from "./storages.ts";

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
  void (async () => {
    try { await walk(folder.id === ROOT ? ROOT : folder.id, ""); if (!aborted) await zip.finalize(); }
    catch (e) { req.log.warn({ err: e }, "zip aborted"); zip.abort(); out.destroy(e as Error); }
  })();
  reply.header("content-type", "application/zip");
  reply.header("content-disposition", contentDisposition("attachment", `${folder.name}.zip`));
  reply.header("cache-control", "no-store");
  return reply.send(out);
}
void ProviderError;
