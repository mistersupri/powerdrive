import { Transform } from "node:stream";
import { XMLParser } from "fast-xml-parser";
import mime from "mime-types";
import { request, Semaphore, streamOf } from "./http.ts";
import { baseOf, byFoldersThenName, checkName, hiddenName, idOf, joinRel, parentOf, relOf, THUMB_MIME, TRASH } from "./pathutil.ts";
import { baseCaps, ProviderError, type AccountInfo, type ListResult, type ReadOptions, type ReadResult, type RemoteFile, type StorageProvider, type WriteInput } from "./types.ts";

export interface WebdavConfig { url: string }
export interface WebdavCredentials { username?: string; password?: string }

const PROPS = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getcontenttype/><d:getetag/><d:creationdate/></d:prop></d:propfind>`;
const QUOTA = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:quota-available-bytes/><d:quota-used-bytes/></d:prop></d:propfind>`;
const xml = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false, isArray: (n) => n === "response" });
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** WebDAV over HTTPS (Nextcloud, ownCloud, Synology, Apache/nginx dav…). Ids are paths relative to the configured URL. */
export class WebdavProvider implements StorageProvider {
  readonly type = "WEBDAV" as const;
  readonly capabilities = baseCaps({ nativeCopy: true, nativeMove: true });
  private sem = new Semaphore(6);
  private root: URL;
  private auth: string | undefined;

  constructor(cfg: WebdavConfig, creds: WebdavCredentials, private displayName = "WebDAV") {
    this.root = new URL(cfg.url.endsWith("/") ? cfg.url : cfg.url + "/");
    if (creds.username) this.auth = "Basic " + Buffer.from(`${creds.username}:${creds.password ?? ""}`).toString("base64");
  }

  private url(rel: string, dir = false) {
    const p = rel.split("/").filter(Boolean).map(encodeURIComponent).join("/");
    return new URL(this.root.pathname + p + (dir && p ? "/" : ""), this.root).toString();
  }
  /** href from a multistatus response → relative decoded path. */
  private relFromHref(href: string) {
    let p = decodeURIComponent(new URL(href, this.root).pathname);
    const rootPath = decodeURIComponent(this.root.pathname);
    if (p.startsWith(rootPath)) p = p.slice(rootPath.length);
    return p.replace(/^\/+|\/+$/g, "");
  }

  /** Sends a request without following redirects across hosts (a redirect must stay on the configured origin). */
  private async dav(method: string, url: string, o: { headers?: Record<string, string>; body?: any; okStatuses?: number[]; signal?: AbortSignal; timeoutMs?: number; retries?: number } = {}) {
    let target = url;
    for (let hop = 0; hop < 4; hop++) {
      const res = await request(target, {
        method, signal: o.signal, sem: this.sem, timeoutMs: o.timeoutMs, retries: o.retries, redirect: "manual",
        headers: { ...(this.auth ? { authorization: this.auth } : {}), ...o.headers }, body: o.body,
        okStatuses: [301, 302, 307, 308, ...(o.okStatuses ?? [])],
      }).catch((e) => { throw this.mapErr(e); });
      if ([301, 302, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location"); if (!loc) return res;
        const next = new URL(loc, target);
        if (next.origin !== this.root.origin) throw new ProviderError("Server WebDAV mengalihkan ke host lain; ditolak.", "other");
        target = next.toString(); continue;
      }
      return res;
    }
    throw new ProviderError("Terlalu banyak pengalihan dari server WebDAV.", "other");
  }
  private mapErr(e: unknown) {
    if (e instanceof ProviderError && e.status === 403) return new ProviderError("Akses ditolak oleh server WebDAV.", "auth", 403);
    if (e instanceof ProviderError && e.status === 401) return new ProviderError("Login WebDAV ditolak. Periksa username dan password.", "auth", 401);
    if (e instanceof ProviderError && e.status === 507) return new ProviderError("Ruang di server WebDAV penuh.", "quota", 507);
    if (e instanceof ProviderError && (e.status === 405 || e.status === 412)) return new ProviderError("Nama sudah dipakai.", "conflict", e.status);
    return e;
  }

  private parse(text: string): RemoteFile[] {
    const doc = xml.parse(text); const out: RemoteFile[] = [];
    for (const r of arr<any>(doc?.multistatus?.response)) {
      const ps = arr<any>(r.propstat).find((p) => String(p.status ?? "").includes(" 200")) ?? arr<any>(r.propstat)[0];
      const prop = ps?.prop ?? {}; const rel = this.relFromHref(String(r.href));
      const isFolder = prop.resourcetype !== undefined && typeof prop.resourcetype === "object" && prop.resourcetype !== null && "collection" in prop.resourcetype;
      const name = rel === "" ? this.displayName : baseOf(rel);
      const mimeType = isFolder ? null : (prop.getcontenttype ? String(prop.getcontenttype).split(";")[0]!.trim() : null) ?? ((mime.lookup(name) as string) || "application/octet-stream");
      const mt = prop.getlastmodified ? new Date(String(prop.getlastmodified)) : null;
      const mtype = mimeType && mimeType !== "application/octet-stream" ? mimeType : ((mime.lookup(name) as string) || "application/octet-stream");
      out.push({
        id: idOf(rel), parentId: rel === "" ? null : idOf(parentOf(rel)), name, isFolder, mimeType: isFolder ? null : mtype,
        size: isFolder ? null : prop.getcontentlength !== undefined ? Number(prop.getcontentlength) : null,
        modifiedAt: mt && !isNaN(+mt) ? mt.toISOString() : null, createdAt: prop.creationdate ? new Date(String(prop.creationdate)).toISOString() : null,
        checksum: null, version: prop.getetag ? String(prop.getetag).replace(/"/g, "") : mt ? String(+mt) : null,
        hasThumbnail: !isFolder && THUMB_MIME.test(mtype),
      });
    }
    return out;
  }

  private async propfind(rel: string, depth: 0 | 1, body = PROPS) {
    const res = await this.dav("PROPFIND", this.url(rel, true), { headers: { depth: String(depth), "content-type": "application/xml" }, body, okStatuses: [207] });
    if (res.status !== 207) throw new ProviderError(`Server tidak merespons sebagai WebDAV (HTTP ${res.status}).`, "other", res.status);
    return await res.text();
  }

  async account(): Promise<AccountInfo> {
    await this.propfind("", 0);
    let quota: AccountInfo["quota"] = null;
    try {
      const doc = xml.parse(await this.propfind("", 0, QUOTA)); const p = arr<any>(doc?.multistatus?.response)[0]?.propstat; const prop = arr<any>(p).map((x) => x.prop).find((x) => x?.["quota-used-bytes"] !== undefined);
      if (prop) { const used = Number(prop["quota-used-bytes"]); const av = prop["quota-available-bytes"] !== undefined ? Number(prop["quota-available-bytes"]) : NaN; quota = { used, total: Number.isFinite(av) && av >= 0 ? used + av : null }; }
    } catch { /* quota properties are optional */ }
    return { id: this.root.origin + this.root.pathname, email: null, displayName: this.displayName, quota };
  }

  async list(parentId: string, opts: { pageToken?: string | null; limit?: number } = {}): Promise<ListResult> {
    const rel = relOf(parentId); const limit = opts.limit ?? 200;
    const all = this.parse(await this.propfind(rel, 1)).filter((f) => f.id !== idOf(rel) && !hiddenName(f.name)).sort(byFoldersThenName);
    const start = opts.pageToken ? Number(opts.pageToken) : 0;
    return { items: all.slice(start, start + limit), nextPageToken: start + limit < all.length ? String(start + limit) : null };
  }

  async stat(id: string) {
    const rel = relOf(id);
    const f = this.parse(await this.propfind(rel, 0))[0];
    if (!f) throw new ProviderError("Tidak ditemukan.", "not_found", 404);
    return f;
  }
  async findChild(parentId: string, name: string) {
    try { return await this.stat(joinRel(relOf(parentId), name)); } catch (e) { if (e instanceof ProviderError && e.kind === "not_found") return null; throw e; }
  }
  async path(id: string) { const rel = relOf(id); if (!rel) return []; const p = rel.split("/"); return p.map((name, i) => ({ id: p.slice(0, i + 1).join("/"), name })); }

  async createFolder(parentId: string, name: string) {
    checkName(name); const rel = joinRel(relOf(parentId), name);
    await this.dav("MKCOL", this.url(rel, true), { okStatuses: [201] });
    return this.stat(rel);
  }

  async read(id: string, opts: ReadOptions = {}): Promise<ReadResult> {
    const rel = relOf(id); const meta = await this.stat(rel);
    if (meta.isFolder) throw new ProviderError("Ini adalah folder.", "other");
    const res = await this.dav("GET", this.url(rel), { headers: opts.range ? { range: `bytes=${opts.range.start}-${opts.range.end ?? ""}` } : {}, signal: opts.signal, timeoutMs: 120_000, okStatuses: [206] });
    const total = meta.size;
    if (opts.range && res.status === 200 && total !== null) {
      // Server ignored Range: skip to the start and stop at the end ourselves.
      const start = opts.range.start; const end = Math.min(opts.range.end ?? total - 1, total - 1); let seen = 0;
      const cut = new Transform({ transform(chunk: Buffer, _e, cb) {
        const from = Math.max(0, start - seen), to = Math.min(chunk.length, end + 1 - seen); seen += chunk.length;
        if (to > from) this.push(chunk.subarray(from, to));
        if (seen > end) this.push(null);
        cb();
      } });
      streamOf(res).pipe(cut);
      return { stream: cut, size: end - start + 1, mimeType: meta.mimeType, range: { start, end, total } };
    }
    let range: ReadResult["range"]; const cr = res.headers.get("content-range")?.match(/bytes (\d+)-(\d+)\/(\d+|\*)/);
    // Some servers answer "bytes a-b/*"; the total then comes from PROPFIND.
    if (cr && (cr[3] !== "*" || total !== null)) range = { start: +cr[1]!, end: +cr[2]!, total: cr[3] === "*" ? total! : +cr[3]! };
    else if (res.status === 206 && opts.range && total !== null) range = { start: opts.range.start, end: Math.min(opts.range.end ?? total - 1, total - 1), total };
    return { stream: streamOf(res), size: Number(res.headers.get("content-length")) || meta.size, mimeType: meta.mimeType, range };
  }

  async write(input: WriteInput): Promise<RemoteFile> {
    checkName(input.name); const rel = joinRel(relOf(input.parentId), input.name);
    // Many servers refuse chunked uploads, so the length is sent whenever it is known.
    const headers: Record<string, string> = { "content-type": (input.mimeType as string) || (mime.lookup(input.name) as string) || "application/octet-stream" };
    if (input.size !== null) headers["content-length"] = String(input.size);
    await this.dav("PUT", this.url(rel), { headers, body: input.stream, signal: input.signal, timeoutMs: 6 * 3600_000, retries: 0, okStatuses: [201, 204] });
    return this.stat(rel);
  }

  private async moveOrCopy(method: "MOVE" | "COPY", id: string, destParentId: string, newName?: string) {
    const rel = relOf(id); const name = newName ?? baseOf(rel); checkName(name);
    const dest = joinRel(relOf(destParentId), name);
    if (dest === rel || dest.startsWith(rel + "/")) throw new ProviderError("Tidak bisa ke dalam dirinya sendiri.", "conflict");
    await this.dav(method, this.url(rel, true), { headers: { destination: this.url(dest, true), overwrite: "F" }, okStatuses: [201, 204] });
    return this.stat(dest);
  }
  copy(id: string, destParentId: string, newName?: string) { return this.moveOrCopy("COPY", id, destParentId, newName); }
  move(id: string, destParentId: string, newName?: string) { return this.moveOrCopy("MOVE", id, destParentId, newName); }
  rename(id: string, name: string) { return this.moveOrCopy("MOVE", id, idOf(parentOf(relOf(id))), name); }

  /** Moves into a hidden trash collection rather than issuing DELETE, so nothing is destroyed immediately. */
  async delete(id: string) {
    const rel = relOf(id); if (!rel) throw new ProviderError("Folder utama tidak dapat dihapus.", "other");
    await this.dav("MKCOL", this.url(TRASH, true), { okStatuses: [201, 405] }).catch(() => {});
    const dest = `${TRASH}/${Date.now()}-${baseOf(rel)}`;
    await this.dav("MOVE", this.url(rel, true), { headers: { destination: this.url(dest, true), overwrite: "T" }, okStatuses: [201, 204] });
  }
}
