import { DatabaseSync, type StatementSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.ts";

type Param = string | number | null | bigint | Uint8Array;
export type Row = Record<string, any>;

/**
 * SQLite in WAL mode: zero extra services to run, fast for the metadata workload
 * (listing, search index, job state), and trivial to back up. The wrapper keeps the
 * rest of the code independent of the driver.
 */
class Database {
  raw: DatabaseSync;
  private cache = new Map<string, StatementSync>();

  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA cache_size = -65536;
      PRAGMA temp_store = MEMORY;
    `);
  }

  private stmt(sql: string) {
    let s = this.cache.get(sql);
    if (!s) { s = this.raw.prepare(sql); this.cache.set(sql, s); }
    return s;
  }
  get<T = Row>(sql: string, ...p: Param[]): T | undefined { return this.stmt(sql).get(...p) as T | undefined; }
  all<T = Row>(sql: string, ...p: Param[]): T[] { return this.stmt(sql).all(...p) as T[]; }
  run(sql: string, ...p: Param[]) { return this.stmt(sql).run(...p); }
  exec(sql: string) { this.raw.exec(sql); }

  /** Run `fn` in a transaction. Nested calls join the outer transaction. */
  private depth = 0;
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.raw.exec("BEGIN IMMEDIATE");
    this.depth++;
    try { const r = fn(); this.raw.exec("COMMIT"); return r; }
    catch (e) { this.raw.exec("ROLLBACK"); throw e; }
    finally { this.depth--; }
  }
  close() { this.raw.close(); }
}

const MIGRATIONS: string[] = [
  /* 1 */ `
  CREATE TABLE users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
    password_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', is_super_admin INTEGER NOT NULL DEFAULT 0,
    last_login_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, ip TEXT, user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id, expires_at);
  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE memberships (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'MEMBER',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (workspace_id, user_id)
  );
  CREATE INDEX idx_memberships_user ON memberships(user_id);
  CREATE TABLE invitations (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email TEXT NOT NULL COLLATE NOCASE, role TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL, accepted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE password_resets (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL
  );
  CREATE TABLE credentials (
    id TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, iv TEXT NOT NULL, auth_tag TEXT NOT NULL,
    key_version TEXT NOT NULL, credential_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE storages (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider TEXT NOT NULL, name TEXT NOT NULL, account_id TEXT, account_email TEXT,
    status TEXT NOT NULL DEFAULT 'DISCONNECTED', credential_id TEXT REFERENCES credentials(id) ON DELETE SET NULL,
    config TEXT, capabilities TEXT, quota_used INTEGER, quota_total INTEGER,
    last_connected_at TEXT, last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_storages_ws ON storages(workspace_id, provider);
  CREATE TABLE storage_permissions (
    id TEXT PRIMARY KEY, storage_id TEXT NOT NULL REFERENCES storages(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE, role TEXT, permissions TEXT NOT NULL
  );
  CREATE INDEX idx_storage_perm ON storage_permissions(storage_id, user_id);
  CREATE TABLE mounts (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    storage_id TEXT NOT NULL REFERENCES storages(id) ON DELETE CASCADE, name TEXT NOT NULL,
    virtual_path TEXT NOT NULL, root_folder_id TEXT, enabled INTEGER NOT NULL DEFAULT 1,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (workspace_id, virtual_path)
  );
  -- Local metadata index. The provider stays the source of truth.
  CREATE TABLE files (
    storage_id TEXT NOT NULL REFERENCES storages(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL, parent_id TEXT, name TEXT NOT NULL, name_lower TEXT NOT NULL,
    ext TEXT, mime_type TEXT, size INTEGER, checksum TEXT, is_folder INTEGER NOT NULL DEFAULT 0,
    has_thumbnail INTEGER NOT NULL DEFAULT 0, version TEXT,
    modified_at TEXT, created_at_remote TEXT, indexed_at TEXT NOT NULL,
    PRIMARY KEY (storage_id, file_id)
  ) WITHOUT ROWID;
  CREATE INDEX idx_files_parent ON files(storage_id, parent_id);
  CREATE INDEX idx_files_name ON files(name_lower);
  CREATE INDEX idx_files_modified ON files(modified_at DESC);
  CREATE TABLE stars (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_id TEXT NOT NULL REFERENCES storages(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (user_id, storage_id, file_id)
  ) WITHOUT ROWID;
  CREATE TABLE transfer_jobs (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id), source_storage_id TEXT NOT NULL, destination_storage_id TEXT NOT NULL,
    type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'QUEUED', conflict_policy TEXT NOT NULL DEFAULT 'RENAME',
    title TEXT NOT NULL, request TEXT NOT NULL,
    total_files INTEGER NOT NULL DEFAULT 0, completed_files INTEGER NOT NULL DEFAULT 0,
    failed_files INTEGER NOT NULL DEFAULT 0, skipped_files INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER, transferred_bytes INTEGER NOT NULL DEFAULT 0,
    expanded INTEGER NOT NULL DEFAULT 0, error_message TEXT, retry_count INTEGER NOT NULL DEFAULT 0,
    idempotency_key TEXT NOT NULL, started_at TEXT, completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (workspace_id, idempotency_key)
  );
  CREATE INDEX idx_jobs_status ON transfer_jobs(workspace_id, status);
  CREATE TABLE transfer_items (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES transfer_jobs(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL, source_file_id TEXT NOT NULL, source_parent_id TEXT, destination_parent_id TEXT NOT NULL,
    destination_file_id TEXT, relative_path TEXT, file_name TEXT NOT NULL, is_folder INTEGER NOT NULL DEFAULT 0,
    file_size INTEGER, transferred_bytes INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'QUEUED',
    checksum TEXT, error_message TEXT, retry_count INTEGER NOT NULL DEFAULT 0,
    checkpoint TEXT, source_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_items_job ON transfer_items(job_id, status, seq);
  CREATE TABLE uploads (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, storage_id TEXT NOT NULL,
    parent_id TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, received INTEGER NOT NULL DEFAULT 0,
    mime_type TEXT, conflict_policy TEXT NOT NULL DEFAULT 'RENAME', status TEXT NOT NULL DEFAULT 'RECEIVING',
    error_message TEXT, staging_path TEXT NOT NULL, result TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE oauth_states (
    state TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, provider TEXT NOT NULL,
    code_verifier TEXT, name TEXT, reconnect_storage_id TEXT, expires_at TEXT NOT NULL
  );
  CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT, action TEXT NOT NULL,
    resource_type TEXT NOT NULL, resource_id TEXT, metadata TEXT, ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_audit_ws ON audit_logs(workspace_id, created_at DESC);
  CREATE TABLE notifications (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, type TEXT NOT NULL,
    title TEXT NOT NULL, message TEXT NOT NULL, data TEXT, read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_notif_user ON notifications(user_id, read_at, created_at DESC);
  `,
  /* 2 */ `
  ALTER TABLE storages ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE uploads ADD COLUMN share_id TEXT;
  ALTER TABLE uploads ADD COLUMN ip TEXT;
  CREATE INDEX idx_uploads_share ON uploads(share_id);
  CREATE TABLE share_links (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    storage_id TEXT NOT NULL REFERENCES storages(id) ON DELETE CASCADE, file_id TEXT NOT NULL, is_folder INTEGER NOT NULL,
    name TEXT NOT NULL, role TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_enc TEXT NOT NULL, password_hash TEXT,
    expires_at TEXT, max_upload_bytes INTEGER, uploaded_bytes INTEGER NOT NULL DEFAULT 0, created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), revoked_at TEXT,
    access_count INTEGER NOT NULL DEFAULT 0, last_access_at TEXT
  );
  CREATE INDEX idx_share_target ON share_links(storage_id, file_id, role);
  CREATE INDEX idx_share_ws ON share_links(workspace_id, created_at DESC);
  CREATE TABLE trash_items (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    storage_id TEXT NOT NULL REFERENCES storages(id) ON DELETE CASCADE, name TEXT NOT NULL, is_folder INTEGER NOT NULL DEFAULT 0,
    size INTEGER, original_parent_id TEXT NOT NULL, original_path TEXT, trash_file_id TEXT NOT NULL, trashed_by TEXT,
    trashed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), expires_at TEXT NOT NULL
  );
  CREATE INDEX idx_trash_ws ON trash_items(workspace_id, trashed_at DESC);
  CREATE INDEX idx_trash_storage ON trash_items(storage_id);
  CREATE INDEX idx_jobs_user_created ON transfer_jobs(workspace_id, created_at DESC);
  `,
  /* 3 */ `
  CREATE TABLE index_state (
    storage_id TEXT PRIMARY KEY REFERENCES storages(id) ON DELETE CASCADE, status TEXT NOT NULL,
    started_at TEXT, finished_at TEXT, folders_scanned INTEGER NOT NULL DEFAULT 0, files_indexed INTEGER NOT NULL DEFAULT 0, error TEXT
  );
  `,
  /* 4 */ `
  ALTER TABLE share_links ADD COLUMN title TEXT;
  `,
  /* 5 */ `
  CREATE TABLE folder_changes (storage_id TEXT NOT NULL, folder_id TEXT NOT NULL, changed_at TEXT NOT NULL, by_actor TEXT NOT NULL, PRIMARY KEY (storage_id, folder_id)) WITHOUT ROWID;
  CREATE TABLE folder_seen (user_id TEXT NOT NULL, storage_id TEXT NOT NULL, folder_id TEXT NOT NULL, seen_at TEXT NOT NULL, PRIMARY KEY (user_id, storage_id, folder_id)) WITHOUT ROWID;
  CREATE TABLE file_activity (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, storage_id TEXT NOT NULL, file_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, meta TEXT, ip TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_file_activity ON file_activity(storage_id, file_id, created_at DESC);
  CREATE TABLE file_tags (storage_id TEXT NOT NULL, file_id TEXT NOT NULL, tag TEXT NOT NULL, workspace_id TEXT NOT NULL, created_by TEXT, PRIMARY KEY (storage_id, file_id, tag)) WITHOUT ROWID;
  CREATE INDEX idx_file_tags_tag ON file_tags(workspace_id, tag);
  CREATE TABLE file_comments (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, storage_id TEXT NOT NULL, file_id TEXT NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_file_comments ON file_comments(storage_id, file_id, created_at);
  CREATE TABLE file_meta_cache (storage_id TEXT NOT NULL, file_id TEXT NOT NULL, version TEXT NOT NULL DEFAULT '', data TEXT NOT NULL, PRIMARY KEY (storage_id, file_id)) WITHOUT ROWID;
  `,
  /* 6 */ `
  ALTER TABLE share_links ADD COLUMN kind TEXT NOT NULL DEFAULT 'single';
  ALTER TABLE share_links ADD COLUMN recipient_user_id TEXT;
  CREATE TABLE share_items (share_id TEXT NOT NULL REFERENCES share_links(id) ON DELETE CASCADE, file_id TEXT NOT NULL, name TEXT NOT NULL, is_folder INTEGER NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (share_id, file_id)) WITHOUT ROWID;
  CREATE INDEX idx_share_recipient ON share_links(recipient_user_id, revoked_at);
  `,
  /* 7 */ `
  CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
  ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
  CREATE TABLE user_mfa (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, secret_enc TEXT NOT NULL, confirmed_at TEXT, recovery TEXT NOT NULL DEFAULT '[]', last_step INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE mfa_challenges (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, ip TEXT, user_agent TEXT);
  `,
];

function migrate(d: Database) {
  d.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)");
  const done = new Set(d.all<{ version: number }>("SELECT version FROM schema_migrations").map((r) => r.version));
  MIGRATIONS.forEach((sql, i) => {
    const v = i + 1;
    if (done.has(v)) return;
    d.tx(() => { d.exec(sql); d.run("INSERT INTO schema_migrations(version) VALUES (?)", v); });
  });
}

let instance: Database | null = null;
export function openDb(file = config.dbFile) {
  if (instance) instance.close();
  instance = new Database(file);
  migrate(instance);
  return instance;
}
export const db = new Proxy({} as Database, {
  get(_t, prop) {
    if (!instance) openDb();
    const v = (instance as any)[prop];
    return typeof v === "function" ? v.bind(instance) : v;
  },
});
export const now = () => new Date().toISOString();
