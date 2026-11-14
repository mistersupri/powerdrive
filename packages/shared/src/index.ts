// Types shared by the API and the web app. No runtime dependencies.

export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
export type ProviderType =
  | "GOOGLE_DRIVE" | "ONEDRIVE" | "DROPBOX" | "LOCAL" | "S3"
  | "SFTP" | "WEBDAV" | "SMB";
export type ConnectionStatus =
  | "CONNECTED" | "DISCONNECTED" | "TOKEN_EXPIRED" | "REAUTH_REQUIRED" | "ERROR" | "DISABLED";
export type TransferType = "COPY" | "MOVE";
export type TransferStatus =
  | "QUEUED" | "VALIDATING" | "RUNNING" | "PAUSED" | "RETRYING" | "VERIFYING"
  | "COMPLETED" | "COPY_COMPLETED_SOURCE_RETAINED" | "FAILED" | "CANCELLED";
export type ConflictPolicy = "SKIP" | "OVERWRITE" | "RENAME" | "FAIL";
export type Permission =
  | "READ" | "UPLOAD" | "DOWNLOAD" | "COPY" | "MOVE" | "DELETE" | "RENAME" | "SHARE" | "MOUNT" | "MANAGE_STORAGE";

export const ALL_PERMISSIONS: Permission[] = [
  "READ", "UPLOAD", "DOWNLOAD", "COPY", "MOVE", "DELETE", "RENAME", "SHARE", "MOUNT", "MANAGE_STORAGE",
];

export const ACTIVE_TRANSFER_STATUSES: TransferStatus[] = [
  "QUEUED", "VALIDATING", "RUNNING", "RETRYING", "VERIFYING", "PAUSED",
];

export interface StorageCapabilities {
  listFiles: boolean;
  readFile: boolean;
  rangeRead: boolean;
  uploadFile: boolean;
  resumableUpload: boolean;
  multipartUpload: boolean;
  nativeCopy: boolean;
  nativeMove: boolean;
  deleteFile: boolean;
  createFolder: boolean;
  nativeThumbnails: boolean;
  checksums: boolean;
  webhooks: boolean;
  versioning: boolean;
  sharedLinks: boolean;
}

export interface User { id: string; email: string; name: string; isSuperAdmin: boolean }
export interface WorkspaceSummary { id: string; name: string; slug: string; role: WorkspaceRole }

export interface FileEntry {
  id: string;
  storageId: string;
  parentId: string | null;
  name: string;
  isFolder: boolean;
  mimeType: string | null;
  size: number | null;
  modifiedAt: string | null;
  createdAt: string | null;
  checksum: string | null;
  hasThumbnail: boolean;
  /** Someone else changed something inside this folder since you last opened it. */
  changed?: boolean;
  starred?: boolean;
  /** Where the item lives (search results): "/Laporan/2026". */
  path?: string;
  /** Changes whenever the file content changes. Used as a cache key for thumbnails. */
  version: string | null;
}

export interface FileListing {
  items: FileEntry[];
  nextPageToken: string | null;
  folder: { id: string; name: string; parentId: string | null; path: { id: string; name: string }[] };
}

export interface StorageConnectionDto {
  id: string;
  workspaceId: string;
  provider: ProviderType;
  name: string;
  accountEmail: string | null;
  status: ConnectionStatus;
  lastError: string | null;
  lastConnectedAt: string | null;
  capabilities: StorageCapabilities;
  quota: { used: number | null; total: number | null } | null;
  mount: { id: string; virtualPath: string; enabled: boolean } | null;
  rootFolderId: string;
  permissions: Permission[];
  /** Extra detail worth showing, e.g. the pinned SSH host key fingerprint. */
  info?: string | null;
  /** The built-in "Semua file" storage (the uploads volume). */
  isDefault?: boolean;
  /** State of the background index that powers global search. */
  index?: { status: "IDLE" | "RUNNING" | "DONE" | "PARTIAL" | "FAILED"; filesIndexed: number; foldersScanned: number; startedAt: string | null; finishedAt: string | null; count: number; error: string | null };
}

export interface TransferJobDto {
  id: string;
  type: TransferType;
  status: TransferStatus;
  conflictPolicy: ConflictPolicy;
  sourceStorageId: string;
  destinationStorageId: string;
  sourceStorageName: string;
  destinationStorageName: string;
  title: string;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  skippedFiles: number;
  totalBytes: number | null;
  transferredBytes: number;
  errorMessage: string | null;
  retryCount: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  userId: string;
}

export interface TransferItemDto {
  id: string;
  fileName: string;
  relativePath: string | null;
  fileSize: number | null;
  transferredBytes: number;
  status: TransferStatus | "SKIPPED";
  errorMessage: string | null;
  retryCount: number;
}

export interface TrashItemDto {
  id: string; storageId: string; storageName: string; name: string; isFolder: boolean; size: number | null;
  originalPath: string; trashedAt: string; trashedBy: string | null; expiresAt: string;
}

export interface ShareLinkDto {
  id: string; /** Free text for the owner: who this link was made for. Never shown to visitors. */ title: string | null;
  /** "bundle" = several items under one link. */ kind: "single" | "bundle"; itemCount: number; items: { name: string; isFolder: boolean }[];
  /** Set when shared directly with a workspace member instead of by link. */ recipient: { id: string; name: string; email: string } | null; storageId: string; storageName: string; fileId: string; name: string; isFolder: boolean; role: "VIEWER" | "EDITOR";
  url: string; hasPassword: boolean; expiresAt: string | null; maxUploadBytes: number | null; uploadedBytes: number;
  accessCount: number; lastAccessAt: string | null; createdAt: string; createdByName: string | null; revokedAt: string | null; expired: boolean;
}

export interface PublicShareDto {
  name: string; isFolder: boolean; isBundle?: boolean; itemCount?: number; role: "VIEWER" | "EDITOR"; requiresPassword: boolean; unlocked: boolean; expiresAt: string | null;
  maxUploadBytes: number | null; uploadedBytes: number;
}

export interface FolderStats { files: number; folders: number; bytes: number; truncated: boolean }

export interface Paged<T> { items: T[]; total: number }

export interface UploadDto {
  id: string;
  name: string;
  size: number;
  offset: number;
  status: "RECEIVING" | "FINALIZING" | "DONE" | "FAILED";
  errorMessage: string | null;
  chunkSize: number;
  /** Bytes already pushed from the server to the destination provider (finalizing stage). */
  pushed?: number;
  skipped?: boolean;
  file?: FileEntry;
}

export interface NotificationDto {
  id: string; type: string; title: string; message: string; readAt: string | null; createdAt: string;
}

export interface AuditLogDto {
  id: string; action: string; resourceType: string; resourceId: string | null;
  userName: string | null; metadata: Record<string, unknown> | null; ipAddress: string | null; createdAt: string;
}

export interface MemberDto { userId: string; name: string; email: string; role: WorkspaceRole; createdAt: string }

export interface DashboardDto {
  storages: number;
  providers: number;
  knownCapacity: number;
  knownUsage: number;
  transfers: { active: number; completed: number; failed: number };
  recentActivity: AuditLogDto[];
  storageList: StorageConnectionDto[];
}

export interface ApiOk<T> { success: true; data: T; meta?: { requestId: string } }
export interface ApiErr { success: false; error: { code: string; message: string } }

export const PROVIDER_LABEL: Record<ProviderType, string> = {
  GOOGLE_DRIVE: "Google Drive", ONEDRIVE: "OneDrive", DROPBOX: "Dropbox", LOCAL: "Folder server",
  S3: "Penyimpanan S3", SFTP: "SFTP", WEBDAV: "WebDAV", SMB: "SMB / NAS",
};

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB", "PB"];
  let i = -1; let v = n;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`;
}
