import { spawn, execFile, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { PassThrough, Transform } from "node:stream";
import mime from "mime-types";
import { Semaphore } from "./http.ts";
import { baseOf, byFoldersThenName, checkName, hiddenName, idOf, joinRel, parentOf, relOf, THUMB_MIME, TRASH } from "./pathutil.ts";
import { baseCaps, ProviderError, type AccountInfo, type ListResult, type ReadOptions, type ReadResult, type RemoteFile, type StorageProvider, type WriteInput } from "./types.ts";

export interface SmbConfig { host: string; port?: number; share: string; baseDir?: string; domain?: string; encrypt?: boolean }
export interface SmbCredentials { username: string; password: string }

let probe: Promise<boolean> | null = null;
/** SMB uses the `smbclient` binary (libsmbclient): it speaks SMB2/3 with signing, encryption and NTLMv2, which pure-JS clients do not. */
export const smbAvailable = () => (probe ??= new Promise((res) => execFile("smbclient", ["--version"], (e) => res(!e))));

const LS_LINE = /^ {2}(.+?)\s+([A-Za-z]*)\s+(\d+)\s+(\w{3} \w{3}\s+\d+ \d{2}:\d{2}:\d{2} \d{4})$/;

function mapStatus(out: string): ProviderError | null {
  const m = /NT_STATUS_[A-Z_0-9]+/.exec(out); const s = m?.[0];
  if (!s) return /Connection to .* failed|Unable to connect|Connection refused|Network is unreachable/i.test(out) ? new ProviderError(`Tidak dapat terhubung ke server SMB: ${out.trim().split("\n").pop()}`, "network") : null;
  if (["NT_STATUS_NO_SUCH_FILE", "NT_STATUS_OBJECT_NAME_NOT_FOUND", "NT_STATUS_OBJECT_PATH_NOT_FOUND", "NT_STATUS_NOT_A_DIRECTORY"].includes(s)) return new ProviderError("Tidak ditemukan.", "not_found", 404);
  if (["NT_STATUS_OBJECT_NAME_COLLISION", "NT_STATUS_OBJECT_NAME_EXISTS"].includes(s)) return new ProviderError("Nama sudah dipakai.", "conflict", 409);
  if (["NT_STATUS_LOGON_FAILURE", "NT_STATUS_WRONG_PASSWORD", "NT_STATUS_ACCOUNT_DISABLED", "NT_STATUS_PASSWORD_EXPIRED", "NT_STATUS_ACCOUNT_LOCKED_OUT", "NT_STATUS_NO_LOGON_SERVERS"].includes(s)) return new ProviderError("Login SMB ditolak. Periksa username, password, dan domain.", "auth", 401);
  if (s === "NT_STATUS_ACCESS_DENIED" || s === "NT_STATUS_SHARING_VIOLATION") return new ProviderError(s === "NT_STATUS_ACCESS_DENIED" ? "Akses ditolak di share SMB." : "File sedang dipakai proses lain di server SMB.", s === "NT_STATUS_ACCESS_DENIED" ? "auth" : "conflict", 403);
  if (["NT_STATUS_DISK_FULL", "NT_STATUS_QUOTA_EXCEEDED"].includes(s)) return new ProviderError("Ruang di share SMB penuh.", "quota", 507);
  if (s === "NT_STATUS_BAD_NETWORK_NAME") return new ProviderError("Share SMB tidak ditemukan di server itu.", "other");
  if (["NT_STATUS_CONNECTION_REFUSED", "NT_STATUS_HOST_UNREACHABLE", "NT_STATUS_IO_TIMEOUT", "NT_STATUS_UNSUCCESSFUL"].includes(s)) return new ProviderError(`Tidak dapat terhubung ke server SMB (${s}).`, "network");
  return new ProviderError(`Kesalahan SMB: ${s}`, "other");
}

export class SmbProvider implements StorageProvider {
  readonly type = "SMB" as const;
  readonly capabilities = baseCaps({ nativeCopy: false, nativeMove: true });
  private sem = new Semaphore(4);
  private base: string;

  constructor(private cfg: SmbConfig, private creds: SmbCredentials, private displayName = "SMB") {
    this.base = (cfg.baseDir ?? "").replace(/^[/\\]+|[/\\]+$/g, "").replace(/\\/g, "/");
  }

  private abs(rel: string) { return [this.base, rel].filter(Boolean).join("/"); }
  private q(p: string) {
    if (/["\n\r\0]/.test(p) || p.split("/").includes("..")) throw new ProviderError("Path tidak valid.", "other");
    return `"${p}"`;
  }

  private spawnSmb(command: string): ChildProcess {
    const args = [`//${this.cfg.host}/${this.cfg.share}`, "-U", this.creds.username, "-c", command, "-t", "60"];
    if (this.cfg.port) args.push("-p", String(this.cfg.port));
    if (this.cfg.domain) args.push("-W", this.cfg.domain);
    if (this.cfg.encrypt) args.push("-e");
    // The password goes through the environment, never argv (which any local user can read with ps).
    return spawn("smbclient", args, { env: { ...process.env, PASSWD: this.creds.password, LC_ALL: "C.UTF-8" }, stdio: ["pipe", "pipe", "pipe"] });
  }
  private unavailable() { return new ProviderError("smbclient belum terpasang di server SuperDrive (paket: smbclient).", "unsupported"); }

  /** Run one command and return its text output. One command per process: smbclient only reports failure of the last one reliably. */
  private run(command: string, timeoutMs = 60_000): Promise<string> {
    return this.sem.run(() => new Promise<string>((resolve, reject) => {
      const c = this.spawnSmb(command); let out = ""; let err = "";
      const t = setTimeout(() => { c.kill("SIGKILL"); reject(new ProviderError("Server SMB tidak merespons.", "network")); }, timeoutMs);
      c.stdout!.on("data", (d) => (out += d)); c.stderr!.on("data", (d) => (err += d));
      c.on("error", (e: any) => { clearTimeout(t); reject(e.code === "ENOENT" ? this.unavailable() : e); });
      c.on("close", (code) => {
        clearTimeout(t);
        const e = mapStatus(out + "\n" + err);
        if (e) return reject(e);
        if (code !== 0) return reject(new ProviderError(`smbclient gagal (kode ${code}): ${err.trim().split("\n").pop() ?? ""}`, "other"));
        resolve(out);
      });
    }));
  }

  private parseLs(out: string): RemoteFile[] {
    const items: RemoteFile[] = [];
    for (const line of out.split("\n")) {
      const m = LS_LINE.exec(line); if (!m) continue;
      const [, name, attr, size, date] = m as unknown as [string, string, string, string, string];
      if (name === "." || name === "..") continue;
      const isFolder = attr.includes("D"); const mt = new Date(date);
      const mimeType = isFolder ? null : ((mime.lookup(name) as string) || "application/octet-stream");
      items.push({ id: name, parentId: null, name, isFolder, mimeType, size: isFolder ? null : Number(size), modifiedAt: isNaN(+mt) ? null : mt.toISOString(), createdAt: null, checksum: null,
        version: `${+mt}-${size}`, hasThumbnail: !isFolder && !!mimeType && THUMB_MIME.test(mimeType) });
    }
    return items;
  }
  private place(f: RemoteFile, dirRel: string): RemoteFile { const rel = joinRel(dirRel, f.name); return { ...f, id: idOf(rel), parentId: idOf(dirRel) }; }

  async account(): Promise<AccountInfo> {
    const out = await this.run(`ls ${this.q(this.abs("*"))}`);
    const q = /(\d+) blocks of size (\d+)\. (\d+) blocks available/.exec(out);
    const quota = q ? { total: Number(q[1]) * Number(q[2]), used: (Number(q[1]) - Number(q[3])) * Number(q[2]) } : null;
    return { id: `${this.creds.username}@${this.cfg.host}/${this.cfg.share}`, email: null, displayName: this.displayName, quota };
  }

  async list(parentId: string, opts: { pageToken?: string | null; limit?: number } = {}): Promise<ListResult> {
    const rel = relOf(parentId); const limit = opts.limit ?? 200;
    const all = this.parseLs(await this.run(`ls ${this.q(this.abs(rel ? `${rel}/*` : "*"))}`)).filter((f) => !hiddenName(f.name)).map((f) => this.place(f, rel)).sort(byFoldersThenName);
    const start = opts.pageToken ? Number(opts.pageToken) : 0;
    return { items: all.slice(start, start + limit), nextPageToken: start + limit < all.length ? String(start + limit) : null };
  }

  async stat(id: string): Promise<RemoteFile> {
    const rel = relOf(id);
    if (rel === "") { await this.run(`ls ${this.q(this.abs("*"))}`); return { id: "root", parentId: null, name: this.displayName, isFolder: true, mimeType: null, size: null, modifiedAt: null, createdAt: null, checksum: null, version: null, hasThumbnail: false }; }
    const f = this.parseLs(await this.run(`ls ${this.q(this.abs(rel))}`)).find((x) => x.name.toLowerCase() === baseOf(rel).toLowerCase());
    if (!f) throw new ProviderError("Tidak ditemukan.", "not_found", 404);
    return this.place(f, parentOf(rel));
  }
  async findChild(parentId: string, name: string) {
    try { return await this.stat(joinRel(relOf(parentId), name)); } catch (e) { if (e instanceof ProviderError && e.kind === "not_found") return null; throw e; }
  }
  async path(id: string) { const rel = relOf(id); if (!rel) return []; const p = rel.split("/"); return p.map((name, i) => ({ id: p.slice(0, i + 1).join("/"), name })); }

  async createFolder(parentId: string, name: string, system = false) {
    checkName(name, true, system); const rel = joinRel(relOf(parentId), name);
    await this.run(`mkdir ${this.q(this.abs(rel))}`);
    return this.stat(rel);
  }

  async read(id: string, opts: ReadOptions = {}): Promise<ReadResult> {
    const rel = relOf(id); const meta = await this.stat(rel);
    if (meta.isFolder) throw new ProviderError("Ini adalah folder.", "other");
    const total = meta.size ?? 0;
    let range: ReadResult["range"]; let start = 0; let end = total - 1;
    if (opts.range && total > 0) {
      start = opts.range.start; end = Math.min(opts.range.end ?? total - 1, total - 1);
      if (start > end || start >= total) throw new ProviderError("Range tidak valid.", "other", 416);
      range = { start, end, total };
    }
    const out = new PassThrough({ highWaterMark: 1024 * 1024 });
    // smbclient cannot seek, so a ranged read streams from the start and discards bytes before `start`. Fine on a LAN; it is the price of SMB3 support.
    void this.sem.run(() => new Promise<void>((done) => {
      const c = this.spawnSmb(`get ${this.q(this.abs(rel))} -`); let err = ""; let seen = 0; let stopped = false;
      c.stderr!.on("data", (d) => (err += d));
      c.on("error", (e: any) => { out.destroy(e.code === "ENOENT" ? this.unavailable() : e); done(); });
      const cut = new Transform({ transform(chunk: Buffer, _e, cb) {
        const from = Math.max(0, start - seen), to = Math.min(chunk.length, end + 1 - seen); seen += chunk.length;
        if (to > from) this.push(chunk.subarray(from, to));
        if (seen > end && !stopped) { stopped = true; this.push(null); c.kill("SIGTERM"); }
        cb();
      } });
      c.stdout!.pipe(cut).pipe(out);
      const stop = () => { stopped = true; c.kill("SIGTERM"); };
      out.on("close", stop); opts.signal?.addEventListener("abort", stop, { once: true });
      c.on("close", (code) => {
        if (!stopped && code !== 0) out.destroy(mapStatus(err) ?? new ProviderError(`smbclient gagal (kode ${code})`, "other"));
        done();
      });
    }));
    return { stream: out, size: range ? end - start + 1 : total, mimeType: meta.mimeType, range };
  }

  async write(input: WriteInput): Promise<RemoteFile> {
    checkName(input.name, true); const parent = relOf(input.parentId); const rel = joinRel(parent, input.name);
    const tmpRel = `${rel}.${crypto.randomBytes(4).toString("hex")}.sdpart`;
    try {
      await this.sem.run(() => new Promise<void>((resolve, reject) => {
        const c = this.spawnSmb(`put - ${this.q(this.abs(tmpRel))}`); let all = "";
        c.stdout!.on("data", (d) => (all += d)); c.stderr!.on("data", (d) => (all += d));
        c.on("error", (e: any) => reject(e.code === "ENOENT" ? this.unavailable() : e));
        c.stdin!.on("error", () => { /* surfaced through the exit status */ });
        const abort = () => { c.kill("SIGKILL"); reject(new Error("aborted")); };
        input.signal?.addEventListener("abort", abort, { once: true });
        input.stream.on("error", (e) => { c.kill("SIGKILL"); reject(e); });
        input.stream.pipe(c.stdin!);
        c.on("close", (code) => { const e = mapStatus(all); if (e) return reject(e); code === 0 ? resolve() : reject(new ProviderError(`smbclient gagal (kode ${code}): ${all.trim().split("\n").pop()}`, "other")); });
      }));
      const written = await this.stat(tmpRel);
      if (input.size !== null && written.size !== input.size) throw new ProviderError(`Ukuran di server SMB (${written.size}) berbeda dari yang dikirim (${input.size}).`, "other");
      await this.run(`rename ${this.q(this.abs(tmpRel))} ${this.q(this.abs(rel))}`);
    } catch (e) { await this.run(`del ${this.q(this.abs(tmpRel))}`).catch(() => {}); throw e; }
    return this.stat(rel);
  }

  async move(id: string, destParentId: string, newName?: string) {
    const rel = relOf(id); const name = newName ?? baseOf(rel); checkName(name, true);
    const dest = joinRel(relOf(destParentId), name);
    if (dest === rel || dest.startsWith(rel + "/")) throw new ProviderError("Tidak bisa memindahkan folder ke dalam dirinya sendiri.", "conflict");
    if (await this.findChild(destParentId, name)) throw new ProviderError("Nama sudah dipakai.", "conflict");
    await this.run(`rename ${this.q(this.abs(rel))} ${this.q(this.abs(dest))}`);
    return this.stat(dest);
  }
  rename(id: string, name: string) { return this.move(id, idOf(parentOf(relOf(id))), name); }

  /** Permanent: `deltree` removes a folder with everything in it, `del` removes a file. */
  async delete(id: string) {
    const rel = relOf(id); if (!rel) throw new ProviderError("Folder utama tidak dapat dihapus.", "other");
    const f = await this.stat(rel);
    await this.run(`${f.isFolder ? "deltree" : "del"} ${this.q(this.abs(rel))}`);
  }
}
