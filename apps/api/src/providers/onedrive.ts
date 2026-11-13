import mime from "mime-types";
import { chunker } from "./chunker.ts";
import { json, request, Semaphore, streamOf } from "./http.ts";
import type { TokenSource } from "./oauth.ts";
import { baseCaps, ProviderError, ROOT, type AccountInfo, type ListResult, type ReadOptions, type ReadResult, type RemoteFile, type StorageProvider, type ThumbResult, type WriteInput } from "./types.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const SELECT = "id,name,size,folder,file,lastModifiedDateTime,createdDateTime,parentReference,eTag,cTag";
const SMALL = 4 * 1024 * 1024;
const CHUNK = 32 * 320 * 1024; // 10 MiB, a multiple of 320 KiB as Graph requires
const THUMBABLE = /^(image\/|video\/|application\/pdf|application\/vnd\.(openxmlformats|ms-)|application\/msword)/;
const enc = (s: string) => encodeURIComponent(s).replace(/'/g, "%27");

export class OneDriveProvider implements StorageProvider {
  readonly type = "ONEDRIVE" as const;
  readonly capabilities = baseCaps({ resumableUpload: true, multipartUpload: true, nativeCopy: true, nativeMove: true, nativeThumbnails: true, checksums: true, versioning: true, sharedLinks: true });
  private sem = new Semaphore(6);
  constructor(private tokens: TokenSource) {}

  private item(id: string) { return id === ROOT ? "/me/drive/root" : `/me/drive/items/${enc(id)}`; }
  private async h(extra: Record<string, string> = {}) { return { authorization: `Bearer ${await this.tokens.get()}`, ...extra }; }
  private async api<T>(path: string, o: Parameters<typeof json>[1] = {}): Promise<T> {
    const url = path.startsWith("http") ? path : `${GRAPH}${path}`;
    // nextLink / monitor URLs come back from the server; only follow ones on the Graph host.
    if (path.startsWith("http") && new URL(path).hostname !== "graph.microsoft.com") throw new ProviderError("URL tidak diizinkan.", "other");
    try { return await json<T>(url, { ...o, sem: this.sem, headers: await this.h(o.headers as any) }); }
    catch (e) {
      if (e instanceof ProviderError && e.status === 401) { await this.tokens.invalidate(); return json<T>(url, { ...o, sem: this.sem, headers: await this.h(o.headers as any) }); }
      throw e;
    }
  }

  private toRemote(f: any): RemoteFile {
    const isFolder = !!f.folder;
    const mimeType = isFolder ? null : f.file?.mimeType ?? ((mime.lookup(f.name) as string) || "application/octet-stream");
    const parent = f.parentReference?.id;
    return {
      id: f.id, parentId: parent ?? null, name: f.name, isFolder, mimeType, size: isFolder ? null : (f.size ?? null),
      modifiedAt: f.lastModifiedDateTime ?? null, createdAt: f.createdDateTime ?? null,
      checksum: f.file?.hashes?.sha1Hash ?? f.file?.hashes?.quickXorHash ?? null, version: f.cTag ?? f.eTag ?? f.lastModifiedDateTime ?? null,
      hasThumbnail: !isFolder && THUMBABLE.test(mimeType ?? ""),
    };
  }

  async account(): Promise<AccountInfo> {
    const [me, drive] = await Promise.all([this.api<any>("/me?$select=id,displayName,mail,userPrincipalName"), this.api<any>("/me/drive?$select=quota")]);
    return { id: me.id, email: me.mail ?? me.userPrincipalName ?? null, displayName: me.displayName ?? null,
      quota: drive.quota ? { used: drive.quota.used ?? null, total: drive.quota.total ?? null } : null };
  }

  async list(parentId: string, opts: { pageToken?: string | null; limit?: number } = {}): Promise<ListResult> {
    const url = opts.pageToken ?? `${this.item(parentId)}/children?$top=${Math.min(opts.limit ?? 200, 999)}&$select=${SELECT},file&$orderby=name`;
    const r = await this.api<any>(url);
    const items = (r.value as any[]).map((f) => this.toRemote(f));
    items.sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    return { items, nextPageToken: r["@odata.nextLink"] ?? null };
  }
  async stat(id: string) { return this.toRemote(await this.api<any>(`${this.item(id)}?$select=${SELECT},file`)); }

  async path(id: string) {
    const out: { id: string; name: string }[] = [];
    let cur: any = id === ROOT ? null : await this.api<any>(`${this.item(id)}?$select=id,name,parentReference,root`);
    for (let i = 0; cur && !cur.root && i < 40; i++) {
      out.unshift({ id: cur.id, name: cur.name });
      const pid = cur.parentReference?.id;
      cur = pid ? await this.api<any>(`/me/drive/items/${enc(pid)}?$select=id,name,parentReference,root`) : null;
    }
    return out;
  }

  async findChild(parentId: string, name: string) {
    try { return this.toRemote(await this.api<any>(`${this.item(parentId)}:/${enc(name)}?$select=${SELECT},file`)); }
    catch (e) { if (e instanceof ProviderError && e.kind === "not_found") return null; throw e; }
  }

  async createFolder(parentId: string, name: string) {
    return this.toRemote(await this.api<any>(`${this.item(parentId)}/children`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }) }));
  }

  async read(id: string, o: ReadOptions = {}): Promise<ReadResult> {
    const meta = await this.stat(id);
    const h = await this.h(o.range ? { range: `bytes=${o.range.start}-${o.range.end ?? ""}` } : {});
    // /content answers 302 to a pre-authenticated CDN URL; fetch drops the bearer on the cross-origin hop.
    const res = await request(`${GRAPH}${this.item(id)}/content`, { headers: h, sem: this.sem, signal: o.signal, timeoutMs: 120_000 });
    let range: ReadResult["range"];
    const cr = res.headers.get("content-range")?.match(/bytes (\d+)-(\d+)\/(\d+)/);
    if (cr) range = { start: +cr[1]!, end: +cr[2]!, total: +cr[3]! };
    return { stream: streamOf(res), size: Number(res.headers.get("content-length")) || meta.size, mimeType: meta.mimeType, range };
  }

  async write(i: WriteInput): Promise<RemoteFile> {
    const parent = i.parentId === ROOT ? "/me/drive/root" : `/me/drive/items/${enc(i.parentId)}`;
    if (i.size !== null && i.size <= SMALL) {
      const bufs: Buffer[] = []; for await (const b of i.stream) bufs.push(b as Buffer);
      return this.toRemote(await this.api<any>(`${parent}:/${enc(i.name)}:/content?@microsoft.graph.conflictBehavior=fail`, {
        method: "PUT", body: new Uint8Array(Buffer.concat(bufs)), headers: { "content-type": "application/octet-stream" }, signal: i.signal, timeoutMs: 120_000,
      } as any));
    }
    const s = await this.api<any>(`${parent}:/${enc(i.name)}:/createUploadSession`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "fail", name: i.name } }), signal: i.signal });
    const url: string = s.uploadUrl;
    let result: any = null;
    for await (const c of chunker(i.stream, CHUNK)) {
      const end = c.offset + c.data.length - 1;
      // Total is needed on every chunk; with unknown size we can only know it at the end.
      const total = i.size ?? (c.last ? c.offset + c.data.length : null);
      if (total === null) throw new ProviderError("Ukuran file harus diketahui untuk OneDrive.", "unsupported");
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await request(url, { method: "PUT", body: new Uint8Array(c.data), headers: { "content-range": `bytes ${c.offset}-${end}/${total}`, "content-length": String(c.data.length) }, retries: 0, signal: i.signal, timeoutMs: 180_000, okStatuses: [202] });
          if (res.status !== 202) result = await res.json();
          break;
        } catch (e) {
          if (attempt >= 4 || (e instanceof ProviderError && ["auth", "quota", "conflict"].includes(e.kind) && e.status !== 416)) throw e;
          await new Promise((r) => setTimeout(r, 800 * 2 ** attempt * (0.5 + Math.random())));
        }
      }
    }
    if (!result) throw new ProviderError("Unggahan ke OneDrive tidak selesai.", "other");
    return this.toRemote(result);
  }

  async copy(id: string, destParentId: string, newName?: string) {
    const res = await request(`${GRAPH}${this.item(id)}/copy`, { method: "POST", sem: this.sem, headers: await this.h({ "content-type": "application/json" }),
      body: JSON.stringify({ parentReference: { id: destParentId === ROOT ? (await this.api<any>("/me/drive/root?$select=id")).id : destParentId }, ...(newName ? { name: newName } : {}) }) });
    const monitor = res.headers.get("location");
    if (!monitor || !monitor.startsWith("https://")) throw new ProviderError("OneDrive tidak mengembalikan monitor salinan.", "other");
    // Monitor URLs are pre-authenticated; poll without our token.
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, Math.min(500 + i * 250, 3000)));
      const st: any = await (await request(monitor, { retries: 1 })).json();
      if (st.status === "completed" && st.resourceId) return this.stat(st.resourceId);
      if (st.status === "failed") throw new ProviderError(`Salinan gagal: ${st.errorCode ?? "unknown"}`, "other");
    }
    throw new ProviderError("Salinan OneDrive melebihi batas waktu.", "network");
  }
  async move(id: string, destParentId: string, newName?: string) {
    const parentRef = destParentId === ROOT ? (await this.api<any>("/me/drive/root?$select=id")).id : destParentId;
    return this.toRemote(await this.api<any>(`${this.item(id)}?$select=${SELECT},file`, { method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentReference: { id: parentRef }, ...(newName ? { name: newName } : {}) }) }));
  }
  async rename(id: string, name: string) {
    return this.toRemote(await this.api<any>(`${this.item(id)}?$select=${SELECT},file`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }));
  }
  /** Graph DELETE sends the item to the OneDrive recycle bin. */
  async delete(id: string) { await this.api(this.item(id), { method: "DELETE" }); }

  async thumbnail(file: RemoteFile, size: number): Promise<ThumbResult | null> {
    const label = size <= 96 ? "small" : size <= 176 ? "medium" : "large";
    try {
      const res = await request(`${GRAPH}${this.item(file.id)}/thumbnails/0/${label}/content`, { headers: await this.h(), sem: this.sem, retries: 1, timeoutMs: 20_000 });
      return { stream: streamOf(res), contentType: res.headers.get("content-type") ?? "image/jpeg" };
    } catch (e) { if (e instanceof ProviderError && e.kind === "not_found") return null; throw e; }
  }
}
