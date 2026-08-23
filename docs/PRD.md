# Product Requirements Document (PRD)
# Centralized File Upload & Google Drive Synchronization Application

## 1. Overview & Vision
The **Centralized File Upload & Google Drive Synchronization Application** is an enterprise-grade, secure file gateway. It acts as an authoritative intermediary between end-users and Google Drive storage (My Drive and Google Workspace Shared Drives). 

Users never directly upload files to Google Drive, nor are they ever asked or required to know, copy, or enter Google Drive Folder IDs or system identifiers. Instead, the application accepts user uploads, securely stores them in an organized local server storage buffer, indexes complete metadata in a PostgreSQL database, queues asynchronous sync jobs, and executes reliable, idempotent uploads to Google Drive via backend-controlled APIs.

---

## 2. Core Architectural Principles
1. **Application Gateway Authority**: "The application receives the file. The application controls the synchronization. Google Drive is the destination."
2. **Zero Direct User-to-Drive Access**: Browsers and client apps never interact directly with Google Drive API endpoints or upload directly to Google storage buckets.
3. **Zero Manual Identifier Configuration**: Google Drive IDs (Folder IDs, Drive IDs, File IDs, Parent IDs) are strictly **SYSTEM-MANAGED IDENTIFIERS**. Users only interact with human-readable Drive/Folder trees, visual selectors, and automatic destination paths.
4. **Resilient Local Buffer**: Uploaded files reside in structured local server storage until Google Drive synchronization succeeds and is confirmed with an immutable `googleDriveFileId`. If synchronization fails, local files are strictly preserved for automatic or administrative retry.
5. **Idempotency & Duplicate Protection**: The synchronization engine is strictly idempotent. Repeated sync attempts or transient network timeouts will never generate duplicate files in Google Drive.
6. **Transparent Auditing & Observability**: Every critical system event (authentications, folder mutations, uploads, sync status transitions, retries, and errors) is immutably recorded in an Activity Log.
7. **Permanent Documentation as Single Source of Truth**: All architectural designs, schemas, decisions, phase reports, and validation records reside permanently within `/docs/`.

---

## 3. User Personas & Roles

### 3.1 Role: USER
- **Authentication**: Secure login and logout via session credentials.
- **Folder Navigation**: Browse internal application folders and target destinations mapped to Google Drive.
- **File Upload**: Upload single or multiple files via drag-and-drop or file picker with client-side validation and live progress.
- **File & Sync Tracking**: View uploaded files, real-time synchronization lifecycle statuses (`PENDING`, `PROCESSING`, `SYNCED`, `FAILED`, `RETRYING`), and download local copies.

### 3.2 Role: ADMIN
- **Supervision & Management**: Complete administrative control over all users, folders, and uploaded files.
- **Google Account & Drive Connection**: Authorize and connect the administrative Google Account via backend Google OAuth 2.0.
- **Drive & Folder Discovery**: Browse interactive hierarchical folder trees across My Drive and Shared Drives without manual ID entry.
- **Automatic Path Setup**: Configure application folder destinations with automatic recursive folder creation (e.g. `Shared Drive/2026/Pendataan/KJP`).
- **Sync Operations**: Monitor global synchronization health, inspect failure logs, trigger manual retries for failed jobs, and reconcile states.
- **System Audit & Activity Logs**: Filter and inspect detailed activity logs for compliance and debugging.

---

## 4. Functional Requirements

### 4.1 Authentication & Authorization
- Secure password hashing (Argon2id/Bcrypt) and session token management via HTTP-only, SameSite cookies.
- Role-Based Access Control (RBAC) enforced at all API endpoints.
- User isolation: Regular users access only permitted folders and files.

### 4.2 Google Drive Connection & Discovery
- Secure Google OAuth 2.0 authorization with `https://www.googleapis.com/auth/drive` scope.
- Backend token vault: Securely store Refresh Tokens and manage ephemeral Access Tokens without leaking secrets to the client.
- Automated Drive Discovery: Fetch and distinguish personal `My Drive` and organizational `Shared Drives`.
- Hierarchical Folder Tree Builder: Dynamically traverse, fetch, and construct nested folder trees for frontend visual navigation.

### 4.3 Automated Folder Management
- **Visual Folder Browser**: Interactive folder tree allowing folder creation, search, refresh, and selection.
- **Automatic Hierarchy Creation**: When a designated target path (e.g., `2026/Pendataan/KJP`) does not exist in Google Drive, backend automatically queries each segment and recursively creates missing parent and child folders.
- **Duplicate Folder Shield**: Verify existing folder names at each parent level before creation.

### 4.4 File Upload & Local Storage Buffer
- **Multi-File & Drag-and-Drop**: Modern upload UI supporting batch uploads with real-time progress.
- **Validation**: Enforce configurable maximum file sizes (e.g., 100MB), whitelist MIME types, and sanitize filenames.
- **Sanitized Storage Partitioning**: Store incoming files on server storage using UUID-based physical filenames within partitioned date paths (`/storage/uploads/YYYY/MM/DD/uuid.bin`).
- **Original Metadata Retention**: Retain original filenames, MIME types, file sizes, uploader IDs, and upload timestamps in PostgreSQL.

### 4.5 Asynchronous Sync Engine
- **Lifecycle States**: `PENDING` -> `PROCESSING` -> `SYNCED` (or `FAILED` -> `RETRYING` -> `PROCESSING` -> `SYNCED`).
- **Background Worker**: Server-side sync daemon that processes queued `SyncJob` records independently of browser session state.
- **Google Drive Upload Pipeline**: Read local buffered files, upload via Google Drive API v3 to target folder, extract and verify `googleDriveFileId`, and update PostgreSQL atomically.
- **Resilient Retention**: Never delete local files until Google Drive upload is verified and marked `SYNCED`.

### 4.6 Reliability, Retry & Idempotency
- **Deduplication Check**: Before uploading, sync worker checks target folder for existing file hashes / metadata to prevent duplicate uploads during timeout recovery.
- **Exponential Backoff**: Configurable automatic retry schedule for transient network failures.
- **Admin Manual Retry**: On-demand single-click retry for failed jobs.

### 4.7 Audit Logging & Observability
- Immutable logging of actions: `LOGIN`, `LOGOUT`, `GOOGLE_CONNECTED`, `FOLDER_CREATED`, `FILE_UPLOAD_COMPLETED`, `SYNC_STARTED`, `SYNC_COMPLETED`, `SYNC_FAILED`, `SYNC_RETRY`, etc.

---

## 5. Non-Functional Requirements
- **Performance**: Sub-100ms API response times for folder navigation and metadata lookups; streaming file upload/download without memory leaks.
- **Security**: Zero credential leakage to browser; path traversal protection; parameterized database queries; strict CORS and CSP headers.
- **Availability**: Offline-aware SPA with Service Worker static shell caching; graceful degradation when Google Drive API experiences rate limits.
- **Maintainability**: Clear modular architecture separating web client, API server, database layer, sync engine, storage manager, and Google Drive services.
