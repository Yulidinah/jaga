# JAGA Android

Aplikasi native Kotlin/Jetpack Compose untuk role JAGA Desa dan JAGA Rescue. Pengguna masuk dengan akun
organisasi; peran dan wilayah ditentukan server dari akun tersebut.

Saat dijalankan pada Android Emulator, aplikasi mengakses backend lokal melalui
`http://10.0.2.2:3000`. Untuk perangkat fisik, ubah `baseUrl` di `JagaApi.kt`
(`API_BASE` di `app/build.gradle.kts`) menjadi alamat backend. HTTP biasa hanya diizinkan ke 10.0.2.2/localhost; gunakan HTTPS di luar pengembangan.

Build memerlukan Android Studio, Android SDK 35, JDK 17, dan Gradle wrapper yang
dapat dibuat oleh Android Studio. Belum ada peta, pelacakan jejak, dan notifikasi push (FCM).
