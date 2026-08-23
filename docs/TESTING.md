# Testing & Validation Strategy
# Centralized File Upload & Google Drive Synchronization Application

## 1. Test Matrix Across Functional Domains

### 1.1 Authentication & Authorization
- [ ] User login with valid credentials succeeds and returns JWT/Cookie.
- [ ] Invalid password or inactive account is rejected with HTTP 401.
- [ ] Regular USER accessing `/api/admin/*` is rejected with HTTP 403 Forbidden.
- [ ] Regular USER cannot query or download files belonging to other users.

### 1.2 Google Drive Connection & Discovery
- [ ] Admin OAuth connect URL generates valid Google OAuth consent redirect.
- [ ] Callback persists tokens securely and marks connection active.
- [ ] Drive discovery accurately lists `My Drive` and all accessible `Shared Drives`.
- [ ] Folder tree builder correctly constructs nested hierarchy JSON without raw ID leakage.

### 1.3 Folder Creation & Duplicate Protection
- [ ] Path `2026/Pendataan/KJP` is recursively verified and created level-by-level.
- [ ] If folder already exists, it is reused and no duplicate folder is created in Google Drive.
- [ ] System handles concurrent folder creation gracefully.

### 1.4 File Upload & Server Storage
- [ ] Single file upload stores binary on `/storage/uploads/YYYY/MM/DD/{uuid}.bin`.
- [ ] Multiple file upload handles concurrent multi-part streams accurately.
- [ ] File exceeding max size limit (e.g. 100MB) is rejected with HTTP 413.
- [ ] Incomplete or interrupted upload cleans up partial temp files.
- [ ] SHA-256 checksum is calculated and stored correctly.

### 1.5 Sync Engine & Idempotency
- [ ] Sync worker picks up `PENDING` job and moves status to `PROCESSING`.
- [ ] Successful upload to Google Drive extracts `googleDriveFileId` and marks `SYNCED`.
- [ ] Local file remains on server storage throughout the sync lifecycle.
- [ ] Network interruption simulates failure -> status moves to `FAILED` or `RETRYING`.
- [ ] Sync retry executes idempotency check, detects already-uploaded file on Google Drive, reconciles ID, and prevents duplicate creation.

### 1.6 Security & Hardening
- [ ] Path traversal payloads (e.g. `../../etc/passwd`) are blocked.
- [ ] Google client secrets and refresh tokens are inaccessible via public frontend APIs.
- [ ] Activity logs record IP, user, and action for every critical operation.
