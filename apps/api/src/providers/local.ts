import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import mime from "mime-types";
import { baseCaps, ProviderError, ROOT, type AccountInfo, type ListResult, type ReadOptions, type ReadResult, type RemoteFile, type StorageProvider, type WriteInput } from "./types.ts";

export const TRASH_DIR = ".superdrive-trash";
const HIDDEN = (n: string) => n === TRASH_DIR || n.endsWith(".sdpart");

const encRel = (rel: string) => (rel === "" ? ROOT : "p" + Buffer.from(rel, "utf8").toString("base64url"));
const decRel = (id: string) => (id === ROOT ? "" : Buffer.from(id.slice(1), "base64url").toString("utf8"));
const THUMB_MIME = /^(image\/(jpeg|png|webp|gif|avif|tiff)|video\/)/;

/**
 * Server-side directory. Every path is resolved against the configured root and checked with
 * realpath so `..` segments and symlinks cannot leave it.
 */
export class LocalProvider implements StorageProvider {
  readonly type = "LOCAL" as const;
  readonly capabilities = baseCaps({ resumableUpload: true, nativeCopy: true, nativeMove: true, checksums: false, webhooks: false });
  private realRoot: string;

  constructor(private root: string, private displayName = "Folder server") {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
    this.realRoot = fs.realpathSync(this.root);
  }

  private abs(rel: string): string {
    const full = path.resolve(this.root, rel);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) throw new ProviderError("Path di luar folder yang diizinkan.", "auth");
    return full;
  }
  /** Resolve symlinks of the deepest existing ancestor and make sure we stay inside the root. */
  private async safe(rel: string): Promise<string> {
    const full = this.abs(rel);
    let probe = full;
    for (;;) {
      try {
        const real = await fsp.realpath(probe);
        if (real !== this.realRoot && !real.startsWith(this.realRoot + path.sep)) throw new ProviderError("Symlink keluar dari folder yang diizinkan.", "auth");
        return full;
      } catch (e: any) {
        if (e instanceof ProviderError) throw e;
        if (e.code !== "ENOENT") throw e;
        const up = path.dirname(probe);
        if (up === probe) return full;
        probe = up;
      }
    }
  }
  private relOf(id: string) { return decRel(id); }
  private checkName(name: string) {
    if (!name || name === "." || name === ".." || /[\\/\0]/.test(name) || name.length > 255) throw new ProviderError("Nama tidak valid.", "other");
    if (HIDDEN(name)) throw new ProviderError("Nama ini dicadangkan oleh sistem.", "other");
  }

  localPath(id: string) { return this.abs(this.relOf(id)); }

  private async toRemote(rel: string, st: fs.Stats): Promise<RemoteFile> {
    const name = rel === "" ? this.displayName : path.basename(rel);
    const isFolder = st.isDirectory();
    const mimeType = isFolder ? null : ((mime.lookup(name) as string) || "application/octet-stream");
    return {
      id: encRel(rel), parentId: rel === "" ? null : encRel(path.dirname(rel) === "." ? "" : path.dirname(rel)),
      name, isFolder, mimeType, size: isFolder ? null : st.size,
      modifiedAt: st.mtime.toISOString(), createdAt: (st.birthtimeMs ? st.birthtime : st.ctime).toISOString(),
      checksum: null, version: `${Math.floor(st.mtimeMs)}-${st.size}`,
      hasThumbnail: !isFolder && !!mimeType && THUMB_MIME.test(mimeType),
    };
  }

  async account(): Promise<AccountInfo> {
    let quota: AccountInfo["quota"] = null;
    try { const s = await fsp.statfs(this.root); quota = { total: Number(s.blocks) * Number(s.bsize), used: (Number(s.blocks) - Number(s.bfree)) * Number(s.bsize) }; } catch { /* statfs unsupported */ }
    // Quota is the whole disk, so every folder on the same disk shares one account id and is counted once.
    const dev = await fsp.stat(this.root).then((st) => st.dev, () => 0);
    return { id: `disk:${dev}`, email: null, displayName: this.displayName, quota };
  }

  async list(parentId: string, opts: { pageToken?: string | null; limit?: number } = {}): Promise<ListResult> {
    const rel = this.relOf(parentId);
    const dir = await this.safe(rel);
    const limit = opts.limit ?? 200;
    let entries: fs.Dirent[];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
    catch (e: any) { throw e.code === "ENOENT" || e.code === "ENOTDIR" ? new ProviderError("Folder tidak ditemukan.", "not_found") : e; }
    const visible = entries.filter((e) => !HIDDEN(e.name) && (e.isFile() || e.isDirectory() || e.isSymbolicLink()));
    visible.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    const start = opts.pageToken ? Number(opts.pageToken) : 0;
    const page = visible.slice(start, start + limit);
    const items = (await Promise.all(page.map(async (e) => {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      try {
        const full = this.abs(childRel);
        const st = await fsp.stat(full);
        if (e.isSymbolicLink()) { const real = await fsp.realpath(full); if (!real.startsWith(this.realRoot + path.sep)) return null; }
        return await this.toRemote(childRel, st);
      } catch { return null; }
    }))).filter((x): x is RemoteFile => !!x);
    const next = start + limit < visible.length ? String(start + limit) : null;
    return { items, nextPageToken: next };
  }

  async stat(id: string): Promise<RemoteFile> {
    const rel = this.relOf(id);
    const full = await this.safe(rel);
    try { return await this.toRemote(rel, await fsp.stat(full)); }
    catch (e: any) { if (e.code === "ENOENT") throw new ProviderError("File tidak ditemukan.", "not_found"); throw e; }
  }

  async path(id: string) {
    const rel = this.relOf(id);
    if (!rel) return [];
    const parts = rel.split("/");
    return parts.map((name, i) => ({ id: encRel(parts.slice(0, i + 1).join("/")), name }));
  }

  async findChild(parentId: string, name: string) {
    const rel = path.posix.join(this.relOf(parentId), name);
    try { return await this.toRemote(rel, await fsp.stat(await this.safe(rel))); } catch (e: any) { if (e.code === "ENOENT") return null; throw e; }
  }

  async createFolder(parentId: string, name: string) {
    this.checkName(name);
    const rel = path.posix.join(this.relOf(parentId), name);
    const full = await this.safe(rel);
    try { await fsp.mkdir(full); } catch (e: any) { if (e.code === "EEXIST") throw new ProviderError("Nama sudah dipakai.", "conflict"); throw e; }
    return this.toRemote(rel, await fsp.stat(full));
  }

  async read(id: string, opts: ReadOptions = {}): Promise<ReadResult> {
    const rel = this.relOf(id);
    const full = await this.safe(rel);
    const st = await fsp.stat(full).catch(() => { throw new ProviderError("File tidak ditemukan.", "not_found"); });
    if (st.isDirectory()) throw new ProviderError("Ini adalah folder.", "other");
    const mimeType = (mime.lookup(full) as string) || "application/octet-stream";
    let range: ReadResult["range"];
    const o: Parameters<typeof fs.createReadStream>[1] = { highWaterMark: 1024 * 1024, signal: opts.signal };
    if (opts.range && st.size > 0) {
      const start = opts.range.start;
      const end = Math.min(opts.range.end ?? st.size - 1, st.size - 1);
      if (start > end || start >= st.size) throw new ProviderError("Range tidak valid.", "other", 416);
      Object.assign(o, { start, end });
      range = { start, end, total: st.size };
    }
    return { stream: fs.createReadStream(full, o), size: range ? range.end - range.start + 1 : st.size, mimeType, range };
  }

  async write(input: WriteInput): Promise<RemoteFile> {
    this.checkName(input.name);
    const parentRel = this.relOf(input.parentId);
    await this.safe(parentRel);
    const rel = path.posix.join(parentRel, input.name);
    const full = await this.safe(rel);
    const tmp = `${full}.${crypto.randomBytes(4).toString("hex")}.sdpart`;
    try {
      await pipeline(input.stream, fs.createWriteStream(tmp, { highWaterMark: 1024 * 1024 }), { signal: input.signal });
      await fsp.rename(tmp, full);
    } catch (e) { await fsp.rm(tmp, { force: true }); throw e; }
    return this.toRemote(rel, await fsp.stat(full));
  }

  /** Adopt a finished file already on the same disk without copying bytes (used by uploads). */
  async adopt(parentId: string, name: string, srcFile: string): Promise<RemoteFile> {
    this.checkName(name);
    const rel = path.posix.join(this.relOf(parentId), name);
    const full = await this.safe(rel);
    try { await fsp.rename(srcFile, full); }
    catch (e: any) {
      if (e.code !== "EXDEV") throw e;
      await fsp.copyFile(srcFile, full); await fsp.rm(srcFile, { force: true });
    }
    return this.toRemote(rel, await fsp.stat(full));
  }

  async copy(id: string, destParentId: string, newName?: string) {
    const rel = this.relOf(id);
    const name = newName ?? path.basename(rel);
    this.checkName(name);
    const destRel = path.posix.join(this.relOf(destParentId), name);
    const src = await this.safe(rel); const dst = await this.safe(destRel);
    if (dst === src || dst.startsWith(src + path.sep)) throw new ProviderError("Tidak bisa menyalin folder ke dalam dirinya sendiri.", "conflict");
    await fsp.cp(src, dst, { recursive: true, errorOnExist: true, force: false, mode: fs.constants.COPYFILE_FICLONE });
    return this.toRemote(destRel, await fsp.stat(dst));
  }

  async move(id: string, destParentId: string, newName?: string) {
    const rel = this.relOf(id);
    const name = newName ?? path.basename(rel);
    this.checkName(name);
    const destRel = path.posix.join(this.relOf(destParentId), name);
    const src = await this.safe(rel); const dst = await this.safe(destRel);
    if (dst === src || dst.startsWith(src + path.sep)) throw new ProviderError("Tidak bisa memindahkan folder ke dalam dirinya sendiri.", "conflict");
    if (await fsp.stat(dst).then(() => true, () => false)) throw new ProviderError("Nama sudah dipakai.", "conflict");
    try { await fsp.rename(src, dst); }
    catch (e: any) { if (e.code === "EXDEV") { await fsp.cp(src, dst, { recursive: true }); await fsp.rm(src, { recursive: true }); } else throw e; }
    return this.toRemote(destRel, await fsp.stat(dst));
  }

  async rename(id: string, name: string) { return this.move(id, encRel(path.posix.dirname(this.relOf(id)) === "." ? "" : path.posix.dirname(this.relOf(id))), name); }

  /** Deleting moves to a hidden trash folder inside the root; nothing is destroyed immediately. */
  async delete(id: string) {
    const rel = this.relOf(id);
    if (!rel) throw new ProviderError("Folder utama tidak dapat dihapus.", "other");
    const src = await this.safe(rel);
    const trash = path.join(this.root, TRASH_DIR);
    await fsp.mkdir(trash, { recursive: true });
    await fsp.rename(src, path.join(trash, `${Date.now()}-${crypto.randomBytes(3).toString("hex")}-${path.basename(rel)}`));
  }
}
