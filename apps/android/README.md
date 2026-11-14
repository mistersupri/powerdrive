# SuperDrive untuk Android

Pembungkus (WebView) untuk web app SuperDrive: pemilih file untuk unggah, unduhan lewat Download Manager, video layar penuh, dialog JavaScript, dan warna bilah sistem mengikuti tema.

- Pertama kali dibuka, aplikasi meminta alamat server SuperDrive Anda dan memeriksanya.
- Server `http://` (tanpa TLS) diizinkan tetapi diberi peringatan.
- Build: dilakukan oleh GitHub Actions (`.github/workflows/android.yml`), hasilnya APK di Releases dengan tag `android-v1.0.N`.
- Build lokal: `gradle -p apps/android assembleRelease` (JDK 17 + Android SDK).
- Tanda tangan: tanpa secret, dipakai `app/release.keystore` (kunci publik). Untuk kunci sendiri, set secret `ANDROID_KEYSTORE_B64` (base64 keystore), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
