# Deployment & Operational Specification
# Centralized File Upload & Google Drive Synchronization Application

## 1. Runtime Environment Specifications

- **Platform**: Node.js 20+ runtime in sandboxed Cloud Run container environment.
- **Port Ingress**: Port `3000` bound to host `0.0.0.0` (Hardcoded platform constraint).
- **Backend Architecture**: Single bundled Express server outputting to `dist/server.cjs` via `esbuild`.
- **Frontend SPA**: Static React bundle built via Vite into `dist/` and served via Express static middleware in production.

---

## 2. Production Build & Start Commands

```json
{
  "scripts": {
    "dev": "tsx server.ts",
    "build": "vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs",
    "start": "node dist/server.cjs"
  }
}
```

---

## 3. Environment Variables Configuration

| Variable | Description | Sensitivity |
| :--- | :--- | :--- |
| `PORT` | Container HTTP Port (Must be `3000`) | System Public |
| `DATABASE_URL` | PostgreSQL connection string (`postgresql://...`) | Secret |
| `SESSION_SECRET` | Secret key for signing user session tokens | Secret |
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth 2.0 Client ID | Non-sensitive Server config |
| `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth 2.0 Client Secret | Secret |
| `GOOGLE_REDIRECT_URI` | Authorized OAuth redirect callback URL | Server config |
| `APP_URL` | Public application base URL | System / Config |
| `STORAGE_DIR` | Absolute or relative path to local storage buffer (`./storage/uploads`) | Config |
| `MAX_FILE_SIZE_MB` | Maximum allowed file upload size (default `100`) | Config |
