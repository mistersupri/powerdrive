# File Upload Specification
# Centralized File Upload & Google Drive Synchronization Application

## 1. Upload Flow

```
[User Browser]
      │
      │ 1. Select files (Drag-and-Drop or File Picker)
      │ 2. Client-side validation (Size, Extension, MIME)
      ▼
[Express Backend API: POST /api/files/upload]
      │
      │ 3. Streaming Multipart parser (Multer / Busboy)
      │ 4. Server-side validation (Magic bytes, Content-Length, Rate limits)
      │ 5. Write to /storage/uploads/YYYY/MM/DD/{uuid}.bin & compute SHA-256
      ▼
[Database Persistence]
      │
      │ 6. Insert File record (Status: PENDING)
      │ 7. Insert SyncJob record (Status: PENDING)
      ▼
[Audit Logging]
      │
      │ 8. Record FILE_UPLOAD_COMPLETED in ActivityLog
      ▼
[Client Response (HTTP 201)]
      │
      │ 9. Return file details and sync status
```

---

## 2. Multi-Layer Validation Matrix

| Layer | Validation Check | Action on Failure |
| :--- | :--- | :--- |
| **Client** | Max size check (e.g. <= 200MB) | Prevent upload request, show toast error |
| **Client** | File extension whitelist | Prevent upload request, highlight invalid file |
| **Server** | Authentication & RBAC | Reject with HTTP 401 / 403 |
| **Server** | Destination Folder existence & active status | Reject with HTTP 404 / 400 |
| **Server** | Actual Content-Length & Streamed bytes | Abort stream, delete incomplete temp file, HTTP 413 |
| **Server** | MIME type & Magic byte verification | Reject with HTTP 415 Unsupported Media Type |
| **Server** | Path sanitization (Prevent `../` traversal) | Reject with HTTP 400 |

---

## 3. UI/UX Specifications
- **Progress Tracking**: Real-time percentage progress bar via Axios/Fetch `onUploadProgress`.
- **Batch Processing**: Simultaneous multi-file selection with independent card statuses for each upload.
- **Immediate Feedback**: Instant visual status badge transitions (`Uploading` -> `Buffered` -> `Queued for Drive Sync`).
