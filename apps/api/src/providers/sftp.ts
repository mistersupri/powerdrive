import crypto from "node:crypto";
import path from "node:path";
import { type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import mime from "mime-types";
import { Client, type SFTPWrapper, type Stats } from "ssh2";
import { Semaphore } from "./http.ts";
import { baseOf, byFoldersThenName, checkName, hiddenName, idOf, joinRel, parentOf, relOf, THUMB_MIME, TRASH } from "./pathutil.ts";
import { baseCaps, ProviderError, ROOT, type AccountInfo, type ListResult, type ReadOptions, type ReadResult, type RemoteFile, type StorageProvider, type WriteInput } from "./types.ts";

export interface SftpConfig { host: string; port: number; username: string; baseDir: string; hostKey?: string }
export interface SftpCredentials { password?: string; privateKey?: string; passphrase?: string }

export const hostKeyFingerprint = (blob: Buffer) => "SHA256:" + crypto.createHash("sha256").update(blob).digest("base64").replace(/=+$/, "");

/**
 * SFTP over one multiplexed SSH connection. The server's host key must match the pinned fingerprint;
 * if none is pinned yet, the first one seen is pinned (trust on first use) and reported through `onPin`.
 */
export class SftpProvider implements StorageProvider {
  readonly type = "SFTP" as const;
  readonly capabilities = baseCaps({ resumableUpload: false, nativeCopy: false, nativeMove: true });
  private conn: Promise<{ client: Client; sftp: SFTPWrapper }> | null = null;
  private sem = new Semaphore(8);
  private base: string;

  constructor(private cfg: SftpConfig, private creds: SftpCredentials, private onPin?: (fp: string) => void, private displayName = "SFTP") {
    this.base = path.posix.resolve("/", cfg.baseDir || "/");
  }

  private abs(rel: string) { return rel ? path.posix.join(this.base, rel) : this.base; }

  private connect() {
    return (this.conn ??= new Promise((resolve, reject) => {
      const client = new Client();
      let done = false;
      const fail = (e: Error) => { if (!done) { done = true; this.conn = null; reject(this.mapConnErr(e)); } else { this.conn = null; } };
      client.on("ready", () => client.sftp((err, sftp) => {
        if (err) return fail(err);
        done = true; sftp.on("close", () => { this.conn = null; }); resolve({ client, sftp });
      }));
      client.on("error", fail);
      client.on("close", () => { this.conn = null; });
      client.connect({
        host: this.cfg.host, port: this.cfg.port, username: this.cfg.username, password: this.creds.password,
        privateKey: this.creds.privateKey, passphrase: this.creds.passphrase, readyTimeout: 20_000, keepaliveInterval: 15_000,
        hostVerifier: (key: Buffer) => {
          const fp = hostKeyFingerprint(key);
          if (!this.cfg.hostKey) { this.cfg.hostKey = fp; this.onPin?.(fp); return true; }
          if (this.cfg.hostKey === fp) return true;
          fail(new ProviderError(`Kunci host server SFTP berubah (${fp}). Jika ini disengaja, hapus lalu hubungkan ulang penyimpanan.`, "auth"));
          return false;
        },
      });
    }));
  }
  private mapConnErr(e: Error) {
    if (e instanceof ProviderError) return e;
    if (/authentication/i.test(e.message)) return new ProviderError("Login SFTP ditolak. Periksa username, password, atau kunci privat.", "auth", 401);
    return new ProviderError(`Tidak dapat terhubung ke server SFTP: ${e.message}`, "network");
  }
  private async s(): Promise<SFTPWrapper> { return (await this.connect()).sftp; }
  private wrap(e: any): never {
    if (e instanceof ProviderError) throw e;
    const code = e?.code;
    if (code === 2) throw new ProviderError("Tidak ditemukan.", "not_found", 404);
    if (code === 3) throw new ProviderError("Akses ditolak di server SFTP.", "auth", 403);
    if (code === 4 && /exist/i.test(e.message ?? "")) throw new ProviderError("Nama sudah dipakai.", "conflict", 409);
    throw new ProviderError(e?.message ?? String(e), "other");
  }
  private call<T>(fn: (s: SFTPWrapper, cb: (err: any, res?: T) => void) => void): Promise<T> {
    return this.sem.run(async () => { const s = await this.s(); return new Promise<T>((res, rej) => fn(s, (err, r) => (err ? rej(err) : res(r as T)))).catch((e) => this.wrap(e)); });
  }

  private toRemote(rel: string, st: Stats, name = baseOf(rel)): RemoteFile {
    const isFolder = st.isDirectory();
    const mimeType = isFolder ? null : ((mime.lookup(name) as string) || "application/octet-stream");
    return {
      id: idOf(rel), parentId: rel === "" ? null : idOf(parentOf(rel)), name: rel === "" ? this.displayName : name, isFolder, mimeType,
      size: isFolder ? null : st.size, modifiedAt: new Date(st.mtime * 1000).toISOString(), createdAt: null, checksum: null,
      version: `${st.mtime}-${st.size}`, hasThumbnail: !isFolder && !!mimeType && THUMB_MIME.test(mimeType),
    };
  }

  async account(): Promise<AccountInfo> {
    await this.call<Stats>((s, cb) => s.stat(this.base, cb));
    let quota: AccountInfo["quota"] = null;
    try {
      const v: any = await this.call<any>((s, cb) => (s as any).ext_openssh_statvfs(this.base, cb));
      quota = { total: Number(v.blocks) * Number(v.frsize ?? v.bsize), used: (Number(v.blocks) - Number(v.bfree)) * Number(v.frsize ?? v.bsize) };
    } catch { /* server has no statvfs extension */ }
    return { id: `${this.cfg.username}@${this.cfg.host}:${this.cfg.port}`, email: null, displayName: this.displayName, quota };
  }

  async list(parentId: string, opts: { pageToken?: string | null; limit?: number } = {}): Promise<ListResult> {
    const rel = relOf(parentId); const limit = opts.limit ?? 200;
    const entries = await this.call<{ filename: string; attrs: Stats }[]>((s, cb) => s.readdir(this.abs(rel), cb as any));
    const visible = entries.filter((e) => e.filename !== "." && e.filename !== ".." && !hiddenName(e.filename));
    const start = opts.pageToken ? Number(opts.pageToken) : 0;
    // Directory order comes from the server; sort cheaply by type then name before paging.
    visible.sort((a, b) => Number(b.attrs.isDirectory()) - Number(a.attrs.isDirectory()) || a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: "base" }));
    const page = visible.slice(start, start + limit);
    const items = await Promise.all(page.map(async (e) => {
      let attrs = e.attrs;
      if (attrs.isSymbolicLink()) { try { attrs = await this.call<Stats>((s, cb) => s.stat(this.abs(joinRel(rel, e.filename)), cb)); } catch { return null; } }
      return this.toRemote(joinRel(rel, e.filename), attrs, e.filename);
    }));
    return { items: items.filter((x): x is RemoteFile => !!x).sort(byFoldersThenName), nextPageToken: start + limit < visible.length ? String(start + limit) : null };
  }

  async stat(id: string) { const rel = relOf(id); return this.toRemote(rel, await this.call<Stats>((s, cb) => s.stat(this.abs(rel), cb))); }

  async path(id: string) {
    const rel = relOf(id); if (!rel) return [];
    const parts = rel.split("/");
    return parts.map((name, i) => ({ id: parts.slice(0, i + 1).join("/"), name }));
  }

  async findChild(parentId: string, name: string) {
    const rel = joinRel(relOf(parentId), name);
    try { return this.toRemote(rel, await this.call<Stats>((s, cb) => s.stat(this.abs(rel), cb))); }
    catch (e) { if (e instanceof ProviderError && e.kind === "not_found") return null; throw e; }
  }

  async createFolder(parentId: string, name: string) {
    checkName(name); const rel = joinRel(relOf(parentId), name);
    try { await this.call<void>((s, cb) => s.mkdir(this.abs(rel), cb as any)); }
    catch (e) {
      // SFTP v3 reports "already exists" as a bare generic failure; tell the two apart by looking.
      if (e instanceof ProviderError && e.kind === "other" && (await this.findChild(parentId, name))) throw new ProviderError("Nama sudah dipakai.", "conflict", 409);
      throw e;
    }
    return this.stat(rel);
  }

  async read(id: string, opts: ReadOptions = {}): Promise<ReadResult> {
    const rel = relOf(id); const st = await this.call<Stats>((s, cb) => s.stat(this.abs(rel), cb));
    if (st.isDirectory()) throw new ProviderError("Ini adalah folder.", "other");
    const s = await this.s();
    let range: ReadResult["range"]; const o: any = { highWaterMark: 256 * 1024 };
    if (opts.range && st.size > 0) {
      const start = opts.range.start; const end = Math.min(opts.range.end ?? st.size - 1, st.size - 1);
      if (start > end || start >= st.size) throw new ProviderError("Range tidak valid.", "other", 416);
      o.start = start; o.end = end; range = { start, end, total: st.size };
    }
    const stream = s.createReadStream(this.abs(rel), o) as Readable;
    opts.signal?.addEventListener("abort", () => stream.destroy(), { once: true });
    return { stream, size: range ? range.end - range.start + 1 : st.size, mimeType: (mime.lookup(rel) as string) || "application/octet-stream", range };
  }

  async write(input: WriteInput): Promise<RemoteFile> {
    checkName(input.name); const parent = relOf(input.parentId); const rel = joinRel(parent, input.name);
    const tmp = `${this.abs(rel)}.${crypto.randomBytes(4).toString("hex")}.sdpart`;
    const s = await this.s();
    try {
      const out = s.createWriteStream(tmp, { highWaterMark: 256 * 1024 });
      await pipeline(input.stream, out, { signal: input.signal });
      await this.rename0(tmp, this.abs(rel));
    } catch (e) { await this.call<void>((x, cb) => x.unlink(tmp, cb as any)).catch(() => {}); return this.wrap(e); }
    return this.stat(rel);
  }

  /** Rename that also replaces an existing target (plain SFTP rename refuses to). */
  private async rename0(from: string, to: string) {
    const s: any = await this.s();
    if (typeof s.ext_openssh_rename === "function") { try { await new Promise<void>((res, rej) => s.ext_openssh_rename(from, to, (e: any) => (e ? rej(e) : res()))); return; } catch { /* fall back */ } }
    try { await this.call<void>((x, cb) => x.rename(from, to, cb as any)); }
    catch { await this.call<void>((x, cb) => x.unlink(to, cb as any)).catch(() => {}); await this.call<void>((x, cb) => x.rename(from, to, cb as any)); }
  }

  async move(id: string, destParentId: string, newName?: string) {
    const rel = relOf(id); const name = newName ?? baseOf(rel); checkName(name);
    const dest = joinRel(relOf(destParentId), name);
    if (dest === rel || dest.startsWith(rel + "/")) throw new ProviderError("Tidak bisa memindahkan folder ke dalam dirinya sendiri.", "conflict");
    if (await this.findChild(destParentId, name)) throw new ProviderError("Nama sudah dipakai.", "conflict");
    await this.call<void>((s, cb) => s.rename(this.abs(rel), this.abs(dest), cb as any));
    return this.stat(dest);
  }
  rename(id: string, name: string) { return this.move(id, idOf(parentOf(relOf(id))), name); }

  /** Delete moves into a hidden trash folder on the server; nothing is destroyed immediately. */
  async delete(id: string) {
    const rel = relOf(id); if (!rel) throw new ProviderError("Folder utama tidak dapat dihapus.", "other");
    const trash = this.abs(TRASH);
    await this.call<void>((s, cb) => s.mkdir(trash, cb as any)).catch(() => {});
    await this.call<void>((s, cb) => s.rename(this.abs(rel), `${trash}/${Date.now()}-${crypto.randomBytes(3).toString("hex")}-${baseOf(rel)}`, cb as any));
  }

  close() { void this.conn?.then((c) => c.client.end()).catch(() => {}); this.conn = null; }
}
