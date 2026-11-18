# Aplikasi Android native (tanpa WebView)

Tujuan akhir: aplikasi Android yang seluruh antarmukanya ditulis native (Kotlin + Jetpack Compose), tanpa WebView, dengan scroll, animasi, gestur, dan viewer seperti aplikasi galeri atau file manager bawaan. Server dan API tidak berubah: aplikasi native berbicara ke REST API yang sama dengan situs web.

Ini proyek besar. Dokumen ini adalah rencananya, supaya setiap tahap bisa dikerjakan, diuji, dan dirilis sendiri-sendiri.

## Strategi: ganti sedikit demi sedikit, jangan diganti sekaligus

1. **Dua antarmuka dalam satu APK.** Antarmuka native baru (`app.superdrive.ui`) ada di samping antarmuka WebView yang sekarang. Pengguna memilih lewat "Antarmuka native (beta)" di Pengaturan aplikasi. Bawaan tetap WebView sampai antarmuka native setara.
2. **Layar yang belum ditulis native dibuka lewat WebView tertanam** di dalam cangkang native (satu halaman web per tab, memakai sesi login yang sama). Dengan begitu antarmuka native sudah bisa dipakai penuh sejak tahap pertama, dan setiap tahap hanya mengganti satu layar web dengan layar native.
3. **WebView dihapus di tahap terakhir**, setelah semua layar punya padanan native. Sampai saat itu WebView tertanam adalah jaring pengaman, bukan tujuan.
4. **Satu sesi untuk keduanya.** Cookie sesi dibagi antara klien API native dan WebView, jadi masuk di satu dunia berlaku di dunia lain.

## Arsitektur

- **Satu Activity, Compose penuh.** Material 3 yang disesuaikan dengan token desain situs web (warna terang/gelap, radius, tipografi, kurva gerak yang sama: ease-out kuat, kurva laci).
- **Navigasi:** Navigation Compose, satu graf. Tab bawah adalah `NavigationBar`; gestur kembali prediktif bawaan Android.
- **Pola layar:** `ViewModel` + `StateFlow` (aliran data satu arah). Layar hanya menggambar state, aksi naik ke ViewModel.
- **Data:** OkHttp + kotlinx.serialization. Klien membaca amplop `{success, data}` yang sama dengan web, memakai cookie sesi, header `x-requested-with` dan `x-workspace-id`. Repositori per area (auth, file, media, album, berbagi, transfer).
- **Gambar:** Coil (memakai OkHttp berotentikasi). Thumbnail dari `/files/:storage/:id/thumbnail`, dengan kunci cache `version` seperti di web.
- **Video:** Media3 ExoPlayer (dukungan range sudah ada di server).
- **Unggah dan unduh:** WorkManager + layanan latar depan yang sudah ada (cadangan foto, notifikasi progres tetap dipakai ulang).
- **Pratinjau dokumen:** PDF memakai `PdfRenderer` bawaan Android. DOCX, XLSX, CSV, ZIP, dan teks butuh keputusan terpisah (render di server, atau pustaka native). Ini bagian paling mahal; sampai selesai tetap memakai WebView tertanam.
- **Yang dipakai ulang apa adanya:** kunci sidik jari, brankas album privat (Keystore), pembaruan aplikasi, cadangan foto, notifikasi, login Google (peramban + kode sekali pakai).

## Daftar layar dan tahapnya

| Tahap | Isi | Endpoint utama | Selesai bila |
| --- | --- | --- | --- |
| 2 | Cangkang Compose, tema, klien API, masuk (+TOTP), tab bawah, **File** (daftar folder, thumbnail, telusur folder, tarik untuk muat ulang), tab lain lewat WebView tertanam | `/auth/login`, `/auth/mfa/verify`, `/auth/me`, `/storages`, `/files` | Bisa masuk dan menelusuri file sepenuhnya native |
| 3 | **Media**: galeri (tanggal, folder, album), sorotan, viewer foto dan video layar penuh native (ExoPlayer, zoom, geser) | `/media`, `/media/folders`, `/media/highlights`, `/albums`, `/files/.../preview` | Galeri dan viewer tanpa WebView |
| 4 | **Aksi file**: pilih banyak, ganti nama, pindah, salin, hapus, bintang, unggah (pemilih sistem), unduh, bagikan, detail (tab aktivitas, tag, komentar) | `/files/*`, `/uploads`, `/transfers`, `/shares` | Semua aksi di File dan Media |
| 5 | **Beranda dan Transfer**, notifikasi dalam aplikasi, pencarian (+saran) | `/media`, `/transfers`, `/search`, `/notifications` | |
| 6 | **Berbagi**: Dibagikan ke saya, tautan berbagi, halaman tautan publik | `/shares`, `/shared`, `/public` | |
| 7 | **Pengaturan**: profil, kata sandi, TOTP, album privat, aplikasi (cadangan, kunci, pembaruan), penyimpanan, anggota | `/auth/*`, `/workspaces/*`, `/storages/*` | |
| 8 | **Pratinjau dokumen native** (PDF, teks, CSV, JSON, DOCX/XLSX, ZIP) dan OCR | `/files/.../preview` | Tidak ada pratinjau yang memakai WebView |
| 9 | Menghapus WebView: layar masuk Google, halaman admin (khusus situs web, tetap tidak ada di aplikasi), pembersihan | | `WebView` tidak lagi dipakai di kode |

Pengaturan sistem dan website sengaja tidak pernah ada di aplikasi native (aturan produk yang sama dengan sekarang).

## Pengujian

- **JVM (tanpa emulator):** pengujian ViewModel, parser JSON, dan klien API dengan MockWebServer. Berjalan di CI.
- **Compose di JVM:** pengujian UI dengan Robolectric dan cuplikan layar dengan Paparazzi, berjalan di CI, supaya perubahan tampilan tidak rusak diam-diam.
- **Perangkat nyata:** setiap tahap dirilis dulu sebagai pra-rilis (beta) untuk dicoba di HP sebelum jadi bawaan.

## Risiko yang perlu diketahui

- **Tidak ada emulator di lingkungan pengembangan ini.** Perubahan tampilan hanya terbukti terkompilasi dan lolos pengujian JVM, belum terlihat. Karena itu setiap tahap harus dicoba di HP Anda, dan kesalahan tampilan akan diperbaiki berdasarkan screenshot dari HP.
- **Dua antarmuka berarti dua kali perawatan** sampai tahap 9. Ini harga dari tidak merusak aplikasi yang sudah dipakai.
- **Pratinjau dokumen (tahap 8)** adalah bagian yang paling mungkin molor.
