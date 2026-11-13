# SUPERDRIVE
## Product Requirements Document (PRD)
### Unified Cloud & External Storage Management Platform

**Version:** 1.0.0  
**Status:** Final — Ready for Implementation  
**Product Name:** SuperDrive  
**Category:** Cloud Storage Management  
**Deployment:** Self-hosted  
**Platform:** Web Application

---

# 1. EXECUTIVE SUMMARY

## 1.1 Product Overview

SuperDrive adalah aplikasi manajemen penyimpanan terpusat yang memungkinkan pengguna menghubungkan, mengakses, mengelola, dan memindahkan file dari berbagai layanan cloud storage dan external storage melalui satu antarmuka web.

SuperDrive mengintegrasikan berbagai penyedia penyimpanan seperti Google Drive, Microsoft OneDrive, Dropbox, NAS, SMB, SFTP, WebDAV, dan S3-compatible storage.

Aplikasi menggunakan konsep Unified Virtual Storage, yaitu seluruh storage yang terhubung ditampilkan sebagai direktori virtual dalam satu file manager.

Pengguna dapat melakukan operasi file lintas-provider tanpa harus mengunduh file ke komputer terlebih dahulu.

Seluruh transfer diproses oleh server SuperDrive menggunakan streaming, multipart upload, dan resumable transfer jika didukung oleh provider.

## 1.2 Product Vision

Menjadi platform penyimpanan universal yang memungkinkan pengguna mengelola seluruh cloud storage dan external storage melalui satu tempat.

## 1.3 Product Goals

1. Mengintegrasikan berbagai cloud storage dalam satu aplikasi.
2. Mendukung banyak akun untuk provider yang sama.
3. Menyediakan unified file manager.
4. Memungkinkan virtual mounting storage.
5. Memindahkan file antar-storage secara langsung melalui server.
6. Mendukung transfer file dan folder berukuran besar.
7. Menyediakan transfer queue yang dapat di-pause dan di-resume.
8. Menyediakan sinkronisasi antar-storage.
9. Mendukung multi-user dan workspace.
10. Dapat di-deploy pada VPS atau server pribadi.

## 1.4 Product Principles

- Universal storage access.
- Provider-independent architecture.
- Streaming-first transfer.
- Secure by default.
- Multi-tenant isolation.
- Resumable operations.
- Non-destructive file management.
- Modular and extensible architecture.

---

# 2. PRODUCT SCOPE

## 2.1 Supported Storage Providers

### Phase 1 — Cloud Storage

| Provider | Integration | Support |
|---|---|---|
| Google Drive | Google Drive API v3 | Multiple accounts |
| Microsoft OneDrive | Microsoft Graph API | Multiple accounts |
| Dropbox | Dropbox API v2 | Multiple accounts |

### Phase 2 — External Storage

| Provider | Integration |
|---|---|
| Local Server Directory | Node.js Filesystem |
| NAS | SMB/CIFS |
| SFTP | SSH/SFTP |
| WebDAV | WebDAV |
| Amazon S3 | S3 API |
| MinIO | S3-compatible API |
| Cloudflare R2 | S3-compatible API |
| Backblaze B2 | Native/S3-compatible API |

### Future Providers

- MEGA
- Box
- pCloud
- SharePoint
- Other S3-compatible providers.

Provider integration must use an adapter architecture so that new providers can be added without modifying the core file manager or transfer engine.

## 2.2 Platform Scope

SuperDrive menggunakan web application sebagai platform utama.

Pengguna mengakses aplikasi melalui browser.

Mounting yang dimaksud adalah application-level virtual mounting, bukan mounting sebagai drive pada Windows Explorer, macOS Finder, atau Linux filesystem.

External storage harus dapat diakses dari server SuperDrive melalui jaringan atau direktori yang diizinkan.

## 2.3 Out of Scope

Fitur berikut tidak termasuk versi awal:

- Native desktop application.
- Windows filesystem mounting.
- macOS filesystem mounting.
- Linux FUSE.
- Desktop synchronization agent.
- Peer-to-peer transfer.
- Document collaboration.
- Native document editing.
- Anonymous public file sharing.

---

# 3. USER MANAGEMENT

## 3.1 Multi-Workspace Architecture

SuperDrive menggunakan konsep workspace.

Workspace merupakan lingkungan penyimpanan yang terisolasi untuk organisasi atau kelompok pengguna.

Setiap workspace memiliki:

- Members.
- Storage connections.
- Virtual mounts.
- Storage permissions.
- Transfer jobs.
- Synchronization tasks.
- Audit logs.
- Notifications.

Satu pengguna dapat menjadi anggota beberapa workspace.

## 3.2 User Roles

| Role | Description |
|---|---|
| Super Admin | Mengelola seluruh instalasi SuperDrive |
| Workspace Owner | Mengelola workspace dan anggotanya |
| Workspace Admin | Mengelola storage dan operasional |
| Member | Mengakses storage sesuai permission |
| Viewer | Akses baca saja |

## 3.3 Permission Management

Permission diberikan berdasarkan workspace, storage, dan pengguna.

| Permission | Description |
|---|---|
| READ | Melihat file dan folder |
| UPLOAD | Mengunggah file |
| DOWNLOAD | Mengunduh file |
| COPY | Menyalin file |
| MOVE | Memindahkan file |
| DELETE | Menghapus file |
| RENAME | Mengubah nama |
| SHARE | Membagikan file |
| MOUNT | Membuat virtual mount |
| MANAGE_STORAGE | Mengelola koneksi storage |

Permission harus diperiksa oleh backend pada setiap operasi.

## 3.4 Storage Ownership

Setiap storage connection dimiliki oleh satu workspace.

Pemilik storage dapat mengatur siapa yang boleh mengakses storage tersebut.

OAuth credentials tidak boleh diberikan kepada anggota workspace lainnya.

---

# 4. CORE FEATURES

## 4.1 Dashboard

Dashboard merupakan halaman utama SuperDrive.

Informasi:

- Total connected storage.
- Jumlah provider.
- Jumlah akun terhubung.
- Total kapasitas yang diketahui.
- Total penggunaan yang diketahui.
- Active transfers.
- Completed transfers.
- Failed transfers.
- Recent activities.
- Storage connection health.

Kapasitas storage harus ditampilkan per provider. Nilai yang tidak tersedia tidak boleh diasumsikan nol.

## 4.2 Storage Connection Manager

Fitur untuk menghubungkan dan mengelola akun penyimpanan.

Pengguna dapat:

1. Menambahkan koneksi storage.
2. Memilih provider.
3. Melakukan OAuth authorization.
4. Mengelola beberapa akun provider yang sama.
5. Mengganti nama koneksi.
6. Menguji koneksi.
7. Melihat informasi akun.
8. Melihat status koneksi.
9. Melakukan reconnect.
10. Disconnect storage.

Contoh:

Google Drive:
- Google Personal.
- Google Work.
- Google Archive.

OneDrive:
- OneDrive Personal.
- OneDrive Office.

Dropbox:
- Dropbox Personal.
- Dropbox Archive.

Status koneksi:

- CONNECTED
- DISCONNECTED
- TOKEN_EXPIRED
- REAUTH_REQUIRED
- ERROR
- DISABLED

Menghapus koneksi tidak boleh menghapus file pada provider.

## 4.3 Virtual Storage Mounting

Fitur utama SuperDrive.

Setiap storage yang terhubung dapat didaftarkan sebagai virtual directory.

Contoh:

    SuperDrive
    │
    ├── My Storage
    │   ├── Google Drive - Personal
    │   ├── Google Drive - Work
    │   ├── OneDrive - Office
    │   ├── Dropbox - Archive
    │   ├── NAS Server
    │   └── SFTP Server
    │
    ├── Shared Storage
    │
    └── Favorites

Contoh virtual path:

    /storage/google-personal/
    /storage/google-work/
    /storage/onedrive-office/
    /storage/dropbox-archive/
    /storage/nas-server/

Setiap virtual mount memiliki:

- ID.
- Workspace ID.
- Storage connection ID.
- Mount name.
- Virtual path.
- Root folder ID.
- Visibility.
- Access permission.
- Enabled status.
- Created date.

Virtual filesystem berfungsi sebagai namespace aplikasi. Semua operasi file akan diterjemahkan menjadi provider-specific API calls.

## 4.4 Unified File Manager

File manager menjadi pusat pengelolaan seluruh storage.

### Tampilan

- Grid view.
- List view.
- Breadcrumb navigation.
- Dual-pane view.
- Sidebar storage.
- File preview.
- Context menu.

### File Operations

- Upload.
- Download.
- Copy.
- Move.
- Rename.
- Delete.
- Create folder.
- Multi-select.
- Drag and drop.
- Bulk operations.
- Sorting.
- Filtering.
- Search.

### Sorting

- Name.
- File size.
- Modified date.
- Created date.
- File type.

### File Actions

Setiap operasi harus memeriksa capability provider.

Contohnya, tidak semua provider mendukung native move atau copy dengan cara yang sama.

## 4.5 Cross-Storage Transfer Engine

Fitur utama kedua SuperDrive adalah memindahkan file antar-storage.

Contoh:

| Source | Destination |
|---|---|
| Google Drive | OneDrive |
| Google Drive | Dropbox |
| Dropbox | Google Drive |
| OneDrive | Dropbox |
| OneDrive | NAS |
| NAS | Google Drive |
| SFTP | Dropbox |
| External Server | OneDrive |

### Transfer Operations

- COPY_FILE
- MOVE_FILE
- COPY_FOLDER
- MOVE_FOLDER
- BULK_COPY
- BULK_MOVE

### Transfer Strategies

**A. Native Provider Operations**

Menggunakan operasi native provider apabila tersedia dan aman.

Contohnya copy atau move antar-folder dalam provider yang sama.

**B. Server-side Streaming**

Untuk transfer antar-provider berbeda.

    SOURCE STORAGE
          |
          v
      SOURCE ADAPTER
          |
          v
      READABLE STREAM
          |
          v
      STREAM PIPELINE
          |
          v
      WRITABLE STREAM
          |
          v
    DESTINATION ADAPTER
          |
          v
    DESTINATION STORAGE

Server tidak boleh memuat keseluruhan file ke memory.

**C. Multipart / Resumable Transfer**

Untuk file besar:

- Multipart upload.
- Resumable upload.
- Chunk tracking.
- Transfer checkpoint.
- Retry failed chunks.
- Upload session management.
- Session expiration handling.

### Transfer Conflict Policy

| Policy | Behavior |
|---|---|
| SKIP | Lewati file yang sudah ada |
| OVERWRITE | Timpa file tujuan setelah konfirmasi |
| RENAME | Buat nama baru |
| FAIL | Gagalkan operasi |

Default: RENAME.

### Move Safety

Cross-provider MOVE harus menjalankan urutan:

1. Validate source.
2. Validate destination.
3. Start upload.
4. Complete upload.
5. Verify destination.
6. Record destination ID.
7. Delete source.
8. Record deletion result.

Source tidak boleh dihapus sebelum destination berhasil diverifikasi.

Jika penghapusan source gagal, tandai:

COPY_COMPLETED_SOURCE_RETAINED.

## 4.6 Transfer Manager

Transfer Manager menampilkan seluruh proses transfer.

Informasi:

- Filename.
- Source.
- Destination.
- File size.
- Transferred bytes.
- Progress percentage.
- Transfer speed.
- Estimated time.
- Status.
- Retry count.
- Error message.
- Start time.
- Completion time.

Status:

- QUEUED
- VALIDATING
- RUNNING
- PAUSED
- RETRYING
- VERIFYING
- COMPLETED
- COPY_COMPLETED_SOURCE_RETAINED
- FAILED
- CANCELLED

Actions:

- Pause.
- Resume.
- Cancel.
- Retry.
- View details.

Progress dikirim melalui Server-Sent Events (SSE).

## 4.7 Folder Transfer

Folder transfer harus mendukung struktur direktori bertingkat.

Requirements:

- Recursive traversal.
- Preserve folder hierarchy.
- Preserve relative paths.
- Track individual file.
- Resume failed files.
- Duplicate detection.
- Partial completion reporting.
- Large folder support.

Satu folder transfer memiliki satu parent job dan beberapa child transfer items.

## 4.8 Synchronization Engine

Menyediakan sinkronisasi antar-storage.

Modes:

| Mode | Description |
|---|---|
| ONE_WAY | Sumber ke tujuan |
| TWO_WAY | Sinkronisasi dua arah |
| MIRROR | Tujuan mengikuti sumber |
| SCHEDULED | Sinkronisasi terjadwal |
| MANUAL | Sinkronisasi manual |

Conflict policies:

- SOURCE_WINS.
- DESTINATION_WINS.
- NEWEST_WINS.
- KEEP_BOTH.
- ASK_USER.

Features:

- Change detection.
- Modification tracking.
- Version tracking.
- File deletion detection.
- Rename detection.
- Conflict management.
- Sync history.
- Scheduled synchronization.

Two-way sync harus memiliki baseline scan sebelum diaktifkan.

MIRROR deletion memerlukan konfirmasi eksplisit.

## 4.9 Universal Search

Pencarian file lintas-storage.

Search criteria:

- Filename.
- Extension.
- MIME type.
- Storage.
- Folder.
- Size.
- Modified date.

Search menggunakan metadata index lokal.

Tidak perlu mengunduh isi seluruh file untuk melakukan pencarian nama file.

## 4.10 File Preview

| Format | Preview |
|---|---|
| PDF | PDF.js |
| JPG/PNG/WebP | Image Viewer |
| MP4/WebM | Video Player |
| TXT/MD | Text Viewer |
| DOCX | Document Preview |
| XLSX | Spreadsheet Preview |
| PPTX | Presentation Preview |
| MP3/WAV | Audio Player |

Preview harus menggunakan authorized backend stream.

Provider access token tidak boleh dikirim ke frontend.

---

# 5. TECHNICAL ARCHITECTURE

## 5.1 Technology Stack

| Component | Technology |
|---|---|
| Frontend | React + TypeScript |
| Build Tool | Vite |
| Styling | Tailwind CSS |
| UI | shadcn/ui |
| Routing | React Router |
| Data Fetching | TanStack Query |
| Form | React Hook Form + Zod |
| Backend | Node.js + TypeScript |
| Framework | Fastify |
| ORM | Prisma |
| Database | PostgreSQL |
| Queue | Redis + BullMQ |
| Realtime | SSE |
| Streaming | Node.js Streams |
| HTTP | Undici |
| Authentication | Secure Session |
| Encryption | AES-256-GCM |
| Deployment | Docker Compose |
| Reverse Proxy | Caddy / Nginx |

## 5.2 System Architecture

    USER
     |
     v
    WEB BROWSER
     |
     v
    REACT APPLICATION
     |
     v
    FASTIFY API
     |
     +-------------------+
     |                   |
     v                   v
    AUTH SERVICE     STORAGE SERVICE
     |                   |
     v                   v
    POSTGRESQL       PROVIDER ADAPTERS
                         |
             +-----------+-----------+
             |           |           |
             v           v           v
          GOOGLE      ONEDRIVE     DROPBOX
           DRIVE
             |
             v
       EXTERNAL STORAGE

    TRANSFER REQUEST
          |
          v
     TRANSFER SERVICE
          |
          v
       REDIS QUEUE
          |
          v
     TRANSFER WORKER
          |
          v
     STREAM PIPELINE
          |
          v
     DESTINATION PROVIDER

## 5.3 Backend Project Structure

    apps/
    ├── web/
    │
    └── api/
        └── src/
            ├── app.ts
            ├── server.ts
            ├── modules/
            │   ├── auth/
            │   ├── users/
            │   ├── workspaces/
            │   ├── memberships/
            │   ├── storage/
            │   ├── mounts/
            │   ├── files/
            │   ├── transfers/
            │   ├── synchronization/
            │   ├── search/
            │   ├── notifications/
            │   └── audit/
            ├── providers/
            │   ├── base/
            │   ├── google-drive/
            │   ├── onedrive/
            │   ├── dropbox/
            │   ├── local/
            │   ├── smb/
            │   ├── sftp/
            │   ├── webdav/
            │   └── s3/
            ├── workers/
            ├── services/
            ├── queues/
            ├── plugins/
            ├── lib/
            └── config/

## 5.4 Monorepo Structure

    superdrive/
    ├── apps/
    │   ├── web/
    │   └── api/
    ├── packages/
    │   ├── database/
    │   ├── providers/
    │   ├── shared/
    │   ├── schemas/
    │   └── config/
    ├── docker/
    ├── scripts/
    ├── docs/
    ├── docker-compose.yml
    ├── package.json
    ├── pnpm-workspace.yaml
    ├── turbo.json
    ├── .env.example
    └── README.md

Use pnpm workspaces and Turborepo for monorepo management.

## 5.5 Provider Adapter Interface

All providers must implement a unified contract.

```typescript
interface StorageProvider {
  getAccountInfo(): Promise<AccountInfo>;

  listFiles(
    parentId: string,
    options?: ListFilesOptions
  ): Promise<PaginatedFileList>;

  getMetadata(
    fileId: string
  ): Promise<StorageFileMetadata>;

  createFolder(
    parentId: string,
    name: string
  ): Promise<StorageFileMetadata>;

  readFile(
    fileId: string,
    options?: ReadFileOptions
  ): Promise<Readable>;

  uploadFile(
    input: UploadInput
  ): Promise<StorageFileMetadata>;

  createUploadSession?(
    input: UploadSessionInput
  ): Promise<UploadSession>;

  uploadChunk?(
    session: UploadSession,
    chunk: Buffer
  ): Promise<UploadChunkResult>;

  completeUpload?(
    session: UploadSession
  ): Promise<StorageFileMetadata>;

  copyFile?(
    fileId: string,
    destinationFolderId: string
  ): Promise<StorageFileMetadata>;

  moveFile?(
    fileId: string,
    destinationFolderId: string
  ): Promise<StorageFileMetadata>;

  renameFile(
    fileId: string,
    name: string
  ): Promise<StorageFileMetadata>;

  deleteFile(
    fileId: string
  ): Promise<void>;

  getCapabilities(): StorageCapabilities;

  refreshAuthentication(): Promise<void>;
}
```

Optional methods must be checked using capability detection.

## 5.6 Provider Capabilities

```typescript
interface StorageCapabilities {
  listFiles: boolean;
  readFile: boolean;
  uploadFile: boolean;
  resumableUpload: boolean;
  multipartUpload: boolean;
  nativeCopy: boolean;
  nativeMove: boolean;
  deleteFile: boolean;
  createFolder: boolean;
  webhooks: boolean;
  versioning: boolean;
  checksums: boolean;
  sharedLinks: boolean;
}
```

---

# 6. DATABASE DESIGN

Database: PostgreSQL.

ORM: Prisma.

All workspace-owned entities must contain workspaceId directly or be verifiably linked through a workspace-owned parent.

## 6.1 Core Models

Required models:

- User
- Session
- Workspace
- Membership
- Invitation
- StorageConnection
- EncryptedCredential
- StoragePermission
- StorageMount
- StorageFile
- TransferJob
- TransferItem
- TransferCheckpoint
- SyncTask
- SyncFileState
- SyncRun
- SyncConflict
- AuditLog
- Notification

## 6.2 Prisma Schema

The following is the core schema. Additional indexes, constraints, and migration-level validation must be included in implementation.

```prisma
enum UserStatus {
  ACTIVE
  DISABLED
  INVITED
}

enum WorkspaceRole {
  OWNER
  ADMIN
  MEMBER
  VIEWER
}

enum ProviderType {
  GOOGLE_DRIVE
  ONEDRIVE
  DROPBOX
  LOCAL
  SMB
  SFTP
  WEBDAV
  S3
}

enum ConnectionStatus {
  CONNECTED
  DISCONNECTED
  TOKEN_EXPIRED
  REAUTH_REQUIRED
  ERROR
  DISABLED
}

enum TransferType {
  COPY
  MOVE
}

enum TransferStatus {
  QUEUED
  VALIDATING
  RUNNING
  PAUSED
  RETRYING
  VERIFYING
  COMPLETED
  COPY_COMPLETED_SOURCE_RETAINED
  FAILED
  CANCELLED
}

enum ConflictPolicy {
  SKIP
  OVERWRITE
  RENAME
  FAIL
}

enum SyncMode {
  ONE_WAY
  TWO_WAY
  MIRROR
}

enum SyncStatus {
  ACTIVE
  PAUSED
  ERROR
  DISABLED
}

model User {
  id           String     @id @default(cuid())
  email        String     @unique
  passwordHash String
  name         String
  status       UserStatus @default(ACTIVE)
  lastLoginAt  DateTime?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  memberships  Membership[]
  sessions     Session[]
  transfers    TransferJob[]
  auditLogs    AuditLog[]
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  tokenHash String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())

  user User @relation(
    fields: [userId],
    references: [id],
    onDelete: Cascade
  )

  @@index([userId, expiresAt])
}

model Workspace {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  members   Membership[]
  storages  StorageConnection[]
  mounts    StorageMount[]
  transfers TransferJob[]
  syncTasks SyncTask[]
  auditLogs AuditLog[]
}

model Membership {
  id          String        @id @default(cuid())
  workspaceId String
  userId      String
  role        WorkspaceRole @default(MEMBER)
  createdAt   DateTime      @default(now())

  workspace Workspace @relation(
    fields: [workspaceId],
    references: [id],
    onDelete: Cascade
  )

  user User @relation(
    fields: [userId],
    references: [id],
    onDelete: Cascade
  )

  @@unique([workspaceId, userId])
  @@index([userId])
}

model StorageConnection {
  id              String           @id @default(cuid())
  workspaceId     String
  provider        ProviderType
  name            String
  accountId       String?
  accountEmail    String?
  status          ConnectionStatus @default(DISCONNECTED)
  credentialId    String?
  configuration   Json?
  capabilities    Json?
  lastConnectedAt DateTime?
  lastError       String?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  workspace Workspace @relation(
    fields: [workspaceId],
    references: [id],
    onDelete: Cascade
  )

  mounts StorageMount[]
  permissions StoragePermission[]
  files StorageFile[]

  sourceJobs TransferJob[] @relation("TransferSource")
  targetJobs TransferJob[] @relation("TransferDestination")

  @@index([workspaceId, provider])
  @@index([workspaceId, status])
}

model EncryptedCredential {
  id             String   @id @default(cuid())
  ciphertext     String
  iv             String
  authTag        String
  keyVersion     String
  credentialType String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model StoragePermission {
  id          String   @id @default(cuid())
  storageId   String
  userId      String?
  role        WorkspaceRole?
  canRead     Boolean  @default(true)
  canUpload   Boolean  @default(false)
  canDownload Boolean  @default(true)
  canCopy     Boolean  @default(false)
  canMove     Boolean  @default(false)
  canDelete   Boolean  @default(false)
  createdAt   DateTime @default(now())

  storage StorageConnection @relation(
    fields: [storageId],
    references: [id],
    onDelete: Cascade
  )

  @@index([storageId, userId])
}

model StorageMount {
  id           String   @id @default(cuid())
  workspaceId  String
  storageId    String
  name         String
  virtualPath  String
  rootFolderId String?
  enabled      Boolean  @default(true)
  isFavorite   Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  workspace Workspace @relation(
    fields: [workspaceId],
    references: [id],
    onDelete: Cascade
  )

  storage StorageConnection @relation(
    fields: [storageId],
    references: [id],
    onDelete: Cascade
  )

  @@unique([workspaceId, virtualPath])
  @@index([workspaceId, enabled])
}

model StorageFile {
  id             String   @id @default(cuid())
  storageId      String
  providerFileId String
  parentFileId   String?
  name           String
  mimeType       String?
  size           BigInt?
  checksum       String?
  isFolder       Boolean  @default(false)
  modifiedAt     DateTime?
  indexedAt      DateTime @default(now())

  storage StorageConnection @relation(
    fields: [storageId],
    references: [id],
    onDelete: Cascade
  )

  @@unique([storageId, providerFileId])
  @@index([storageId, parentFileId])
  @@index([name])
}

model TransferJob {
  id                    String         @id @default(cuid())
  workspaceId           String
  userId                String
  sourceStorageId       String
  destinationStorageId  String
  type                  TransferType
  status                TransferStatus @default(QUEUED)
  conflictPolicy        ConflictPolicy @default(RENAME)
  deleteSourceOnSuccess Boolean        @default(false)
  totalFiles            Int            @default(1)
  completedFiles        Int            @default(0)
  failedFiles           Int            @default(0)
  totalBytes            BigInt?
  transferredBytes      BigInt         @default(0)
  errorMessage          String?
  retryCount            Int            @default(0)
  idempotencyKey        String
  startedAt             DateTime?
  completedAt           DateTime?
  createdAt             DateTime       @default(now())
  updatedAt             DateTime       @updatedAt

  workspace Workspace @relation(
    fields: [workspaceId],
    references: [id]
  )

  user User @relation(
    fields: [userId],
    references: [id]
  )

  sourceStorage StorageConnection @relation(
    "TransferSource",
    fields: [sourceStorageId],
    references: [id]
  )

  destinationStorage StorageConnection @relation(
    "TransferDestination",
    fields: [destinationStorageId],
    references: [id]
  )

  items TransferItem[]

  @@unique([workspaceId, idempotencyKey])
  @@index([workspaceId, status])
  @@index([userId, createdAt])
}

model TransferItem {
  id               String         @id @default(cuid())
  jobId            String
  sourceFileId     String
  destinationFileId String?
  relativePath     String?
  fileName         String
  fileSize         BigInt?
  transferredBytes BigInt        @default(0)
  status           TransferStatus @default(QUEUED)
  checksum         String?
  errorMessage     String?
  retryCount       Int            @default(0)
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt

  job TransferJob @relation(
    fields: [jobId],
    references: [id],
    onDelete: Cascade
  )

  checkpoint TransferCheckpoint?

  @@index([jobId, status])
}

model TransferCheckpoint {
  id                String   @id @default(cuid())
  transferItemId    String   @unique
  sourceOffset      BigInt   @default(0)
  destinationOffset BigInt   @default(0)
  chunkSize         Int?
  uploadSessionData String?
  lastCheckpointAt  DateTime @default(now())

  transferItem TransferItem @relation(
    fields: [transferItemId],
    references: [id],
    onDelete: Cascade
  )
}

model SyncTask {
  id                    String     @id @default(cuid())
  workspaceId           String
  name                  String
  sourceStorageId       String
  destinationStorageId  String
  sourceFolderId        String
  destinationFolderId   String
  mode                  SyncMode
  status                SyncStatus @default(ACTIVE)
  schedule              String?
  conflictPolicy        String     @default("NEWEST_WINS")
  deletePolicy          String     @default("KEEP")
  lastRunAt             DateTime?
  nextRunAt             DateTime?
  createdAt             DateTime   @default(now())
  updatedAt             DateTime   @updatedAt

  workspace Workspace @relation(
    fields: [workspaceId],
    references: [id],
    onDelete: Cascade
  )

  runs SyncRun[]

  @@index([workspaceId, status])
}

model SyncRun {
  id          String   @id @default(cuid())
  syncTaskId  String
  status      String
  startedAt   DateTime @default(now())
  completedAt DateTime?
  summary     Json?

  task SyncTask @relation(
    fields: [syncTaskId],
    references: [id],
    onDelete: Cascade
  )
}

model SyncFileState {
  id                 String   @id @default(cuid())
  syncTaskId         String
  relativePath       String
  sourceFileId       String?
  destinationFileId  String?
  sourceVersion      String?
  destinationVersion String?
  checksum           String?
  lastSyncedAt       DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([syncTaskId, relativePath])
}

model SyncConflict {
  id           String   @id @default(cuid())
  syncTaskId   String
  relativePath String
  sourceData   Json?
  destinationData Json?
  resolution   String?
  resolvedAt   DateTime?
  createdAt    DateTime @default(now())

  @@index([syncTaskId, resolvedAt])
}

model Invitation {
  id          String   @id @default(cuid())
  workspaceId String
  email       String
  role        WorkspaceRole
  tokenHash   String   @unique
  expiresAt   DateTime
  acceptedAt  DateTime?
  createdAt   DateTime @default(now())

  @@index([workspaceId, email])
}

model Notification {
  id          String   @id @default(cuid())
  workspaceId String
  userId      String
  type        String
  title       String
  message     String
  data        Json?
  readAt      DateTime?
  createdAt   DateTime @default(now())

  @@index([userId, readAt])
}

model AuditLog {
  id           String   @id @default(cuid())
  workspaceId  String
  userId       String?
  action       String
  resourceType String
  resourceId   String?
  metadata     Json?
  ipAddress    String?
  createdAt    DateTime @default(now())

  workspace Workspace @relation(
    fields: [workspaceId],
    references: [id],
    onDelete: Cascade
  )

  user User? @relation(
    fields: [userId],
    references: [id]
  )

  @@index([workspaceId, createdAt])
  @@index([userId, createdAt])
}
```

### 6.3 Database Rules

- Every workspace resource must be scoped to its workspace.
- Credentials must be encrypted.
- Provider file IDs must be unique per storage connection.
- Transfer jobs must support idempotency.
- Transfer checkpoints must be persistent.
- Large integer file sizes must use BigInt.
- Deletion of storage connections must not delete remote files.
- Sync history must be preserved.
- Use database transactions for critical state transitions.

---

# 7. API SPECIFICATION

Base URL:

    /api/v1

Authentication: HTTP-only secure session cookie.

## 7.1 Authentication API

| Method | Endpoint | Description |
|---|---|---|
| POST | /auth/login | Login |
| POST | /auth/logout | Logout |
| GET | /auth/me | Current user |
| POST | /auth/register | Registration |
| POST | /auth/forgot-password | Request reset |
| POST | /auth/reset-password | Reset password |

## 7.2 Workspace API

| Method | Endpoint | Description |
|---|---|---|
| GET | /workspaces | List workspaces |
| POST | /workspaces | Create workspace |
| GET | /workspaces/:id | Detail |
| PATCH | /workspaces/:id | Update |
| GET | /workspaces/:id/members | Members |
| POST | /workspaces/:id/invitations | Invite |
| PATCH | /workspaces/:id/members/:userId | Change role |
| DELETE | /workspaces/:id/members/:userId | Remove member |

## 7.3 Storage API

| Method | Endpoint | Description |
|---|---|---|
| GET | /storages | List storage |
| GET | /storages/providers | Available providers |
| POST | /storages/:provider/connect | Start OAuth |
| GET | /storages/:provider/callback | OAuth callback |
| GET | /storages/:id | Detail |
| PATCH | /storages/:id | Update |
| POST | /storages/:id/test | Test |
| POST | /storages/:id/reconnect | Reconnect |
| DELETE | /storages/:id | Disconnect |

## 7.4 Mount API

| Method | Endpoint | Description |
|---|---|---|
| GET | /mounts | List mounts |
| POST | /mounts | Create mount |
| GET | /mounts/:id | Detail |
| PATCH | /mounts/:id | Update |
| POST | /mounts/:id/enable | Enable |
| POST | /mounts/:id/disable | Disable |
| DELETE | /mounts/:id | Remove |

## 7.5 File API

| Method | Endpoint | Description |
|---|---|---|
| GET | /files | Browse files |
| GET | /files/:storageId/:fileId | File detail |
| POST | /files/folders | Create folder |
| POST | /files/rename | Rename |
| POST | /files/copy | Copy |
| POST | /files/move | Move |
| DELETE | /files/:storageId/:fileId | Delete |
| GET | /files/:storageId/:fileId/download | Download |
| GET | /files/:storageId/:fileId/preview | Preview |
| POST | /files/upload | Upload |

## 7.6 Transfer API

| Method | Endpoint | Description |
|---|---|---|
| POST | /transfers | Create transfer |
| GET | /transfers | List |
| GET | /transfers/:id | Detail |
| GET | /transfers/:id/items | Items |
| POST | /transfers/:id/pause | Pause |
| POST | /transfers/:id/resume | Resume |
| POST | /transfers/:id/cancel | Cancel |
| POST | /transfers/:id/retry | Retry |
| GET | /transfers/:id/events | SSE events |

## 7.7 Synchronization API

| Method | Endpoint | Description |
|---|---|---|
| GET | /sync-tasks | List |
| POST | /sync-tasks | Create |
| GET | /sync-tasks/:id | Detail |
| PATCH | /sync-tasks/:id | Update |
| POST | /sync-tasks/:id/run | Run |
| POST | /sync-tasks/:id/pause | Pause |
| POST | /sync-tasks/:id/resume | Resume |
| DELETE | /sync-tasks/:id | Delete |

## 7.8 Search API

    GET /api/v1/search

Parameters:

- q
- storageId
- type
- minSize
- maxSize
- modifiedAfter
- modifiedBefore
- page
- limit
- sort

## 7.9 Transfer Request Example

```json
{
  "type": "COPY",
  "source": {
    "storageId": "google-001",
    "fileId": "file-123"
  },
  "destination": {
    "storageId": "dropbox-001",
    "folderId": "folder-456"
  },
  "conflictPolicy": "RENAME",
  "idempotencyKey": "unique-transfer-001"
}
```

Response HTTP 202:

```json
{
  "success": true,
  "data": {
    "id": "transfer-001",
    "status": "QUEUED",
    "progress": 0
  }
}
```

## 7.10 Standard Response

Success:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "req-001"
  }
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "STORAGE_CONNECTION_EXPIRED",
    "message": "Storage authorization has expired."
  }
}
```

---

# 8. TRANSFER ENGINE IMPLEMENTATION

## 8.1 Worker Workflow

1. Receive transfer job.
2. Validate workspace.
3. Validate user permissions.
4. Validate source and destination.
5. Resolve provider adapters.
6. Retrieve source metadata.
7. Check destination capability.
8. Select transfer strategy.
9. Create upload session if needed.
10. Start streaming.
11. Update checkpoints.
12. Complete destination upload.
13. Verify destination.
14. Delete source if MOVE.
15. Update job status.
16. Record audit log.
17. Send notification.

## 8.2 Streaming Implementation

Use Node.js Streams.

```typescript
import { pipeline } from "node:stream/promises";

await pipeline(
  sourceStream,
  transformStream,
  destinationWritable
);
```

Requirements:

- Stream backpressure.
- Bounded memory usage.
- Configurable buffer size.
- Transfer cancellation.
- Network timeout.
- Provider-aware retry.
- Progress tracking.
- Checksum verification.

Do not load entire files into RAM.

Do not assume arbitrary streams can resume from any byte offset. Resume must use supported source ranges and destination upload sessions.

## 8.3 Queue Management

Use Redis + BullMQ.

Queues:

- transfer-queue
- sync-queue
- indexing-queue
- maintenance-queue

Initial configuration:

| Parameter | Default |
|---|---|
| Concurrent transfers/workspace | 3 |
| Retry attempts | 5 |
| Retry strategy | Exponential backoff + jitter |
| Buffer size | 1 MiB |
| Checkpoint | Configurable |
| Failed jobs | Retained for inspection |

Concurrency must be configurable globally and per workspace.

## 8.4 Transfer Recovery

When worker restarts:

1. Load unfinished jobs.
2. Check job status.
3. Validate source availability.
4. Validate destination upload session.
5. Resume supported upload session.
6. Restart affected file if resume is unavailable.
7. Continue remaining folder items.

BullMQ processing must be idempotent.

---

# 9. PROVIDER INTEGRATION

## 9.1 Google Drive

API: Google Drive API v3.

Required capabilities:

- List files.
- Get metadata.
- Download.
- Upload.
- Create folder.
- Rename.
- Delete.
- Copy.
- Move.
- Export native Google Workspace files.

OAuth:

- Authorization Code flow.
- Offline access.
- Refresh token.
- State validation.
- Least-privilege scopes.

Important:

`drive.file` does not grant unrestricted access to all existing Drive files.

The required OAuth scopes must be evaluated based on the actual file manager functionality and Google verification requirements.

Official documentation:

https://developers.google.com/workspace/drive/api

## 9.2 Microsoft OneDrive

API: Microsoft Graph.

Required:

- List drive items.
- Read metadata.
- Download.
- Upload.
- Upload session.
- Copy.
- Move.
- Delete.
- Create folder.

Use delegated OAuth permissions and offline access.

Large files must use upload sessions.

Official documentation:

https://learn.microsoft.com/graph/api/resources/driveitem

## 9.3 Dropbox

API: Dropbox API v2.

Required:

- list_folder.
- get_metadata.
- download.
- upload.
- upload_session.
- create_folder.
- copy_v2.
- move_v2.
- delete_v2.

Use OAuth with refresh token support.

Large files must use upload sessions.

Official documentation:

https://www.dropbox.com/developers/documentation/http/documentation

## 9.4 External Storage

### Local Directory

- Server-side directories only.
- Configurable directory allowlist.
- Path traversal protection.
- Symlink escape prevention.
- Restricted filesystem access.

### SMB

- Host.
- Share.
- Username.
- Password.
- Base directory.
- Connection timeout.

### SFTP

- Host.
- Port.
- Username.
- Password or private key.
- Known-host verification.
- Base directory.

### WebDAV

- URL.
- Username.
- Password.
- HTTPS.
- Base directory.

### S3-compatible

- Endpoint.
- Region.
- Bucket.
- Access key.
- Secret key.
- Multipart upload.
- Abort multipart upload.

---

# 10. FILE INDEXING AND METADATA

Provider remains the source of truth.

Local metadata index is used to improve navigation and search.

Metadata:

- Provider file ID.
- Storage connection ID.
- Parent ID.
- Name.
- MIME type.
- Size.
- Created time.
- Modified time.
- ETag.
- Version.
- Checksum.
- Indexed timestamp.

Indexing workflow:

1. Connect storage.
2. Scan root.
3. Retrieve folder contents.
4. Store metadata.
5. Continue pagination.
6. Track changes using webhooks when available.
7. Periodically reconcile.

Metadata indexing must not download file contents unnecessarily.

---

# 11. SECURITY REQUIREMENTS

## 11.1 Authentication

- Argon2id.
- Secure HTTP-only cookies.
- CSRF protection.
- Session expiration.
- Session revocation.
- Login rate limiting.
- Optional TOTP.

## 11.2 OAuth

- State validation.
- PKCE where supported.
- Strict redirect URI.
- Refresh token encryption.
- Token rotation handling.
- No token exposure to frontend.
- No credentials in logs.

## 11.3 Encryption

Use envelope encryption.

- AES-256-GCM.
- Master key outside database.
- Encrypted credential records.
- Key versioning.
- Key rotation support.

## 11.4 Multi-Tenant Isolation

Every request must validate:

- Current user.
- Active workspace.
- Workspace membership.
- Resource ownership.
- Storage permissions.

## 11.5 SSRF Protection

External storage configuration creates an SSRF risk.

Implement:

- Host validation.
- DNS resolution validation.
- Private IP restrictions.
- Loopback restrictions.
- Link-local restrictions.
- Cloud metadata endpoint blocking.
- Redirect validation.
- Port restrictions.
- Network egress restrictions.

Allow internal NAS connections only through explicit administrator configuration.

## 11.6 Audit Logs

Record:

- Authentication events.
- Storage connections.
- Storage disconnections.
- Upload.
- Download.
- Copy.
- Move.
- Delete.
- Transfer completion.
- Transfer failure.
- Permission changes.
- Member invitations.

Never log file contents or credentials.

---

# 12. UI/UX SPECIFICATION

## 12.1 Design Direction

SuperDrive uses a modern, clean, professional interface.

Design principles:

- Minimalist.
- Desktop-first.
- Responsive.
- Clear navigation.
- Consistent file manager experience.
- Fast interactions.

Suggested palette:

| Element | Color |
|---|---|
| Primary | #1769E8 |
| Dark Navy | #102C54 |
| Background | #F5F7FA |
| Surface | #FFFFFF |
| Border | #E5EAF0 |
| Text | #172B4D |
| Secondary Text | #64748B |

## 12.2 Navigation

    SUPERDRIVE

    Dashboard

    FILE MANAGER
    ├── All Files
    ├── Recent
    ├── Starred
    └── Shared

    STORAGE
    ├── Google Drive
    ├── OneDrive
    ├── Dropbox
    └── External Storage

    OPERATIONS
    ├── Transfers
    ├── Synchronization
    └── Activity Logs

    WORKSPACE
    ├── Members
    └── Permissions

    SETTINGS

## 12.3 Dashboard

Display:

- Storage cards.
- Storage connection status.
- Usage.
- Active transfers.
- Recent files.
- Recent activities.

## 12.4 File Manager

Toolbar:

- Upload.
- New Folder.
- Copy.
- Move.
- Download.
- Delete.
- Search.
- Sort.
- View Mode.

File list:

| Column | Content |
|---|---|
| Name | Filename |
| Type | File type |
| Size | File size |
| Modified | Modified date |
| Storage | Provider |
| Actions | Context menu |

## 12.5 Dual-Pane Interface

Provide a two-panel interface for cross-storage transfers.

    SOURCE                  DESTINATION
    Google Drive             Dropbox
    /Documents               /Archive

    File A                   Folder X
    File B                   Folder Y
    File C                   Folder Z

    [ COPY TO DESTINATION ]

The user can drag files between the two panels or use explicit copy/move actions.

## 12.6 Responsive

Desktop:
- Full sidebar.
- Detailed file list.
- Dual-pane.

Tablet:
- Collapsible sidebar.
- Adaptive list.

Mobile:
- Single pane.
- Compact toolbar.
- Transfer monitoring.

---

# 13. NOTIFICATIONS

Notifications:

- Transfer started.
- Transfer completed.
- Transfer failed.
- OAuth expired.
- Storage disconnected.
- Synchronization completed.
- Synchronization conflict.
- Destination quota exceeded.

Notifications must be scoped to workspace and user.

---

# 14. DEPLOYMENT

## 14.1 Docker Services

Required containers:

- web
- api
- worker
- scheduler
- postgres
- redis
- reverse-proxy

## 14.2 Environment Variables

```env
NODE_ENV=production

APP_URL=https://superdrive.example.com
API_URL=https://superdrive.example.com/api

DATABASE_URL=postgresql://user:password@postgres:5432/superdrive

REDIS_URL=redis://redis:6379

SESSION_SECRET=
ENCRYPTION_MASTER_KEY=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_REDIRECT_URI=

DROPBOX_CLIENT_ID=
DROPBOX_CLIENT_SECRET=
DROPBOX_REDIRECT_URI=

TRANSFER_MAX_CONCURRENCY=3
TRANSFER_BUFFER_SIZE=1048576
TRANSFER_RETRY_ATTEMPTS=5
```

Secrets must be injected securely during deployment.

## 14.3 Directory Structure

    /var/lib/superdrive/
    ├── temp/
    ├── cache/
    ├── uploads/
    └── logs/

Requirements:

- Configurable storage directory.
- Temporary file cleanup.
- Disk usage limits.
- Restricted permissions.
- No public access to temporary files.
- Streaming-first processing.

## 14.4 Backup

Backup:

- PostgreSQL.
- Encryption key material.
- Application configuration.
- Audit logs.
- Required metadata.

Provider files remain in their respective cloud or external storage systems.

---

# 15. PERFORMANCE AND RELIABILITY

Initial targets:

| Metric | Target |
|---|---|
| Metadata API P95 | <500 ms excluding provider latency |
| Initial UI load | <3 seconds under reference conditions |
| Concurrent transfers/workspace | 3 default |
| Streaming memory | Bounded |
| Transfer recovery | Supported upload sessions |
| Availability | 99.5% target |
| Worker recovery | Automatic |
| Database | Indexed query paths |

Additional requirements:

- Graceful shutdown.
- Structured logging.
- Health checks.
- Metrics.
- Retry with backoff.
- Provider-aware rate limiting.
- Persistent transfer jobs.
- Persistent checkpoints.
- Idempotent worker execution.

---

# 16. TESTING STRATEGY

## 16.1 Unit Tests

- Authentication.
- Permissions.
- Storage resolver.
- Provider adapters.
- Capability detection.
- Transfer strategy.
- Conflict policies.
- Path validation.
- Credential encryption.

## 16.2 Integration Tests

- Google Drive OAuth.
- OneDrive OAuth.
- Dropbox OAuth.
- File browsing.
- Upload.
- Download.
- Cross-provider copy.
- Cross-provider move.
- Token refresh.
- Workspace isolation.
- Transfer recovery.

## 16.3 Transfer Test Cases

1. Small file.
2. Large file.
3. Empty file.
4. Folder transfer.
5. Nested folders.
6. Duplicate filename.
7. Insufficient quota.
8. Expired OAuth.
9. Network interruption.
10. Worker restart.
11. Destination failure.
12. Source deletion failure.
13. Checksum mismatch.
14. User cancellation.
15. Permission revoked during transfer.

## 16.4 Security Tests

- Cross-workspace access.
- Unauthorized download.
- OAuth CSRF.
- SSRF.
- Path traversal.
- Symlink escape.
- Credential leakage.
- Session fixation.
- Privilege escalation.

---

# 17. IMPLEMENTATION PHASES

## Phase 1 — Foundation

Deliverables:

- Monorepo.
- Authentication.
- Workspace.
- Membership.
- RBAC.
- PostgreSQL.
- Prisma.
- Docker deployment.
- Base UI.

## Phase 2 — Cloud Integration

Deliverables:

- Google Drive.
- OneDrive.
- Dropbox.
- OAuth.
- Multiple accounts.
- Storage dashboard.
- Virtual mounting.

## Phase 3 — File Manager

Deliverables:

- File browsing.
- Folder navigation.
- Metadata index.
- Upload.
- Download.
- Preview.
- Rename.
- Delete.
- Search.

## Phase 4 — Transfer Engine

Deliverables:

- BullMQ.
- Streaming.
- Cross-provider copy.
- Cross-provider move.
- Resumable upload.
- Checkpoints.
- Retry.
- Pause/resume.
- Cancellation.
- Folder transfer.

## Phase 5 — External Storage

Deliverables:

- Local server directory.
- SMB.
- SFTP.
- WebDAV.
- S3-compatible storage.

## Phase 6 — Synchronization

Deliverables:

- One-way sync.
- Two-way sync.
- Scheduled sync.
- Conflict management.
- Sync history.
- Notifications.

## Phase 7 — Production Hardening

Deliverables:

- Security review.
- Performance optimization.
- Monitoring.
- Backup and recovery.
- Documentation.
- Production deployment.

---

# 18. ACCEPTANCE CRITERIA

## 18.1 Authentication and Workspace

- [ ] User can register or receive invitation.
- [ ] User can log in and log out.
- [ ] Workspace can be created.
- [ ] Members can be invited.
- [ ] Roles can be assigned.
- [ ] Workspace isolation works.
- [ ] Permissions enforced by backend.

## 18.2 Storage

- [ ] Google Drive can connect.
- [ ] OneDrive can connect.
- [ ] Dropbox can connect.
- [ ] Multiple accounts per provider supported.
- [ ] Connection can be renamed.
- [ ] Connection can be disconnected.
- [ ] OAuth refresh supported.
- [ ] Credentials encrypted.
- [ ] Connection status visible.

## 18.3 Virtual Mounting

- [ ] Storage can be mounted.
- [ ] Unique virtual path.
- [ ] Multiple mounts.
- [ ] Permission-based visibility.
- [ ] Enable/disable.
- [ ] Remove mount without deleting remote files.

## 18.4 File Management

- [ ] Browse storage.
- [ ] Navigate folders.
- [ ] Create folder.
- [ ] Upload.
- [ ] Download.
- [ ] Rename.
- [ ] Delete.
- [ ] Multi-select.
- [ ] Preview.
- [ ] Search metadata.

## 18.5 Transfer

- [ ] Cross-provider copy.
- [ ] Cross-provider move.
- [ ] Recursive folder transfer.
- [ ] Server-side streaming.
- [ ] Progress monitoring.
- [ ] Pause/resume.
- [ ] Cancel.
- [ ] Retry.
- [ ] Conflict resolution.
- [ ] Resumable large uploads.
- [ ] Worker restart recovery.
- [ ] Safe source deletion.
- [ ] Partial failure reporting.

## 18.6 External Storage

- [ ] Local server directory.
- [ ] SMB.
- [ ] SFTP.
- [ ] WebDAV.
- [ ] S3-compatible storage.
- [ ] Path restrictions.
- [ ] SSRF protection.

## 18.7 Synchronization

- [ ] One-way sync.
- [ ] Two-way sync.
- [ ] Scheduled sync.
- [ ] Conflict detection.
- [ ] Sync history.
- [ ] Safe mirror deletion.

## 18.8 Deployment

- [ ] Docker deployment.
- [ ] Database migrations.
- [ ] Backup and restore.
- [ ] Health checks.
- [ ] Structured logs.
- [ ] Worker recovery.
- [ ] Secrets protected.

---

# 19. DEFINITION OF DONE

A feature is complete only when:

1. Backend implemented.
2. Frontend implemented.
3. API validation implemented.
4. Permission checks implemented.
5. Error handling implemented.
6. Unit tests pass.
7. Integration tests pass.
8. Audit logs generated where required.
9. Documentation updated.
10. Docker deployment tested.

A completed UI without functional backend integration is not considered a completed feature.

---

# 20. MVP RELEASE DEFINITION

SuperDrive MVP must include:

1. Multi-user workspace.
2. Authentication and RBAC.
3. Google Drive integration.
4. OneDrive integration.
5. Dropbox integration.
6. Multiple accounts per provider.
7. Virtual storage mounting.
8. Unified File Manager.
9. Upload and download.
10. Cross-provider copy.
11. Cross-provider move.
12. Server-side streaming.
13. Transfer Manager.
14. Transfer progress.
15. Retry and cancellation.
16. Secure OAuth credentials.
17. Audit logs.
18. Self-hosted Docker deployment.

External storage and advanced synchronization are subsequent releases.

---

# 21. FINAL PRODUCT DEFINITION

SuperDrive is a self-hosted, multi-user, web-based unified storage management platform that integrates multiple cloud storage accounts and external storage providers into a single virtual file management environment.

It provides centralized file browsing, application-level mounting, server-side cross-storage transfer, resumable file operations, synchronization, and secure workspace-based access control.

**SuperDrive — All Your Storage. One Place.**