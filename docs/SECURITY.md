# Security & Compliance Specification
# Centralized File Upload & Google Drive Synchronization Application

## 1. Threat Modeling & Mitigations

| Threat Vector | Potential Impact | Architecture Mitigation |
| :--- | :--- | :--- |
| **Path Traversal Attacks** | Arbitrary filesystem reads/writes | Strict UUID-based filenames on disk; rejection of `..` or non-whitelisted path characters. |
| **Malicious Executable Uploads** | Server exploitation via uploaded malware | Non-executable storage partition (`chmod 644`), randomized `.bin` physical extension, streaming validation. |
| **Google Credential Leakage** | Unauthorized Google Workspace / Drive access | OAuth refresh tokens stored strictly backend-side in PostgreSQL / environment; zero token exposure to client frontend. |
| **Horizontal Privilege Escalation** | Regular user viewing or downloading other users' private files | Strict RBAC middleware checking file ownership (`userId === req.user.id || req.user.role === 'ADMIN'`). |
| **Denial of Service (Storage Flooding)** | Disk space exhaustion | Per-user rate limiting, max file size enforcement (100MB limit default), disk space health checks. |
| **Cross-Site Scripting (XSS)** | Client token hijacking | Sanitized React rendering, strict Content Security Policy (CSP), HTTP-Only session cookies. |

---

## 2. Cryptographic and Access Controls

- **Transport Security**: HTTPS everywhere (TLS 1.3 enforced).
- **Data Integrity**: SHA-256 computed on upload stream and verified on sync.
- **Audit Non-Repudiation**: Immutable `ActivityLog` table storing IP address, User Agent, Timestamp, Action, and Resource IDs.
