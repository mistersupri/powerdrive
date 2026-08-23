# Architecture Decision Records (ADRs)
# Centralized File Upload & Google Drive Synchronization Application

# ADR-001 — Modular Full-Stack Architecture (Express + React Vite)

## Context
The application serves as a centralized gateway between end-users and Google Drive. It requires secure file buffering, cryptographic checksumming, database persistence, and protected Google Drive OAuth token management.

## Problem
A pure client-side SPA cannot securely manage Google OAuth secrets, execute streaming background synchronization after the browser tab is closed, or reliably buffer physical files on server disks.

## Options Considered
1. **Pure Client-Side React SPA**: Direct user-to-Google-Drive upload.
2. **Modular Express + React Vite Full-Stack**: Express API server hosting REST endpoints, streaming uploads to local disk, orchestrating Google Drive API via backend worker, and serving the React frontend.
3. **Microservices / Message Queue (RabbitMQ + Worker Container)**: High complexity, excessive infrastructure.

## Decision
Adopt Option 2: **Modular Full-Stack Express + React Vite**.

## Reason
Provides complete security for Google API credentials, full control over the local buffer storage, background sync independence from browser sessions, and conforms strictly to the zero-large-infrastructure principle.

## Consequences
All API routes reside under `/api/*`, Vite handles dev middleware and production static bundling, and backend bundles cleanly to `dist/server.cjs`.

---

# ADR-002 — System-Managed Google Drive Identifiers

## Context
Standard enterprise tools frequently force users to copy-paste cryptic Google Drive Folder IDs and Parent IDs into input forms, creating user error and fragile mappings.

## Problem
Raw Google Drive IDs are difficult for humans to manage and risk accidental data misrouting.

## Options Considered
1. **Manual Folder ID Configuration**: Require admin/user to paste Google Drive Folder IDs into text inputs.
2. **System-Managed Visual Identifiers & Discovery**: App discovers Drives (My Drive / Shared Drives) via API, builds hierarchical visual folder trees, and automatically resolves/creates paths internally.

## Decision
Adopt Option 2: **System-Managed Identifiers**.

## Reason
Ensures zero manual ID entry. The application handles all ID lookups, caching, path traversals, and mapping behind the scenes.

## Consequences
Frontend only requires intuitive visual tree selectors and path strings (e.g. `2026/Pendataan/KJP`).

---

# ADR-003 — Local Server Storage Buffer with Zero Early Deletion

## Context
Files uploaded by users must not be lost if network latency, Google API quotas, or service interruptions occur during Google Drive synchronization.

## Problem
Uploading directly or deleting local files before confirmed remote persistence risks irreversible user data loss.

## Options Considered
1. **Direct Stream to Google Drive**: Stream directly without local buffer.
2. **Durable Local Storage Buffer with Zero Early Deletion**: Write to `/storage/uploads/YYYY/MM/DD/{uuid}.bin`, record in PostgreSQL, and only consider deletion/archival after remote Google Drive confirmation.

## Decision
Adopt Option 2: **Durable Local Storage Buffer**.

## Reason
Guarantees resilient, zero-data-loss synchronization with effortless retry capability.

## Consequences
Server disk usage must be tracked with retention policies for verified `SYNCED` files.

---

# ADR-004 — PostgreSQL & Prisma for Relational Persistence

## Context
The application manages structured relationships: users, roles, folders, files, sync jobs, audit logs, and connection states.

## Problem
Need a robust, ACID-compliant relational database engine with automated migrations and type-safe data access.

## Options Considered
1. **SQLite / File-based store**: Insufficient for production concurrency.
2. **PostgreSQL + Prisma ORM**: Type-safe schema, migrations, strong indexing, and enterprise reliability.

## Decision
Adopt Option 2: **PostgreSQL + Prisma ORM**.

## Reason
Fulfills technology stack constraint and provides reliable transaction support for job state transitions.

## Consequences
Prisma migrations will be strictly generated and tracked in `/prisma/migrations/`.

---

# ADR-005 — Idempotent Asynchronous Background Sync Worker

## Context
Google Drive synchronization may encounter transient network disconnects right after remote file creation, leading the system to believe the upload failed.

## Problem
Naive retries will create duplicate files in the target Google Drive folder.

## Options Considered
1. **Naive Retry**: Always send a new upload request on retry.
2. **Pre-flight Idempotency Verification**: Sync worker inspects target folder for identical filename and matching checksum/size before initiating new upload streams.

## Decision
Adopt Option 2: **Pre-flight Idempotency Verification**.

## Reason
Prevents file duplication and ensures safe, idempotent retries across all failure modes.

## Consequences
The worker queries Google Drive metadata prior to stream creation during retry cycles.
