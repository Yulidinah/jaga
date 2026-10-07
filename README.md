# JAGA

JAGA adalah sistem peringatan dan respons bencana inklusif. Ia menghubungkan kalung (JAGA Rumah) milik warga rentan
(penyandang disabilitas, lansia, ibu hamil), petugas **JAGA Desa**, tim **JAGA Rescue**, dan admin **JAGA Pusat**.
Sistem ini pendukung keputusan: alarm dikonfirmasi manusia, dan keputusan taktis tetap pada petugas.

## Yang sudah tersedia

- **Dashboard web** untuk tiga peran (navbar atas, menu di sidebar, peta OpenStreetMap), dapat dipasang sebagai PWA di ponsel.
- **Halaman depan publik** (`/`) dengan kartu peran; masuk lewat `/login`; dashboard di `/app`.
- **API TypeScript** untuk warga, kalung, SOS, alarm, operasi, prioritas, tim, akun, dan audit.
- **Operasi:** alarm area Siaga/Awas dari JAGA Desa membuka operasi; JAGA Rescue baru boleh melihat warga berkalung di area itu selama operasi berjalan.
- **Prioritas berwarna** (merah, oranye, kuning, hijau) beserta alasannya di tampilan Rescue.
- **Data pilot dummy** Aceh Utara (Gampong Leubok Pusaka, 9 warga berkalung: 3 disabilitas, 3 lansia, 3 ibu hamil).
- Server-Sent Events untuk pembaruan langsung; aplikasi Android native (prototipe).

Konsep, alasan lokasi pilot, aturan prioritas, dan kontrak perangkat ada di [`docs/JAGA.md`](docs/JAGA.md). Temuan audit dan status perbaikan ada di [`docs/audit.md`](docs/audit.md).

## Struktur folder dan pemiliknya

```
backend/src/   API TypeScript (api/, store-*.ts, auth.ts, recommend.ts, geo.ts, seed.ts)
frontend/      dashboard web: halaman depan, login, dashboard per role, peta Leaflet (PWA)
android/       aplikasi Android native (prototipe, Kotlin/Compose)
firmware/      kalung dan gateway (tim perangkat): contoh API dan kode perangkat
supabase/      migrasi SQL (jalankan berurutan)
scripts/       smoke.mjs (tes regresi), seed-supabase.mjs, demo-device-keys.mjs
docs/          JAGA.md (konsep + kontrak perangkat + kebutuhan data), audit.md
```

## Kerja bersama (agar tidak bentrok)

| Area | Pemilik | Aturan |
|---|---|---|
| `backend/`, `frontend/`, `supabase/`, `scripts/`, `android/`, `package*.json`, `README.md` | Tim aplikasi | Tim perangkat tidak mengubahnya. Butuh perubahan? Ajukan ke tim aplikasi. |
| `firmware/` | Tim perangkat | Bebas menata isinya; tim aplikasi tidak mengubahnya. |
| `docs/JAGA.md`, bagian **Integrasi Kalung** | Bersama | Kontrak API perangkat. Ubah lewat PR kecil dan beri tahu pihak lain. Bagian lain `docs/` milik tim aplikasi. |

- **Kontrak perangkat** (`/api/device/*`) dirujuk dari satu tempat: bagian "Integrasi Kalung" di `docs/JAGA.md` dan `firmware/api-examples.http`. Bila perangkat butuh endpoint atau field baru, tulis usulan di bagian itu dulu; backend diubah oleh tim aplikasi.
- **Cabang:** `main` hanya menerima gabungan lewat PR. Pakai cabang per topik: `firmware/<topik>`, `feat/<topik>`, `fix/<topik>`. Commit kecil; `git pull --rebase` sebelum push.
- **Jangan pernah commit:** `.env`, kunci kalung (`jrk_...`), kunci gateway (`gtw_...`), kata sandi Wi-Fi, berkas hasil build (`*.bin`, `*.elf`, `*.hex`, `.pio/`, `build/`). `.gitignore` sudah menolak pola umumnya; konfigurasi rahasia taruh di `config.local.*` atau `secrets.*` di bawah `firmware/` dan sediakan `config.example.*` sebagai contoh.
- **Akhir baris:** `.gitattributes` menyeragamkan ke LF supaya Windows, macOS, dan Linux tidak saling menimpa baris.

## Menjalankan web dan backend

```powershell
npm install
npm run build
npm start
```

Buka `http://localhost:3000` (halaman depan). Masuk lewat `/login`; dashboard ada di `/app`. Jangan membuka berkas HTML di `frontend/` langsung, karena API dan real-time membutuhkan server.

## Pengembangan lokal tanpa Supabase

```powershell
$env:JAGA_FORCE_MEMORY = "true"; npm run dev
```

Mode memori memuat data pilot dummy dan akun demo tanpa `.env`. Halaman masuk menampilkan akun demo sebagai tombol yang mengisi form otomatis, dan kartu peran di halaman depan membawa langsung ke akun yang sesuai:

| Peran | Email | Kata sandi |
|---|---|---|
| JAGA Pusat | `pusat@jaga.id` | `JagaPusat2026!` |
| JAGA Desa | `desa.leubokpusaka@jaga.id`, `desa.seureuke@jaga.id`, atau `desa.buketlinteung@jaga.id` | `JagaDesa2026!` |
| JAGA Rescue | `rescue.bpbd@jaga.id`, `rescue.damkar@jaga.id`, atau relawan desa `rescue.siagadesa@jaga.id` | `JagaRescue2026!` |

Kata sandi ini publik, jadi mode memori tidak boleh dipakai di produksi (server menolak memori bila `NODE_ENV=production`). Setelah login salah 8 kali untuk satu email, login ditolak 15 menit (reset saat server dimulai ulang).

## Menghubungkan Supabase

1. Buat project Supabase.
2. Jalankan migrasi **berurutan** melalui SQL Editor:
   `202609220001_initial_jaga.sql`, `202609220002_operational.sql`, `202610020001_perbaikan_audit.sql`, `202610020002_operasi.sql`, `202610030001_prioritas.sql`, lalu `202610050001_gps_dan_sinyal.sql`, `202610060001_hapus_dusun.sql`, lalu `202610070001_pusat_kendala_kalung.sql`, lalu `202610080001_istilah_bmkg_bnpb.sql` (jalankan sendirian, tanpa perintah lain) dan `202610080002_sesuai_srs.sql`. Setelah itu isi ulang data dengan `SEED_DEMO_PASSWORDS=true node --env-file=.env scripts/seed-supabase.mjs --reset`.
3. Salin `.env.example` menjadi `.env`, isi `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, dan `SESSION_SECRET`.
4. Opsional, data pilot dummy: `node --env-file=.env scripts/seed-supabase.mjs`. Kata sandi akun dibuat acak dan dicetak sekali (`SEED_DEMO_PASSWORDS=true` hanya untuk uji lokal). Set `JAGA_DATA_IS_DUMMY=true` agar dashboard menampilkan label data dummy.
5. Jalankan backend. `/api/health` menampilkan `"storage":"supabase"` hanya bila benar-benar terhubung; bila Supabase tidak terjangkau, server berhenti (tidak diam-diam memakai data demo).

Kunci rahasia Supabase hanya boleh ada di backend. Web, Android, gateway, dan firmware tidak boleh menyimpannya.

## Tes

Uji menyeluruh ada di `scripts/uji/` (butuh server memori berjalan di port 3100, kecuali `supabase.mjs`):

```powershell
node scripts/uji/keamanan.mjs                 # matriks otorisasi, isolasi desa, fuzz, sesi
node scripts/uji/peran.mjs                    # alur Desa, Rescue, Pusat di browser Edge (EDGE_PATH bila lokasinya lain)
node scripts/uji/supabase.mjs                 # alur khusus Supabase; MENULIS data uji, jalankan seed --reset sesudahnya
```


```powershell
npm run check   # tipe TypeScript
npm run build
npm run smoke   # menjalankan server memori sendiri dan memeriksa alur utama (232 pemeriksaan)
```

## Untuk tim kalung

Baca bagian **Integrasi Kalung** di [`docs/JAGA.md`](docs/JAGA.md) dan coba `firmware/api-examples.http`. Uji lokal tanpa Supabase: jalankan mode memori di atas, lalu `node scripts/demo-device-keys.mjs` untuk ID dan kunci kalung demo.

## Batas versi saat ini

- Belum ada transport MQTT/LoRa: alarm diambil perangkat lewat polling `inbox` (rencana: antrean keluar untuk gateway).
- Notifikasi push (FCM) dan SMS belum aktif; rute evakuasi hanya estimasi (bukan jaringan jalan); belum ada sinkronisasi offline atau agregasi per provinsi.
- Aturan prioritas masih bobot contoh (dummy) dan harus disahkan JAGA Pusat bersama BPBD, Dinsos, dan organisasi penyandang disabilitas sebelum dipakai di operasi nyata.
- Header `X-JAGA-Role` hanya berlaku bila `JAGA_DEV_ROLE_HEADER=true` (tanpa kredensial; jangan dipakai di produksi).
- Aplikasi Android baru prototipe dan belum pernah dikompilasi; petunjuknya di [`android/README.md`](android/README.md).
