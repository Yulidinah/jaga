# Temuan Audit Proyek JAGA

Tanggal audit: 1 Oktober 2026 · Cabang `main` (1 commit + perubahan lokal `backend/src/store-boot.ts`)

## 1. Cakupan dan metode

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
