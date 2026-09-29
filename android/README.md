# JAGA Android

Aplikasi native Kotlin/Jetpack Compose untuk role JAGA Desa dan JAGA Rescue.

Saat dijalankan pada Android Emulator, aplikasi mengakses backend lokal melalui
`http://10.0.2.2:3000`. Untuk perangkat fisik, ubah `baseUrl` di `JagaApi.kt`
menjadi alamat IP komputer pada jaringan yang sama.

Build memerlukan Android Studio, Android SDK 35, JDK 17, dan Gradle wrapper yang
dapat dibuat oleh Android Studio. Pemilih role pada layar hanya untuk demo; pada
produksi role harus berasal dari token autentikasi backend.
