# JAGA (Jaringan Aksi Tanggap Darurat Inklusif)

JAGA adalah sebuah platform sistem peringatan dan respons bencana inklusif yang dirancang untuk melindungi kelompok rentan (seperti penyandang disabilitas, lansia, dan ibu hamil) dalam situasi darurat. Platform ini mengintegrasikan perangkat IoT (*wearable SOS*) dengan sistem kendali pusat, desa, dan tim *rescue*.

Sistem ini bertindak sebagai pendukung keputusan taktis: alarm darurat yang dikirim dari perangkat IoT akan diterima secara *real-time*, diproses oleh sistem rekomendasi prioritas evakuasi, dan diteruskan ke tim penyelamat lapangan.

## Fitur Utama

- **Dashboard Real-time (Web & PWA)**: Memiliki 3 *role* (JAGA Pusat, JAGA Desa, JAGA Rescue). Mendukung fitur peta interaktif dan notifikasi langsung berbasis *Server-Sent Events* (SSE).
- **Integrasi IoT (SOS Kalung/Wearable)**: Komunikasi darurat 2 arah antara sistem dan perangkat kalung yang digunakan warga rentan.
- **Sistem Prioritas Cerdas**: Skoring otomatis berbasis tingkat kerentanan warga dan tingkat bahaya lokasi bencana.
- **Peta Offline (Service Worker)**: Peta evakuasi tetap dapat diakses di kondisi minim/hilang sinyal di lapangan.
- **Aplikasi Mobile (Android)**: Aplikasi pendamping *native* (Kotlin/Jetpack Compose) untuk mobilitas tinggi tim *rescue* dan *desa*.

## Struktur Proyek

- `backend/`: API (Node.js/TypeScript) yang menangani logika bisnis, autentikasi, SSE, dan rekomendasi evakuasi.
- `frontend/`: Antarmuka *dashboard* web yang mendukung mode *Progressive Web App (PWA)*.
- `android/`: *Source code* untuk aplikasi pendamping *native* Android.
- `firmware/`: Direktori kerja untuk sistem tertanam (*embedded system*) kalung IoT dan gateway.
- `supabase/`: Skema database dan berkas migrasi PostgreSQL.

## Menjalankan Aplikasi Secara Lokal

### Kebutuhan Sistem
- Node.js versi 18+ (atau 20+)
- NPM

### Langkah-langkah
1. **Clone repository ini** dan masuk ke direktori proyek.
2. **Install dependensi:**
   ```bash
   npm install
   ```
3. **Build proyek TypeScript:**
   ```bash
   npm run build
   ```
4. **Jalankan mode memori (Simulasi Lokal tanpa Supabase):**
   ```bash
   npm run dev:memory
   ```
   *(Atau di Windows PowerShell: `$env:JAGA_FORCE_MEMORY = "true"; npm run dev`)*

5. **Akses Aplikasi:**
   Buka `http://localhost:3000` di *browser*. 
   Anda dapat *login* dengan mengklik tombol akun demo otomatis yang muncul di halaman *login* (untuk *role* Pusat, Desa, atau Rescue).

## Pengembangan dengan Database Supabase

Untuk menjalankan JAGA secara terhubung penuh dengan *database* Supabase:
1. Buat *project* di Supabase dan salin `.env.example` menjadi `.env`.
2. Masukkan URL dan *Secret Key* Supabase ke dalam `.env`.
3. Jalankan file SQL migrasi yang berada di dalam folder `supabase/migrations/` secara berurutan di SQL Editor Supabase Anda.
4. Jalankan aplikasi menggunakan perintah standar:
   ```bash
   npm start
   ```

## Lisensi & Atribusi
Proyek ini dibangun untuk keperluan kompetisi teknologi dan kemanusiaan. Harap tidak menggunakan data *dummy* yang disertakan untuk kepentingan produksi.
