# Status Perbaikan atas Temuan Audit

Acuan: [temuan-audit.md](temuan-audit.md). Verifikasi: `npm run check` (tsc strict) bersih dan `npm run smoke` **51/51 lulus**
(mode memori). Perubahan Supabase dan Android **belum diuji pada lingkungan nyata** (lihat bagian "Belum terverifikasi").

## Sudah diperbaiki

| ID | Perbaikan |
|---|---|
| K1 | Login web memanggil `/api/auth/login`; peran dari sesi server; header peran dihapus dari klien; switcher peran dihapus; 401 → redirect ke login. `buat-akun.html` memanggil `/api/accounts`. |
| K2 | `api-client.js` membuka envelope `{data}`; `app.js` memetakan `counters`; ubah status ke `/status`; tambah warga mengirim `villageId`; alarm mengirim `villageId`/`targetType`, membaca `devicesReached`; SSE membaca `owner_name`. Android: login, Bearer token, parsing daftar, `/status`, `devicesReached`. |
| K3 | `POST /api/device/sos` (kunci perangkat, gateway opsional, deduplikasi SOS terbuka, balasan `SOS_DITERIMA`). |
| K4 | Inbox berbasis `command_receipts` milik perangkat (memuat `receiptId`), receipt QUEUED→SENT saat diambil, status perintah mengikuti receipt; alarm awal `QUEUED`. Transport MQTT/LoRa belum ada (polling inbox). |
| K5 | Memori tidak lagi menjadi cadangan diam-diam (server berhenti; opt-in `JAGA_ALLOW_MEMORY_FALLBACK`); ditolak di produksi; kunci perangkat via query string dihapus; seed Supabase memakai kata sandi acak. Akun/kunci demo tetap ada **hanya di mode memori**. |
| K6 | `teamId` dari body/query; ETA, accept, hapus anggota (via `removeWhere`) berfungsi; `accepted_at` tidak lagi diisi saat penugasan; penugasan ganda → 409. |
| K7 (kode) | `created_at`/`updated_at` hanya untuk tabel yang punya kolomnya; `in` kosong = tidak ada hasil di kedua store; nilai filter di-encode; `remove` komposit; `_sort`, `role`, `created_at` salah dihapus; id UUID untuk organisasi/profil/notifikasi; sesi Supabase membaca `organization_members`; `location` tim diisi; migrasi `202610020001_perbaikan_audit.sql` (hapus trigger riwayat ganda, `location` nullable, indeks). |
| T1–T2 | Snapshot warga dicek lingkupnya (404 bila tidak ada); `audit/recent` hanya PUSAT dan tanpa `before/after`; feed audit hanya PUSAT. |
| T3 | Alarm ke perangkat divalidasi milik desa; tanpa fallback ke semua perangkat (target kosong → 400); filter DUSUN; ZONA ditolak jelas. |
| T4 | Kontrol tim per organisasi (RESCUE) / desa markas (DESA); Rescue tidak mengubah kerentanan/kontak; ack receipt hanya oleh perangkat pemiliknya; daftar penugasan dan override dibatasi lingkup. |
| T5 | Rate limit login (429), `scrypt` asinkron, token dicabut saat logout, peran/status/wilayah dibaca ulang tiap request, cookie `Secure` di produksi, `last_login_at`. |
| T6 | Kategori kerentanan benar (bukan UUID); ambang per rule set dipakai; override hanya untuk rekomendasi yang diubah dan level sistem asli tersimpan; WIB untuk `is_night`; `device_online` dari data perangkat; pemilihan rule set mengutamakan jenis bencana (cadangan ditandai `ruleSetFallback`); RESCUE boleh override (sesuai `JAGA.md`). |
| T7 | Rute GET memakai query (`shelterId`, `accessNotes`) dan default shelter terdekat; zona bahaya memakai `center_latitude/longitude/radius_meters` serta jendela aktif; titik rute divalidasi. |
| T8 | `health`/`config`/`me` memakai `store.kind`; audit disimpan ke store apa pun. |
| T9 | Counter dashboard dihitung dari seluruh warga dalam lingkup; papan prioritas memuat semua insiden aktif; kondisi aman mengikuti insiden terbaru; tim dibatasi lingkup; topeng nama untuk RESCUE juga pada perangkat. |
| S1 | Filter `eq` digabung (`eqFilter`); daftar warga default hanya aktif (`active=all` untuk semua). |
| S2 | Notifikasi memuat `village_id`/`resident_id`, id UUID, update dengan id benar, IN_APP tidak ke Twilio, tanpa N+1; FCM legacy dihapus (belum diintegrasikan, tetap antre). |
| S3 | Koordinat/baterai divalidasi (null tidak jadi 0,0); notifikasi baterai sekali per penurunan dan membawa desa; perangkat LOST/RETIRED ditolak; ID perangkat acak. |
| S4 | Daftar akun sesuai lingkup; sinkron `internal_accounts`; wilayah organisasi ditambah, tidak ditimpa. |
| S5 | Persetujuan (`consented`) wajib eksplisit; tanggal lahir/koordinat divalidasi; simpan kerentanan tidak lagi menghapus sebelum menyimpan dan tahan duplikat; hapus permanen ditolak bila ada riwayat. |
| S7 | Aturan aktif tidak bisa diedit; catatan persetujuan wajib; pemulihan bila simpan aturan/aktivasi gagal; ambang per rule set. |
| S9 (sebagian) | Event tim dikirim hanya ke desa markas. |
| S10 | Cookie/URL rusak tidak lagi 500; 204 tanpa body. |
| S11 | Peta menggambar koordinat nyata (bukan ilustrasi), tanpa data palsu "312 desa", CSP mengizinkan Google Fonts dan tidak lagi unpkg, ikon PWA ditambahkan, tanggal tak valid tidak merobohkan UI. |
| S12 | Android: login, endpoint benar, HTTP hanya ke 10.0.2.2/localhost, polling dengan backoff dan berhenti saat keluar, urutan status per peran, AGP 8.7.3. |
| R1–R2 | Kode duplikat dihapus; `smoke.mjs` ditulis ulang (51 pemeriksaan) + `npm run smoke`; README dan `.env.example` diperbarui (urutan migrasi, variabel lingkungan). |

## Belum diperbaiki / perlu keputusan

- **Belum terverifikasi di lingkungan nyata:** semua perubahan K7 pada Supabase (jalankan migrasi 001 → 002 → 202610020001 di proyek staging, seed, lalu uji alur), dan build Android (belum dikompilasi).
- **Fitur yang memang belum ada:** transport MQTT/LoRa, FCM v1, rute berbasis jaringan jalan, peta interaktif (Leaflet) di web, hierarki provinsi/nasional, cakupan wilayah pada publikasi aturan, UI pengelolaan ambang.
- **S6** mesin status insiden (urutan transisi yang sah) belum dibuat.
- **S8** pagination di sisi database dan batas 1000 baris PostgREST (perlu `range`/count server-side).
- **S9** SSE belum memeriksa kedaluwarsa/pencabutan sesi selama koneksi terbuka.
- **R3** RLS tanpa policy (isolasi tetap di kode aplikasi), `sync_operations` tanpa API; data demo di migrasi 001 masih ada (hapus untuk produksi).
- **Peringatan operasional:** `.env` lokal berisi secret key Supabase asli; pastikan tidak dibagikan. Migrasi 001 berisi data demo.
- Token Supabase (mode `authSource=supabase`) tidak dicabut saat logout karena dikelola Supabase Auth.
