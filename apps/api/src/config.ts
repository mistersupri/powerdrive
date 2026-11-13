import path from "node:path";
import os from "node:os";

const env = process.env;
const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);
const dataDir = path.resolve(env.DATA_DIR ?? "./data");

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
  allowRegistration: env.ALLOW_REGISTRATION !== "false",
  /** Directories the "local" provider may expose. Comma separated. */
  localRoots: (env.LOCAL_ROOTS ?? path.join(dataDir, "files")).split(",").map((s) => path.resolve(s.trim())).filter(Boolean),
  /** Allow external storage (S3 / WebDAV / SFTP) on private networks, e.g. a NAS. */
  allowPrivateHosts: env.ALLOW_PRIVATE_HOSTS === "true",
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
