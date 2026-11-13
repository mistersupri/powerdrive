# Arsitektur

```
Browser (React) ── REST + SSE ──► Fastify ──► modules/*  ──► providers/*  ──► Google · OneDrive · Dropbox · S3 · disk
                                     │            │
                                     │            └─ transfers: antrean + worker dalam proses
                                     └─ SQLite (WAL): pengguna, workspace, koneksi, indeks file, job, audit
                            data/ : db · cache/thumbs · staging (potongan unggahan)
```

```
apps/api/src
  app.ts, server.ts      bootstrap, CSRF (Origin/X-Requested-With), penanganan error baku
  modules/               auth · permissions · storages · files · uploads · thumbnails · delivery · transfers
  providers/             types.ts (kontrak) · local · s3 · google · onedrive · dropbox · oauth · http · chunker
  routes/                tipis: validasi (zod) → modul
apps/web/src             features/{files,transfers,uploads,storage,dual,members,...} · ui/ (komponen)
packages/shared          tipe DTO yang dipakai API dan web
```

## Kontrak adapter

`StorageProvider` (`providers/types.ts`): `list/stat/path/createFolder/read(range)/write/rename/delete`, opsional `copy/move/findChild/thumbnail/localPath`, dan `capabilities`. Mesin transfer tidak tahu penyedia mana pun: ia memilih **native** (satu penyedia, `copy`/`move` tersedia) atau **streaming** (`read` → meter → `write`). Menambah SFTP/WebDAV = satu file adapter + satu baris di `providerFor`.

ID file di API adalah `~base64url(id penyedia)` (atau `root`), sehingga aman di URL untuk semua penyedia.

## Alur utama

- **Daftar folder**: `GET /files` → adapter → *write-through* ke tabel `files` (indeks metadata) → pencarian/terbaru/bintang membaca indeks lokal, tanpa memanggil penyedia.
- **Thumbnail**: `GET /files/:s/:f/thumbnail` → metadata dari indeks → ETag/304 tanpa menyentuh disk → cache disk beralamat konten (`storage+file+versi+ukuran`) → bila perlu: libvips langsung dari disk (lokal) / thumbnail bawaan penyedia / stream asli ke libvips (maks 64 MB). Permintaan sama digabung, konkurensi dibatasi, kegagalan di-cache negatif 10 menit.
- **Unggah**: `POST /uploads` → `PATCH /uploads/:id` (potongan 16 MiB, offset harus persis) → ke staging → finalisasi di latar: lokal = `rename` (tanpa menyalin), cloud = stream ke sesi unggah penyedia.
- **Unduh/pratinjau**: `stat` → `read(range)` → stream ke respons; klien putus → stream penyedia dihentikan.
- **Transfer**: `POST /transfers` → job `QUEUED` → worker: validasi → *expand* folder (idempoten) → item diproses 3 paralel → verifikasi → hapus sumber bila MOVE → notifikasi + audit. Progres lewat SSE (`/transfers/events`), digabung ±4 kali/detik.

## Keamanan

Argon2id; cookie `HttpOnly` + `SameSite=Lax`; cek Origin pada tulis; rate limit login; sesi dapat dicabut. Setiap permintaan memeriksa pengguna → workspace → keanggotaan → izin penyimpanan di backend; id lintas workspace menghasilkan 404/403 yang sama. Kredensial dienkripsi AES-256-GCM dengan kunci versi (rotasi lewat `ENCRYPTION_MASTER_KEY=v2:…,v1:…`); token tidak pernah dikirim ke browser maupun dicatat. OAuth memakai `state` sekali pakai + PKCE. Folder server dibatasi `LOCAL_ROOTS` dengan pengecekan `realpath` (path traversal dan symlink). Endpoint S3 divalidasi (DNS, IP privat/loopback/link-local, metadata cloud) kecuali `ALLOW_PRIVATE_HOSTS=true`. Batasan: validasi DNS dilakukan saat koneksi dibuat/diuji, belum mengunci IP pada tiap permintaan (DNS rebinding).

## API

Dasar `/api/v1`, respons `{ success, data | error, meta }`. Rute: `auth/*`, `workspaces/*`, `storages/*` (+ `/providers`, OAuth `connect`/`callback`, `permissions`), `mounts/*`, `files/*` (+ `folders rename copy move star download preview thumbnail`), `uploads/*`, `transfers/*` (+ `events`), `search`, `dashboard`, `audit-logs`, `notifications`. Kode di `apps/api/src/routes`.
