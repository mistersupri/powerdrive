# REST API Specification
# Centralized File Upload & Google Drive Synchronization Application

## 1. Authentication Endpoints (`/api/auth`)

- `POST /api/auth/login`: Authenticates user/admin with email and password. Returns user object and sets HTTP-Only session cookie.
- `POST /api/auth/logout`: Clears session cookie and invalidates token.
- `GET /api/auth/me`: Returns current authenticated user profile and role.

---

## 2. Google Drive Integration Endpoints (`/api/google`)

- `GET /api/google/status`: Returns connection status (`isConnected`, `accountEmail`, `selectedDriveName`, `selectedDriveType`).
- `GET /api/google/connect-url`: Generates backend OAuth 2.0 authorization URL with drive scopes.
- `GET /api/google/callback`: Handles OAuth 2.0 code exchange and persists refresh token.
- `POST /api/google/disconnect`: Disconnects Google account and clears stored tokens (Admin only).
- `GET /api/google/drives`: Returns list of available drives (My Drive + Shared Drives).
- `POST /api/google/select-drive`: Sets the active target drive for the application.
- `GET /api/google/folders`: Returns hierarchical folder tree for the selected drive.
- `POST /api/google/folders/create`: Creates a new folder under a specified parent in Google Drive.
- `POST /api/google/folders/refresh`: Force-refreshes Google Drive folder tree cache.

---

## 3. Application Folders (`/api/folders`)

- `GET /api/folders`: List all active application folders with their mapped Google Drive targets.
- `POST /api/folders`: Create an application folder mapped to an automatic Google Drive destination path (Admin only).
- `PUT /api/folders/:id`: Update folder metadata or target path.
- `DELETE /api/folders/:id`: Soft delete or remove folder.

---

## 4. File Management & Upload (`/api/files`)

- `POST /api/files/upload`: Multipart upload receiving single or multiple files + `folderId`.
- `GET /api/files`: List files (filtered by role: own files for USER, all files for ADMIN) with pagination and search.
- `GET /api/files/:id`: Get file details, checksum, sync status, and error diagnostics.
- `GET /api/files/:id/download`: Download local buffered file (Owner or Admin).
- `DELETE /api/files/:id`: Delete file record and local buffer (Admin only).

---

## 5. Synchronization & Queue Monitoring (`/api/sync`)

- `GET /api/sync/status`: Summary metrics of sync queue (`pending`, `processing`, `synced`, `failed`).
- `GET /api/sync/jobs`: Paginated list of `SyncJob` records with error traces.
- `POST /api/sync/retry/:fileId`: Trigger manual retry for a failed sync job (Admin only).
- `POST /api/sync/retry-all-failed`: Bulk retry all failed jobs (Admin only).

---

## 6. Admin & System Management (`/api/admin`)

- `GET /api/admin/users`: List users and roles.
- `POST /api/admin/users`: Create a new user account.
- `PUT /api/admin/users/:id`: Update user role or status.
- `GET /api/admin/logs`: Query paginated `ActivityLog` audit records with action and date filters.
- `GET /api/admin/stats`: Aggregate dashboard analytics (Total Files, Storage Used, Sync Health Rate).
