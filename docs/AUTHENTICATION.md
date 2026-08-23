# Authentication & Authorization Architecture
# Centralized File Upload & Google Drive Synchronization Application

## 1. Dual-Layer Authentication Model

The application employs a clean dual-layer authentication model:

1. **Application Layer Authentication (App Users & Admins)**:
   - Manages internal system users with Role-Based Access Control (`USER` vs `ADMIN`).
   - Secure login via email and hashed password (or optional Google Sign-In for internal identity).
   - Session tracking via secure, signed JWT or HTTP-Only cookie.

2. **Google Drive Integration Layer (Administrative Connection)**:
   - Authorizes the application backend to act on behalf of the organization's Google Drive.
   - Admin connects the organizational Google Account via OAuth 2.0.
   - Backend securely stores `refreshToken` and auto-refreshes `accessToken`.
   - **Zero Token Leakage**: Tokens are strictly held in the backend database/memory and never exposed to the frontend browser.

---

## 2. Roles & Permissions Matrix

| Capability / Action | USER | ADMIN |
| :--- | :---: | :---: |
| Login / Logout / Profile | Yes | Yes |
| Upload Files to Assigned Folders | Yes | Yes |
| View Own Uploaded Files & Sync Status | Yes | Yes |
| Download Own Local Files | Yes | Yes |
| View All System Files & Global Sync Status | No | Yes |
| Connect / Disconnect Google Drive Account | No | Yes |
| Select Target Google Drive (My Drive / Shared Drive) | No | Yes |
| Browse / Create / Refresh Google Drive Folder Trees | Read-Only (Mappable) | Full (Create / Manage) |
| Trigger Manual Retry for Failed Sync Jobs | No | Yes |
| User Management (Create / Update / Deactivate) | No | Yes |
| View System Activity & Audit Logs | No | Yes |
| Configure Global Settings (Max Size, Whitelist) | No | Yes |

---

## 3. Session Security Best Practices
- **Password Security**: Bcrypt / Argon2id with work factor >= 10.
- **Cookie Flags**: `HttpOnly`, `SameSite=Lax` (or `Strict`), `Secure` in production.
- **CSRF Protection**: State parameters on OAuth flows and custom HTTP header validation (`X-Requested-With` or CSRF token).
- **Access Control Middleware**: Express middleware `requireAuth` and `requireAdmin` to enforce permissions on every protected endpoint.
