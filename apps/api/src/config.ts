import path from "node:path";
import os from "node:os";

const env = process.env;
const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);
/** Accepts true/false in any case (YAML/compose tools often write True/False). */
const flag = (v: string | undefined, d: boolean) => (v === undefined || v === "" ? d : /^(true|1|yes|on)$/i.test(v.trim()));
const dataDir = path.resolve(env.DATA_DIR ?? "./data");
// One setting. LOCAL_ROOTS is the old name: honoured only as a fallback for UPLOADS_DIR (its first entry).
const uploadsDir = path.resolve(env.UPLOADS_DIR ?? env.LOCAL_ROOTS?.split(",")[0]?.trim() ?? path.join(dataDir, "files"));

export const config = {
  env: env.NODE_ENV ?? "development",
  isProd: env.NODE_ENV === "production",
  port: num(env.PORT, 3000),
  host: env.HOST ?? "0.0.0.0",
  appUrl: (env.APP_URL ?? "http://localhost:5173").replace(/\/$/, ""),
  dataDir,
  dbFile: env.DATABASE_FILE ?? path.join(dataDir, "superdrive.db"),
  cacheDir: path.join(dataDir, "cache"),
  stagingDir: path.join(dataDir, "staging"),
  sessionTtlDays: num(env.SESSION_TTL_DAYS, 14),
  /** `v1:<base64 32 bytes>,v2:<...>` — first entry is used for new writes. */
  masterKeys: env.ENCRYPTION_MASTER_KEY ?? "",
  allowRegistration: flag(env.ALLOW_REGISTRATION, true),
  /** Directories the "local" provider may expose. Comma separated. */
  /** The folder behind the "Semua file" page. Defaults to ./data/files. */
  uploadsDir,
  /** Extra "Folder server" storages must live inside the uploads folder. */
  localRoots: [uploadsDir],
  trashRetentionDays: num(env.TRASH_RETENTION_DAYS, 30),
  /** Allow external storage (S3 / WebDAV / SFTP) on private networks, e.g. a NAS. */
  allowPrivateHosts: flag(env.ALLOW_PRIVATE_HOSTS, false),
  transfer: {
    perWorkspaceConcurrency: num(env.TRANSFER_MAX_CONCURRENCY, 3),
    globalConcurrency: num(env.TRANSFER_GLOBAL_CONCURRENCY, 8),
    bufferSize: num(env.TRANSFER_BUFFER_SIZE, 1024 * 1024),
    retryAttempts: num(env.TRANSFER_RETRY_ATTEMPTS, 5),
    retryBaseMs: num(env.TRANSFER_RETRY_BASE_MS, 1500),
  },
  upload: {
    chunkSize: num(env.UPLOAD_CHUNK_SIZE, 16 * 1024 * 1024),
    maxFileSize: num(env.UPLOAD_MAX_FILE_SIZE, 0), // 0 = unlimited
    staleHours: num(env.UPLOAD_STALE_HOURS, 48),
    /** Cap on bytes waiting in staging across all uploads (0 = unlimited). Protects the disk under heavy public use. */
    stagingMaxBytes: num(env.STAGING_MAX_BYTES, 0),
    maxActivePerIp: num(env.MAX_ACTIVE_UPLOADS_PER_IP, 100),
  },
  thumbnails: {
    concurrency: num(env.THUMBNAIL_CONCURRENCY, Math.max(2, os.cpus().length)),
    maxSourceBytes: num(env.THUMBNAIL_MAX_SOURCE_BYTES, 64 * 1024 * 1024),
    sizes: [128, 256, 512, 1024, 2048] as number[],
  },
  oauth: {
    google: { clientId: env.GOOGLE_CLIENT_ID ?? "", clientSecret: env.GOOGLE_CLIENT_SECRET ?? "", redirectUri: env.GOOGLE_REDIRECT_URI ?? `${(env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "")}/api/v1/storages/google-drive/callback` },
    microsoft: { clientId: env.MICROSOFT_CLIENT_ID ?? "", clientSecret: env.MICROSOFT_CLIENT_SECRET ?? "", redirectUri: env.MICROSOFT_REDIRECT_URI ?? `${(env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "")}/api/v1/storages/onedrive/callback`, tenant: env.MICROSOFT_TENANT ?? "common" },
    dropbox: { clientId: env.DROPBOX_CLIENT_ID ?? "", clientSecret: env.DROPBOX_CLIENT_SECRET ?? "", redirectUri: env.DROPBOX_REDIRECT_URI ?? `${(env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "")}/api/v1/storages/dropbox/callback` },
  },
};
