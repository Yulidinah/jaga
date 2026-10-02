# JAGA

JAGA adalah sistem peringatan dan respons bencana inklusif yang menghubungkan
kalung IoT milik kelompok rentan, operator JAGA Desa, dan tim JAGA Rescue.

## Yang sudah tersedia

- Dashboard web responsif dan dapat dipasang sebagai PWA.
- API TypeScript untuk perangkat, SOS, insiden, dan perintah alarm (perangkat mengambil alarm lewat inbox).
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
2. Jalankan migrasi **berurutan** melalui SQL Editor:
   `202609220001_initial_jaga.sql`, `202609220002_operational.sql`, lalu `202610020001_perbaikan_audit.sql`.
   (Migrasi 001 memuat data demo fiktif; hapus bagian itu bila untuk produksi.)
3. Salin `.env.example` menjadi `.env`, isi `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, dan `SESSION_SECRET`.
4. Jalankan `node --env-file=.env scripts/seed-supabase.mjs` bila ingin data demo. Kata sandi akun demo
   dibuat acak dan dicetak sekali (gunakan `SEED_DEMO_PASSWORDS=true` hanya untuk uji lokal).
5. Jalankan ulang backend. `/api/health` menampilkan `"storage":"supabase"` hanya bila benar-benar terhubung.
   Bila Supabase tidak terjangkau, server berhenti (tidak diam-diam memakai data demo).

Secret key hanya boleh dipasang pada backend. Web, Android, gateway, dan firmware
tidak boleh menyimpan key tersebut.

## Pengembangan lokal tanpa Supabase

```powershell
$env:JAGA_FORCE_MEMORY = "true"; npm run dev
```

Mode memori memuat akun demo (`pusat@jaga.id`, `desa.sukamaju@jaga.id`, `rescue.bpbd@jaga.id`; kata sandi ada di
`backend/src/seed.ts`). Kata sandi itu publik, jadi mode ini tidak boleh dipakai di produksi (server menolak
memori bila `NODE_ENV=production`).

## Tes

```powershell
npm run build
npm run smoke   # menjalankan server memori sendiri dan memeriksa alur utama (51 pemeriksaan)
```

## Simulasi dari kalung

Perangkat memakai header `X-JAGA-Device-Id` + `X-JAGA-Device-Key` (dan `X-JAGA-Gateway-Key` bila lewat gateway):

- `POST /api/device/sos` membuat insiden (balasan `ack: "SOS_DITERIMA"` untuk umpan balik ke kalung).
- `GET /api/device/inbox` mengambil alarm (`commands[]` berisi `receiptId`).
- `POST /api/device/receipts/:receiptId` mengonfirmasi alarm (`{"status":"ACKNOWLEDGED"}`).
- `POST /api/device/telemetry` melaporkan baterai/lokasi.

## Batas versi fondasi

Tanpa konfigurasi Supabase, data memakai fallback memori dan kembali ke kondisi awal saat server mati.
Header `X-JAGA-Role` hanya berlaku bila `JAGA_DEV_ROLE_HEADER=true` (tanpa kredensial; jangan dipakai di
produksi). Belum tersedia: transport MQTT/LoRa (alarm diambil perangkat lewat polling inbox), FCM, peta jalan
sungguhan (rute hanya estimasi), peta interaktif di web, dan hierarki provinsi/nasional.

Petunjuk Android tersedia di [`android/README.md`](android/README.md).
