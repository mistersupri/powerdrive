import { Readable } from "node:stream";
import mime from "mime-types";
import { chunker } from "./chunker.ts";
import { json, request, Semaphore, streamOf } from "./http.ts";
import type { TokenSource } from "./oauth.ts";
import { baseCaps, ProviderError, ROOT, type AccountInfo, type ListResult, type ReadOptions, type ReadResult, type RemoteFile, type StorageProvider, type ThumbResult, type WriteInput } from "./types.ts";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
const FIELDS = "id,name,mimeType,size,modifiedTime,createdTime,md5Checksum,thumbnailLink,parents,headRevisionId,version,hasThumbnail";
const CHUNK = 16 * 1024 * 1024; // multiple of 256 KiB, as the resumable protocol requires
const ESC = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const EXPORTS: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "application/pdf", ext: ".pdf" },
  "application/vnd.google-apps.spreadsheet": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: ".xlsx" },
  "application/vnd.google-apps.presentation": { mime: "application/pdf", ext: ".pdf" },
  "application/vnd.google-apps.drawing": { mime: "image/png", ext: ".png" },
};

export class GoogleDriveProvider implements StorageProvider {
  readonly type = "GOOGLE_DRIVE" as const;
  readonly capabilities = baseCaps({ resumableUpload: true, multipartUpload: true, nativeCopy: true, nativeMove: true, nativeThumbnails: true, checksums: true, versioning: true, sharedLinks: true });
  private sem = new Semaphore(8);
  private pathCache = new Map<string, { id: string; name: string; parent: string | null }>();

  constructor(private tokens: TokenSource) {}

  private async headers(extra: Record<string, string> = {}) { return { authorization: `Bearer ${await this.tokens.get()}`, ...extra }; }
  private id(id: string) { return id === ROOT ? "root" : id; }
  private async api<T>(p: string, o: Parameters<typeof json>[1] = {}): Promise<T> {
    try { return await json<T>(`${API}${p}`, { ...o, sem: this.sem, headers: await this.headers(o.headers as any) }); }
    catch (e) {
      if (e instanceof ProviderError && e.kind === "auth" && e.status === 401) { await this.tokens.invalidate(); return json<T>(`${API}${p}`, { ...o, sem: this.sem, headers: await this.headers(o.headers as any) }); }
      throw e;
    }
  }

  private toRemote(f: any, parentHint?: string): RemoteFile {
    const isFolder = f.mimeType === FOLDER;
    const exp = EXPORTS[f.mimeType];
    return {
      id: f.id, parentId: f.parents?.[0] ?? parentHint ?? null,
      name: exp && !f.name.toLowerCase().endsWith(exp.ext) ? f.name + exp.ext : f.name,
      isFolder, mimeType: exp ? exp.mime : isFolder ? null : f.mimeType,
      size: f.size !== undefined ? Number(f.size) : null, modifiedAt: f.modifiedTime ?? null, createdAt: f.createdTime ?? null,
      checksum: f.md5Checksum ?? null, version: f.headRevisionId ?? f.version ?? f.modifiedTime ?? null,
      hasThumbnail: !!f.thumbnailLink || (!isFolder && /^(image|video)\//.test(f.mimeType ?? "")),
    };
  }

  async account(): Promise<AccountInfo> {
    const a = await this.api<any>(`/about?fields=user(emailAddress,displayName,permissionId),storageQuota(limit,usage)`);
    return { id: a.user?.permissionId ?? null, email: a.user?.emailAddress ?? null, displayName: a.user?.displayName ?? null,
      quota: { used: a.storageQuota?.usage ? Number(a.storageQuota.usage) : null, total: a.storageQuota?.limit ? Number(a.storageQuota.limit) : null } };
  }

  async list(parentId: string, opts: { pageToken?: string | null; limit?: number } = {}): Promise<ListResult> {
    const pid = this.id(parentId);
    const p = new URLSearchParams({
      q: `'${ESC(pid)}' in parents and trashed = false`, fields: `nextPageToken,files(${FIELDS})`, pageSize: String(Math.min(opts.limit ?? 200, 1000)),
      orderBy: "folder,name_natural", supportsAllDrives: "true", includeItemsFromAllDrives: "true",
    });
    if (opts.pageToken) p.set("pageToken", opts.pageToken);
    const r = await this.api<any>(`/files?${p}`);
    return { items: (r.files ?? []).map((f: any) => this.toRemote(f, pid === "root" ? undefined : pid)), nextPageToken: r.nextPageToken ?? null };
  }

  async stat(id: string): Promise<RemoteFile> {
    return this.toRemote(await this.api<any>(`/files/${encodeURIComponent(this.id(id))}?fields=${FIELDS}&supportsAllDrives=true`));
  }

  async path(id: string) {
    const out: { id: string; name: string }[] = [];
    let cur: string | null = this.id(id);
    for (let i = 0; cur && cur !== "root" && i < 40; i++) {
      let node = this.pathCache.get(cur);
      if (!node) {
        const f: any = await this.api<any>(`/files/${encodeURIComponent(cur!)}?fields=id,name,parents&supportsAllDrives=true`);
        node = { id: f.id, name: f.name, parent: f.parents?.[0] ?? null };
        this.pathCache.set(cur, node);
      }
      out.unshift({ id: node.id, name: node.name });
      cur = node.parent;
    }
    return out;
  }

  async findChild(parentId: string, name: string) {
    const q = `'${ESC(this.id(parentId))}' in parents and name = '${ESC(name)}' and trashed = false`;
    const r = await this.api<any>(`/files?${new URLSearchParams({ q, fields: `files(${FIELDS})`, pageSize: "1", supportsAllDrives: "true", includeItemsFromAllDrives: "true" })}`);
    return r.files?.[0] ? this.toRemote(r.files[0], this.id(parentId)) : null;
  }

  async createFolder(parentId: string, name: string) {
    return this.toRemote(await this.api<any>(`/files?fields=${FIELDS}&supportsAllDrives=true`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [this.id(parentId)] }),
    }));
  }

  async read(id: string, o: ReadOptions = {}): Promise<ReadResult> {
    const meta = await this.stat(id);
    const raw = await this.api<any>(`/files/${encodeURIComponent(this.id(id))}?fields=mimeType&supportsAllDrives=true`);
    const exp = EXPORTS[raw.mimeType];
    const url = exp ? `${API}/files/${encodeURIComponent(this.id(id))}/export?mimeType=${encodeURIComponent(exp.mime)}` : `${API}/files/${encodeURIComponent(this.id(id))}?alt=media&supportsAllDrives=true`;
    const h: Record<string, string> = await this.headers();
    if (o.range && !exp) h.range = `bytes=${o.range.start}-${o.range.end ?? ""}`;
    const res = await request(url, { headers: h, sem: this.sem, signal: o.signal, timeoutMs: 120_000 });
    let range: ReadResult["range"];
    const cr = res.headers.get("content-range")?.match(/bytes (\d+)-(\d+)\/(\d+)/);
    if (cr) range = { start: +cr[1]!, end: +cr[2]!, total: +cr[3]! };
    return { stream: streamOf(res), size: Number(res.headers.get("content-length") ?? meta.size ?? NaN) || null, mimeType: meta.mimeType, range };
  }

  async write(i: WriteInput): Promise<RemoteFile> {
    const mimeType = i.mimeType ?? ((mime.lookup(i.name) as string) || "application/octet-stream");
    const start = await request(`${UPLOAD}/files?uploadType=resumable&fields=${FIELDS}&supportsAllDrives=true`, {
      method: "POST", sem: this.sem, signal: i.signal,
      headers: await this.headers({ "content-type": "application/json; charset=UTF-8", "x-upload-content-type": mimeType, ...(i.size !== null ? { "x-upload-content-length": String(i.size) } : {}) }),
      body: JSON.stringify({ name: i.name, parents: [this.id(i.parentId)] }),
    });
    const session = start.headers.get("location");
    if (!session) throw new ProviderError("Google Drive tidak mengembalikan sesi unggah.", "other");
    let result: any = null;
    for await (const c of chunker(i.stream, CHUNK)) {
      const end = c.offset + c.data.length - 1;
      const total = c.last ? String(c.offset + c.data.length) : "*";
      const range = c.data.length === 0 ? `bytes */0` : `bytes ${c.offset}-${end}/${total}`;
      // Retry each chunk independently; the session survives, so a blip never restarts the file.
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await request(session, { method: "PUT", body: new Uint8Array(c.data), headers: { "content-range": range, "content-length": String(c.data.length) }, okStatuses: [308], retries: 0, signal: i.signal, timeoutMs: 180_000 });
          if (res.status !== 308) result = await res.json();
          break;
        } catch (e) {
          if (attempt >= 4 || (e instanceof ProviderError && (e.kind === "auth" || e.kind === "quota" || e.kind === "conflict"))) throw e;
          await new Promise((r) => setTimeout(r, 800 * 2 ** attempt * (0.5 + Math.random())));
          // Ask the server how much it has before re-sending.
          const probe = await request(session, { method: "PUT", headers: { "content-range": "bytes */*", "content-length": "0" }, okStatuses: [308, 200, 201], retries: 0 }).catch(() => null);
          if (probe && probe.status !== 308) { result = await probe.json(); break; }
          const got = probe?.headers.get("range")?.match(/bytes=0-(\d+)/);
          if (got && Number(got[1]) + 1 >= c.offset + c.data.length) break;
        }
      }
    }
    if (!result) throw new ProviderError("Unggahan ke Google Drive tidak selesai.", "other");
    return this.toRemote(result, this.id(i.parentId));
  }

  async copy(id: string, destParentId: string, newName?: string) {
    return this.toRemote(await this.api<any>(`/files/${encodeURIComponent(this.id(id))}/copy?fields=${FIELDS}&supportsAllDrives=true`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parents: [this.id(destParentId)], ...(newName ? { name: newName } : {}) }),
    }));
  }
  async move(id: string, destParentId: string, newName?: string) {
    const cur = await this.api<any>(`/files/${encodeURIComponent(this.id(id))}?fields=parents&supportsAllDrives=true`);
    const p = new URLSearchParams({ addParents: this.id(destParentId), removeParents: (cur.parents ?? []).join(","), fields: FIELDS, supportsAllDrives: "true" });
    return this.toRemote(await this.api<any>(`/files/${encodeURIComponent(this.id(id))}?${p}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(newName ? { name: newName } : {}),
    }));
  }
  async rename(id: string, name: string) {
    return this.toRemote(await this.api<any>(`/files/${encodeURIComponent(this.id(id))}?fields=${FIELDS}&supportsAllDrives=true`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }),
    }));
  }
  /** Moves to the Drive trash — recoverable for 30 days. */
  async delete(id: string) {
    await this.api(`/files/${encodeURIComponent(this.id(id))}?supportsAllDrives=true`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ trashed: true }) });
  }

  async thumbnail(file: RemoteFile, size: number): Promise<ThumbResult | null> {
    const f = await this.api<any>(`/files/${encodeURIComponent(file.id)}?fields=thumbnailLink&supportsAllDrives=true`);
    if (!f.thumbnailLink) return null;
    const url = new URL(f.thumbnailLink.replace(/=s\d+$/, `=s${size}`));
    // thumbnailLink points at Google's image CDN; never send our token anywhere else.
    if (!/\.googleusercontent\.com$|\.google\.com$/.test(url.hostname)) return null;
    const res = await request(url.toString(), { retries: 1, timeoutMs: 20_000 });
    return { stream: streamOf(res), contentType: res.headers.get("content-type") ?? "image/jpeg" };
  }
}
