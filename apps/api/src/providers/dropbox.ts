import mime from "mime-types";
import { chunker } from "./chunker.ts";
import { json, request, Semaphore, streamOf } from "./http.ts";
import type { TokenSource } from "./oauth.ts";
import { baseCaps, ProviderError, ROOT, type AccountInfo, type ListResult, type ReadOptions, type ReadResult, type RemoteFile, type StorageProvider, type ThumbResult, type WriteInput } from "./types.ts";

const RPC = "https://api.dropboxapi.com/2";
const CONTENT = "https://content.dropboxapi.com/2";
const CHUNK = 8 * 1024 * 1024; // multiple of 4 MiB
const SINGLE = 8 * 1024 * 1024;
const THUMB_EXT = /\.(jpe?g|png|tiff?|gif|webp|bmp|ppm)$/i;
// Dropbox only accepts a fixed set of thumbnail sizes.
const SIZES: [number, string][] = [[128, "w128h128"], [256, "w256h256"], [480, "w480h320"], [640, "w640h480"], [960, "w960h640"], [1024, "w1024h768"], [2048, "w2048h1536"]];
/** Header values must be ASCII, so non-ASCII characters in paths are escaped as \uXXXX. */
const argHeader = (o: unknown) => JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

/** Ids are Dropbox paths (case-insensitive). Root is "". */
export class DropboxProvider implements StorageProvider {
  readonly type = "DROPBOX" as const;
  readonly capabilities = baseCaps({ resumableUpload: true, multipartUpload: true, nativeCopy: true, nativeMove: true, nativeThumbnails: true, checksums: false, versioning: true, sharedLinks: true });
  private sem = new Semaphore(6);
  constructor(private tokens: TokenSource) {}

  private p(id: string) { return id === ROOT ? "" : id; }
  private join(parent: string, name: string) { return `${this.p(parent)}/${name}`; }
  private async h(extra: Record<string, string> = {}) { return { authorization: `Bearer ${await this.tokens.get()}`, ...extra }; }
  private async rpc<T>(ep: string, body: unknown): Promise<T> {
    const go = async () => json<T>(`${RPC}/${ep}`, { method: "POST", sem: this.sem, headers: await this.h({ "content-type": "application/json" }), body: body === undefined ? "null" : JSON.stringify(body) });
    try { return await go(); }
    catch (e) {
      if (e instanceof ProviderError && e.status === 401) { await this.tokens.invalidate(); return go(); }
      if (e instanceof ProviderError && e.status === 409) {
        // Dropbox signals domain errors with 409 + a body; classify the common ones.
        if (/not_found/.test(e.message)) throw new ProviderError("Tidak ditemukan.", "not_found", 404);
        if (/insufficient_space/.test(e.message)) throw new ProviderError("Ruang Dropbox tidak cukup.", "quota", 409);
        if (/conflict|disallowed_name|already/.test(e.message)) throw new ProviderError("Nama sudah dipakai.", "conflict", 409);
      }
      throw e;
    }
  }

  private toRemote(f: any): RemoteFile {
    const isFolder = f[".tag"] === "folder";
    const display: string = f.path_display ?? f.path_lower ?? "";
    const idx = display.lastIndexOf("/");
    const parentPath = idx > 0 ? display.slice(0, idx) : "";
    return {
      id: display || ROOT, parentId: parentPath === "" ? ROOT : parentPath, name: f.name, isFolder,
      mimeType: isFolder ? null : ((mime.lookup(f.name) as string) || "application/octet-stream"), size: isFolder ? null : f.size ?? null,
      modifiedAt: f.server_modified ?? null, createdAt: f.client_modified ?? null, checksum: null, version: f.rev ?? null,
      hasThumbnail: !isFolder && THUMB_EXT.test(f.name),
    };
  }

  async account(): Promise<AccountInfo> {
    const [a, u] = await Promise.all([this.rpc<any>("users/get_current_account", undefined), this.rpc<any>("users/get_space_usage", undefined)]);
    const total = u.allocation?.allocated ?? u.allocation?.individual?.allocated ?? null;
    return { id: a.account_id, email: a.email, displayName: a.name?.display_name ?? null, quota: { used: u.used ?? null, total } };
  }

  async list(parentId: string, opts: { pageToken?: string | null; limit?: number } = {}): Promise<ListResult> {
    const r = opts.pageToken
      ? await this.rpc<any>("files/list_folder/continue", { cursor: opts.pageToken })
      : await this.rpc<any>("files/list_folder", { path: this.p(parentId), limit: Math.min(opts.limit ?? 500, 2000), include_deleted: false });
    const items = (r.entries as any[]).filter((e) => e[".tag"] !== "deleted").map((e) => this.toRemote(e));
    items.sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    return { items, nextPageToken: r.has_more ? r.cursor : null };
  }
  async stat(id: string) {
    if (id === ROOT) return { id: ROOT, parentId: null, name: "Dropbox", isFolder: true, mimeType: null, size: null, modifiedAt: null, createdAt: null, checksum: null, version: null, hasThumbnail: false };
    return this.toRemote(await this.rpc<any>("files/get_metadata", { path: id }));
  }
  async path(id: string) {
    if (id === ROOT) return [];
    const parts = id.split("/").filter(Boolean);
    return parts.map((name, i) => ({ id: "/" + parts.slice(0, i + 1).join("/"), name }));
  }
  async findChild(parentId: string, name: string) {
    try { return this.toRemote(await this.rpc<any>("files/get_metadata", { path: this.join(parentId, name) })); }
    catch (e) { if (e instanceof ProviderError && e.kind === "not_found") return null; throw e; }
  }
  async createFolder(parentId: string, name: string) {
    const r = await this.rpc<any>("files/create_folder_v2", { path: this.join(parentId, name), autorename: false });
    return this.toRemote({ ...r.metadata, ".tag": "folder" });
  }

  async read(id: string, o: ReadOptions = {}): Promise<ReadResult> {
    const h = await this.h({ "dropbox-api-arg": argHeader({ path: id }), ...(o.range ? { range: `bytes=${o.range.start}-${o.range.end ?? ""}` } : {}) });
    const res = await request(`${CONTENT}/files/download`, { method: "POST", headers: h, sem: this.sem, signal: o.signal, timeoutMs: 120_000 });
    const meta = JSON.parse(res.headers.get("dropbox-api-result") ?? "{}");
    const name = meta.name ?? id.split("/").pop() ?? "";
    let range: ReadResult["range"];
    const cr = res.headers.get("content-range")?.match(/bytes (\d+)-(\d+)\/(\d+)/);
    if (cr) range = { start: +cr[1]!, end: +cr[2]!, total: +cr[3]! };
    return { stream: streamOf(res), size: Number(res.headers.get("content-length")) || meta.size || null, mimeType: (mime.lookup(name) as string) || "application/octet-stream", range };
  }

  async write(i: WriteInput): Promise<RemoteFile> {
    const path = this.join(i.parentId, i.name);
    const commit = { path, mode: "add", autorename: false, mute: true };
    const hdr = async (arg: unknown) => this.h({ "dropbox-api-arg": argHeader(arg), "content-type": "application/octet-stream" });
    const call = async (ep: string, arg: unknown, body: Buffer) => {
      for (let attempt = 0; ; attempt++) {
        try { return await request(`${CONTENT}/files/${ep}`, { method: "POST", headers: await hdr(arg), body: new Uint8Array(body), sem: this.sem, retries: 0, signal: i.signal, timeoutMs: 180_000 }); }
        catch (e) {
          if (attempt >= 4 || (e instanceof ProviderError && ["auth", "quota", "conflict"].includes(e.kind) && e.status !== 409)) throw e;
          if (e instanceof ProviderError && e.status === 409 && !/incorrect_offset/.test(e.message)) throw (/insufficient_space/.test(e.message) ? new ProviderError("Ruang Dropbox tidak cukup.", "quota", 409) : /conflict/.test(e.message) ? new ProviderError("Nama sudah dipakai.", "conflict", 409) : e);
          await new Promise((r) => setTimeout(r, 700 * 2 ** attempt * (0.5 + Math.random())));
        }
      }
    };
    let sessionId: string | null = null;
    let result: any = null;
    for await (const c of chunker(i.stream, CHUNK)) {
      if (!sessionId && c.last && c.data.length <= SINGLE) {
        result = await (await call("upload", commit, c.data)).json();
        break;
      }
      if (!sessionId) {
        const r: any = await (await call("upload_session/start", { close: false }, c.data)).json();
        sessionId = r.session_id;
        if (c.last) result = await (await call("upload_session/finish", { cursor: { session_id: sessionId, offset: c.data.length }, commit }, Buffer.alloc(0))).json();
        continue;
      }
      if (c.last) result = await (await call("upload_session/finish", { cursor: { session_id: sessionId, offset: c.offset }, commit }, c.data)).json();
      else await call("upload_session/append_v2", { cursor: { session_id: sessionId, offset: c.offset }, close: false }, c.data);
    }
    if (!result) throw new ProviderError("Unggahan ke Dropbox tidak selesai.", "other");
    return this.toRemote({ ...result, ".tag": "file" });
  }

  async copy(id: string, destParentId: string, newName?: string) {
    const name = newName ?? id.split("/").pop()!;
    const r = await this.rpc<any>("files/copy_v2", { from_path: id, to_path: this.join(destParentId, name), autorename: false });
    return this.toRemote(r.metadata);
  }
  async move(id: string, destParentId: string, newName?: string) {
    const name = newName ?? id.split("/").pop()!;
    const r = await this.rpc<any>("files/move_v2", { from_path: id, to_path: this.join(destParentId, name), autorename: false });
    return this.toRemote(r.metadata);
  }
  async rename(id: string, name: string) {
    const parent = id.slice(0, id.lastIndexOf("/"));
    return this.move(id, parent === "" ? ROOT : parent, name);
  }
  /** Dropbox keeps deleted files recoverable for 30 days (180 on business plans). */
  async delete(id: string) { await this.rpc("files/delete_v2", { path: id }); }

  async thumbnail(file: RemoteFile, size: number): Promise<ThumbResult | null> {
    if (!THUMB_EXT.test(file.name)) return null;
    const fmt = (SIZES.find(([px]) => px >= size) ?? SIZES.at(-1)!)[1];
    try {
      const res = await request(`${CONTENT}/files/get_thumbnail_v2`, { method: "POST", sem: this.sem, retries: 1, timeoutMs: 20_000,
        headers: await this.h({ "dropbox-api-arg": argHeader({ resource: { ".tag": "path", path: file.id }, format: "jpeg", size: fmt, mode: "bestfit" }) }) });
      return { stream: streamOf(res), contentType: "image/jpeg" };
    } catch (e) { if (e instanceof ProviderError && (e.kind === "not_found" || e.status === 409)) return null; throw e; }
  }
}
