import { CopyObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { Readable } from "node:stream";
import mime from "mime-types";
import { baseCaps, ProviderError, ROOT, type AccountInfo, type ListResult, type ReadOptions, type ReadResult, type RemoteFile, type StorageProvider, type WriteInput } from "./types.ts";

export interface S3Config { endpoint?: string; region: string; bucket: string; prefix?: string; forcePathStyle?: boolean }
export interface S3Credentials { accessKeyId: string; secretAccessKey: string }

const MAX_SINGLE_COPY = 5 * 1024 ** 3 - 1;

/** AWS S3 and S3-compatible stores (MinIO, Cloudflare R2, Backblaze B2). Ids are object keys; folders end in "/". */
export class S3Provider implements StorageProvider {
  readonly type = "S3" as const;
  readonly capabilities = baseCaps({ resumableUpload: false, multipartUpload: true, nativeCopy: true, nativeMove: true, checksums: false, versioning: false });
  private client: S3Client;
  private base: string;

  constructor(private cfg: S3Config, creds: S3Credentials) {
    this.base = (cfg.prefix ?? "").replace(/^\/+|\/+$/g, "");
    if (this.base) this.base += "/";
    this.client = new S3Client({
      region: cfg.region || "auto", endpoint: cfg.endpoint || undefined, forcePathStyle: cfg.forcePathStyle ?? !!cfg.endpoint,
      credentials: creds, maxAttempts: 4, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  private key(id: string) { return id === ROOT ? this.base : this.base + id; }
  private idOf(fullKey: string) { return fullKey.slice(this.base.length) || ROOT; }
  private wrap(e: any): never {
    const c = e?.$metadata?.httpStatusCode; const n = e?.name ?? "";
    if (c === 404 || n === "NoSuchKey" || n === "NotFound") throw new ProviderError("Tidak ditemukan.", "not_found", 404);
    if (c === 403 || n === "AccessDenied" || n === "InvalidAccessKeyId" || n === "SignatureDoesNotMatch") throw new ProviderError("Akses ditolak oleh penyimpanan S3. Periksa access key.", "auth", 403);
    if (c === 503 || n === "SlowDown") throw new ProviderError("Penyimpanan S3 membatasi permintaan.", "rate", 503);
    throw e instanceof ProviderError ? e : new ProviderError(e?.message ?? String(e), "other", c);
  }

  private fileOf(fullKey: string, o: { size?: number; lastModified?: Date; etag?: string; contentType?: string }): RemoteFile {
    const name = fullKey.split("/").pop()!;
    const parentKey = fullKey.slice(0, fullKey.length - name.length);
    const mimeType = o.contentType && o.contentType !== "binary/octet-stream" ? o.contentType : ((mime.lookup(name) as string) || "application/octet-stream");
    return {
      id: this.idOf(fullKey), parentId: parentKey === this.base ? ROOT : this.idOf(parentKey), name, isFolder: false, mimeType,
      size: o.size ?? null, modifiedAt: o.lastModified?.toISOString() ?? null, createdAt: null, checksum: null,
      version: o.etag?.replace(/"/g, "") ?? null, hasThumbnail: /^image\//.test(mimeType),
    };
  }
  private folderOf(fullKey: string): RemoteFile {
    const trimmed = fullKey.replace(/\/$/, "");
    const name = trimmed.split("/").pop()!;
    const parentKey = trimmed.slice(0, trimmed.length - name.length);
    return { id: this.idOf(fullKey), parentId: parentKey === this.base ? ROOT : this.idOf(parentKey), name, isFolder: true, mimeType: null, size: null, modifiedAt: null, createdAt: null, checksum: null, version: null, hasThumbnail: false };
  }

  async account(): Promise<AccountInfo> {
    try { await this.client.send(new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: this.base, MaxKeys: 1 })); }
    catch (e) { this.wrap(e); }
    return { id: this.cfg.bucket, email: null, displayName: this.cfg.bucket, quota: null };
  }

  async list(parentId: string, opts: { pageToken?: string | null; limit?: number } = {}): Promise<ListResult> {
    try {
      const prefix = this.key(parentId);
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: prefix, Delimiter: "/", MaxKeys: Math.min(opts.limit ?? 200, 1000), ContinuationToken: opts.pageToken ?? undefined }));
      const folders = (r.CommonPrefixes ?? []).map((p) => this.folderOf(p.Prefix!));
      const files = (r.Contents ?? []).filter((o) => o.Key !== prefix && !o.Key!.endsWith("/")).map((o) => this.fileOf(o.Key!, { size: o.Size, lastModified: o.LastModified, etag: o.ETag }));
      return { items: [...folders, ...files], nextPageToken: r.IsTruncated ? r.NextContinuationToken ?? null : null };
    } catch (e) { this.wrap(e); }
  }

  async stat(id: string): Promise<RemoteFile> {
    if (id === ROOT) return { ...this.folderOf(this.base || "bucket/"), id: ROOT, parentId: null, name: this.cfg.bucket };
    if (id.endsWith("/")) return this.folderOf(this.key(id));
    try {
      const h = await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: this.key(id) }));
      return this.fileOf(this.key(id), { size: h.ContentLength, lastModified: h.LastModified, etag: h.ETag, contentType: h.ContentType });
    } catch (e) { this.wrap(e); }
  }

  async path(id: string) {
    if (id === ROOT) return [];
    const parts = id.replace(/\/$/, "").split("/");
    return parts.map((name, i) => ({ id: parts.slice(0, i + 1).join("/") + (i < parts.length - 1 || id.endsWith("/") ? "/" : ""), name }));
  }

  async findChild(parentId: string, name: string) {
    const k = (parentId === ROOT ? "" : parentId) + name;
    try { return await this.stat(k); } catch (e) { if (!(e instanceof ProviderError) || e.kind !== "not_found") throw e; }
    const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: this.base + k + "/", MaxKeys: 1 }));
    return (r.KeyCount ?? 0) > 0 ? this.folderOf(this.base + k + "/") : null;
  }

  async createFolder(parentId: string, name: string) {
    const k = this.key(parentId) + name + "/";
    try { await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: k, Body: "" })); } catch (e) { this.wrap(e); }
    return this.folderOf(k);
  }

  async read(id: string, o: ReadOptions = {}): Promise<ReadResult> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.key(id), Range: o.range ? `bytes=${o.range.start}-${o.range.end ?? ""}` : undefined }), { abortSignal: o.signal });
      let range: ReadResult["range"];
      const cr = r.ContentRange?.match(/bytes (\d+)-(\d+)\/(\d+)/);
      if (cr) range = { start: +cr[1]!, end: +cr[2]!, total: +cr[3]! };
      return { stream: r.Body as Readable, size: r.ContentLength ?? null, mimeType: r.ContentType ?? ((mime.lookup(id) as string) || null), range };
    } catch (e) { this.wrap(e); }
  }

  async write(i: WriteInput): Promise<RemoteFile> {
    const key = this.key(i.parentId) + i.name;
    const up = new Upload({
      client: this.client, queueSize: 4, partSize: 8 * 1024 * 1024, leavePartsOnError: false,
      params: { Bucket: this.cfg.bucket, Key: key, Body: i.stream, ContentType: i.mimeType ?? ((mime.lookup(i.name) as string) || "application/octet-stream") },
    });
    i.signal?.addEventListener("abort", () => { void up.abort(); }, { once: true });
    try { await up.done(); } catch (e) { this.wrap(e); }
    return this.stat(this.idOf(key));
  }

  private async keysUnder(prefix: string) {
    const keys: string[] = []; let token: string | undefined;
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of r.Contents ?? []) keys.push(o.Key!);
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }
  private async copyKey(from: string, to: string) {
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: from }));
    if ((head.ContentLength ?? 0) > MAX_SINGLE_COPY) throw new ProviderError("Objek lebih dari 5 GB tidak bisa disalin langsung di S3.", "unsupported");
    await this.client.send(new CopyObjectCommand({ Bucket: this.cfg.bucket, Key: to, CopySource: `${this.cfg.bucket}/${from.split("/").map(encodeURIComponent).join("/")}` }));
  }

  async copy(id: string, destParentId: string, newName?: string) {
    try {
      const isDir = id.endsWith("/");
      const name = newName ?? id.replace(/\/$/, "").split("/").pop()!;
      const dest = this.key(destParentId) + name + (isDir ? "/" : "");
      if (!isDir) await this.copyKey(this.key(id), dest);
      else for (const k of await this.keysUnder(this.key(id))) await this.copyKey(k, dest + k.slice(this.key(id).length));
      return this.stat(this.idOf(dest));
    } catch (e) { this.wrap(e); }
  }
  async move(id: string, destParentId: string, newName?: string) {
    const res = await this.copy(id, destParentId, newName);
    await this.delete(id);
    return res;
  }
  async rename(id: string, name: string) {
    const parent = id.replace(/\/$/, "").split("/").slice(0, -1).join("/");
    return this.move(id, parent ? parent + "/" : ROOT, name);
  }

  async delete(id: string) {
    try {
      if (!id.endsWith("/")) { await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: this.key(id) })); return; }
      const keys = await this.keysUnder(this.key(id));
      for (let i = 0; i < keys.length; i += 1000) {
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.cfg.bucket, Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true } }));
      }
    } catch (e) { this.wrap(e); }
  }
}
