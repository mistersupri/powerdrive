import type { Readable } from "node:stream";
import type { ProviderType, StorageCapabilities } from "@superdrive/shared";

/** Canonical id of a storage's root folder. Every adapter maps it to its own root. */
export const ROOT = "root";

export interface RemoteFile {
  id: string;
  parentId: string | null;
  name: string;
  isFolder: boolean;
  mimeType: string | null;
  size: number | null;
  modifiedAt: string | null;
  createdAt: string | null;
  checksum: string | null;
  /** Changes whenever content changes — used as a thumbnail cache key. */
  version: string | null;
  hasThumbnail: boolean;
}

export interface ListResult { items: RemoteFile[]; nextPageToken: string | null }
export interface ReadResult {
  stream: Readable;
  size: number | null;
  mimeType: string | null;
  /** Set when a byte range was served. `total` is the full object size. */
  range?: { start: number; end: number; total: number };
}
export interface ReadOptions { range?: { start: number; end?: number }; signal?: AbortSignal }
export interface WriteInput {
  parentId: string;
  name: string;
  size: number | null;
  mimeType?: string | null;
  stream: Readable;
  signal?: AbortSignal;
}
export interface AccountInfo {
  id: string | null;
  email: string | null;
  displayName?: string | null;
  quota: { used: number | null; total: number | null } | null;
}
export interface ThumbResult { stream: Readable; contentType: string }

export interface StorageProvider {
  readonly type: ProviderType;
  readonly capabilities: StorageCapabilities;
  account(): Promise<AccountInfo>;
  list(parentId: string, opts?: { pageToken?: string | null; limit?: number }): Promise<ListResult>;
  stat(id: string): Promise<RemoteFile>;
  /** Ancestors from the root (exclusive) down to `id` (inclusive). */
  path(id: string): Promise<{ id: string; name: string }[]>;
  /** `system` lets the app create its own reserved folders (the trash). */
  createFolder(parentId: string, name: string, system?: boolean): Promise<RemoteFile>;
  read(id: string, opts?: ReadOptions): Promise<ReadResult>;
  write(input: WriteInput): Promise<RemoteFile>;
  copy?(id: string, destParentId: string, newName?: string): Promise<RemoteFile>;
  move?(id: string, destParentId: string, newName?: string): Promise<RemoteFile>;
  rename(id: string, name: string): Promise<RemoteFile>;
  delete(id: string): Promise<void>;
  /** Cheap lookup for name conflicts. */
  findChild?(parentId: string, name: string): Promise<RemoteFile | null>;
  /** Provider-generated thumbnail (avoids downloading the original). */
  thumbnail?(file: RemoteFile, size: number): Promise<ThumbResult | null>;
  /** Absolute path on the server filesystem; only for the local provider. */
  localPath?(id: string): string;
  /** Release long-lived connections (SSH). */
  close?(): void;
}

export const baseCaps = (over: Partial<StorageCapabilities> = {}): StorageCapabilities => ({
  listFiles: true, readFile: true, rangeRead: true, uploadFile: true, resumableUpload: false,
  multipartUpload: false, nativeCopy: false, nativeMove: false, deleteFile: true, createFolder: true,
  nativeThumbnails: false, checksums: false, webhooks: false, versioning: false, sharedLinks: false,
  ...over,
});

/** Opaque, URL-safe id used on the API boundary. Providers always see raw ids. */
export const encodeId = (raw: string) => (raw === ROOT ? ROOT : "~" + Buffer.from(raw, "utf8").toString("base64url"));
export const decodeId = (enc: string) => (enc === ROOT ? ROOT : enc.startsWith("~") ? Buffer.from(enc.slice(1), "base64url").toString("utf8") : enc);

export class ProviderError extends Error {
  constructor(message: string, public kind: "auth" | "not_found" | "conflict" | "quota" | "rate" | "unsupported" | "network" | "other" = "other", public status?: number) {
    super(message);
  }
}
export const isRetryable = (e: unknown) =>
  e instanceof ProviderError ? e.kind === "rate" || e.kind === "network" || (e.status !== undefined && e.status >= 500)
    : (e as any)?.code === "ECONNRESET" || (e as any)?.code === "ETIMEDOUT" || (e as any)?.name === "TimeoutError";
