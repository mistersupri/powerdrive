# Synchronization Engine, Idempotency & Reliability
# Centralized File Upload & Google Drive Synchronization Application

## 1. Sync Lifecycle State Machine

```
      +---------------------+
      |       UPLOADING     |
      +----------+----------+
                 |
                 v
      +---------------------+
      |   STORED / PENDING  | <-----------+ (Retry trigger)
      +----------+----------+             |
                 |                        |
                 v                        |
      +---------------------+             |
+---> |     PROCESSING      |             |
|     +----+-----------+----+             |
|          |           |                  |
|          | Success   | Failure          |
|          v           v                  |
|     +---------+ +---------+             |
|     | SYNCED  | | FAILED  +-------------+
|     +---------+ +----+----+
|                      |
|                      v (Max attempts reached / Auto backoff)
|                 +---------+
+-----------------+RETRYING |
                  +---------+
```

---

## 2. Server-Side Sync Worker Architecture

- **Independent Worker Daemon**: The sync worker runs inside the Node.js backend environment on an event-driven queue or lightweight scheduler (e.g. interval polling `cron`/`setInterval` decoupled from HTTP request loops).
- **Session Independence**: The sync worker operates completely asynchronously; user/browser session closure does not interrupt in-flight Google Drive uploads.
- **Concurrency Control**: Worker limits concurrent Google Drive upload streams (e.g., maximum 3-5 concurrent streams) to prevent hitting Google Drive API rate limits (user rate limits and project quotas).

---

## 3. Idempotency & Duplicate Reconciliation Strategy

### 3.1 The Network Timeout / Split-Brain Problem
A common failure in cloud file synchronization:
1. Backend sends file payload to Google Drive API.
2. Google Drive receives the entire file and creates it in the target folder.
3. Network connection drops before the backend receives the HTTP 200 JSON response containing `googleDriveFileId`.
4. Backend marks the job as `FAILED` and triggers a retry.
5. On naive retry, a duplicate file is created.

### 3.2 Idempotent Reconciliation Solution
Before initiating a fresh multipart upload for a file during sync or retry:
1. **Pre-Flight Query**: Backend queries Google Drive target folder:
   `name = '{originalName}' and '{targetFolderId}' in parents and trashed = false`
2. **Checksum & Size Verification**:
   - If a file with matching name is found, inspect Google Drive `md5Checksum` / `sha256` (or file size and upload timestamp window).
   - If verified to match the pending file:
     - **Reconcile**: Capture the existing `googleDriveFileId`, link it to PostgreSQL `File` record, update status to `SYNCED`, and log reconciliation event.
     - **Do Not Re-upload**.
3. **If not found or size differs**:
   - Proceed with standard resumable/multipart upload.
   - On completion, record `googleDriveFileId` and mark `SYNCED`.

---

## 4. Exponential Backoff & Error Classification

| Error Type | Behavior | Retry Strategy |
| :--- | :--- | :--- |
| **HTTP 429 / 503 (Rate Limit / Quota)** | Temporary Google throttling | Exponential backoff: `Math.min(1000 * Math.pow(2, attempts), 60000) + jitter` |
| **HTTP 401 / 403 (Invalid Token)** | Expired or revoked credentials | Trigger token refresh; if refresh fails, alert admin and halt queue |
| **HTTP 404 (Target Folder Deleted)** | Google Drive folder missing | Trigger recursive folder recreate or mark `FAILED` with explicit diagnostic error |
| **Local File Missing / Read Error** | Storage corruption or removal | Mark `FAILED`, alert admin immediately |
