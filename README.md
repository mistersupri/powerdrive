# SuperDrive

Satu antarmuka web untuk semua penyimpanan: Google Drive, OneDrive, Dropbox, S3-compatible (AWS, MinIO, R2, B2), SMB/NAS, SFTP, WebDAV, dan folder di server. File dipindahkan **antar penyimpanan lewat server**, tanpa diunduh ke komputer pengguna dulu.

Dibangun ulang dari [PRD](docs/PRD.md) dengan tampilan dari desain [`docs/superdrive.pen`](docs/superdrive.pen).

## Menjalankan

Butuh Node.js ≥ 22.13 dan pnpm. Tidak perlu PostgreSQL atau Redis.

```bash
pnpm install
pnpm dev            # API :3000 + web :5173 (buka http://localhost:5173)
```

Akun pertama yang mendaftar menjadi administrator. Tanpa konfigurasi apa pun Anda bisa langsung menghubungkan **Folder server** (data di `./data/files`) dan mencoba semua fitur.

```bash
pnpm test           # tes API (SFTP/SMB asli diuji bila SD_TEST_SFTP / SD_TEST_SMB diisi; lihat scripts/ci-external-servers.sh)
#                     37 tes API (otentikasi, isolasi workspace, unggah, transfer, izin, keamanan, kontrak adapter cloud dengan fetch tiruan)
pnpm typecheck
```

### Produksi (Docker)

```bash
cp .env.example .env     # isi APP_URL, ENCRYPTION_MASTER_KEY, dan kredensial OAuth yang dipakai
docker compose up -d     # tambahkan  --profile tls  untuk HTTPS otomatis lewat Caddy
```

Image siap pakai dipublikasikan otomatis setiap push ke `main` (lihat `.github/workflows/release.yml`):
`docker pull ghcr.io/mistersupri/superdrive:latest` (lalu jalankan dengan volume `/data` dan variabel dari `.env.example`).

Tanpa Docker: `pnpm build && pnpm start` (set variabel lingkungan seperti di `.env.example`).

Daftarkan redirect URI OAuth: `${APP_URL}/api/v1/storages/{google-drive|onedrive|dropbox}/callback`.

## Yang sudah ada

| Area | Status |
|---|---|
| Akun, workspace, peran (Owner/Admin/Member/Viewer), izin per penyimpanan, undangan | ✅ diuji otomatis |
| File manager: grid/daftar, breadcrumb, pilih banyak, drag-drop, menu klik-kanan, pintasan keyboard, pencarian, bintang, terbaru, dua panel, pratinjau gambar/video/audio/PDF/teks | ✅ diuji di browser |
| Unggah resumable per potongan (file & folder), unduh dengan Range, unduh folder sebagai ZIP | ✅ diuji |
| Thumbnail cepat (lihat [PERFORMANCE](docs/PERFORMANCE.md)) | ✅ diukur |
| Transfer salin/pindah antar penyimpanan: file, folder bertingkat, bulk, kebijakan nama bentrok, jeda/lanjut/batal/ulang, SSE, pemulihan setelah restart, pindah aman (sumber dihapus setelah tujuan terverifikasi) | ✅ diuji (antar folder server) |
| Penyimpanan eksternal: **SMB/NAS**, **SFTP**, **WebDAV** (form di UI, kredensial terenkripsi, host key SFTP dikunci) | ✅ diuji terhadap **Samba (SMB3, signing + enkripsi wajib) dan OpenSSH asli**, serta server WebDAV; termasuk transfer lintas-storage dan pindah aman |
| Penyimpanan: **Folder server**, **S3-compatible**, Google Drive, OneDrive, Dropbox (OAuth + PKCE, banyak akun, token terenkripsi) | Folder server ✅ diuji. **Cloud & S3: ditulis sesuai dokumentasi API resmi; Google/OneDrive/Dropbox diuji terhadap respons tiruan (paging, unggah per potongan, Range, error), S3 dan semuanya belum diuji ke layanan sungguhan** (tidak ada kredensial di lingkungan pengembangan) |
| Audit log, notifikasi, dashboard (kapasitas yang tidak dilaporkan tampil "—", bukan 0), tema terang/gelap, responsif | ✅ |

## Catatan penyimpanan eksternal

- **SMB** memakai biner `smbclient` (ada di image Docker). Jika menjalankan tanpa Docker: `apt install smbclient`. Dipilih karena pustaka SMB murni-JS gagal pada server modern (NTLMv1, signing, enkripsi). Konsekuensinya satu proses per operasi, dan *seek* tidak didukung: unduh dengan Range membaca dari awal dan membuang byte sebelum posisi yang diminta (wajar di LAN, lambat untuk lompat jauh di file sangat besar).
- **SFTP**: kunci host dikunci pada koneksi pertama (atau isi sidik jari sendiri). Jika berubah, koneksi ditolak.
- **WebDAV**: wajib HTTPS (kecuali `ALLOW_PRIVATE_HOSTS=true`). Pengalihan ke host lain ditolak.
- Ketiganya: hapus memindahkan ke folder tersembunyi `.superdrive-trash` di penyimpanan itu. Alamat jaringan internal (NAS di LAN) diblokir kecuali `ALLOW_PRIVATE_HOSTS=true`.
- Tidak ada salin native di SFTP/SMB, jadi salin di dalam satu penyimpanan tetap lewat server.

## Belum ada (sengaja ditunda)

- **Sinkronisasi** (PRD fase 6). MVP di PRD tidak memuatnya.
- TOTP, pratinjau DOCX/XLSX/PPTX, PDF.js (PDF memakai penampil bawaan browser), berbagi tautan, webhook penyedia.
- Email: tautan reset kata sandi ditulis ke log server, belum dikirim lewat SMTP.
- Folder pada "mount virtual" memang hanya titik awal, bukan pembatas akses. Pembatas yang sah adalah akar koneksi (folder server/prefix S3) dan izin per penyimpanan.

Keputusan teknis dan alasannya ada di [docs/DECISIONS.md](docs/DECISIONS.md); rancangan di [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
