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
pnpm test           # 78 tes API (SFTP/SMB asli diuji bila SD_TEST_SFTP / SD_TEST_SMB diisi; lihat scripts/ci-external-servers.sh)
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
| **Berbagi tautan** (viewer/editor, sandi, kedaluwarsa, kuota unggah, dicabut kapan saja), halaman publik tanpa login, **Sampah** (pulihkan/hapus permanen, 30 hari), **Semua file** = volume `UPLOADS_DIR` | ✅ diuji otomatis + browser + uji beban |
| Pratinjau lanjutan: foto (zoom/putar), video, audio, PDF (pdf.js), CSV, Excel (.xlsx), Word (.docx), JSON (pohon), teks/kode, isi ZIP | ✅ diuji di browser |
| Filter lanjutan (nama, jenis, ekstensi, ukuran, tanggal, bintang), seleksi kotak, seret-lepas multi-item dengan penanda jumlah, dropdown folder di breadcrumb saat menyeret | ✅ diuji di browser |
| **Pohon folder** di "Semua file"/penyimpanan (lazy, seret-lepas ke folder, buka otomatis saat menahan), **Sampah sebagai pohon** (buka folder terhapus, pulihkan/hapus sebagian isi), **Folder baru** di dua panel, **panel Detail** (ukuran folder rekursif), **cetak**, **tayangan slide**, **pencarian global** lintas penyimpanan terhubung lewat indeks latar belakang (lokasi folder tampil di hasil) | ✅ diuji otomatis + browser |
| Audit log, notifikasi, dashboard (kapasitas yang tidak dilaporkan tampil "—", bukan 0), tema terang/gelap, responsif | ✅ |

## Pengaturan sistem (admin)

Halaman **Pengaturan sistem** (khusus administrator instalasi) mengatur: tema dan merek (nama, warna utama dengan pemeriksaan kontras, ikon aplikasi yang dipakai di favicon dan manifest pemasangan), pendaftaran (terbuka, hanya undangan, tertutup), akses tamu (matikan tautan publik, matikan unggahan tamu, wajibkan sandi, masa berlaku bawaan dan maksimal), keamanan (verifikasi dua langkah TOTP opsional atau wajib untuk admin/semua, keluar otomatis saat tidak aktif, lama sesi), retensi (sampah, log audit dan aktivitas file, riwayat transfer), serta email SMTP (atur ulang sandi dan undangan; kata sandi SMTP tersimpan terenkripsi). Nilai bawaan mengikuti variabel lingkungan, jadi instalasi lama berperilaku sama sampai diubah.

## Fitur file lainnya

Folder bertanda titik bila anggota lain mengubah isinya sejak terakhir Anda buka; panel Detail punya tab Aktivitas (siapa membuka, mengunduh, mengubah, termasuk tamu tautan), tag, komentar, dan metadata (EXIF gambar, info video); satu tautan bisa membagikan banyak file/folder; berbagi langsung ke anggota muncul di **Dibagikan ke saya**; halaman **Media** menampilkan semua foto dan video dari semua penyimpanan (termasuk cloud setelah diindeks) per tanggal.

## Pencarian global

Setiap penyimpanan yang terhubung (termasuk Google Drive, OneDrive, SMB, SFTP…) dirayapi di latar belakang ke indeks metadata lokal, sehingga pencarian menjangkau folder yang belum pernah dibuka. Perayapan berjalan saat penyimpanan dihubungkan, saat server menyala, tiap 6 jam, dan bisa dipicu admin lewat **Penyimpanan → Indeks ulang pencarian**. Untuk penyimpanan cloud, perayapan diberi jeda agar tidak menghabiskan kuota API. Hasil menampilkan penyimpanan dan folder tempat file berada.

## Berbagi lewat tautan

Klik kanan file/folder → **Bagikan…**. Satu item bisa punya banyak tautan (maks. 25), masing-masing dengan **judul** untuk mengingat penerimanya (mis. "Pak Budi", "Tim audit") sehingga bisa dimatikan sendiri-sendiri. Izin tiap tautan, **penonton** (lihat, putar, unduh) atau **editor** (khusus folder: unggah, folder baru, ganti nama, hapus ke Sampah; tidak pernah menimpa file yang sudah ada), **bisa diubah kapan saja**, juga setelah tautan dipakai: URL tetap sama dan perubahan langsung berlaku, termasuk menghentikan unggahan yang sedang berjalan. Pengunjung tautan tidak bisa membuat, mengubah, atau mematikan tautan; itu ditolak di server. Opsi lain: kata sandi, masa berlaku, kuota unggah. Semua tautan aktif ada di **Tautan berbagi** (bisa dicari berdasarkan judul).

Keamanan: token acak 256-bit (hanya hash yang dipakai untuk mencari; token terenkripsi agar bisa disalin lagi oleh pemilik), setiap permintaan memastikan item ada di dalam folder yang dibagikan (percobaan keluar folder → 403, diuji), pembatas laju per IP, batas unggahan aktif per IP dan kuota staging global, dan tautan yang tidak valid/kedaluwarsa/dicabut selalu menjawab sama (404) agar tidak bisa ditebak. Siapa pun yang memegang tautan bisa memakainya: bagikan seperlunya.

**Beban:** 100 pengunjung anonim × 30 file lewat tautan editor (3.000 unggahan, 3,7 GB) selesai tanpa galat, 197 file/dtk, p95 985 ms, memori server puncak 281 MB (`docs/PERFORMANCE.md`).

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
