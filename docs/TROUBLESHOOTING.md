# Operational Troubleshooting Guide
# Centralized File Upload & Google Drive Synchronization Application

## 1. Common Operational Scenarios & Resolutions

### 1.1 Google Drive Rate Limit (HTTP 429 / 503)
- **Symptom**: Sync jobs rapidly move to `FAILED` with error `Rate Limit Exceeded` or `User Rate Limit Exceeded`.
- **Root Cause**: Google Drive enforces per-user and per-project QPS quotas (default 1,000 queries per 100 seconds per user).
- **Resolution**:
  1. The sync worker applies exponential backoff with jitter.
  2. Throttle worker concurrency to max 3 concurrent file streams.
  3. Batch folder listing requests and cache folder tree metadata.

### 1.2 Google Drive Refresh Token Expired or Revoked
- **Symptom**: Background sync jobs fail with `invalid_grant` or `Token has been expired or revoked`.
- **Root Cause**: OAuth consent status changed, or test app refresh token reached expiration limit.
- **Resolution**:
  1. Admin navigates to `/admin/google` and clicks **Reconnect Google Account**.
  2. Complete Google OAuth authorization to acquire a fresh permanent refresh token.
  3. Click **Retry All Failed Syncs** to resume the pending queue.

### 1.3 Local Server Disk Space Pressure
- **Symptom**: File uploads return HTTP 500 `ENOSPC: no space left on device`.
- **Root Cause**: Local storage buffer accumulated large volumes of buffered files.
- **Resolution**:
  1. Inspect `/storage/uploads/` directory size.
  2. Verify all `SYNCED` files have valid `googleDriveFileId` recorded in PostgreSQL.
  3. Execute automated cleanup of local files that have been verified `SYNCED` for longer than the retention window.

### 1.4 Broken Folder Hierarchy in Google Drive
- **Symptom**: Files fail to sync because destination folder was moved or trashed externally in Google Drive.
- **Root Cause**: External user altered folder structure directly in Google Drive UI.
- **Resolution**:
  1. Use **Refresh Folders** in Application Admin.
  2. Sync engine automatically triggers recursive path resolution to find or recreate the target path.
