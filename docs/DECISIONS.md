# Keputusan teknis

Permintaan: "stack terbaik dan gratis, dengan performa cepat, terutama thumbnail, unggah, dan unduh". PRD menyebut PostgreSQL + Redis + BullMQ + Prisma + Fastify. Berikut yang dipertahankan, yang diganti, dan alasannya.

| Pilihan | Alasan |
|---|---|
| **Fastify 5 + Node 22** (dipertahankan) | Overhead per permintaan kecil; streaming `Readable` ke socket dengan backpressure; cocok untuk unduh/unggah besar. |
| **SQLite (WAL) lewat `node:sqlite` bawaan Node**, bukan PostgreSQL + Prisma | Beban kerja ini kecil dan berbasis metadata (daftar file, indeks pencarian, status job). SQLite dalam proses menghilangkan satu hop jaringan per kueri, sehingga daftar folder dan pencarian lebih cepat. Instalasi self-hosted jadi satu kontainer tanpa layanan lain. Tanpa dependensi native, jadi tidak ada langkah kompilasi. Pembungkus di `apps/api/src/db.ts` menyembunyikan driver bila suatu saat perlu pindah ke PostgreSQL. **Konsekuensi:** satu proses server, bukan klaster. `node:sqlite` masih berstatus experimental di Node 22 (peringatan disenyapkan di `start`). |
| **Antrean job tahan-restart di database**, bukan Redis + BullMQ | Job, item, dan checkpoint disimpan di SQLite dan dipulihkan saat start (`Engine.start`). Konkurensi per workspace dan global, retry dengan exponential backoff + jitter. Tanpa Redis berarti satu layanan lebih sedikit; skala ke banyak worker bukan target PRD (self-hosted, satu server). |
| **sharp (libvips)** untuk thumbnail | Pembacaan JPEG dengan shrink-on-load: foto 12 MP dibuat thumbnail ±19 ms. Gratis, berjalan sebagai biner prebuilt. |
| **ffmpeg** (opsional) | Satu frame poster untuk thumbnail video lokal. Bila tidak terpasang, ikon dipakai. |
| **React 19 + Vite + Tailwind 4**, TanStack Query + Virtual | Daftar folder besar tidak membebani DOM karena dirender virtual (303 item = ±1.500 node DOM). Cache query membuat membuka folder yang pernah dilihat terasa seketika. |
| **Argon2id** (`@node-rs/argon2`) | Sesuai PRD. Memakai biner prebuilt. |
| **Token sesi acak tersimpan sebagai hash**, bukan JWT | Bisa dicabut seketika (logout, ganti kata sandi). `SESSION_SECRET` dari PRD tidak diperlukan, jadi dihapus. |
| **REST langsung (fetch)** untuk Google/OneDrive/Dropbox, bukan SDK besar | Mengontrol streaming, rentang byte, dan sesi unggah resumable per penyedia; bundel lebih kecil. |
| **Bahasa antarmuka Indonesia** | PRD dan pengguna berbahasa Indonesia; desain `.pen` berbahasa Inggris, tata letak dan gaya diikuti. |

## Perilaku yang perlu diketahui

- **Resume.** Unggahan dari browser benar-benar resumable (offset dikonfirmasi server, potongan atomik, disimpan di `localStorage` agar lanjut setelah muat ulang). Transfer antar penyimpanan **mengulang file yang sedang berjalan** setelah jeda/restart, karena stream sembarang tidak bisa dilanjutkan dari offset (PRD §8.2 juga menyatakan ini). File yang sudah selesai tidak diulang. Adapter cloud mengulang tiap potongan secara terpisah di dalam sesi unggah resumable milik penyedia.
- **Hapus tidak merusak.** Google Drive → Sampah, OneDrive → Recycle Bin, Dropbox → file terhapus, folder server → `.superdrive-trash`. S3 menghapus permanen (dikatakan di dialog).
- **Timpa aman.** Pada kebijakan OVERWRITE di penyedia remote, file baru diunggah dengan nama sementara, diverifikasi, baru menggantikan yang lama.
- **Pindah aman.** Sumber dihapus hanya setelah tujuan terverifikasi (ukuran, dan checksum bila tersedia di kedua sisi). Jika penghapusan sumber gagal: status `COPY_COMPLETED_SOURCE_RETAINED`.
- **File dari pengguna tidak pernah dieksekusi.** Pratinjau hanya menyajikan jenis aman; HTML/teks disajikan `text/plain`, SVG/jenis aktif dipaksa unduh, plus `nosniff` dan CSP.
