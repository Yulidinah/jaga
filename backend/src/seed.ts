import { hashPassword, nowIso, sha256Hex } from "./lib.js";
import type { MemoryStore } from "./store-memory.js";
import type { Row } from "./types.js";

/**
 * DATA PILOT: Gampong Leubok Pusaka (Kec. Langkahan, Kab. Aceh Utara).
 *
 * Yang NYATA (publik): kode wilayah, nama, titik tengah desa (Wikidata), nama Dusun Tanah Merah.
 * Yang DUMMY: seluruh warga, kontak, kerentanan, kalung, gateway, tim, insiden, alarm, aturan skor, titik kumpul, zona bahaya
 * (batas dan koordinat rumah dibuat acak di sekitar titik tengah dusun, tidak menunjuk rumah siapa pun).
 * Dusun selain Tanah Merah adalah placeholder. Alasan pemilihan lokasi dan dasar prioritas: docs/JAGA.md.
 */

/** UUID deterministik supaya data demo sama antara mode memori dan seed Supabase. */
const id = (group: string, n: number) => `${group}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const DEMO_ACCOUNTS = [
  {
    email: "pusat@jaga.id",
    password: "JagaPusat2026!",
    displayName: "Rani Puspita",
    title: "Koordinator Nasional JAGA (dummy)",
    role: "PUSAT" as const,
    org: 1,
    villages: [] as number[]
  },
  {
    email: "desa.leubokpusaka@jaga.id",
    password: "JagaDesa2026!",
    displayName: "Zulfahmi",
    title: "Operator JAGA Desa Leubok Pusaka (dummy)",
    role: "DESA" as const,
    org: 2,
    villages: [1]
  },
  {
    email: "rescue.bpbd@jaga.id",
    password: "JagaRescue2026!",
    displayName: "Dimas Prakoso",
    title: "Komandan TRC BPBD Aceh Utara (dummy)",
    role: "RESCUE" as const,
    org: 3,
    villages: [1]
  },
  {
    email: "rescue.damkar@jaga.id",
    password: "JagaRescue2026!",
    displayName: "Bayu Setiawan",
    title: "Komandan Damkar Aceh Utara (dummy)",
    role: "RESCUE" as const,
    org: 4,
    villages: [1]
  }
];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** Poligon lingkaran (EWKT) untuk kolom geography zona bahaya. */
const circle = (lat: number, lng: number, radiusMeters: number, steps = 24) => {
  const dLat = radiusMeters / 111_320;
  const dLng = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
  const points: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = ((i % steps) * 2 * Math.PI) / steps;
    points.push(`${(lng + dLng * Math.cos(angle)).toFixed(6)} ${(lat + dLat * Math.sin(angle)).toFixed(6)}`);
  }
  return `SRID=4326;MULTIPOLYGON(((${points.join(",")})))`;
};
const point = (lat: number, lng: number) => `SRID=4326;POINT(${lng} ${lat})`;

const provinces = [{ id: "11", name: "Aceh" }];
const regencies = [{ id: "1108", province_id: "11", name: "Kabupaten Aceh Utara" }];
const districts = [{ id: "110818", regency_id: "1108", name: "Kecamatan Langkahan" }];

const village = {
  n: 1, code: "1108182021", name: "Gampong Leubok Pusaka", lat: 4.827, lng: 97.416, population: 2286,
  access: "Dusun Tanah Merah terendam banjir November 2025 (laporan media). Jalan desa sempit dan rawan genangan saat sungai meluap. Catatan akses ini dummy; verifikasi dengan Keuchik."
};

const organizations = [
  { n: 1, name: "JAGA Pusat (dummy)", type: "PUSAT", email: "pusat@jaga.id" },
  { n: 2, name: "Pemerintah Gampong Leubok Pusaka", type: "PEMERINTAH_DESA", email: "desa.leubokpusaka@jaga.id" },
  { n: 3, name: "BPBD Kabupaten Aceh Utara", type: "BPBD", email: "rescue.bpbd@jaga.id" },
  { n: 4, name: "Damkar Kabupaten Aceh Utara", type: "DAMKAR", email: "rescue.damkar@jaga.id" }
];

const vulnerabilitySeed: Array<{ code: string; category: string; name: string; assistance: string; description: string }> = [
  { code: "TUNARUNGU", category: "DISABILITAS", name: "Tunarungu", assistance: "Gunakan cahaya, getaran, teks, dan pendamping komunikasi.", description: "Gangguan pendengaran; peringatan perlu kombinasi media visual dan getaran." },
  { code: "TUNANETRA", category: "DISABILITAS", name: "Tunanetra", assistance: "Berikan panduan suara dan pendamping mobilitas.", description: "Gangguan penglihatan; arahan harus berupa suara dan rambu verbal." },
  { code: "TUNADAKSA", category: "DISABILITAS", name: "Disabilitas fisik/mobilitas", assistance: "Siapkan bantuan mobilitas dan jalur yang dapat diakses.", description: "Keterbatasan gerak; perlu kursi roda, tandu, atau alat bantu." },
  { code: "DISABILITAS_INTELEKTUAL", category: "DISABILITAS", name: "Disabilitas intelektual", assistance: "Gunakan instruksi sederhana dan pendamping tepercaya.", description: "Butuh instruksi singkat, berulang, dan pendamping yang dikenal." },
  { code: "AUTISME", category: "DISABILITAS", name: "Autisme", assistance: "Kurangi rangsangan dan gunakan komunikasi yang konsisten.", description: "Sensitif terhadap bunyi keras dan cahaya menyilaukan." },
  { code: "DISABILITAS_GANDA", category: "DISABILITAS", name: "Disabilitas ganda", assistance: "Ikuti kebutuhan bantuan individual yang telah diverifikasi.", description: "Kombinasi gangguan yang berbeda tiap individu." },
  { code: "LANSIA", category: "LANSIA", name: "Lansia", assistance: "Prioritaskan pemeriksaan kondisi dan bantuan mobilitas.", description: "Lanjut usia; stamina menurun dan risiko jatuh lebih tinggi." },
  { code: "IBU_HAMIL", category: "IBU_HAMIL", name: "Ibu hamil", assistance: "Prioritaskan transportasi aman dan bantuan medis bila diperlukan.", description: "Perlu perhatian khusus selama perjalanan dan pemeriksaan berkala." },
  { code: "ANAK_TANPA_PENDAMPING", category: "ANAK", name: "Anak tanpa pendamping", assistance: "Pastikan pendampingan dan reunifikasi keluarga.", description: "Anak yang memerlukan pendampingan orang dewasa saat evakuasi." },
  { code: "PENYAKIT_KRONIS", category: "PENYAKIT_KRONIS", name: "Penyakit kronis", assistance: "Bawa obat, dokumen medis, dan periksa kebutuhan klinis.", description: "Memerlukan obat rutin dan pemantauan kondisi saat dipindahkan." }
];

/** Pusat dusun hanya untuk menyebar koordinat dummy; tabel hamlets tidak menyimpan koordinat. */
const hamlets = [
  { n: 1, name: "Dusun Tanah Merah", lat: 4.8275, lng: 97.4155 },
  { n: 2, name: "Dusun Contoh 2 (placeholder)", lat: 4.8238, lng: 97.4192 },
  { n: 3, name: "Dusun Contoh 3 (placeholder)", lat: 4.8302, lng: 97.4208 }
];

type Ability = "MANDIRI" | "PERLU_BANTUAN" | "TIDAK_BISA_SENDIRI";

interface ResidentSeed {
  n: number;
  hamlet: number;
  name: string;
  birth: string;
  gender: "LAKI_LAKI" | "PEREMPUAN" | "LAINNYA";
  /** Selisih derajat dari pusat dusun (±0.001 derajat sekitar 110 m). */
  at: [number, number];
  alone: boolean;
  ability: Ability;
  /** Kebutuhan medis yang tidak bisa ditunda (insulin, oksigen, dialisis, persalinan dekat). */
  critical: boolean;
  mobility: string | null;
  communication: string | null;
  medical: string | null;
  evacuation: string | null;
  vulns: Array<[string, number, string]>;
  /** [nama, hubungan, telepon, tinggal serumah] */
  contacts: Array<[string, string, string, boolean]>;
}

// Fokus JAGA: disabilitas, lansia, ibu hamil (masing-masing 3). Seluruh nama dan nomor telepon fiktif.
const residentSeed: ResidentSeed[] = [
  // --- Disabilitas
  {
    n: 1, hamlet: 1, name: "Teuku Razali", birth: "1983-07-02", gender: "LAKI_LAKI", at: [-0.0005, 0.0004], alone: false,
    ability: "TIDAK_BISA_SENDIRI", critical: false,
    mobility: "Menggunakan kursi roda.", communication: "Baik.", medical: null,
    evacuation: "Rumah berundak; perlu kursi roda dan dua orang untuk mengangkat.",
    vulns: [["TUNADAKSA", 5, "Siapkan kursi roda dan jalur tanpa tangga."]],
    contacts: [["Nurlaila", "Istri", "0812-0000-0101", true]]
  },
  {
    n: 2, hamlet: 1, name: "Syarifah Aini", birth: "1996-11-21", gender: "PEREMPUAN", at: [0.0007, 0.0002], alone: false,
    ability: "MANDIRI", critical: false,
    mobility: null, communication: "Tunarungu; gunakan teks dan isyarat, alarm suara tidak terdengar.", medical: null,
    evacuation: "Dapat berjalan sendiri bila diberi tanda cahaya atau getaran.",
    vulns: [["TUNARUNGU", 4, "Peringatan cahaya dan getaran, pendamping komunikasi."]],
    contacts: [["Hasanah", "Ibu", "0812-0000-0102", true]]
  },
  {
    n: 3, hamlet: 2, name: "Ismail Hasan", birth: "1971-09-18", gender: "LAKI_LAKI", at: [-0.0006, 0.0003], alone: false,
    ability: "PERLU_BANTUAN", critical: false,
    mobility: "Berjalan dengan pendamping.", communication: "Tunanetra; berikan arahan suara.", medical: null,
    evacuation: "Pendamping keluarga di rumah; sebutkan arah dan hambatan secara verbal.",
    vulns: [["TUNANETRA", 4, "Panduan suara dan pendamping mobilitas."]],
    contacts: [["Nuraini", "Istri", "0812-0000-0103", true]]
  },
  // --- Lansia
  {
    n: 4, hamlet: 2, name: "Abdullah Yusuf", birth: "1944-05-30", gender: "LAKI_LAKI", at: [-0.0003, -0.0004], alone: true,
    ability: "TIDAK_BISA_SENDIRI", critical: false,
    mobility: "Pasca-stroke, tidak dapat berjalan.", communication: "Bicara terbatas.", medical: "Pasca-stroke; obat tekanan darah rutin.",
    evacuation: "Perlu tandu dan dua orang; rumah di titik rendah.",
    vulns: [
      ["LANSIA", 5, "Kondisi rapuh, pemeriksaan berkala."],
      ["PENYAKIT_KRONIS", 4, "Bawa obat dan catatan medis."]
    ],
    contacts: [["Rizki", "Cucu", "0812-0000-0104", false]]
  },
  {
    n: 5, hamlet: 1, name: "Cut Maryam", birth: "1949-03-14", gender: "PEREMPUAN", at: [0.0004, -0.0006], alone: true,
    ability: "PERLU_BANTUAN", critical: false,
    mobility: "Berjalan dengan tongkat, tidak kuat berjalan jauh.", communication: "Dapat mendengar, bicara pelan.", medical: null,
    evacuation: "Perlu satu pendamping dan jalur tanpa genangan.",
    vulns: [["LANSIA", 4, "Periksa kondisi dan bantu berjalan."]],
    contacts: [["Zulkifli", "Anak", "0812-0000-0105", false]]
  },
  {
    n: 6, hamlet: 3, name: "Nurmala Dewi", birth: "1957-12-05", gender: "PEREMPUAN", at: [0.0003, -0.0005], alone: false,
    ability: "PERLU_BANTUAN", critical: true,
    mobility: "Berjalan pendek.", communication: "Baik.", medical: "Diabetes; suntik insulin harian, perlu jadwal makan.",
    evacuation: "Bawa insulin (disimpan dingin) dan makanan ringan.",
    vulns: [
      ["LANSIA", 3, "Waktu perjalanan singkat."],
      ["PENYAKIT_KRONIS", 4, "Bawa insulin dan cek gula darah."]
    ],
    contacts: [["Ainul", "Anak", "0812-0000-0106", true]]
  },
  // --- Ibu hamil
  {
    n: 7, hamlet: 2, name: "Mahdalena", birth: "1993-02-09", gender: "PEREMPUAN", at: [0.0005, 0.0006], alone: false,
    ability: "MANDIRI", critical: true,
    mobility: null, communication: "Baik.", medical: "Hamil 8 bulan, perkiraan lahir dalam sekitar 2 minggu; kontrol di bidan desa.",
    evacuation: "Butuh kendaraan, hindari berjalan jauh; hubungi bidan desa.",
    vulns: [["IBU_HAMIL", 5, "Persalinan dekat: prioritaskan transportasi aman dan bidan."]],
    contacts: [["Syamsul", "Suami", "0812-0000-0107", true]]
  },
  {
    n: 8, hamlet: 3, name: "Rahmi", birth: "1998-08-12", gender: "PEREMPUAN", at: [-0.0004, 0.0006], alone: false,
    ability: "MANDIRI", critical: false,
    mobility: null, communication: "Baik.", medical: "Hamil 5 bulan, sehat.",
    evacuation: "Dapat evakuasi sendiri bersama suami.",
    vulns: [["IBU_HAMIL", 2, "Pantau kondisi."]],
    contacts: [["Fadhil", "Suami", "0812-0000-0108", true]]
  },
  {
    n: 9, hamlet: 1, name: "Nurul Huda", birth: "1995-03-27", gender: "PEREMPUAN", at: [-0.0007, -0.0003], alone: true,
    ability: "MANDIRI", critical: false,
    mobility: null, communication: "Baik.", medical: "Hamil 7 bulan.",
    evacuation: "Suami merantau; tinggal sendiri, butuh pendamping dan kendaraan bila air tinggi.",
    vulns: [["IBU_HAMIL", 3, "Tinggal sendiri; pantau dan siapkan transportasi."]],
    contacts: [["Hasniah", "Ibu", "0812-0000-0109", false]]
  }
];

const deviceSeed: Array<{ id: string; resident: number | null; battery: number; online: boolean; status: string }> = [
  { id: "JAGA-0001", resident: 1, battery: 64, online: true, status: "ASSIGNED" },
  { id: "JAGA-0002", resident: 2, battery: 91, online: true, status: "ASSIGNED" },
  { id: "JAGA-0003", resident: 3, battery: 57, online: true, status: "ASSIGNED" },
  { id: "JAGA-0004", resident: 4, battery: 14, online: false, status: "ASSIGNED" },
  { id: "JAGA-0005", resident: 5, battery: 78, online: true, status: "ASSIGNED" },
  { id: "JAGA-0006", resident: 6, battery: 69, online: true, status: "ASSIGNED" },
  { id: "JAGA-0007", resident: 7, battery: 82, online: true, status: "ASSIGNED" },
  { id: "JAGA-0008", resident: 8, battery: 88, online: true, status: "ASSIGNED" },
  { id: "JAGA-0009", resident: 9, battery: 23, online: true, status: "ASSIGNED" },
  { id: "JAGA-0020", resident: null, battery: 100, online: false, status: "STOCK" }
];

const gatewaySeed = [
  { n: 1, code: "GW-LEUBOKPUSAKA-01", name: "Gateway Dusun Tanah Merah", lat: 4.8279, lng: 97.4158, online: true }
];

const hazardSeed = [
  { n: 1, name: "Dataran banjir Dusun Tanah Merah", hazard_type: "BANJIR", risk_level: 5, lat: 4.8275, lng: 97.4155, radius: 450, notes: "Banjir 26 November 2025 dilaporkan mencapai sekitar 5 meter di dusun ini (Kompas). Batas zona perkiraan, bukan hasil pemetaan resmi." },
  { n: 2, name: "Titik rendah Dusun Contoh 2", hazard_type: "BANJIR", risk_level: 4, lat: 4.8238, lng: 97.4192, radius: 280, notes: "Titik rendah rawan genangan (data dummy; Desa menentukan titik sebenarnya)." }
];

const shelterSeed = [
  { n: 1, name: "Meunasah Leubok Pusaka (titik kumpul usulan)", address: "Lokasi usulan, belum diverifikasi", lat: 4.8291, lng: 97.4181, capacity: 100, notes: "Usulan di tanah lebih tinggi; perlu verifikasi lapangan." },
  { n: 2, name: "Lapangan desa (titik kumpul usulan)", address: "Lokasi usulan, belum diverifikasi", lat: 4.8312, lng: 97.4175, capacity: 150, notes: "Lahan terbuka untuk tenda darurat; perlu verifikasi lapangan." }
];

const teamSeed = [
  { n: 1, org: 3, name: "TRC BPBD Aceh Utara 01", call_sign: "TRC-01", vehicle: "Truk dan perahu karet", status: "AVAILABLE", leader: 3, lat: 4.84, lng: 97.4 },
  { n: 2, org: 3, name: "TRC BPBD Aceh Utara 02", call_sign: "TRC-02", vehicle: "Ambulans lapangan", status: "AVAILABLE", leader: 3, lat: 4.838, lng: 97.402 },
  { n: 3, org: 4, name: "Damkar Aceh Utara 01", call_sign: "DAMKAR-01", vehicle: "Perahu fiberglass", status: "AVAILABLE", leader: 4, lat: 4.835, lng: 97.405 }
];

/**
 * ATURAN PRIORITAS DUMMY (bukan standar resmi). Prinsipnya triase yang dapat dijelaskan, bukan label kelompok:
 *   1. ancaman langsung terhadap nyawa (SOS, air di rumah, zona bahaya),
 *   2. tidak mampu menyelamatkan diri (kemampuan evakuasi, tinggal sendiri),
 *   3. kebutuhan medis yang tidak bisa ditunda,
 *   4. hambatan menerima peringatan, 5. faktor penambah (usia, kehamilan, akses, malam, kalung offline).
 * Kelompok (disabilitas/lansia/ibu hamil) hanya penanda kerentanan dengan bobot kecil. Bobot nyata wajib disahkan
 * JAGA Pusat bersama BPBD, Dinsos, dan organisasi penyandang disabilitas. Semua kunci dihasilkan mesin rekomendasi.
 */
const ruleSeed: Array<{ key: string; op: string; value: unknown; delta: number; order: number; text: string }> = [
  { key: "has_active_sos", op: "EQ", value: true, delta: 40, order: 10, text: "Ada SOS atau laporan insiden yang masih terbuka: ancaman langsung." },
  { key: "flood_depth_cm", op: "GTE", value: 50, delta: 15, order: 20, text: "Air di lokasi warga setinggi 50 cm atau lebih." },
  { key: "flood_depth_cm", op: "GTE", value: 100, delta: 15, order: 21, text: "Air di lokasi warga mencapai 1 meter atau lebih." },
  { key: "hazard_zone_risk", op: "GTE", value: 4, delta: 15, order: 30, text: "Rumah berada di dalam atau tepi zona bahaya berisiko tinggi." },
  { key: "hazard_zone_risk", op: "EQ", value: 3, delta: 8, order: 31, text: "Rumah berada di dalam atau tepi zona bahaya berisiko sedang." },
  { key: "operation_water_level_cm", op: "GTE", value: 100, delta: 10, order: 40, text: "JAGA Desa mengamati tinggi air umum mencapai 1 meter atau lebih." },
  { key: "evacuation_ability", op: "EQ", value: "TIDAK_BISA_SENDIRI", delta: 30, order: 50, text: "Tidak dapat menyelamatkan diri sendiri: butuh pengangkatan atau tandu." },
  { key: "evacuation_ability", op: "EQ", value: "PERLU_BANTUAN", delta: 10, order: 51, text: "Perlu bantuan untuk mengungsi." },
  { key: "lives_alone", op: "EQ", value: true, delta: 15, order: 60, text: "Tinggal sendiri: tidak ada pendamping serumah." },
  { key: "time_critical_medical", op: "EQ", value: true, delta: 30, order: 70, text: "Kebutuhan medis yang tidak bisa ditunda (mis. insulin, oksigen, persalinan dekat)." },
  { key: "vulnerability_codes", op: "IN", value: ["TUNARUNGU", "TUNANETRA", "DISABILITAS_INTELEKTUAL", "AUTISME"], delta: 10, order: 80, text: "Sulit menerima atau memahami peringatan: perlu pemberitahuan langsung." },
  { key: "is_pregnant", op: "EQ", value: true, delta: 10, order: 90, text: "Ibu hamil." },
  { key: "age_group", op: "EQ", value: "LANSIA", delta: 5, order: 100, text: "Lanjut usia: stamina menurun dan risiko jatuh lebih tinggi." },
  { key: "vulnerability_severity", op: "GTE", value: 4, delta: 5, order: 110, text: "Tingkat kerentanan tercatat tinggi (4 atau 5)." },
  { key: "device_online", op: "EQ", value: false, delta: 10, order: 120, text: "Kalung tidak terhubung: kondisi warga tidak dapat dipantau." },
  { key: "terrain_isolation", op: "GTE", value: 4, delta: 5, order: 130, text: "Akses menuju desa sulit atau mudah terputus." },
  { key: "is_night", op: "EQ", value: true, delta: 5, order: 140, text: "Malam hari: jarak pandang dan koordinasi lebih sulit." },
  { key: "has_contact", op: "EQ", value: false, delta: 5, order: 150, text: "Tidak ada kontak darurat tercatat." }
];

const REQUIRED_FACTORS = [
  "vulnerability_categories", "vulnerability_severity", "lives_alone", "mobility_aid", "medical_equipment",
  "has_contact", "terrain_isolation", "is_night", "flood_depth_cm", "evacuation_ability", "hazard_zone_risk"
];

const thresholdSeed = [
  { level: "PANTAU", min_score: 0, display_order: 1 },
  { level: "SEGERA_TINJAU", min_score: 25, display_order: 2 },
  { level: "RESPONS_CEPAT", min_score: 50, display_order: 3 },
  { level: "DARURAT", min_score: 70, display_order: 4 }
];

const incidentSeed = [
  { n: 1, resident: 4, device: "JAGA-0004", severity: "SIAGA", status: "ACKNOWLEDGED", description: "Air mulai masuk rumah; warga pasca-stroke tidak dapat berjalan. (dummy)", createdAgo: 25 * 60_000, updates: ["NEW", "ACKNOWLEDGED"] },
  { n: 2, resident: 5, device: "JAGA-0005", severity: "SIAGA", status: "SAFE", description: "Warga lansia tinggal sendiri, rumah tergenang. (dummy)", createdAgo: 2 * DAY, updates: ["NEW", "ACKNOWLEDGED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "EVACUATED", "SAFE"] }
];

export interface DemoData {
  tables: Record<string, Row[]>;
  accounts: typeof DEMO_ACCOUNTS;
  requiredFactors: string[];
  deviceKeys: Array<{ deviceId: string; key: string }>;
  gatewayKeys: Array<{ gatewayId: string; key: string }>;
}

export function buildDemoData(): DemoData {
  const created = ago(30 * DAY);
  const tables: Record<string, Row[]> = {};
  const push = (table: string, row: Row) => { (tables[table] ??= []).push(row); };
  const villageId = id("10000000", village.n);
  const desaProfile = id("50000000", 2);

  const hamletOf = (n: number) => hamlets.find(item => item.n === n)!;
  const residentPoint = (resident: ResidentSeed) => {
    const center = hamletOf(resident.hamlet);
    return { lat: Number((center.lat + resident.at[0]).toFixed(6)), lng: Number((center.lng + resident.at[1]).toFixed(6)) };
  };
  const residentOf = (n: number | null) => (n === null ? null : residentSeed.find(entry => entry.n === n) ?? null);

  tables.provinces = provinces.map(row => ({ ...row }));
  tables.regencies = regencies.map(row => ({ ...row }));
  tables.districts = districts.map(row => ({ ...row }));
  tables.villages = [{
    id: villageId,
    government_code: village.code,
    district_id: "110818",
    name: village.name,
    district: "Kecamatan Langkahan",
    province: "Aceh",
    regency: "Kabupaten Aceh Utara",
    latitude: village.lat,
    longitude: village.lng,
    center: point(village.lat, village.lng),
    access_notes: village.access,
    population: village.population,
    active: true,
    created_at: created
  }];
  tables.hamlets = hamlets.map(hamlet => ({
    id: id("11000000", hamlet.n),
    village_id: villageId,
    name: hamlet.name,
    created_at: created
  }));

  tables.organizations = organizations.map(org => ({
    id: id("40000000", org.n),
    name: org.name,
    type: org.type,
    email: org.email,
    phone: null,
    address: null,
    active: true,
    created_at: created
  }));
  tables.organization_service_areas = [];
  DEMO_ACCOUNTS.forEach(account => {
    push("organization_service_areas", { organization_id: id("40000000", account.org), village_id: villageId });
  });
  tables.profiles = DEMO_ACCOUNTS.map((account, index) => ({
    id: id("50000000", index + 1),
    display_name: account.displayName,
    email: account.email,
    phone: null,
    role: account.role,
    title: account.title,
    active: true,
    created_at: created,
    updated_at: created
  }));
  tables.organization_members = DEMO_ACCOUNTS.map((account, index) => ({
    organization_id: id("40000000", account.org),
    profile_id: id("50000000", index + 1),
    title: account.title,
    is_admin: account.role === "PUSAT",
    joined_at: created
  }));

  tables.vulnerability_types = vulnerabilitySeed.map((vuln, index) => ({
    id: id("6a000000", index + 1),
    category: vuln.category,
    code: vuln.code,
    name: vuln.name,
    description: vuln.description,
    default_assistance: vuln.assistance,
    active: true
  }));
  const typeByCode = new Map(tables.vulnerability_types.map(row => [String(row.code), row.id]));

  tables.residents = residentSeed.map(resident => {
    const at = residentPoint(resident);
    return {
      id: id("20000000", resident.n),
      village_id: villageId,
      hamlet_id: id("11000000", resident.hamlet),
      full_name: resident.name,
      birth_date: resident.birth,
      gender: resident.gender,
      phone: `0812-0000-0${200 + resident.n}`,
      address: `${hamletOf(resident.hamlet).name}, ${village.name} (alamat dummy)`,
      latitude: at.lat,
      longitude: at.lng,
      location: point(at.lat, at.lng),
      lives_alone: resident.alone,
      evacuation_ability: resident.ability,
      time_critical_medical: resident.critical,
      mobility_notes: resident.mobility,
      communication_notes: resident.communication,
      medical_notes: resident.medical,
      evacuation_notes: resident.evacuation,
      active: true,
      consented_at: created,
      created_at: created,
      updated_at: created
    };
  });
  tables.resident_vulnerabilities = [];
  tables.resident_contacts = [];
  for (const resident of residentSeed) {
    for (const [code, severity, note] of resident.vulns) {
      const typeId = typeByCode.get(code);
      if (!typeId) continue;
      push("resident_vulnerabilities", {
        resident_id: id("20000000", resident.n),
        vulnerability_type_id: typeId,
        severity,
        assistance_notes: note,
        verified_by: desaProfile,
        verified_at: created
      });
    }
    for (const [name, relationship, phone, livesWith] of resident.contacts) {
      push("resident_contacts", {
        id: id("0b000000", (tables.resident_contacts?.length ?? 0) + 1),
        resident_id: id("20000000", resident.n),
        name,
        relationship,
        phone,
        is_primary: true,
        lives_with_resident: livesWith
      });
    }
  }

  const deviceKeys: DemoData["deviceKeys"] = [];
  tables.devices = deviceSeed.map(device => {
    const resident = residentOf(device.resident);
    const at = resident ? residentPoint(resident) : { lat: village.lat, lng: village.lng };
    const key = `jrk_${sha256Hex(`${device.id}:${DEMO_ACCOUNTS[0]?.email ?? "jaga"}`).slice(0, 32)}`;
    deviceKeys.push({ deviceId: device.id, key });
    return {
      id: device.id,
      village_id: villageId,
      owner_name: resident?.name ?? "",
      hardware_serial: `SN-${device.id}-0001`,
      model: "JAGA Rumah v1",
      firmware_version: "1.4.2",
      status: device.status,
      latitude: at.lat,
      longitude: at.lng,
      battery: device.battery,
      online: device.online,
      last_seen_at: device.online ? ago(3 * 60_000) : ago(3 * HOUR),
      auth_key_hash: sha256Hex(key),
      notes: "",
      created_at: created
    };
  });
  tables.device_assignments = deviceSeed
    .filter(device => device.resident !== null)
    .map((device, index) => ({
      id: id("30000000", index + 1),
      device_id: device.id,
      resident_id: id("20000000", device.resident as number),
      assigned_by: desaProfile,
      assigned_at: created,
      unassigned_at: null,
      notes: null
    }));

  const gatewayKeys: DemoData["gatewayKeys"] = [];
  tables.gateways = gatewaySeed.map(gateway => {
    const key = `gtw_${sha256Hex(`${gateway.code}:${DEMO_ACCOUNTS[0]?.email ?? "jaga"}`).slice(0, 32)}`;
    gatewayKeys.push({ gatewayId: gateway.code, key });
    return {
      id: id("e0000000", gateway.n),
      village_id: villageId,
      gateway_code: gateway.code,
      name: gateway.name,
      latitude: gateway.lat,
      longitude: gateway.lng,
      firmware_version: "0.9.1",
      online: gateway.online,
      last_seen_at: gateway.online ? ago(2 * 60_000) : ago(2 * DAY),
      auth_key_hash: sha256Hex(key),
      created_at: created
    };
  });
  tables.device_telemetry = [];

  tables.hazard_zones = hazardSeed.map(zone => ({
    id: id("80000000", zone.n),
    village_id: villageId,
    name: zone.name,
    hazard_type: zone.hazard_type,
    risk_level: zone.risk_level,
    center_latitude: zone.lat,
    center_longitude: zone.lng,
    radius_meters: zone.radius,
    area: circle(zone.lat, zone.lng, zone.radius),
    access_notes: zone.notes,
    active_from: ago(6 * HOUR),
    active_until: null,
    active: true,
    created_at: created
  }));
  tables.evacuation_shelters = shelterSeed.map(shelter => ({
    id: id("70000000", shelter.n),
    village_id: villageId,
    name: shelter.name,
    address: shelter.address,
    latitude: shelter.lat,
    longitude: shelter.lng,
    location: point(shelter.lat, shelter.lng),
    capacity: shelter.capacity,
    accessibility_notes: shelter.notes,
    active: true
  }));

  tables.rescue_teams = teamSeed.map(team => ({
    id: id("60000000", team.n),
    organization_id: id("40000000", team.org),
    name: team.name,
    call_sign: team.call_sign,
    vehicle_info: team.vehicle,
    status: team.status,
    home_village_id: villageId,
    latitude: team.lat,
    longitude: team.lng,
    capacity: 8,
    active: true,
    created_at: created
  }));
  tables.rescue_team_members = teamSeed.map(team => ({
    team_id: id("60000000", team.n),
    profile_id: id("50000000", team.leader),
    is_leader: true
  }));

  tables.priority_rule_sets = [
    {
      id: id("c0000000", 1),
      name: "Aturan Prioritas DUMMY (bukan standar resmi)",
      disaster_type: null,
      version: 1,
      status: "ACTIVE",
      description: "Aturan contoh untuk demo. Bobot nyata harus disahkan JAGA Pusat bersama BPBD, Dinsos, dan organisasi penyandang disabilitas.",
      applies_from: created,
      applies_until: null,
      created_by: id("50000000", 1),
      approved_by: id("50000000", 1),
      approved_at: created,
      created_at: created
    },
    {
      id: id("c0000000", 2),
      name: "Aturan Prioritas DUMMY - revisi 2 (draf)",
      disaster_type: null,
      version: 2,
      status: "DRAFT",
      description: "Draf contoh: menaikkan bobot akses terisolasi.",
      applies_from: null,
      applies_until: null,
      created_by: id("50000000", 1),
      approved_by: null,
      approved_at: null,
      created_at: ago(2 * DAY)
    }
  ];
  tables.priority_rules = ruleSeed.map((rule, index) => ({
    id: id("d0000000", index + 1),
    rule_set_id: id("c0000000", 1),
    factor_key: rule.key,
    operator: rule.op,
    comparison_value: rule.value,
    score_delta: rule.delta,
    explanation: rule.text,
    display_order: rule.order,
    active: true,
    created_at: created
  }));
  tables.priority_rules.push({
    id: id("d0000000", 100),
    rule_set_id: id("c0000000", 2),
    factor_key: "terrain_isolation",
    operator: "GTE",
    comparison_value: 4,
    score_delta: 15,
    explanation: "Akses menuju desa sulit atau mudah terputus (bobot dinaikkan pada draf).",
    display_order: 130,
    active: true,
    created_at: ago(2 * DAY)
  });
  tables.priority_thresholds = [
    ...thresholdSeed.map(threshold => ({ rule_set_id: id("c0000000", 1), ...threshold })),
    ...thresholdSeed.map(threshold => ({ rule_set_id: id("c0000000", 2), ...threshold }))
  ];

  tables.priority_recommendations = [];
  tables.priority_overrides = [];
  tables.evacuation_routes = [];
  incidentSeed.forEach(incident => {
    const resident = residentOf(incident.resident);
    const at = resident ? residentPoint(resident) : { lat: village.lat, lng: village.lng };
    const incidentId = id("90000000", incident.n);
    const createdAt = ago(incident.createdAgo);
    const closed = incident.status === "SAFE";
    push("incidents", {
      id: incidentId,
      village_id: villageId,
      resident_id: incident.resident ? id("20000000", incident.resident) : null,
      device_id: incident.device,
      disaster_type: "BANJIR",
      severity: incident.severity,
      affected_count: 1,
      owner_name: resident?.name ?? "Tidak diketahui",
      latitude: at.lat,
      longitude: at.lng,
      status: incident.status,
      description: incident.description,
      resolution_notes: closed ? "Dievakuasi ke titik kumpul usulan; kondisi baik. (dummy)" : null,
      source: "DEVICE",
      created_at: createdAt,
      acknowledged_at: incident.updates.length > 1 ? new Date(Date.parse(createdAt) + 4 * 60_000).toISOString() : null,
      evacuated_at: incident.updates.includes("EVACUATED") ? new Date(Date.parse(createdAt) + 40 * 60_000).toISOString() : null,
      closed_at: closed ? new Date(Date.parse(createdAt) + 55 * 60_000).toISOString() : null,
      updated_at: ago(Math.max(60_000, incident.createdAgo / 4))
    });
    incident.updates.forEach((status, step) => {
      push("incident_status_history", {
        incident_id: incidentId,
        from_status: step === 0 ? null : incident.updates[step - 1],
        to_status: status,
        changed_by: status === "NEW" ? null : desaProfile,
        notes: null,
        created_at: new Date(Date.parse(createdAt) + step * 6 * 60_000).toISOString()
      });
    });
    const assessmentId = id("a0000000", incident.n);
    push("incident_assessments", {
      id: assessmentId,
      incident_id: incidentId,
      assessed_by: desaProfile,
      source: "DESA",
      summary: "Kondisi dikonfirmasi petugas desa lewat pengamatan langsung. (dummy)",
      observed_at: createdAt,
      created_at: createdAt
    });
    const factors: Array<[string, unknown]> = incident.n === 1 ? [["flood_depth_cm", 40], ["structure_risk", 2]] : [["flood_depth_cm", 30]];
    factors.forEach(([key, value]) => {
      push("assessment_factors", { assessment_id: assessmentId, factor_key: key, factor_value: value, source_note: "Pengamatan Desa (dummy)", recorded_at: createdAt });
    });
  });

  // Satu penugasan selesai untuk insiden lama.
  tables.incident_assignments = [{
    id: id("ac000000", 1),
    incident_id: id("90000000", 2),
    team_id: id("60000000", 2),
    assigned_by: desaProfile,
    assigned_at: ago(2 * DAY - 10 * 60_000),
    accepted_at: ago(2 * DAY - 15 * 60_000),
    completed_at: ago(2 * DAY - 55 * 60_000)
  }];
  tables.team_location_history = [];

  // Riwayat alarm lama (kedaluwarsa).
  const oldAlertAt = 3 * DAY;
  tables.alert_commands = [{
    id: id("0a000000", 1),
    village_id: villageId,
    target: "Seluruh desa",
    target_type: "DESA",
    target_reference: null,
    severity: "WASPADA",
    message: "Waspada: permukaan sungai naik, pantau informasi dari petugas desa. (dummy)",
    status: "ACKNOWLEDGED",
    requested_by: desaProfile,
    created_at: ago(oldAlertAt),
    expires_at: ago(oldAlertAt - 2 * HOUR)
  }];
  tables.command_receipts = deviceSeed
    .filter(device => device.resident !== null)
    .map((device, index) => ({
      id: id("0f000000", index + 1),
      command_id: id("0a000000", 1),
      device_id: device.id,
      status: device.online ? "ACKNOWLEDGED" : "FAILED",
      sent_at: ago(oldAlertAt - 60_000),
      acknowledged_at: device.online ? ago(oldAlertAt - 2 * 60_000) : null,
      failure_reason: device.online ? null : "Perangkat tidak menjawab dalam 60 detik."
    }));

  tables.notifications = [];
  tables.audit_logs = [];
  tables.sync_operations = [];
  tables.attachments = [];

  tables.internal_accounts = DEMO_ACCOUNTS.map((account, index) => ({
    id: id("a1000000", index + 1),
    email: account.email.toLowerCase(),
    display_name: account.displayName,
    password_hash: hashPassword(account.password),
    role: account.role,
    organization_id: id("40000000", account.org),
    profile_id: id("50000000", index + 1),
    village_ids: account.villages.map(() => villageId),
    must_change_password: false,
    active: true,
    created_at: created
  }));

  return { tables, accounts: DEMO_ACCOUNTS, requiredFactors: REQUIRED_FACTORS, deviceKeys, gatewayKeys };
}

export async function loadDemoData(store: MemoryStore): Promise<DemoData> {
  const demo = buildDemoData();
  for (const [table, rows] of Object.entries(demo.tables)) store.hydrate(table, rows);
  return demo;
}

/**
 * Fixture khusus tes (JAGA_TEST_FIXTURES=true, hanya mode memori): satu desa lain berisi satu warga berkalung,
 * untuk menguji isolasi antar desa. Tidak termasuk data pilot dan tidak dimuat pada pemakaian biasa.
 */
export async function addIsolationFixture(store: MemoryStore): Promise<void> {
  const created = nowIso();
  const villageId = id("10000000", 9);
  await store.insert("villages", {
    id: villageId, government_code: "TEST-FIXTURE", district_id: "110818", name: "Desa Uji Isolasi (fixture tes)",
    district: "Kecamatan Langkahan", province: "Aceh", regency: "Kabupaten Aceh Utara", latitude: 4.9, longitude: 97.5,
    access_notes: "Fixture tes.", population: null, active: true, created_at: created
  });
  await store.insert("hamlets", { id: id("11000000", 9), village_id: villageId, name: "Dusun Fixture", created_at: created });
  await store.insert("residents", {
    id: id("20000000", 90), village_id: villageId, hamlet_id: id("11000000", 9), full_name: "Warga Fixture Tes", birth_date: "1950-01-01",
    gender: "PEREMPUAN", phone: "0812-0000-9000", address: "Fixture tes", latitude: 4.9001, longitude: 97.5001, lives_alone: true,
    evacuation_ability: "PERLU_BANTUAN", time_critical_medical: false, mobility_notes: null, communication_notes: null,
    medical_notes: null, evacuation_notes: null, active: true, consented_at: created, created_at: created, updated_at: created
  });
  await store.insert("resident_vulnerabilities", {
    resident_id: id("20000000", 90), vulnerability_type_id: id("6a000000", 7), severity: 3, assistance_notes: null, verified_by: null, verified_at: created
  });
  await store.insert("devices", {
    id: "JAGA-9001", village_id: villageId, owner_name: "Warga Fixture Tes", hardware_serial: "SN-JAGA-9001", model: "JAGA Rumah v1",
    firmware_version: "1.4.2", status: "ASSIGNED", latitude: 4.9001, longitude: 97.5001, battery: 80, online: true,
    last_seen_at: created, auth_key_hash: sha256Hex("fixture"), notes: "", created_at: created
  });
  await store.insert("device_assignments", {
    id: id("30000000", 90), device_id: "JAGA-9001", resident_id: id("20000000", 90), assigned_by: null, assigned_at: created, unassigned_at: null, notes: null
  });
}

export const demoTimestamp = nowIso;
