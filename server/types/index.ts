import { Role as PrismaRole, DriveType as PrismaDriveType, SyncStatus as PrismaSyncStatus } from "@prisma/client";

export { PrismaRole as Role, PrismaDriveType as DriveType, PrismaSyncStatus as SyncStatus };

type Role = PrismaRole;
type DriveType = PrismaDriveType;
type SyncStatus = PrismaSyncStatus;

export enum FolderPermission {
  VIEW = "VIEW",
  EDIT = "EDIT",
}

export enum ActivityAction {
  LOGIN = "LOGIN",
  LOGOUT = "LOGOUT",
  USER_CREATED = "USER_CREATED",
  USER_UPDATED = "USER_UPDATED",
  USER_DELETED = "USER_DELETED",
  PASSWORD_RESET_REQUESTED = "PASSWORD_RESET_REQUESTED",
  PASSWORD_RESET_COMPLETED = "PASSWORD_RESET_COMPLETED",
  GOOGLE_CONNECTED = "GOOGLE_CONNECTED",
  GOOGLE_DISCONNECTED = "GOOGLE_DISCONNECTED",
  DRIVE_SELECTED = "DRIVE_SELECTED",
  FOLDER_CREATED = "FOLDER_CREATED",
  FOLDER_UPDATED = "FOLDER_UPDATED",
  FOLDER_DELETED = "FOLDER_DELETED",
  FILE_UPLOAD_STARTED = "FILE_UPLOAD_STARTED",
  FILE_UPLOAD_COMPLETED = "FILE_UPLOAD_COMPLETED",
  SYNC_STARTED = "SYNC_STARTED",
  SYNC_COMPLETED = "SYNC_COMPLETED",
  SYNC_FAILED = "SYNC_FAILED",
  SYNC_RETRY = "SYNC_RETRY",
  FILE_DOWNLOADED = "FILE_DOWNLOADED",
  FILE_DELETED = "FILE_DELETED",
  FILE_TRASHED = "FILE_TRASHED",
  FILE_RESTORED = "FILE_RESTORED",
  FOLDER_TRASHED = "FOLDER_TRASHED",
  FOLDER_RESTORED = "FOLDER_RESTORED",
  TRASH_EMPTIED = "TRASH_EMPTIED",
  MOUNT_ITEM_IMPORTED = "MOUNT_ITEM_IMPORTED",
  SMTP_CONFIG_UPDATED = "SMTP_CONFIG_UPDATED",
  SYSTEM_SETTING_UPDATED = "SYSTEM_SETTING_UPDATED",
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  avatarUrl?: string | null;
  authProvider?: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FolderRecord {
  id: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  permission?: FolderPermission | string | null;
  targetDriveType: DriveType;
  targetDriveId?: string | null;
  targetDriveName?: string | null;
  targetFolderPath: string;
  googleDriveFolderId?: string | null;
  syncToGoogleDrive?: boolean;
  isImported?: boolean;
  source?: string | null;
  isTrashed?: boolean;
  trashedAt?: Date | null;
  trashedBy?: string | null;
  lastSyncedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  subfoldersCount?: number;
  filesCount?: number;
  totalSizeBytes?: number;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
  isConfigured: boolean;
}


export interface FileVersionRecord {
  version: number;
  storedName: string;
  storagePath: string;
  size: number;
  checksumSha256: string;
  mimeType: string;
  createdAt: Date;
  uploadedBy?: string;
}

export interface FileRecord {
  id: string;
  userId: string;
  folderId: string;
  originalName: string;
  storedName: string;
  storagePath: string;
  mimeType: string;
  size: number;
  checksumSha256: string;
  version?: number;
  versionHistory?: FileVersionRecord[];
  isTrashed?: boolean;
  trashedAt?: Date | null;
  trashedBy?: string | null;
  googleDriveFileId?: string | null;
  googleDriveFolderId?: string | null;
  googleDriveWebViewLink?: string | null;
  syncStatus: SyncStatus;
  syncAttempts: number;
  lastError?: string | null;
  syncedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user?: UserRecord;
  folder?: FolderRecord;
}

export interface SyncJobRecord {
  id: string;
  fileId: string;
  status: SyncStatus;
  attempts: number;
  maxAttempts: number;
  lastError?: string | null;
  scheduledAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  file?: FileRecord;
}

export interface GoogleDriveConnectionRecord {
  id: string;
  userId?: string | null;
  accountEmail: string;
  accountName?: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: Date;
  scope: string;
  isConnected: boolean;
  selectedDriveId?: string | null;
  selectedDriveName?: string | null;
  selectedDriveType: DriveType;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActivityLogRecord {
  id: string;
  userId?: string | null;
  action: ActivityAction;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  result: "SUCCESS" | "FAILURE";
  errorMessage?: string | null;
  createdAt: Date;
  user?: UserRecord | null;
}

export interface SystemSettingRecord {
  key: string;
  value: string;
  description?: string | null;
  updatedAt: Date;
}
