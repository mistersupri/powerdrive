# System Architecture Document
# Centralized File Upload & Google Drive Synchronization Application

## 1. Architectural Overview

The application is structured as a modular full-stack web application with strict separation between client interaction, backend gateway services, local buffer storage, relational persistence, background job processing, and Google Drive API integrations.

```
+-----------------------------------------------------------------------------------+
|                                  CLIENT LAYER                                     |
|  +-----------------------------------------------------------------------------+  |
|  |             React 19 SPA (Vite) + Tailwind CSS + React Query                |  |
|  |     [User UI: Upload / File View]     [Admin UI: Drive Tree / Sync / Logs]  |  |
|  +-----------------------------------------------------------------------------+  |
|  |                      Service Worker (PWA Shell & Cache)                     |  |
+---------------------------------------+-------------------------------------------+
                                        | (HTTPS / REST API / Multipart Form-Data)
+---------------------------------------v-------------------------------------------+
|                                BACKEND LAYER                                      |
|  +-----------------------------------------------------------------------------+  |
|  |                       Express.js API Gateway (Port 3000)                    |  |
|  |  +--------------------+  +--------------------+  +-----------------------+  |  |
|  |  | Auth Controller    |  | Folder Controller  |  | File Upload Controller|  |  |
|  |  +--------------------+  +--------------------+  +-----------------------+  |  |
|  |  | Google Controller  |  | Sync Controller    |  | Admin Controller      |  |  |
|  |  +--------------------+  +--------------------+  +-----------------------+  |  |
|  +-----------------------------------------------------------------------------+  |
|                                       |                                           |
|       +-------------------------------+-------------------------------+           |
|       |                               |                               |           |
|  +----v--------------------+    +-----v--------------------+    +-----v---------+ |
|  | Local Storage Manager   |    | Prisma ORM               |    | Google OAuth  | |
|  | /storage/uploads/YYYY/..|    | PostgreSQL Database      |    | & Drive API v3| |
|  +-------------------------+    +--------------------------+    +---------------+ |
|                                               ^                                   |
|                                               |                                   |
|  +--------------------------------------------+--------------------------------+  |
|  |                   Asynchronous Sync Worker Engine                           |  |
|  |  - Fetches PENDING / RETRYING jobs                                          |  |
|  |  - Streams file from local storage -> Google Drive Target Folder            |  |
|  |  - Idempotent conflict resolution & duplicate checks                        |  |
|  |  - Atomically records googleDriveFileId & marks SYNCED                      |  |
|  +-----------------------------------------------------------------------------+  |
+---------------------------------------+-------------------------------------------+
                                        | (Google Drive API v3 HTTPS)
+---------------------------------------v-------------------------------------------+
|                               GOOGLE CLOUD PLATFORM                               |
|          [Google OAuth 2.0]     [My Drive]     [Shared Drives (Teams)]            |
+-----------------------------------------------------------------------------------+
```

---

## 2. Component Boundaries & Responsibilities

### 2.1 Web Client (Frontend)
- **Technology**: React 19, TypeScript, Tailwind CSS, TanStack React Query, Lucide Icons.
- **Service Worker**: Caches application shell, static assets, and displays offline status indicators.
- **Boundaries**: Operates strictly through `/api/*` endpoints. Never stores Google OAuth secrets or touches Google Drive endpoints directly.

### 2.2 API Server (Backend Gateway)
- **Technology**: Express.js (Node.js runtime), TypeScript.
- **Responsibilities**:
  - Validates authentication sessions and RBAC rules.
  - Receives multi-part file uploads, calculates cryptographic checksums (SHA-256), and writes to local storage buffer.
  - Exposes Google Drive tree structure as normalized JSON graphs.
  - Manages application folder mappings to Google Drive paths.
  - Orchestrates manual sync retries and audit logging.

### 2.3 Local Storage Buffer
- **Directory Layout**: `/storage/uploads/{YYYY}/{MM}/{DD}/{uuid}.bin`
- **Responsibilities**: Provides zero-data-loss durability before and during Google Drive synchronization. Files remain locally available until verified `SYNCED`.

### 2.4 Relational Database (PostgreSQL via Prisma)
- **Responsibilities**: Single source of truth for application users, roles, folders, file metadata, sync job queues, activity audit trails, and encrypted Google OAuth credentials.

### 2.5 Google Drive Integration Module
- **Responsibilities**:
  - Handles OAuth 2.0 authorization code exchange and token refresh.
  - Queries My Drive and Google Workspace Shared Drives (`supportsAllDrives: true`, `includeItemsFromAllDrives: true`).
  - Implements recursive path resolver to find or auto-create nested folder hierarchies with duplicate-protection algorithms.
  - Streams buffered files to target folders in Google Drive.

### 2.6 Background Sync Worker
- **Responsibilities**:
  - Polls or listens for `PENDING` and `RETRYING` sync jobs.
  - Marks job `PROCESSING`, streams local file to Google Drive, handles rate-limiting backoff, stores `googleDriveFileId`, and transitions file to `SYNCED`.

---

## 3. Project Directory Structure

```
.
├── docs/                             # Permanent Project Documentation (Single Source of Truth)
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── DATABASE.md
│   ├── AUTHENTICATION.md
│   ├── GOOGLE_DRIVE.md
│   ├── STORAGE.md
│   ├── UPLOAD.md
│   ├── SYNC.md
│   ├── SECURITY.md
│   ├── API.md
│   ├── TESTING.md
│   ├── DEPLOYMENT.md
│   ├── TROUBLESHOOTING.md
│   ├── DECISIONS.md
│   ├── CONFIRMATIONS.md
│   ├── CHANGELOG.md
│   ├── FINAL_REPORT.md
│   └── PHASES/
│       ├── PHASE-00.md
│       └── ...
├── prisma/
│   ├── schema.prisma                 # Prisma ORM schema definition
│   └── migrations/                   # SQL migration history
├── server/                           # Backend Source Code (Express + TypeScript)
│   ├── config/                       # Environment & runtime configuration
│   ├── controllers/                  # HTTP Request handlers
│   │   ├── auth.controller.ts
│   │   ├── folder.controller.ts
│   │   ├── file.controller.ts
│   │   ├── google.controller.ts
│   │   ├── sync.controller.ts
│   │   └── admin.controller.ts
│   ├── middleware/                   # Auth, RBAC, upload validation, error handlers
│   ├── services/                     # Business Logic Services
│   │   ├── auth.service.ts
│   │   ├── storage.service.ts
│   │   ├── google-drive.service.ts
│   │   ├── sync-worker.service.ts
│   │   └── audit.service.ts
│   ├── db/                           # Prisma client singleton
│   └── types/                        # Backend TypeScript types
├── src/                              # Frontend Source Code (React 19 + Vite)
│   ├── assets/
│   ├── components/                   # Modular UI components
│   │   ├── auth/
│   │   ├── layout/
│   │   ├── upload/
│   │   ├── files/
│   │   ├── drive-tree/
│   │   └── admin/
│   ├── hooks/                        # React Query and custom hooks
│   ├── lib/                          # API client & helpers
│   ├── types/                        # Frontend TypeScript definitions
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── storage/                          # Local server storage buffer (gitignored)
│   └── uploads/
├── public/
│   └── sw.js                         # Service Worker implementation
├── server.ts                         # Main Server Entry point (Express + Vite middleware)
├── vite.config.ts                    # Vite configuration
├── package.json
└── tsconfig.json
```
