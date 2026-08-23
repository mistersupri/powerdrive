# Server Storage Architecture & File Management
# Centralized File Upload & Google Drive Synchronization Application

## 1. Storage Architecture

Incoming files are held in local server storage as a resilient buffer before and during Google Drive synchronization.

```
/storage/
└── uploads/
    └── YYYY/
        └── MM/
            └── DD/
                ├── 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d.bin
                └── c4a8a3f8-8429-421b-bb8c-628d6c7017b2.bin
```

---

## 2. Naming & Partitioning Rules

1. **Date-Based Partitioning**:
   - Files are partitioned by creation date (`/storage/uploads/YYYY/MM/DD/`) to prevent filesystem inode degradation from millions of files in a single flat directory.

2. **Sanitized Physical Storage Naming**:
   - Never use user-supplied original filenames on the server filesystem.
   - Generate a cryptographically random UUID v4 string for the physical file (`{uuid}.bin`).
   - The user-facing filename (e.g. `Surat Permohonan KJP.pdf`) is securely persisted in PostgreSQL `File.originalName`.

3. **Checksum Generation**:
   - Stream SHA-256 hash calculation during upload write.
   - Persist hash in `File.checksumSha256` for integrity validation and idempotency checking.

---

## 3. Storage Retention & Cleanup Policies

- **Zero Early Deletion Rule**: Under no circumstances is a local buffered file deleted before:
  1. Google Drive API upload returns HTTP 200 OK.
  2. The valid `googleDriveFileId` is returned and stored in PostgreSQL.
  3. Database record state is committed as `SYNCED`.
- **Failure Preservation**: If sync encounters an error (`FAILED`), the local physical file is strictly retained on disk, allowing immediate zero-data-loss retries.
- **Configurable Retention Policy**: Once `SYNCED`, admins can configure retention duration (e.g. Keep local buffer for 30 days for fast local downloads, or immediately archive).
