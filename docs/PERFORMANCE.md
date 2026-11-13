# Performa

Diukur di sandbox pengembangan (4 vCPU, disk lokal, loopback), server produksi hasil `pnpm build`. Angka jaringan nyata dan penyedia cloud akan berbeda; yang diukur di sini adalah overhead aplikasi.

| Skenario | Hasil |
|---|---|
| 24 foto 12 MP (90 MB asli), thumbnail 256 px, 6 koneksi paralel, cache kosong | 464 ms total (±19 ms/foto) |
| Sama, cache server terisi | 34 ms total (±1,4 ms/foto) |
| Membuka folder 303 file, 50 thumbnail di layar sampai semua tampil (cache kosong) | ±730 ms |
| Muat ulang halaman yang sama (cache browser, thumbnail `immutable`) | ±300 ms |
| DOM untuk folder 303 file (daftar virtual) | ±1.500 node, tidak bertambah dengan jumlah file |
| Unduh file 200 MB | ±1 GB/dtk, byte pertama 18 ms |
| Unduh dengan `Range` (lanjutan dari 100 MB) | 206, 0,1 dtk |
| Unggah 512 MB (potongan 16 MiB) | 1,5 dtk (±343 MB/dtk); finalisasi 57 ms (`rename`, tanpa menyalin) |
| Memori proses server setelah unggah 512 MB + unduh 200 MB + zip 94 MB | ±177 MB RSS (streaming, tidak memuat file ke RAM) |

## Mengapa cepat

1. **Thumbnail:** libvips shrink-on-load, cache disk beralamat konten, ETag yang dihitung tanpa menyentuh disk atau penyedia, URL berversi + `Cache-Control: immutable` (browser tidak bertanya lagi), dedupe permintaan kembar, konkurensi dibatasi, thumbnail bawaan penyedia (Google/OneDrive/Dropbox) sehingga file asli tidak diunduh.
2. **Daftar:** daftar virtual (hanya baris terlihat yang dirender, gambar hanya dimuat saat baris terlihat), prefetch folder saat kursor di atasnya, halaman berikutnya diambil otomatis, indeks metadata lokal untuk pencarian.
3. **Unggah:** potongan besar dengan XHR (progres akurat), file paralel (3), potongan atomik yang bisa diulang, tujuan lokal tanpa salinan kedua.
4. **Unduh:** stream langsung dengan backpressure, `Range` + `ETag`, tanpa kompresi, putus klien menghentikan stream penyedia.

Skrip ukur ada di riwayat pengembangan; ulangi dengan folder foto Anda sendiri untuk angka yang mewakili perangkat keras Anda.
