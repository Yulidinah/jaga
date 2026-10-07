# Audit JAGA

Dokumen audit **tunggal**. Audit berikutnya cukup menambah bagian baru di bawah (jangan membuat berkas audit baru) dan
memperbarui tabel "Riwayat audit" serta status di bagian 10.

## Riwayat audit

| # | Tanggal | Fokus | Hasil |
|---|---|---|---|
| 1 | 1 Okt 2026 | Kode, skema, keamanan, kontrak API | 32 temuan (7 Kritis, 9 Tinggi, 12 Sedang, 4 Rendah); sebagian besar sudah diperbaiki (bagian 10) |
| 2 | 2 Okt 2026 | Kesesuaian fitur per role dan logika alur | 27 fitur: 4 ada, 15 sebagian, 8 belum; 12 temuan logika (bagian 11); L5 dan L10 sudah diperbaiki (11.6) |
| 3 | 3 Okt 2026 | Seed, data pilot (Aceh Utara), prioritas penyelamatan | 6 masalah pada seed/mesin, semua diperbaiki (bagian 12) |
| 4 | 5 Okt 2026 | Masuk (login), halaman depan, serah-terima tim kalung | Login terbukti berfungsi di browser; penyebab hampir pasti akun/kata sandi (bagian 14, 15) |

Verifikasi terkini: `npm run check` bersih, `npm run smoke` **174/174 lulus** (mode memori). Perubahan Supabase dan
Android belum diuji di lingkungan nyata.

Legenda label: **[TERBUKTI]** diuji dinamis; **[KODE]** terbaca dari kode/skema, belum diuji.

## 1. Audit #1 (1 Okt 2026): cakupan dan metode

Yang diperiksa: seluruh backend TypeScript (`backend/src`), migrasi SQL Supabase, skrip (`scripts/`), web (HTML/JS/CSS/PWA), aplikasi Android, serta dokumen (`README.md`, `JAGA.md`).

Metode:
1. Membaca seluruh kode dan skema.
2. `npm run check` (tsc strict): **lolos tanpa error**.
3. Menjalankan backend mode memori di tiga server lokal (dev-header mati, dev-header hidup, dan fallback saat Supabase tidak terjangkau), lalu menguji lewat HTTP (±45 pernyataan).

Label status verifikasi:
- **[TERBUKTI]** diuji dinamis dan hasilnya sesuai dugaan.
- **[KODE]** terbaca jelas dari kode/skema, belum diuji dinamis. Hampir semua temuan khusus Supabase masuk di sini karena audit tidak menyentuh basis data asli.

Tidak dicakup: build Android, uji beban, koneksi Supabase nyata, perangkat keras/firmware.

## 2. Ringkasan

**Kesimpulan:** kode lolos type-check, tetapi sistem **belum bisa dipakai end-to-end**. Tiga alur inti dokumen `JAGA.md` (SOS dari kalung, alarm ke kalung, penugasan Rescue) tidak berfungsi, antarmuka web/Android tidak cocok dengan API, dan ada beberapa celah otorisasi serius.

| Tingkat | Jumlah |
|---|---|
| Kritis | 7 |
| Tinggi | 9 |
| Sedang | 12 |
| Rendah | 4 |

Lima hal yang perlu dikerjakan lebih dulu:
1. Login web hanya tampilan; UI memakai header peran `X-JAGA-Role` (K1).
2. Kalung tidak punya jalur mengirim SOS, dan inbox alarm selalu kosong (K3, K4).
3. Akun demo berpassword publik + kunci perangkat yang bisa dihitung dari source, dan fallback diam-diam ke memori (K5).
4. Banyak operasi tulis akan gagal di Supabase karena kolom tidak ada (K7).
5. Kontrak API vs UI/Android tidak cocok sehingga hampir semua layar rusak (K2).

### Yang sudah baik
- `tsc --strict` bersih; tanpa dependensi runtime (hanya devDependencies).
- Password di-hash `scrypt` + `timingSafeEqual`; kunci perangkat/gateway disimpan sebagai hash SHA-256; token HMAC.
- `.env` ter-ignore dan tidak pernah ter-commit (riwayat git 1 commit, tanpa secret).
- Allowlist berkas statis (tidak ada akses `.env`, `backend`, dll.).
- `esc()` dipakai konsisten di `app.js` (tidak ditemukan XSS).
- Override rekomendasi mewajibkan alasan ≥10 karakter dan dicatat; sebagian besar endpoint memeriksa lingkup desa.

## 3. Daftar temuan

| ID | Tingkat | Judul | Status |
|---|---|---|---|
| K1 | Kritis | Web tanpa autentikasi nyata | TERBUKTI |
| K2 | Kritis | UI web & Android tidak cocok dengan API | TERBUKTI |
| K3 | Kritis | Tidak ada jalur SOS dari kalung | TERBUKTI |
| K4 | Kritis | Alarm tidak pernah sampai ke perangkat | TERBUKTI |
| K5 | Kritis | Kredensial/kunci demo publik + fallback diam-diam | TERBUKTI |
| K6 | Kritis | Penugasan tim tidak berfungsi | TERBUKTI |
| K7 | Kritis | Mode Supabase: tulis gagal, sesi tanpa lingkup | KODE |
| T1 | Tinggi | IDOR data warga (`dashboard/resident/:id`) | TERBUKTI |
| T2 | Tinggi | Log audit terbuka lintas wilayah | TERBUKTI |
| T3 | Tinggi | Alarm lintas desa & salah target | TERBUKTI/KODE |
| T4 | Tinggi | Otorisasi longgar (tim, warga, penugasan) | TERBUKTI/KODE |
| T5 | Tinggi | Manajemen sesi lemah | TERBUKTI |
| T6 | Tinggi | Mesin rekomendasi cacat | TERBUKTI/KODE |
| T7 | Tinggi | Rute & zona bahaya tidak berfungsi | TERBUKTI |
| T8 | Tinggi | Status penyimpanan menyesatkan; audit tak tersimpan | TERBUKTI |
| T9 | Tinggi | Angka dashboard salah/bocor | TERBUKTI/KODE |
| S1–S12 | Sedang | Lihat bagian 5 | — |
| R1–R4 | Rendah | Lihat bagian 6 | — |

## 4. Detail temuan Kritis dan Tinggi

### K1. Web tanpa autentikasi nyata
- **Lokasi:** `auth.js:4`, `api-client.js:7`, `app.js:7,164`, `backend/src/auth.ts:200-220`.
- **Masalah:** form login hanya `setTimeout` lalu pindah ke `index.html?role=...`; tidak memanggil `/api/auth/login`. UI mengirim `X-JAGA-Role` dari parameter URL. Peran bisa diganti sendiri lewat menu "Tampilan peran".
- **Bukti:** dengan konfigurasi normal semua panggilan UI → 401. Dengan `JAGA_DEV_ROLE_HEADER=true`, siapa pun jadi PUSAT tanpa kredensial dan mendapat 5 akun lewat `/api/accounts`; peran DESA/RESCUE berlingkup **0 desa** (UI kosong).
- **Saran:** hubungkan form ke `/api/auth/login` (cookie), hapus header peran dari klien, redirect ke login bila 401, hapus switcher peran.

### K2. UI web & Android tidak cocok dengan API
- **Bukti:**
  - Dashboard: UI membaca `onlineDevices`, `devices`, `activeIncidents`, `lastUpdatedAt`; API mengembalikan `counters{...}` → tampil `undefined` (`app.js:34-36`).
  - Daftar (`residents/devices/incidents`) dibungkus dua kali (`{data:{data:[...]}}`), UI memanggil `.slice/.filter` pada objek (`app.js:125-126`) → render gagal. Android `getJSONArray("data")` pada objek (`JagaApi.kt:23`).
  - Ubah status: UI/Android memanggil `PATCH /incidents/:id {status}` yang mengabaikan `status` (200 tapi status tetap NEW); seharusnya `/incidents/:id/status` (`api-client.js:24`, `JagaApi.kt:28`).
  - Tambah warga: tidak mengirim `villageId` → 400 "Desa tidak valid"; `vulnerabilityCodes`/`consented` diabaikan (`app.js:148`).
  - Kirim alarm: tanpa `villageId`, `target:"ALL"` bukan kontrak API, hasil dibaca `result.targetedDevices` (API: `data.devicesReached`) (`api-client.js:20`, `app.js:159`, `JagaApi.kt:33-38`).
  - Realtime: `EventSource` tidak bisa mengirim header (401, tanpa cookie login); handler membaca `ownerName` padahal event berisi `owner_name`.
  - Android tidak mengirim kredensial apa pun pada `GET /incidents` (`JagaApi.kt:22`).
- **Saran:** tetapkan satu kontrak (mis. skema OpenAPI), ratakan envelope `{data}`, perbarui kedua klien.

### K3. Tidak ada jalur SOS dari kalung
- **Lokasi:** `incidents-api.ts:234-239`, `devices-api.ts:242-278`, `README.md` (bagian "Simulasi SOS").
- **Masalah:** `POST /api/sos` hanya untuk sesi DESA/PUSAT. `ingestTelemetry` tidak menafsirkan payload SOS. Tombol SOS di `JAGA.md` tidak punya endpoint.
- **Bukti:** contoh README (`X-JAGA-Role: DEVICE`) → 401, bahkan dengan kunci perangkat+gateway valid.
- **Saran:** tambah `POST /api/device/sos` (auth kunci perangkat/gateway) yang membuat insiden `source=DEVICE`, lalu balas konfirmasi untuk umpan balik ke kalung.

### K4. Alarm tidak pernah sampai ke perangkat
- **Lokasi:** `devices-api.ts:290`, `alerts-api.ts:84,97`, `config.ts` (MQTT hanya flag).
- **Masalah:** inbox memfilter `isNull: {expires_at: true}` padahal setiap alarm punya `expires_at` → selalu kosong. Respons inbox tidak memuat `receiptId` (perangkat tak bisa meng-ACK), tidak memfilter menurut target/receipt perangkat. MQTT tidak diimplementasi (hanya `mqttConfigured`). Alarm langsung berstatus `SENT` sebelum ada pengiriman.
- **Bukti:** alarm EVAKUASI dibuat (`devicesReached=5`), inbox perangkat sasaran `commands=0`.
- **Saran:** ambil `command_receipts` milik perangkat (status SENT/QUEUED, belum kedaluwarsa), sertakan `receiptId`; status `SENT` hanya setelah transport mengonfirmasi.

### K5. Kredensial/kunci demo publik + fallback diam-diam
- **Lokasi:** `seed.ts:10-47,530,564,920`, `store-boot.ts:33-40`, `scripts/seed-supabase.mjs:169-200`.
- **Masalah:** akun `pusat@jaga.id / JagaPusat2026!` dst. ada di source. Kunci perangkat/gateway = `sha256(id:email)` sehingga bisa dihitung siapa pun. Bila Supabase tidak terjangkau saat start, server **diam-diam** memakai memori + data demo, sehingga akun demo aktif. `seed-supabase.mjs` membuat user Supabase Auth dengan password itu dan mencetaknya.
- **Bukti:** server dengan Supabase mati → login admin demo 200; kunci hasil hitung diterima `/api/device/inbox`.
- **Saran:** muat seed hanya bila `NODE_ENV=development`/flag eksplisit; di produksi gagal-start bila DB tidak ada; password/kunci acak per-seed dan tidak dicetak ke repo; paksa ganti password.

### K6. Penugasan tim tidak berfungsi
- **Lokasi:** `teams-api.ts:236,197,288,159,248`.
- **Masalah:** `assignTeam` memakai `param(ctx,"teamId")` padahal rute `/incidents/:id/assignments` tak punya `:teamId`; `teamEta` memakai `param("incidentId")`; `acceptAssignment` memakai `param("teamId")` pada rute `:id` → semua 400. `removeTeamMember` memanggil `store.remove(table, {objek})` → no-op (memori) / error (Postgres). `accepted_at` sudah diisi saat penugasan, jadi "accept" tidak punya target.
- **Bukti:** assign/eta/accept → 400; DELETE anggota → 200 tetapi anggota tetap ada.
- **Saran:** baca `teamId` dari body/query, perbaiki `remove` komposit (gunakan `removeWhere`), biarkan `accepted_at` null sampai tim menerima.

### K7. Mode Supabase: tulis gagal dan sesi tanpa lingkup — [KODE]
- `PostgrestStore` menambah `created_at` pada **semua** insert (`store-postgrest.ts:120,132,143`) dan `updated_at` pada semua update (`:158`). Tabel tanpa `created_at`: `organization_service_areas`, `resident_vulnerabilities`, `resident_contacts`, `device_assignments`, `device_telemetry`, `rescue_team_members`, `incident_assignments`, `team_location_history`, `command_receipts`, `assessment_factors`. Tabel tanpa `updated_at` yang di-update: `device_assignments`, `incident_assignments`, `command_receipts`, `priority_recommendations`, `priority_rule_sets` (publish aturan gagal), `alert_commands`, `notifications`, `resident_contacts`. PostgREST menolak kolom tak dikenal (PGRST204) → pasang kalung, buat alarm, telemetri, tambah kontak, tugaskan tim, publish aturan gagal.
- Kolom/ID lain yang tidak cocok: `_sort` pada `resident_vulnerabilities` (`residents-api.ts:304`; terjadi **setelah** delete, jadi data kerentanan hilang); `role` pada `organization_members` (`auth-api.ts:206`, meninggalkan user Auth yatim); `created_at` pada `organization_service_areas` (`auth-api.ts:211`); `team_location_history.location NOT NULL` tak diisi (`teams-api.ts:177`); `priority_thresholds.rule_set_id NOT NULL` tak diisi (`rulesets-api.ts:222`); id `organizations` dan `notifications` berupa token acak non-UUID (`auth-api.ts:172`, `audit.ts:74`).
- `profiles` tidak punya `organization_id`/`village_ids`, sedangkan `sessionFromProfile` hanya membacanya (`auth.ts:68-92`) → semua akun DESA/RESCUE Supabase berlingkup **kosong** (tidak melihat data apa pun). `organization_members` tak pernah dibaca saat login.
- Trigger `record_incident_status_change` (`001.sql:512`) + insert manual `incident_status_history` → riwayat ganda.
- `internal_accounts` tidak ada di DB → login salah password berujung 502, bukan 401 (`auth.ts:128`).
- `verify-schema.mjs` tidak menangkap ini (regex tidak membaca `[{...}]` dan kolom otomatis).
- **Saran:** hapus penambahan `created_at/updated_at` otomatis (pakai default/trigger DB), selaraskan skema dan kode, tambah migrasi untuk kolom yang kurang, uji terhadap proyek Supabase staging.

### T1. IDOR data warga
- **Lokasi:** `dashboard-api.ts:337-350` (tanpa `assertVillageAccess`).
- **Bukti:** akun DESA mendapat nama, risk flags, insiden dan perangkat warga desa lain (200), sedangkan `/api/residents/:id` benar menolak (403). Warga tak ada → 200 `null`.
- **Saran:** terapkan pemeriksaan lingkup; 404 bila tidak ada.

### T2. Log audit terbuka lintas wilayah
- **Lokasi:** `index.ts:142`, `dashboard-api.ts:306`, `audit.ts`.
- **Bukti:** akun RESCUE membaca 100 entri audit global (termasuk `before_data/after_data`, yang bisa memuat data pribadi warga). `activityFeed` juga menampilkan ringkasan audit semua desa.
- **Saran:** batasi ke PUSAT (atau filter menurut lingkup) dan jangan ekspos `before/after` ke klien.

### T3. Alarm lintas desa dan salah target
- **Lokasi:** `alerts-api.ts:141,144-147,155`.
- **Bukti [TERBUKTI]:** DESA desa-A memicu perangkat milik desa lain lewat `targetType=PERANGKAT` (`devicesReached=1`).
- **Kode:** `KELOMPOK_RENTAN` tanpa warga cocok jatuh ke "semua perangkat desa" (alarm ke semua orang); `DUSUN` mengabaikan dusun (seluruh desa); `ZONA` menghasilkan 0 perangkat tapi tetap berstatus SENT.
- **Saran:** validasi perangkat milik `villageId`; target kosong → tolak (400), jangan fallback; implementasikan filter dusun/zona.

### T4. Otorisasi longgar
- **Kode:** `updateTeam/setTeamStatus/addTeamMember/removeTeamMember/reportTeamPosition/teamTrail/getTeam` tidak memeriksa organisasi/lingkup, sehingga RESCUE mana pun dapat mengubah, memalsukan posisi, atau menambah anggota tim lain (`teams-api.ts:102-192`). `saveVulnerabilities`, `addContact`, `deleteContact` tidak membatasi peran, padahal buat/ubah warga melarang RESCUE (`residents-api.ts:279-350`). `acknowledgeAlert` publik tidak mengecek bahwa receipt milik perangkat pemanggil (`alerts-api.ts:176-195`). `listOverrides` tidak dibatasi desa (`rulesets-api.ts:273`).
- **Bukti [TERBUKTI]:** `GET /api/assignments` oleh DESA mengembalikan penugasan di luar desanya (1 dari 4).

### T5. Manajemen sesi lemah — [TERBUKTI]
- Login tanpa rate limit/lockout (25 percobaan salah semuanya 401, tidak ada 429); `scryptSync` memblokir event loop sehingga mudah di-DoS (`lib.ts:62-73`).
- Logout tidak mencabut token; Bearer lama tetap 200 sampai 12 jam.
- Peran/lingkup ditanam di token: akun yang diturunkan perannya tetap berperan lama sampai token habis (`auth.ts:186-198`). Akun nonaktif masih bisa login (hanya request berikutnya 401).
- Cookie tanpa `Secure` secara default (`config.ts:23`); `expiresAt` sesi dihitung ulang tiap request (tidak mencerminkan kedaluwarsa).
- Kunci perangkat/gateway boleh lewat query string (`auth.ts:278-279`) → bocor di log.
- **Saran:** rate limit + `scrypt` async, daftar token dicabut/versi sesi, baca peran dari DB per request, `Secure` default di produksi, hanya terima kunci di header.

### T6. Mesin rekomendasi cacat
- **Faktor kerentanan berisi UUID** bukan kategori (`recommend.ts:203`; baris kerentanan tidak punya `category`). Bukti: `vulnerability_categories=["6a00...02"]`, `is_disabled=false` untuk warga disabilitas. Aturan `IN ["LANSIA"]`, `is_pregnant`, `mobility_limited` tak pernah cocok → skor kerentanan tidak bekerja.
- **Ambang diabaikan:** `levelForScore` memakai angka tetap (`recommend.ts:15-23`); `/api/thresholds` tidak berpengaruh (diuji: ambang diubah, level tetap).
- **Override basi:** override terakhir diterapkan selamanya pada kalkulasi berikutnya, dan `suggested_level` yang disimpan sudah berisi level override sehingga level asli sistem hilang (`recommend.ts:181-188`, `incidents-api.ts:373-396`) → merusak transparansi yang dijanjikan `JAGA.md`.
- `is_night` memakai jam zona waktu server, bukan WIB (`recommend.ts:229`); `device_online` selalu salah karena tabel telemetri tak punya kolom `online` (`:235`); `activeRuleSet` bisa jatuh ke aturan bencana lain dan mengutamakan versi tertinggi dibanding yang spesifik (`:271-277`).
- Kata kunci akses mengabaikan negasi ("tidak banjir" tetap dinilai banjir) (`geo.ts:56-64`).

### T7. Rute dan zona bahaya tidak berfungsi — [TERBUKTI]
- `GET /incidents/:id/routes` membaca `shelterId`/`accessNotes` dari body padahal GET tanpa body → tujuan = asal, `fastest.distanceMeters = 0` (`incidents-api.ts:452-468`).
- Zona bahaya tak pernah dikenali: `distanceToZone` membaca `zone.center`, tetapi baris DB memakai `center_latitude/center_longitude/radius_meters` (`geo.ts:98-104`). Diuji dengan SOS tepat di pusat zona risiko 5 → `hazards: []`. `isZoneActive` juga mengabaikan `active_from/until` (`geo.ts:93-96`).
- "Rute" hanya garis lurus × faktor, dengan belokan sintetis; tidak ada jaringan jalan (sudah dinyatakan di respons, tetapi `JAGA.md` menjanjikan rute tercepat/efektif).

### T8. Status penyimpanan menyesatkan; audit tak tersimpan
- `/api/health`, `/api/config`, `/api/auth/me`, log server memakai `supabaseEnabled` (dari env), bukan `store.kind` (`index.ts:19-32`, `server.ts:215`, `config.ts:40`). **Bukti:** server yang jatuh ke memori melaporkan `"storage":"supabase"`.
- `record()` hanya menulis `audit_logs` bila `supabaseEnabled` (`audit.ts:36`); di mode memori hanya ring buffer 300 entri → `/incidents/:id/audit` selalu kosong (terbukti), dan audit hilang saat restart. `ip_address`/`user_agent` selalu null.
- **Saran:** pakai `store.kind`; health memeriksa `store.ping()`; simpan audit ke store apa pun.

### T9. Angka dashboard salah/bocor
- `overview` menghitung perangkat terpasang, warga ber-kalung, dan warga rentan hanya dari warga yang punya insiden (`dashboard-api.ts:32-47`). **Bukti:** terpasang sebenarnya 16/17, dashboard "tidak terpasang" = 11, "warga ber-kalung" = 6.
- `in` dengan array kosong berperilaku **berlawanan** antar-store: memori → tidak ada hasil, PostgREST → filter dibuang sehingga semua baris dikembalikan (`store-postgrest.ts:32` vs `store-memory.ts:68`). Di Supabase, DESA tanpa insiden akan menghitung penugasan seluruh nasional (`dashboard-api.ts:33,262`).
- `priorityBoard` hanya memuat status `NEW` (`dashboard-api.ts:211`); insiden yang sudah diakui/ditugaskan hilang dari papan (terbukti).
- `safetySummary`: satu insiden SAFE di masa lalu membuat warga "sudah aman" selamanya dan menutupi insiden aktif baru (`:273-281`). `teams` tidak dibatasi lingkup.

## 5. Temuan Sedang

**S1. Filter `eq` saling menimpa [TERBUKTI].** Spread ganda menimpa kunci `eq` (`devices-api.ts:31-35`, `incidents-api.ts:50-54`, `residents-api.ts:98-102`). Contoh: `status=STOCK&villageId=...` mengembalikan 6 (status diabaikan, benar 1); `villageId+active=true` menghasilkan 16 (filter desa hilang, benar 2). `listResidents` juga menyertakan warga nonaktif secara default.

**S2. Notifikasi.** `notify()` tidak menulis `village_id`/`resident_id` sehingga notifikasi alarm tak terlihat oleh DESA (0 vs 18 untuk PUSAT) [TERBUKTI] (`audit.ts:80-91`). `store.update("notifications", {eq:..}, ...)` memakai objek sebagai id (`audit.ts:110,122,128`) → status SENT tak pernah tersimpan dan pengiriman FCM yang sukses dilaporkan gagal. Endpoint FCM legacy `fcm/send` sudah dimatikan Google; ganti ke HTTP v1. Kanal `IN_APP` dikirim ke Twilio (`audit.ts:78`); tujuan PUSH adalah `resident.id`, bukan token (`alerts-api.ts:107`). `profile_id` diisi pengirim, bukan penerima. N+1 `loadSupportProfile` per warga (`alerts-api.ts:102-103`).

**S3. Perangkat dan telemetri.**
- `latitude: null` pada telemetri menjadi koordinat 0,0 (`Number(null)=0`) [TERBUKTI]; `battery` NaN lolos; tidak ada validasi rentang (`devices-api.ts:245-247`).
- Notifikasi baterai ≤10% dibuat setiap telemetri (spam) dan tanpa `village_id` (`:266-275`).
- Semua rute `/api/device/*` mewajibkan kunci perangkat **dan** gateway (`server.ts:157-163`).
- Perangkat berstatus LOST/RETIRED tetap bisa autentikasi (`auth.ts:277-288`); tidak ada retensi `device_telemetry`.
- ID perangkat otomatis `JAGA-<6 digit waktu>` rawan bentrok (`devices-api.ts:65`); `createDevice` tidak memvalidasi desa/rentang.

**S4. Akun.** `listAccounts`: DESA mendapat 0 akun di mode internal (membandingkan `organization_id` dengan id desa) [TERBUKTI]; di mode Supabase DESA melihat semua profil (`auth-api.ts:87-115`). `updateAccount` tidak menyinkronkan `internal_accounts` (peran/email). `createAccount` pada organisasi yang sudah ada menimpa seluruh `organization_service_areas` organisasi itu (`auth-api.ts:208`, [KODE]); `mustChangePassword` tak pernah ditegakkan; `last_login_at` tak diperbarui; tidak ada pengaman menonaktifkan diri/PUSAT terakhir.

**S5. Data warga dan privasi.** `consented_at` diisi otomatis tanpa persetujuan nyata (`residents-api.ts:198`), padahal data disabilitas/medis adalah data pribadi spesifik (UU PDP) dan formulir UI hanya checkbox. `birth_date` tidak divalidasi; update koordinat tanpa validasi rentang (`:229-237`). `saveVulnerabilities` delete-lalu-upsert tidak atomik dan gagal bila ada duplikat (`:293-307`). Hard delete bisa gagal FK untuk warga yang punya insiden tertutup (`:256-261`). `mapData` menyamarkan nama untuk RESCUE tetapi `devices[].ownerName` dan `incidents[].ownerName` membocorkannya (`dashboard-api.ts:143-165`).

**S6. Status insiden dan tim.** Tidak ada mesin status (NEW→SAFE langsung, mundur ARRIVED→NEW diizinkan) (`incidents-api.ts:241-277`); bentuk respons berbeda saat status sama. `unassignTeam` mengembalikan tim ke AVAILABLE berdasarkan penugasan *insiden*, bukan penugasan tim (`teams-api.ts:275-279`). Status insiden dan status tim tidak disinkronkan.

**S7. Rule set.** `allowEditingActive` mengubah aturan aktif di tempat sehingga rekomendasi lama tak bisa direproduksi (`rulesets-api.ts:105`); catatan persetujuan punya default otomatis (`:160`); ambang global tanpa versi dan hapus-lalu-insert tak atomik (`:217-228`); tidak ada cakupan wilayah publikasi aturan (lihat bagian 7).

**S8. Skala.** Backend memuat seluruh tabel lalu `slice` di memori (warga, perangkat, insiden); `listIncidents` memuat semua warga dalam lingkup (`incidents-api.ts:62`); N+1 di `resolveResidents` dan `collectFactors`; `limit` PostgREST dipotong 1000 secara diam-diam (`store-postgrest.ts:52`, ditambah batas Supabase) → data nasional terpotong tanpa peringatan; `listNotifications` mengambil 200 baris lalu menyaring (`alerts-api.ts:216-220`).

**S9. Realtime.** `publish` tanpa `villageId` (posisi tim, status tim, publikasi aturan) dikirim ke semua pelanggan (`realtime.ts:33-37`, `teams-api.ts:121,135,185`). Koneksi SSE tidak mengecek kedaluwarsa/pencabutan sesi; heartbeat menulis tanpa pengaman (`realtime.ts:49`).

**S10. Parsing HTTP [TERBUKTI].** Cookie berformat salah atau path `%E0%A4%A` memicu `URIError` → 500 (`lib.ts:144`, `router.ts:67`). Handler yang mengembalikan `undefined` mengirim 204 dengan body (`router.ts:119`, `lib.ts:21-29`).

**S11. Web lain.**
- Peta hanyalah ilustrasi CSS dengan 4 pin acak; tombol "Arahkan" hanya toast (`app.js:27-30,142`). Tidak ada peta nyata walau CSP mengizinkan unpkg.
- Teks tetap: "DESA SUKAMAJU · KAB. GARUT", "Wilayah demo = 1"; halaman login memuat statistik palsu "312 desa · 17.891 perangkat" (`login.html:14`).
- `buat-akun.html` menampilkan "Akun berhasil dibuat / undangan dikirim" tanpa memanggil API (`auth.js:5`).
- CSP memblokir Google Fonts (tidak ada di `style-src`/`font-src`) [TERBUKTI]; `script-src https://unpkg.com` terlalu longgar (mengizinkan paket apa pun).
- `manifest.webmanifest` tanpa ikon sehingga tidak bisa dipasang sebagai PWA; service worker hanya men-cache shell, tidak ada mode offline data.
- `fmtDate` pada nilai tanggal tak valid melempar `RangeError` dan merobohkan render.

**S12. Android.**
- Endpoint salah, tanpa autentikasi, role dipilih di klien (`MainActivity.kt:30,78`), `usesCleartextTraffic="true"` (`AndroidManifest.xml:9`), `baseUrl` terkunci ke emulator.
- `advance` melompati ASSIGNED dan memetakan semua sisanya ke CLOSED, yang ditolak backend untuk RESCUE (`MainActivity.kt:44-47`).
- Polling `while(true)` tiap 5 detik tanpa backoff (`:35`); izin `POST_NOTIFICATIONS` diminta tetapi tidak dipakai; tanpa FCM, peta, jejak, atau gradle wrapper/ikon.
- AGP 8.5.2 dengan `compileSdk 35` memunculkan peringatan (AGP 8.6+ untuk SDK 35).

## 6. Temuan Rendah

- **R1. Kode mati/duplikat:** `rotateDeviceKey`/`rotateGatewayKey` ganda di `auth-api.ts:302-330` (rute memakai versi `devices-api.ts`); `nowMs`, `whoami`, `simulateLive`, `serializeSession`, `void config;` (`store-boot.ts:20,39`); parameter `at` tak terpakai di `isZoneActive`.
- **R2. Proses dan dokumentasi:**
  - Tidak ada tes otomatis. `scripts/smoke.mjs` usang: port 3100, rute salah (`/auth/session`, `/route`, `/assessment`, `/rulesets/active`, `/audit`, `/rotate-key`) dan tidak memahami envelope `{data}`.
  - `verify-schema.mjs` memakai path absolut `D:/LOMBA/...` dan melewatkan insert berbentuk array.
  - README hanya menyuruh menjalankan migrasi pertama (migrasi kedua wajib); `.env.example` tidak memuat `SESSION_SECRET`, `SUPABASE_ANON_KEY`, `SECURE_COOKIE`, `JAGA_DEV_ROLE_HEADER`, `JAGA_FORCE_MEMORY`.
  - Migrasi 1 memuat data demo (nama warga, perangkat) dan tidak idempoten (`create type` tanpa guard) — berisiko di produksi.
  - Perubahan `JAGA_FORCE_MEMORY` di `store-boot.ts` belum di-commit dan tidak terdokumentasi; `.env` lokal mengaktifkannya sehingga Supabase sebenarnya tidak terpakai.
  - Tanpa `engines` (butuh Node yang mendukung `--env-file-if-exists`), path statis bergantung `process.cwd()`.
- **R3. Arsitektur:** RLS aktif tanpa policy dan backend memakai service key, jadi seluruh isolasi bergantung pada kode aplikasi (satu celah = kebocoran penuh; lihat T1–T4). `sync_operations` dan `residents.location` tidak dipakai. Backend memakai secret key untuk grant password Supabase bila anon key kosong (`auth.ts:97`).
- **R4. `/api/config` publik** membuka flag internal (dev header aktif, MQTT/push/SMS terkonfigurasi) tanpa autentikasi (`index.ts:25-32`).

## 7. Kesenjangan terhadap `JAGA.md`

| Janji dokumen | Kondisi |
|---|---|
| Hierarki desa → provinsi → nasional | Lingkup hanya per desa; tidak ada peran/level provinsi atau kabupaten |
| Alarm menyala di tiap rumah | Tidak sampai ke perangkat (K4); tanpa LoRa/MQTT |
| Kalung SOS → gateway → backend → konfirmasi ke kalung | Tidak ada endpoint SOS perangkat atau umpan balik (K3) |
| Rescue berhak mengubah urutan rekomendasi (dengan alasan, tercatat) | API menolak RESCUE (403) pada override (`incidents-api.ts:418`) |
| Rekomendasi transparan dan diperbarui saat kondisi berubah | Faktor kerentanan rusak, level asli hilang setelah override (T6) |
| Aturan berlaku untuk wilayah tertentu, diuji sebelum publikasi | Tidak ada cakupan wilayah; aturan aktif bisa diedit di tempat |
| Peta terintegrasi, jejak pencarian, rute tercepat, area rawan berwarna | Peta tiruan di web; jejak hanya API; rute garis lurus; zona bahaya tak terdeteksi (T7) |
| Pemantauan nasional dan status evakuasi | Angka dashboard salah (T9) |
| Audit setiap keputusan | Audit tak tersimpan di mode memori, terbuka lintas wilayah (T2, T8) |

## 8. Urutan perbaikan yang disarankan

1. **Keamanan dasar:** K1, K5, T1, T2, T3, T4, T5 (relatif kecil, dampak besar).
2. **Fondasi data:** K7 dan T8 (pilih satu sumber kebenaran skema; hapus `created_at/updated_at` otomatis; uji di Supabase staging).
3. **Alur inti:** K3, K4, K6 (endpoint SOS perangkat, inbox berbasis receipt, perbaikan parameter tim).
4. **Kontrak API dan klien:** K2 (definisikan skema respons, perbarui web dan Android).
5. **Kebenaran rekomendasi/dashboard:** T6, T7, T9, S1.
6. **Pengerasan dan kualitas:** S2–S12, tes otomatis (ganti `smoke.mjs`), CI, dokumentasi (R2).

## 9. Catatan reproduksi

Verifikasi dinamis memakai `JAGA_FORCE_MEMORY=true` (tidak menyentuh Supabase) pada port lokal, dengan skrip `fetch` sementara. Temuan berlabel [KODE] sebaiknya diverifikasi ulang setelah perbaikan, terutama di Supabase staging.

## 10. Status perbaikan audit #1

### Sudah diperbaiki

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

### Belum diperbaiki / perlu keputusan

- **Belum terverifikasi di lingkungan nyata:** semua perubahan K7 pada Supabase (jalankan migrasi 001 → 002 → 202610020001 di proyek staging, seed, lalu uji alur), dan build Android (belum dikompilasi).
- **Fitur yang memang belum ada:** transport MQTT/LoRa, FCM v1, rute berbasis jaringan jalan, peta interaktif (Leaflet) di web, hierarki provinsi/nasional, cakupan wilayah pada publikasi aturan, UI pengelolaan ambang.
- **S6** mesin status insiden (urutan transisi yang sah) belum dibuat.
- **S8** pagination di sisi database dan batas 1000 baris PostgREST (perlu `range`/count server-side).
- **S9** SSE belum memeriksa kedaluwarsa/pencabutan sesi selama koneksi terbuka.
- **R3** RLS tanpa policy (isolasi tetap di kode aplikasi), `sync_operations` tanpa API; data demo di migrasi 001 masih ada (hapus untuk produksi).
- **Peringatan operasional:** `.env` lokal berisi secret key Supabase asli; pastikan tidak dibagikan. Migrasi 001 berisi data demo.
- Token Supabase (mode `authSource=supabase`) tidak dicabut saat logout karena dikelola Supabase Auth.

## 11. Audit #2 (2 Okt 2026): kesesuaian fitur dan logika

Acuan: daftar fitur per role (JAGA Pusat, JAGA Desa, JAGA Rescue) dan alur di [JAGA.md](JAGA.md). Penilaian dari kode setelah
perbaikan audit #1. **Ada** = berfungsi dari ujung ke ujung (API + UI); **Sebagian** = ada di backend/API tetapi UI atau
logikanya belum lengkap; **Belum** = tidak ada.

### 11.1 JAGA Pusat

| # | Fitur | Status | Catatan |
|---|---|---|---|
| 1 | Login dan manajemen akun | Sebagian | Buat/ubah akun Desa dan Rescue lewat API dan `buat-akun.html`. Tidak ada UI daftar/ubah/nonaktifkan akun; hak akses hanya 3 role tetap (tidak bisa diatur per fitur). |
| 2 | Dashboard agregat nasional/provinsi | Sebagian | Counter nasional ada. Tidak ada pengelompokan per provinsi/kabupaten walau tabel `provinces/regencies/districts` ada. Riwayat kejadian lintas wilayah hanya lewat daftar insiden. |
| 3 | Monitoring status desa (aktif, sinkron terakhir) | Belum | `villages.active` ada tetapi tidak ada endpoint; tidak ada pencatatan waktu sinkron (`sync_operations` tanpa API). |
| 4 | Laporan dan ekspor | Belum | Tidak ada endpoint/UI laporan atau ekspor CSV/PDF. |
| 5 | Pengaturan platform, manajemen versi | Belum | Hanya `/api/config` (baca saja). |
| 6 | Panel tata kelola data sensitif | Sebagian | Pembatasan per desa dan penyamaran nama di peta untuk Rescue ada. Tidak ada panel pengaturan akses/berbagi data (Dinsos/BPS); `national_id_encrypted` tidak dipakai. |
| 7 | Broadcast ke seluruh tim Desa | Belum | Alarm hanya menuju perangkat; notifikasi IN_APP per desa. Tidak ada pengumuman Pusat → Desa. |
| 8 | Log audit | Sebagian | Pencatatan dan `GET /api/audit/recent` (PUSAT) ada. Menu "Log audit" di UI tidak punya halaman sendiri. |

### 11.2 JAGA Desa

| # | Fitur | Status | Catatan |
|---|---|---|---|
| 1 | Login multi-user | Ada | Banyak akun per organisasi, sesi bersamaan. |
| 2 | Manajemen data warga | Sebagian | API tambah/ubah/nonaktifkan/hapus + kerentanan + kontak lengkap. UI hanya "tambah"; tidak ada ubah/hapus. |
| 3 | Dashboard status bahaya real-time (Normal/Waspada/Siaga/Awas) dari JAGA Sense | Belum | Tidak ada integrasi sensor/JAGA Sense dan tidak ada status siaga desa saat ini. Tingkatnya pun berbeda (lihat L2). |
| 4 | Panel trigger alarm manual | Ada | Target: seluruh desa, perangkat, dusun, kelompok rentan (API). UI menawarkan seluruh desa atau satu perangkat; ada konfirmasi manusia. |
| 5 | Papan status tiap warga | Sebagian | Ada data receipt alarm, SOS, dan status insiden, tetapi tidak ada papan per warga yang menggabungkan "alarm terkirim–belum respons / butuh bantuan / aman". Hanya ringkasan agregat. |
| 6 | Hubungi/kerahkan Rescue dengan lokasi dan prioritas | Sebagian | Lihat L1: tombol "Kerahkan" hanya mengubah status, tidak memilih tim, dan API penugasan tidak boleh dipakai role DESA. |
| 7 | Monitor kesehatan device | Sebagian | Baterai, koneksi, sinyal terakhir ada. Notifikasi baterai lemah ada (sekali per penurunan); notifikasi device offline belum ada. Offline kini dihitung dari sinyal terakhir (L5, sudah diperbaiki). |
| 8 | Indikator mode offline/sinkronisasi | Belum | Tidak ada antrean lokal maupun sinkronisasi; service worker hanya menyimpan cangkang halaman. |
| 9 | Riwayat kejadian | Ada | Daftar insiden, riwayat status, dan riwayat alarm. |
| 10 | Peta lokasi warga | Sebagian | Titik koordinat nyata, tetapi bukan peta (tanpa ubin/jalan/zona). |

### 11.3 JAGA Rescue

| # | Fitur | Status | Catatan |
|---|---|---|---|
| 1 | Login berbasis organisasi | Ada | Akun terikat organisasi dan wilayah layanan. |
| 2 | Feed notifikasi real-time terurut prioritas | Sebagian | Real-time lewat SSE ada. Daftar di UI diurutkan menurut waktu, bukan `/api/dashboard/priorities` (L7). Tidak ada objek "permintaan bantuan" dari Desa (L1). |
| 3 | Peta prioritas berkode warna + overlay zona sulit | Sebagian | `/api/dashboard/map` memuat zona bahaya dan tingkat akses, tetapi UI tidak menggambar zona dan warna hanya merah (SOS) / hijau (warga). |
| 4 | Rekomendasi dan navigasi rute (offline) | Sebagian | Estimasi rute (garis lurus × kesulitan akses) di API; UI membuka Google Maps (butuh internet). Tidak offline, tanpa jaringan jalan. |
| 5 | Pelacakan jejak pencarian | Sebagian | API posisi dan jejak per tim ada. Tidak ada klien yang mengirim posisi berkala, tidak ada penanda "area sudah ditelusuri" yang dibagikan, tidak ada UI. |
| 6 | Update status warga (ditemukan/dievakuasi, belum ditemukan, tidak terjangkau) | Sebagian | Status dievakuasi/aman ada dan tersinkron ke Desa lewat SSE. Status "belum ditemukan" dan "tidak terjangkau" tidak ada (L3). |
| 7 | Koordinasi antar-tim | Sebagian | Posisi tim ada di `/api/dashboard/map`; tidak ditampilkan di UI. |
| 8 | Cache peta offline | Belum | Tidak ada peta maupun cache ubin. |
| 9 | Laporan pasca-operasi | Belum | Hanya catatan `resolution_notes` saat status berubah; tidak ada entitas/endpoint laporan. |

Ringkasan: dari 27 fitur, **4 ada, 15 sebagian, 8 belum**. Fondasi data dan API sudah kuat; kesenjangan terbesar ada di UI,
sinkronisasi offline, peta, dan fitur tata kelola Pusat.

### 11.4 Ketidaksesuaian logika alur

| ID | Tingkat | Temuan | Saran |
|---|---|---|---|
| L1 | Tinggi | **Alur "kerahkan Rescue" terputus.** `JAGA.md`: Desa memvalidasi lalu meminta bantuan, komandan Rescue memilih tim. Di kode tombol "Kerahkan" (UI) hanya mengubah status insiden menjadi ASSIGNED tanpa tim; endpoint penugasan hanya untuk PUSAT/RESCUE; tidak ada objek "permintaan bantuan" dan tidak ada notifikasi khusus ke organisasi Rescue. Akibatnya status ASSIGNED bisa terjadi tanpa tim sama sekali. [KODE] | Tambah `POST /incidents/:id/request-rescue` (status REQUESTED, catat prioritas dan lokasi, notifikasi ke Rescue di wilayah itu). Penugasan tim tetap oleh Rescue; larang DESA mengisi ASSIGNED. |
| L2 | Sedang | **Tiga skala "tingkat" berbeda tanpa satu definisi.** Alarm/insiden memakai WASPADA/SIAGA/EVAKUASI; rekomendasi memakai PANTAU/SEGERA_TINJAU/RESPONS_CEPAT/DARURAT; spesifikasi meminta Normal/Waspada/Siaga/Awas untuk status bahaya desa (yang tidak ada). | Definisikan tingkat bahaya desa (Normal/Waspada/Siaga/Awas) sebagai status desa, dan petakan eksplisit ke tingkat alarm dan level prioritas. |
| L3 | Sedang | **Status warga di lapangan tidak lengkap.** Siklus insiden tidak punya "belum ditemukan" dan "tidak terjangkau", padahal diminta Rescue. | Tambah status (migrasi enum `incident_status`) dan tampilkan di dashboard Desa. |
| L4 | Tinggi | **Perangkat hemat baterai vs polling.** JAGA Rumah dirancang aktif hanya saat dipicu lewat LoRa, tetapi API mengharuskan perangkat menarik (polling) `/api/device/inbox`. Polling rutin menguras baterai dan tidak sesuai desain LoRa. | Tambah antrean keluar untuk gateway (`GET /api/gateway/outbox`: perintah semua perangkat di desanya) agar gateway yang polling dan meneruskan lewat LoRa; perangkat hanya menerima downlink. |
| L5 | Tinggi | **Perangkat tidak pernah menjadi offline.** `online` hanya diubah menjadi true; tidak ada yang menurunkannya, sehingga dashboard memuji kalung yang mati. **Diperbaiki:** status dihitung dari `last_seen_at` dengan ambang `DEVICE_OFFLINE_MINUTES` (default 15); dipakai di daftar perangkat, dashboard, peta, dan faktor rekomendasi. Notifikasi offline masih belum. | Tambah pekerjaan berkala yang membuat notifikasi saat perangkat berpindah ke offline. |
| L6 | Rendah | **Tingkat provinsi/kabupaten belum ada.** Tingkat nasional adalah JAGA Pusat (sudah ada, melihat semua wilayah) dan tingkat desa sudah ada. Yang belum: agregasi per provinsi/kabupaten (tabel wilayah ada tetapi `villages` belum terhubung ke `district_id`) dan, bila diperlukan, akun admin tingkat provinsi dengan lingkup wilayah. | Hubungkan desa ke kabupaten/provinsi, tambah endpoint agregat per wilayah; akun provinsi opsional (Pusat dengan lingkup). |
| L7 | Rendah | **Urutan feed Rescue bukan prioritas.** Papan prioritas (`/dashboard/priorities`) ada tetapi UI tidak memakainya. | UI Rescue memakai endpoint prioritas. |
| L8 | Sedang | **Menu menjanjikan lebih dari isinya.** Menu Pusat "Laporan operasi", "Log audit", "Tata kelola data", dan menu Rescue "Jejak pencarian", "Koordinasi tim" membuka halaman ringkasan generik atau peta yang sama. | Sembunyikan menu yang belum ada, atau beri label "segera hadir". |
| L9 | Sedang | **Sinkronisasi/offline hanya klaim.** Fitur Desa #8, Rescue #4/#8, dan Pusat #3 bergantung pada sinkronisasi offline, tetapi tidak ada antrean lokal, API sinkron, maupun cache data (tabel `sync_operations` tidak dipakai). | Rancang protokol sinkron (id operasi klien, resolusi konflik) sebelum membangun UI-nya. |
| L10 | Tinggi | **Rescue membaca seluruh warga terdaftar di wilayah layanannya kapan saja.** **Diperbaiki (3 Okt 2026)** dengan akses berbasis operasi, sesuai keputusan pemilik proyek: lihat 11.6. | Selesai di backend dan UI; uji di browser dan Supabase masih diperlukan. |
| L11 | Rendah | **Pelacakan jejak tidak mengenal "area ditelusuri".** Hanya titik posisi per tim; tidak ada penandaan area dan pembagiannya ke tim lain untuk mencegah pencarian ganda. | Tambah entitas area-telusur (polyline/poligon) per operasi, tampil di semua tim. |
| L12 | Rendah | **Notifikasi tidak sampai ke warga.** IN_APP hanya terlihat petugas; PUSH (FCM) belum ada; SMS hanya bila Twilio dikonfigurasi. Warga/pendamping tanpa kalung tidak mendapat peringatan. | Putuskan kanal utama untuk pendamping (SMS/WhatsApp) dan integrasikan. |

### 11.5 Prioritas lanjutan

1. L1 (alur kerahkan Rescue) dan L4 (outbox gateway): memengaruhi alur inti.
2. Pusat: laporan/ekspor, monitoring desa, broadcast, agregasi provinsi (fitur #2–#5, #7).
3. UI: peta nyata dengan zona dan warna prioritas (Leaflet + OSM), ubah/hapus warga, papan status per warga.
4. L3/L2: samakan status dan tingkat.
5. Sinkronisasi offline (L9), setelah desainnya jelas.

### 11.6 Keputusan desain: akses data Rescue berbasis operasi (memperbaiki L10)

Keputusan pemilik proyek: (1) roster hanya **pemakai kalung** (kelompok rentan otomatis berkalung, sehingga tidak ada jalur data di luar produk);
(2) operasi dibuka **JAGA Desa** saat alarm dibunyikan, lalu Rescue otomatis mendapat akses; (3) area ditentukan Desa (sistem tanpa sensor,
hanya penilaian manusia: Keuchik/pemuda desa).

Yang berlaku sekarang:

| Aspek | Perilaku |
|---|---|
| Pemicu | Alarm area (seluruh desa atau dusun) tingkat **SIAGA/EVAKUASI** membuka operasi otomatis. WASPADA (peringatan dini) tidak. Alarm ke satu perangkat/kelompok tidak membuka operasi. Konstanta `AUTO_OPEN_SEVERITIES` di `operations-api.ts`. |
| Area | Dusun yang dipilih Desa saat alarm (kosong = seluruh desa). Warga tanpa dusun tercatat ikut dimasukkan dan ditandai. Desa dapat memperluas/menyempit area, mengubah tingkat, dan mencatat tinggi air + catatan pengamatan (`PATCH /api/operations/:id`). |
| Satu operasi per desa | Alarm berikutnya meningkatkan operasi yang sama (tingkat naik, area digabung; "seluruh desa" menang). Dijamin juga oleh indeks unik di DB. |
| Roster Rescue | `GET /api/operations/:id/roster` dan `/offline-pack`: pemakai kalung di area, terurut SOS aktif, lalu rekomendasi sistem/override, lalu dusun dan nama. Berisi kebutuhan evakuasi, kontak darurat, kebutuhan medis, status kalung. **Tanpa** NIK, tanggal lahir, jenis kelamin. |
| Di luar operasi | Rescue tidak bisa membuka `/api/residents`, detail warga, `/api/devices`, telemetri; peta Rescue hanya memuat pemakai kalung di operasi aktif; nama pemilik kalung disembunyikan. |
| Penutupan | Hanya Desa/Pusat (`POST /api/operations/:id/close`). Akses Rescue langsung dicabut. |
| Audit | Setiap pembukaan roster/paket/profil oleh Rescue dan Pusat dicatat (`OPERATION_ROSTER_VIEW`, `RESCUE_RESIDENT_VIEW`); buka/ubah/tutup operasi dicatat. |
| Notifikasi | SSE `operation.opened/updated/closed` ke akun Rescue di wilayah itu; notifikasi IN_APP dari alarm. Pemilihan tim tetap oleh komandan Rescue (bukan otomatis). |
| Rekomendasi | Tinggi air Desa tersedia sebagai faktor `operation_water_level_cm` untuk aturan Pusat. Seed belum memakainya, jadi belum memengaruhi skor sampai Pusat menulis aturan. |

Catatan dan keterbatasan:
- Aplikasi Android belum memakai roster (hanya daftar insiden); web sudah (menu "Feed bantuan" untuk Rescue).
- UI baru belum diuji di browser; backend diuji lewat smoke test (91 pemeriksaan).
- Migrasi `202610020002_operasi.sql` perlu dijalankan di Supabase.
- Kemungkinan lanjutan: pilihan cepat "titik rawan" per dusun (memakai `hazard_zones`), batas waktu operasi otomatis (kedaluwarsa bila lupa ditutup), dan pembatasan roster Rescue hanya ke tim yang sudah ditugaskan.


## 12. Audit #3 (3 Okt 2026): seed dan data pilot

Seed lama (Garut) diganti seed pilot Aceh Utara (lihat [JAGA.md](JAGA.md), bagian "Lokasi Pilot"). Saat membaca dan menguji ulang seed
ditemukan masalah berikut; semuanya sudah diperbaiki di `seed.ts`, `seed-supabase.mjs`, dan migrasi.

| ID | Tingkat | Temuan | Perbaikan |
|---|---|---|---|
| D1 | Tinggi | **Aturan skor seed memakai kunci faktor yang tidak pernah dihasilkan mesin** (`self_evacuation_capable`, `hazard_exposure`, `reported_condition`, dll.). Aturan seperti itu tidak pernah cocok, jadi rekomendasi hampir selalu skor 0 dan "PANTAU". [KODE] | Aturan dummy baru hanya memakai faktor yang dihasilkan mesin; diuji: insiden contoh menghasilkan skor 80 dengan 7 aturan cocok. Kunci `is_disabled` dan `is_pregnant` ditambahkan ke daftar kunci yang boleh disimpan Pusat. |
| D2 | Tinggi | **Seed Supabase melanggar kunci asing ke profil.** Profil dibuat setelah data lain dan memakai UUID dari Auth, sedangkan baris seed merujuk UUID profil buatan (`assigned_by`, `approved_by`, dst.). `organization_members` juga tidak pernah ditulis, sehingga akun Supabase berlingkup kosong. [KODE] | Akun dan profil dibuat lebih dulu; ID profil seed dipetakan ke ID Auth; `organization_members` ditulis; opsi `--data-only` dihapus. |
| D3 | Sedang | **Kolom yang tidak ada di skema**: `_sort`, `_status`, `recorded_at` pada riwayat status; `hazard_zones.area` dan `evacuation_shelters.location` NOT NULL tetapi diisi null. [KODE] | Dihapus/diisi; zona bahaya memakai poligon lingkaran dari pusat dan radius. Seed dicek terhadap skema SQL: semua kolom ada dan NOT NULL terisi. |
| D4 | Sedang | **Bentrok dengan data demo di migrasi 001** (ID desa/warga sama dengan seed, jenis kerentanan dengan UUID acak vs UUID seed). [KODE] | Data demo dihapus dari migrasi 001; seed memakai jenis kerentanan yang sudah ada (dipetakan lewat `code`). |
| D5 | Sedang | **Kalung demo otomatis tampil offline setelah 15 menit** (akibat perbaikan L5, tidak ada perangkat nyata yang mengirim sinyal). | Mode memori mengirim detak berkala untuk perangkat yang online di seed (`JAGA_DEMO_HEARTBEAT=false` untuk mematikan). |
| D6 | Sedang | **`mobility_limited` bernilai benar untuk siapa pun yang kolom catatan mobilitasnya terisi**, termasuk "Mandiri". [TERBUKTI] | **Diperbaiki.** Kolom terstruktur `evacuation_ability` (MANDIRI, PERLU_BANTUAN, TIDAK_BISA_SENDIRI) dan `time_critical_medical` (migrasi `202610030001_prioritas.sql`, API warga, formulir Desa, seed). Teks bebas tidak lagi dipakai sebagai sinyal. |

Catatan:
- Dashboard menampilkan label "Data dummy" bila penyimpanan memori atau `JAGA_DATA_IS_DUMMY=true`.
- Seed ke Supabase belum diuji ke proyek sungguhan (hanya dry-run dan pengecekan skema).
- Dusun selain Tanah Merah adalah placeholder; ganti dengan data BPS/Keuchik.

### 12.1 Prioritas berwarna untuk Rescue

Roster operasi sekarang menghitung prioritas setiap pemakai kalung dari rule set aktif (lihat [JAGA.md](JAGA.md), "Prioritas
Penyelamatan"): merah, oranye, kuning, hijau, lengkap dengan alasan dan terurut. Tampilan Rescue memakai daftar ini untuk kartu prioritas dan
pin peta. Hasil diuji pada data pilot: keempat warna muncul, urutan mengikuti triase, dan warna naik saat Desa memperbarui tinggi air.

Keterbatasan: bobot masih dummy; override level oleh komandan baru untuk warga yang memiliki SOS; UI diuji lewat harness render (bukan browser nyata).
Seed pilot kini satu desa (9 warga: 3 disabilitas, 3 lansia, 3 ibu hamil); tes isolasi antar desa memakai fixture tes terpisah.

## 13. Perombakan antarmuka (3 Okt 2026)

Tampilan web (folder `frontend/`, sebelumnya `web/`) ditulis ulang (HTML, CSS, JS) dengan navbar atas (sidebar untuk JAGA Pusat), palet dari logo, peta Leaflet, dan menu per role (lihat
[JAGA.md](JAGA.md), "Tampilan per Role"). Pengujian: tangkapan layar nyata dengan Edge headless memakai data API nyata tiap role,
pemeriksaan overflow di lebar 500 px untuk 16 halaman, dan uji interaksi terskrip (alarm per dusun, tambah warga, aksi kejadian, ubah tinggi
air, tutup operasi, buat akun Rescue, status tim). Seluruhnya lulus.

Masalah yang ditemukan saat QA visual dan sudah diperbaiki:

| ID | Temuan | Perbaikan |
|---|---|---|
| U1 | Kalung berstatus stok dihitung sebagai "offline" dan masuk penyebut jumlah kalung (8/10 padahal 8/9 terpasang) | Hanya kalung terpasang atau dalam perawatan yang dihitung (`dashboard-api.ts`) |
| U2 | Alarm ke seluruh desa tercatat dengan target berupa UUID desa | Target memakai nama desa atau nama dusun |
| U3 | Halaman dengan tabel melebar di ponsel (grid mengikuti lebar tabel) | `min-width: 0` pada grid dan kartu |
| U4 | Daftar prioritas Rescue berada di bawah peta di ponsel | Daftar tampil lebih dulu di layar sempit |
| U5 | Peta zoom terlalu jauh karena posisi tim dan gateway ikut menentukan batas | Batas peta hanya dari warga, zona, titik kumpul |
| U6 | Pembuatan akun lama meminta UUID desa dan tidak bisa membuat organisasi Rescue | Modal akun memilih desa dari daftar; organisasi Rescue dibuat otomatis (jenis organisasi dipilih) |

Perubahan perilaku yang perlu diketahui:
- Halaman `buat-akun.html` dihapus; pembuatan akun ada di menu **Akun & akses** milik Pusat.
- Tombol "Kerahkan" untuk Desa dihapus dari kejadian: penugasan tim adalah wewenang komandan Rescue (lihat L1); Desa hanya mengonfirmasi, menyatakan aman, atau menutup.
- Rescue tidak lagi memiliki aksi "Tutup" pada kejadian (hanya Desa/Pusat).
- Akun contoh pada halaman masuk hanya ditawarkan server pada mode memori non-produksi.

Fitur dari daftar fitur role yang kini tersedia di UI: Pusat (monitoring desa, laporan dan ekspor CSV, log audit, tata kelola aturan baca-saja,
manajemen akun), Desa (peta sungguhan, papan hal yang perlu ditindaklanjuti), Rescue (peta prioritas dengan zona, koordinasi tim).
Masih belum ada: broadcast Pusat, pengaturan platform, agregasi provinsi, sinkronisasi offline, navigasi rute dan jejak pencarian
di UI, laporan pasca-operasi, cache ubin peta offline.

## 14. Masalah masuk (login) dan halaman depan (5 Okt 2026)

Laporan: pengguna tidak bisa masuk sebagai JAGA Desa dan JAGA Rescue. Diperiksa langsung terhadap server yang berjalan dan dengan browser sungguhan
(Edge terkendali): login ketiga role berhasil, halaman dashboard termuat benar, tanpa galat di konsol. Penyebab yang paling mungkin:

| ID | Dugaan penyebab | Tindakan |
|---|---|---|
| M1 | Akun contoh berganti saat data pilot Aceh Utara dipasang (`desa.sukamaju@jaga.id` lama ditolak; yang berlaku `desa.leubokpusaka@jaga.id`) | Halaman masuk menampilkan akun contoh sebagai tombol yang mengisi form otomatis; pesan galat menyarankan akun contoh pada mode demo |
| M2 | Pilihan peran lama di halaman masuk dulu masuk tanpa kata sandi (palsu); kini login sungguhan sehingga pengguna tanpa akun buntu | Halaman depan baru: kartu peran → `/login?role=...` dengan akun contoh peran itu terisi otomatis |
| M3 | Pembatas percobaan masuk (8 kali per 15 menit per email) menolak sementara setelah salah kata sandi berulang | Pesan server tampil apa adanya; pembatas di memori sehingga reset saat server dimulai ulang |

Halaman depan publik ditambahkan di `/`; dashboard pindah ke `/app`. Endpoint publik baru `GET /api/auth/status` dipakai halaman depan untuk mengetahui sesi tanpa 401.
Pengujian: alur landing → kartu peran → login → dashboard untuk tiga role di Edge, dan 117 pemeriksaan smoke.

## 15. Menu sidebar untuk semua role dan serah-terima tim kalung (5 Okt 2026)

- Menu JAGA Desa dan JAGA Rescue dipindah ke sidebar seperti JAGA Pusat; mode tab tetap tersedia sebagai opsi (`nav: 'tabs'` di `ROLES`, `frontend/app.js`).
  Dicek dengan tangkapan layar dan pemeriksaan overflow di lebar 500 px.
- Ditambahkan bahan serah-terima untuk tim kalung: bagian **Integrasi Kalung** di [JAGA.md](JAGA.md) (kontrak, alur, konfigurasi, hal yang belum ada),
  `firmware/api-examples.http`, `scripts/demo-device-keys.mjs`. Contoh diuji ujung ke ujung (telemetri, SOS dan duplikatnya, inbox, konfirmasi, kunci salah).
- Aturan kerja bersama (kepemilikan folder, cabang, larangan commit rahasia) ada di README. `.gitignore` menolak rahasia dan hasil build firmware;
  `.gitattributes` menyeragamkan akhir baris.
- Catatan keamanan: `.env` berisi kunci rahasia Supabase dan akun MQTT; tidak boleh dibagikan atau di-commit. Bila pernah terkirim, ganti kunci di dashboard Supabase.
- Temuan terbuka yang memengaruhi tim kalung: pengiriman alarm masih polling `inbox` (L4); antrean keluar untuk gateway belum ada; pola alarm per tingkat baru usulan.

## 16. GPS, notifikasi SOS, dan sinyal darurat satu tombol (5 Okt 2026)

Dipicu catatan tim kalung: kalung mengirim koordinat GPS dan SOS, dan dari web harus ada satu tombol sinyal darurat agar kalung bunyi atau getar.

| Temuan | Perbaikan |
|---|---|
| Telemetri hanya menyimpan lat/lng; tanpa fix, akurasi, waktu posisi, riwayat | Migrasi `202610050001_gps_dan_sinyal.sql`; `gpsFix`, `accuracyMeters`, `satellites`; posisi hanya diperbarui bila fix; riwayat posisi di `device_telemetry` |
| SOS kalung hanya SSE; tidak ada catatan tersimpan dan kalung tidak tahu statusnya | Notifikasi IN_APP `SOS` tersimpan (tanpa nama warga); `activeSos` dan `nextPollSeconds` pada inbox; posisi SOS memperbarui posisi kalung |
| Tidak ada tombol darurat satu langkah | `POST /api/alerts/emergency` (Pusat/Desa): EVAKUASI ke seluruh kalung desa, buka operasi, tercatat audit; perintah membawa `media` SUARA/GETAR/CAHAYA |
| Peta Rescue memakai lokasi rumah walau warga sedang di tempat lain | Roster memakai posisi GPS segar (≤15 menit), selain itu rumah; field `positionSource`, `positionAt`, `positionAccuracyMeters`; zona bahaya dihitung dari posisi efektif |
| Frontend | Kartu dan modal konfirmasi "Sinyal darurat" di Beranda Desa, banner dan bunyi bip saat SOS baru, kolom posisi GPS di halaman Kalung |

Belum: validasi migrasi di Supabase nyata, antrean keluar khusus gateway (LoRa), uji dengan modul GPS asli. Status data yang masih kosong ada di `docs/JAGA.md` bagian "Status data".


Tambahan (5 Okt 2026): JAGA Desa/Pusat dapat menambah, mengubah, dan menghapus titik evakuasi (`/api/shelters`, menu Titik evakuasi; tercatat audit). Seed memakai dusun Tanah Merah (dusun lain placeholder), titik kumpul usulan meunasah, lapangan, dan sekolah cadangan.

Tambahan (5 Okt 2026, rute dan detail SOS): `GET /api/operations/:id/route?residentId=&teamId=` (Rescue/Desa/Pusat, tercatat audit) memberi estimasi dan tautan navigasi; antarmuka Rescue punya tombol Rute pada kartu prioritas dan tabel operasi (jalan dari OSRM publik bila terjangkau, selain itu garis estimasi; sisa jarak di luar jalan terpetakan ditandai). Panel Detail SOS (waktu, koordinat, status kalung, log aktivitas, tombol "Tandai sudah ditangani") mengikuti kebutuhan tim kalung. Temuan: titik koordinat dummy warga berjarak 1,4 sampai 2 km dari jalan yang terpetakan di OSM; rute baru bermakna bila koordinat rumah asli diisi. Posisi tim dummy dipindah dekat jalan. Koordinat desa Wikidata (4.827, 97.416) sudah dicek ulang dan benar; hasil pencarian "Leubok" di Copernicus (5.12, 97.15) adalah desa lain dekat Lhokseumawe.

## 17. Konsep dusun dihapus (5 Okt 2026)

Fokus produk adalah desa, sedangkan nama role sudah "JAGA Desa". Dihapus: tabel dan kolom dusun (migrasi `202610060001_hapus_dusun.sql`), endpoint `/api/hamlets`, `hamletIds`/target `DUSUN` pada alarm, area operasi per dusun, kolom dan pilihan dusun di antarmuka, serta data seed dusun (titik acuan koordinat dummy tidak lagi disebut dusun). Alarm dan operasi selalu berlaku untuk seluruh desa. Tes baru memastikan `/api/hamlets` tidak ada dan target `DUSUN` ditolak. Perbaikan lain: header `Referrer-Policy` aset web diubah ke `strict-origin-when-cross-origin` karena server ubin OpenStreetMap menolak permintaan tanpa Referer (penyebab peta kosong tanpa jalan).

## 18. Pusat, banyak desa, kendala teknis, inventaris kalung (5 Okt 2026)

| Temuan | Perbaikan |
|---|---|
| Pusat hanya "ringkasan nasional" dengan isi tingkat desa (kalung offline, insiden) | Ringkasan JAGA Pusat: cakupan provinsi dan desa, persediaan kalung, kendala teknis, operasi (informasi). Pusat tidak lagi menampung penanganan Siaga/insiden |
| Pilot hanya satu desa | Tiga desa (Leubok Pusaka, Seureuke, Buket Linteung) dengan akun Desa masing-masing; isolasi antar desa diuji |
| Monitoring desa tanpa filter, peta di bawah | Peta di atas, filter provinsi (juga memfilter peta); data warga dikelompokkan per desa dengan filter provinsi dan desa |
| Tidak ada jalur kendala teknis dari Desa/Rescue ke Pusat | Tabel `support_tickets`, `/api/tickets`, halaman Kendala teknis (Pusat menangani, Desa/Rescue melapor), notifikasi waktu nyata |
| Desa dapat mendaftarkan kalung | Hanya Pusat yang mendaftarkan (gudang tanpa desa dan koordinat) dan mendistribusikan (`/api/devices/:id/distribute`); Desa memasangkan pada warga |
| Aturan prioritas tidak dapat diedit | Revisi lewat draf (`/api/rulesets/:id/revise`): ubah poin, penjelasan, ambang; aktifkan dengan catatan persetujuan. Validasi aturan kembar diperbaiki (satu faktor boleh punya beberapa ambang) |
| Tidak ada hapus akun | `DELETE /api/accounts/:id` (Pusat; bukan diri sendiri, bukan Pusat terakhir); login dan sesi dicabut seketika; profil disamarkan bila masih dirujuk riwayat |
| Rescue hanya instansi | Relawan desa dapat menjadi Rescue (organisasi jenis relawan); contoh "Tim Siaga Gampong Leubok Pusaka" |
| Koordinat Leubok Pusaka dari Wikidata meleset sekitar 6 km (area hutan) | Diganti koordinat OpenStreetMap (7 sampai 17 m dari jalan terpetakan); rute dan peta kini bermakna |

Migrasi `202610070001_pusat_kendala_kalung.sql` (tabel kendala, koordinat kalung boleh kosong). Belum: pengelola tingkat provinsi (lihat catatan cakupan di `docs/JAGA.md`).

## 19. Uji menyeluruh sebelum serah-terima ke tim kalung (6 Okt 2026)

Dijalankan dengan skrip di `scripts/uji/`: `keamanan.mjs` (matriks otorisasi 102 rute x 5 identitas = 480 panggilan, isolasi antar desa, fuzz masukan, API perangkat, sesi), `peran.mjs` (78 pemeriksaan di browser untuk Desa, Rescue, Pusat, termasuk tampilan 500 px), dan `supabase.mjs` (49 pemeriksaan khusus Supabase). Hasil akhir: keamanan 0 temuan, browser 78/78, Supabase 49/49, smoke 174/174.

| # | Temuan | Tingkat | Perbaikan |
|---|---|---|---|
| 1 | Akun nonaktif di mode Supabase masih bisa masuk dan sesinya tetap berlaku | Tinggi | Login dan pemeriksaan token Supabase menolak `profiles.active=false` |
| 2 | Filter PostgREST dengan nilai berspasi (mis. nama aturan) tidak pernah cocok karena nilai diberi tanda kutip | Tinggi | Tanda kutip hanya dipakai di dalam daftar `in.(...)`; operator `eq`, `neq`, `gt`, `ilike` mengirim nilai apa adanya |
| 3 | SOS dari kalung gagal di Supabase (502): profil `device:ID` ditulis ke kolom uuid; audit log kalung juga gagal tersimpan | Tinggi | `actorOf()` hanya meneruskan UUID profil nyata; dipakai untuk semua kolom `*_by` |
| 4 | Penghapusan akun gagal di Supabase (Auth menolak karena profil dirujuk audit) | Sedang | Urutan baru: hapus profil bila tidak dirujuk, selain itu profil disamarkan dan user Auth dilarang masuk (`ban_duration`) |
| 5 | Seed Supabase gagal menulis `devices` (kunci objek tidak seragam) sehingga warga tanpa kalung, roster kosong | Tinggi | Baris seragam sebelum sisipan massal; urutan dan filter hapus (`--reset`) diperbaiki per tabel |
| 6 | Sinyal darurat dapat terpicu oleh panggilan berisi kosong | Sedang | Wajib `confirm: true`; Pusat tidak lagi dapat membunyikan alarm (hanya Desa) |
| 7 | Email terdaftar dapat ditebak dari waktu respons login (mode memori) | Rendah | Verifikasi kata sandi tiruan untuk email tak dikenal |
| 8 | Logout tidak mencabut token Supabase | Sedang | `POST /auth/v1/logout` ke Supabase saat keluar |
| 9 | Galat konsol Leaflet saat berpindah halaman cepat (peta sudah dilepas) | Rendah | Pewaktu `invalidateSize` diperiksa; `map.stop()` sebelum `remove()` |
| 10 | Kontras teks abu dan lencana oranye di bawah 4,5:1 | Rendah | Warna diperkuat (5,3:1 dan 5,7:1) |
| 11 | Kalung data contoh tampil offline setelah 15 menit di Supabase (tanpa detak) | Rendah | `JAGA_DEMO_HEARTBEAT=true` (hanya demo; jangan aktif bersama kalung asli) |

Diperiksa dan bersih: tidak ada rahasia di riwayat git atau berkas terlacak, `.env` diabaikan git, `npm audit` 0 kerentanan, header keamanan, cookie HttpOnly dan SameSite=Strict, tanpa CORS lintas-asal, SSE membutuhkan sesi, tanda tangan sesi dan peran tidak dapat dipalsukan, pembatasan percobaan login, jalur berkas sensitif (`/.env`, `/.git`, traversal) tidak tersaji, HTML pada kendala teknis ditampilkan sebagai teks, RLS aktif pada semua tabel dan REST Supabase tanpa kunci menolak data warga, view memakai `security_invoker`.

Belum dapat diperiksa dari sini: Security Advisor Supabase (konektor tidak punya izin ke proyek ini; periksa manual di dashboard), HSTS (butuh HTTPS di hosting), masa berlaku token Supabase (1 jam secara bawaan; sesi berakhir lalu diarahkan ke login), MQTT (backend belum membaca MQTT; lihat `docs/JAGA.md`, Integrasi Kalung).

# 20. Penyesuaian SRS JAGA v2.0

Perubahan: istilah tingkat BMKG/BNPB (Normal, Waspada, Siaga, Awas; enum `EVAKUASI` menjadi `AWAS`), status `NOT_FOUND` dan `UNREACHABLE`, tombol kalung terkunci sampai Desa membunyikan alarm (server menjawab 409 bila belum ada alarm), JAGA Sense (sensor, ambang per desa, rekomendasi tingkat), gateway desa (`/api/gateway/outbox`, `/api/gateway/ingest` dengan `recordedAt`), papan status warga, pengumuman, pengaturan platform dan kebijakan data Rescue, laporan pasca-operasi, jejak tim, antrean offline di peramban, unduh peta offline.

Hasil uji: smoke 232/232, browser 116/116 (dua kali berturut-turut). Uji Supabase untuk fitur baru belum dijalankan; menunggu migrasi `202610080001` dan `202610080002` diterapkan, seed ulang, lalu `scripts/uji/supabase.mjs`.

Catatan keamanan: pengerahan tim oleh Desa dan alarm hanya oleh role Desa; Pusat tidak dapat membunyikan alarm; data medis, kontak, dan GPS bagi Rescue hanya selama operasi aktif, mengikuti kebijakan Pusat, dan tercatat di audit. Sensor dan gateway memakai kunci hash terpisah (`snk_`, `gtw_`) dan gateway terbatas pada desanya.
