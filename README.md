# JAGA

JAGA adalah sistem peringatan dan respons bencana inklusif yang menghubungkan
kalung IoT milik kelompok rentan, operator JAGA Desa, dan tim JAGA Rescue.

## Yang sudah tersedia

- Dashboard web responsif dan dapat dipasang sebagai PWA.
- API TypeScript untuk perangkat, SOS, insiden, dan perintah alarm.
- Pembatasan awal: hanya role `DESA` yang dapat membuat perintah alarm.
- Server-Sent Events untuk meneruskan SOS ke dashboard secara langsung.
- Aplikasi Android native Kotlin/Jetpack Compose untuk Desa dan Rescue.
- Data demo tiga kalung untuk pengujian sebelum gateway LoRa tersedia.

## Menjalankan web dan backend

```powershell
npm install
npm run build
npm start
```

Buka `http://localhost:3000`. Jangan membuka `index.html` langsung karena fitur
API dan real-time membutuhkan server.

## Menghubungkan Supabase

1. Buat project Supabase.
2. Jalankan SQL `supabase/migrations/202609220001_initial_jaga.sql` melalui SQL Editor.
3. Salin `.env.example` menjadi `.env` dan isi `SUPABASE_URL` serta
   `SUPABASE_SECRET_KEY` dari pengaturan API Supabase.
4. Jalankan ulang backend. Endpoint `/api/health` akan menampilkan
   `"database":"supabase"`.

Secret key hanya boleh dipasang pada backend. Web, Android, gateway, dan firmware
tidak boleh menyimpan key tersebut.

Untuk mode pengembangan:

```powershell
npm run dev
```

## Simulasi SOS dari kalung

```powershell
$body = @{ deviceId='JAGA-0048'; latitude=-7.2279; longitude=107.9087 } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://localhost:3000/api/sos' -Method Post -Headers @{ 'X-JAGA-Role'='DEVICE' } -ContentType 'application/json' -Body $body
```

Dashboard yang sedang terbuka akan menampilkan notifikasi SOS secara langsung.

## Batas versi fondasi

Tanpa konfigurasi Supabase, data memakai fallback memori dan kembali ke kondisi awal saat server mati.
Header `X-JAGA-Role` hanya dipakai untuk demonstrasi alur izin, bukan autentikasi
produksi. Tahap berikutnya adalah PostgreSQL/PostGIS, login berbasis token,
gateway MQTT/LoRa, Firebase Cloud Messaging, serta peta operasi Android.

Petunjuk Android tersedia di [`android/README.md`](android/README.md).
