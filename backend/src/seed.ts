import { hashPassword, nowIso, sha256Hex } from "./lib.js";
import type { MemoryStore } from "./store-memory.js";
import type { Row } from "./types.js";

/**
 * DATA PILOT: Gampong Leubok Pusaka (Kec. Langkahan, Kab. Aceh Utara).
 *
 * Yang NYATA (publik): kode wilayah, nama, titik tengah desa (OpenStreetMap), nama kawasan Tanah Merah. Koordinat desa dari OpenStreetMap (place=village, dicek: tepat di jalan terpetakan).
 * Yang DUMMY: seluruh warga, kontak, kerentanan, kalung, gateway, tim, insiden, alarm, aturan skor, titik kumpul, zona bahaya
 * (batas dan koordinat rumah dibuat acak di sekitar titik tengah desa, tidak menunjuk rumah siapa pun).
 * Kawasan Tanah Merah (laporan media) nyata; titik lain di desa hanya penyebar koordinat dummy. Alasan pemilihan lokasi dan dasar prioritas: docs/JAGA.md.
 */

/** UUID deterministik supaya data demo sama antara mode memori dan seed Supabase. */
const id = (group: string, n: number) => `${group}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const DEMO_ACCOUNTS = [
  {
    email: "pusat@jaga.id",
    password: "JagaPusat2026!",
    displayName: "Rani Puspita",
    title: "Koordinator Nasional JAGA",
    role: "PUSAT" as const,
    org: 1,
    villages: [] as number[]
  },
  {
    email: "desa.leubokpusaka@jaga.id",
    password: "JagaDesa2026!",
    displayName: "Zulfahmi",
    title: "Operator JAGA Desa Leubok Pusaka",
    role: "DESA" as const,
    org: 2,
    villages: [1]
  },
  {
    email: "rescue.bpbd@jaga.id",
    password: "JagaRescue2026!",
    displayName: "Dimas Prakoso",
    title: "Komandan TRC BPBD Aceh Utara",
    role: "RESCUE" as const,
    org: 3,
    villages: [1, 2, 3]
  },
  {
    email: "rescue.damkar@jaga.id",
    password: "JagaRescue2026!",
    displayName: "Bayu Setiawan",
    title: "Komandan Damkar Aceh Utara",
    role: "RESCUE" as const,
    org: 4,
    villages: [1, 2, 3]
  },
  {
    email: "desa.seureuke@jaga.id",
    password: "JagaDesa2026!",
    displayName: "Muhammad Nasir",
    title: "Operator JAGA Desa Seureuke",
    role: "DESA" as const,
    org: 5,
    villages: [2]
  },
  {
    email: "desa.buketlinteung@jaga.id",
    password: "JagaDesa2026!",
    displayName: "Rahmatillah",
    title: "Operator JAGA Desa Buket Linteung",
    role: "DESA" as const,
    org: 6,
    villages: [3]
  },
  {
    email: "rescue.siagadesa@jaga.id",
    password: "JagaRescue2026!",
    displayName: "Ilyas Hasballah",
    title: "Ketua Tim Siaga Gampong Leubok Pusaka",
    role: "RESCUE" as const,
    org: 7,
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
  n: 1, code: "1108182021", name: "Gampong Leubok Pusaka", lat: 4.8479, lng: 97.4728, population: 2286,
  access: "Kawasan Tanah Merah di desa ini terendam banjir November 2025 (laporan media). Jalan desa sempit dan rawan genangan saat sungai meluap."
};

const organizations = [
  { n: 1, name: "JAGA Pusat", type: "PUSAT", email: "pusat@jaga.id" },
  { n: 2, name: "Pemerintah Gampong Leubok Pusaka", type: "PEMERINTAH_DESA", email: "desa.leubokpusaka@jaga.id" },
  { n: 3, name: "BPBD Kabupaten Aceh Utara", type: "BPBD", email: "rescue.bpbd@jaga.id" },
  { n: 4, name: "Damkar Kabupaten Aceh Utara", type: "DAMKAR", email: "rescue.damkar@jaga.id" },
  { n: 5, name: "Pemerintah Gampong Seureuke", type: "PEMERINTAH_DESA", email: "desa.seureuke@jaga.id" },
  { n: 6, name: "Pemerintah Gampong Buket Linteung", type: "PEMERINTAH_DESA", email: "desa.buketlinteung@jaga.id" },
  { n: 7, name: "Tim Siaga Gampong Leubok Pusaka", type: "RELAWAN", email: "rescue.siagadesa@jaga.id" }
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

/** Titik acuan hanya untuk menyebar koordinat dummy rumah di sekitar desa; bukan wilayah administratif. */
const clusters = [
  { n: 1, name: "Kawasan Tanah Merah", lat: 4.8484, lng: 97.4728 },
  { n: 2, name: "Titik acuan 2", lat: 4.8447, lng: 97.4765 },
  { n: 3, name: "Titik acuan 3", lat: 4.8511, lng: 97.4781 }
];

type Ability = "MANDIRI" | "PERLU_BANTUAN" | "TIDAK_BISA_SENDIRI";

interface ResidentSeed {
  n: number;
  cluster: number;
  name: string;
  birth: string;
  gender: "LAKI_LAKI" | "PEREMPUAN" | "LAINNYA";
  /** Selisih derajat dari titik acuan (±0.001 derajat sekitar 110 m). */
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
    n: 1, cluster: 1, name: "Teuku Razali", birth: "1983-07-02", gender: "LAKI_LAKI", at: [-0.0005, 0.0004], alone: false,
    ability: "TIDAK_BISA_SENDIRI", critical: false,
    mobility: "Menggunakan kursi roda.", communication: "Baik.", medical: null,
    evacuation: "Rumah berundak; perlu kursi roda dan dua orang untuk mengangkat.",
    vulns: [["TUNADAKSA", 5, "Siapkan kursi roda dan jalur tanpa tangga."]],
    contacts: [["Nurlaila", "Istri", "0812-0000-0101", true]]
  },
  {
    n: 2, cluster: 1, name: "Syarifah Aini", birth: "1996-11-21", gender: "PEREMPUAN", at: [0.0007, 0.0002], alone: false,
    ability: "MANDIRI", critical: false,
    mobility: null, communication: "Tunarungu; gunakan teks dan isyarat, alarm suara tidak terdengar.", medical: null,
    evacuation: "Dapat berjalan sendiri bila diberi tanda cahaya atau getaran.",
    vulns: [["TUNARUNGU", 4, "Peringatan cahaya dan getaran, pendamping komunikasi."]],
    contacts: [["Hasanah", "Ibu", "0812-0000-0102", true]]
  },
  {
    n: 3, cluster: 2, name: "Ismail Hasan", birth: "1971-09-18", gender: "LAKI_LAKI", at: [-0.0006, 0.0003], alone: false,
    ability: "PERLU_BANTUAN", critical: false,
    mobility: "Berjalan dengan pendamping.", communication: "Tunanetra; berikan arahan suara.", medical: null,
    evacuation: "Pendamping keluarga di rumah; sebutkan arah dan hambatan secara verbal.",
    vulns: [["TUNANETRA", 4, "Panduan suara dan pendamping mobilitas."]],
    contacts: [["Nuraini", "Istri", "0812-0000-0103", true]]
  },
  // --- Lansia
  {
    n: 4, cluster: 2, name: "Abdullah Yusuf", birth: "1944-05-30", gender: "LAKI_LAKI", at: [-0.0003, -0.0004], alone: true,
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
    n: 5, cluster: 1, name: "Cut Maryam", birth: "1949-03-14", gender: "PEREMPUAN", at: [0.0004, -0.0006], alone: true,
    ability: "PERLU_BANTUAN", critical: false,
    mobility: "Berjalan dengan tongkat, tidak kuat berjalan jauh.", communication: "Dapat mendengar, bicara pelan.", medical: null,
    evacuation: "Perlu satu pendamping dan jalur tanpa genangan.",
    vulns: [["LANSIA", 4, "Periksa kondisi dan bantu berjalan."]],
    contacts: [["Zulkifli", "Anak", "0812-0000-0105", false]]
  },
  {
    n: 6, cluster: 3, name: "Nurmala Dewi", birth: "1957-12-05", gender: "PEREMPUAN", at: [0.0003, -0.0005], alone: false,
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
    n: 7, cluster: 2, name: "Mahdalena", birth: "1993-02-09", gender: "PEREMPUAN", at: [0.0005, 0.0006], alone: false,
    ability: "MANDIRI", critical: true,
    mobility: null, communication: "Baik.", medical: "Hamil 8 bulan, perkiraan lahir dalam sekitar 2 minggu; kontrol di bidan desa.",
    evacuation: "Butuh kendaraan, hindari berjalan jauh; hubungi bidan desa.",
    vulns: [["IBU_HAMIL", 5, "Persalinan dekat: prioritaskan transportasi aman dan bidan."]],
    contacts: [["Syamsul", "Suami", "0812-0000-0107", true]]
  },
  {
    n: 8, cluster: 3, name: "Rahmi", birth: "1998-08-12", gender: "PEREMPUAN", at: [-0.0004, 0.0006], alone: false,
    ability: "MANDIRI", critical: false,
    mobility: null, communication: "Baik.", medical: "Hamil 5 bulan, sehat.",
    evacuation: "Dapat evakuasi sendiri bersama suami.",
    vulns: [["IBU_HAMIL", 2, "Pantau kondisi."]],
    contacts: [["Fadhil", "Suami", "0812-0000-0108", true]]
  },
  {
    n: 9, cluster: 1, name: "Nurul Huda", birth: "1995-03-27", gender: "PEREMPUAN", at: [-0.0007, -0.0003], alone: true,
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
  { n: 1, code: "GW-LEUBOKPUSAKA-01", name: "Gateway Kawasan Tanah Merah", lat: 4.8488, lng: 97.4731, online: true }
];

const hazardSeed = [
  { n: 1, name: "Dataran banjir kawasan Tanah Merah", hazard_type: "BANJIR", risk_level: 5, lat: 4.8484, lng: 97.4728, radius: 450, notes: "Banjir 26 November 2025 dilaporkan mencapai sekitar 5 meter di kawasan ini (Kompas)." },
  { n: 2, name: "Titik rendah", hazard_type: "BANJIR", risk_level: 4, lat: 4.8447, lng: 97.4765, radius: 280, notes: "Titik rendah rawan genangan saat sungai meluap." }
];

const shelterSeed = [
  { n: 1, name: "Meunasah Leubok Pusaka", address: "Gampong Leubok Pusaka", lat: 4.8500, lng: 97.4754, capacity: 100, notes: "Titik kumpul utama warga." },
  { n: 2, name: "Lapangan desa", address: "Gampong Leubok Pusaka", lat: 4.8521, lng: 97.4748, capacity: 150, notes: "Lahan terbuka untuk tenda darurat." },
  { n: 3, name: "Sekolah di Leubok Pusaka", address: "Gampong Leubok Pusaka", lat: 4.8477, lng: 97.4772, capacity: 60, notes: "Satu lantai; dipakai sebagai cadangan sementara." }
];

const teamSeed = [
  { n: 1, org: 3, name: "TRC BPBD Aceh Utara 01", call_sign: "TRC-01", vehicle: "Truk dan perahu karet", status: "AVAILABLE", leader: 3, lat: 4.8625, lng: 97.4765 },
  { n: 2, org: 3, name: "TRC BPBD Aceh Utara 02", call_sign: "TRC-02", vehicle: "Ambulans lapangan", status: "AVAILABLE", leader: 3, lat: 4.8628, lng: 97.4768 },
  { n: 3, org: 4, name: "Damkar Aceh Utara 01", call_sign: "DAMKAR-01", vehicle: "Perahu fiberglass", status: "AVAILABLE", leader: 4, lat: 4.862, lng: 97.476 },
  // Relawan desa juga bertugas sebagai JAGA Rescue: warga yang paling cepat tiba saat jalan terputus.
  { n: 4, org: 7, name: "Tim Siaga Gampong Leubok Pusaka", call_sign: "SIAGA-LP", vehicle: "Sepeda motor dan tandu", status: "AVAILABLE", leader: 7, lat: 4.8476, lng: 97.4735 }
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
  { n: 1, resident: 4, device: "JAGA-0004", severity: "SIAGA", status: "ACKNOWLEDGED", description: "Air mulai masuk rumah; warga pasca-stroke tidak dapat berjalan.", createdAgo: 25 * 60_000, updates: ["NEW", "ACKNOWLEDGED"] },
  { n: 2, resident: 5, device: "JAGA-0005", severity: "SIAGA", status: "SAFE", description: "Warga lansia tinggal sendiri, rumah tergenang.", createdAgo: 2 * DAY, updates: ["NEW", "ACKNOWLEDGED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "EVACUATED", "SAFE"] }
];


/**
 * Dua desa tetangga di Kecamatan Langkahan (koordinat titik tengah dari OpenStreetMap: place Seureke dan Buketlinteung).
 * Warga, kalung, titik kumpul, dan zona bahaya hanya data contoh; masing-masing desa berisi 3 warga (disabilitas, lansia, ibu hamil).
 */
const neighborSeed: Array<{
  n: number; name: string; lat: number; lng: number; access: string;
  hazard: { name: string; risk: number; dLat: number; dLng: number; radius: number; notes: string };
  shelter: { name: string; capacity: number; dLat: number; dLng: number; notes: string };
  residents: ResidentSeed[];
  devices: Array<{ id: string; battery: number; online: boolean }>;
}> = [
  {
    n: 2, name: "Gampong Seureuke", lat: 4.8913, lng: 97.4316,
    access: "Desa di tepi aliran sungai; jalan desa sempit dan dapat tergenang saat hujan deras.",
    hazard: { name: "Dataran rendah tepi sungai Seureuke", risk: 4, dLat: -0.0008, dLng: 0.0006, radius: 320, notes: "Rawan genangan saat sungai meluap." },
    shelter: { name: "Meunasah Gampong Seureuke", capacity: 80, dLat: 0.0012, dLng: -0.0006, notes: "Titik kumpul utama warga." },
    residents: [
      {
        n: 101, cluster: 0, name: "Fauzan Maulana", birth: "1999-04-11", gender: "LAKI_LAKI", at: [-0.0004, 0.0003], alone: false, ability: "PERLU_BANTUAN", critical: false,
        mobility: "Dapat berjalan, perlu didampingi karena mudah panik.", communication: "Instruksi singkat dan berulang; tinggal bersama ibu.",
        medical: null, evacuation: "Ibu mendampingi; perlu pendamping bila ibu tidak di rumah.",
        vulns: [["DISABILITAS_INTELEKTUAL", 3, "Perlu instruksi sederhana dan pendamping tepercaya"]],
        contacts: [["Salmah", "Ibu", "0812-0000-1101", true]]
      },
      {
        n: 102, cluster: 0, name: "Nurbaiti", birth: "1950-08-02", gender: "PEREMPUAN", at: [0.0006, 0.0004], alone: true, ability: "PERLU_BANTUAN", critical: false,
        mobility: "Berjalan dengan tongkat, tinggal sendiri.", communication: null, medical: "Tekanan darah tinggi.", evacuation: "Perlu didampingi menuju meunasah.",
        vulns: [["LANSIA", 3, "Stamina menurun"], ["PENYAKIT_KRONIS", 2, "Hipertensi"]],
        contacts: [["Hafidz", "Cucu", "0812-0000-1102", false]]
      },
      {
        n: 103, cluster: 0, name: "Cut Rosnita", birth: "1997-01-19", gender: "PEREMPUAN", at: [0.0002, -0.0007], alone: false, ability: "MANDIRI", critical: false,
        mobility: null, communication: null, medical: "Hamil 7 bulan, pemeriksaan rutin di bidan desa.", evacuation: "Butuh kendaraan bila harus mengungsi jauh.",
        vulns: [["IBU_HAMIL", 3, "Hamil 7 bulan"]],
        contacts: [["Razali", "Suami", "0812-0000-1103", true]]
      }
    ],
    devices: [{ id: "JAGA-0101", battery: 74, online: true }, { id: "JAGA-0102", battery: 58, online: true }, { id: "JAGA-0103", battery: 90, online: true }]
  },
  {
    n: 3, name: "Gampong Buket Linteung", lat: 4.9077, lng: 97.4699,
    access: "Desa dengan akses jalan utama; bagian belakang desa mudah terisolasi saat banjir.",
    hazard: { name: "Dataran banjir Buket Linteung", risk: 4, dLat: 0.0007, dLng: -0.0005, radius: 300, notes: "Tergenang saat banjir luapan." },
    shelter: { name: "Meunasah Gampong Buket Linteung", capacity: 90, dLat: -0.0011, dLng: 0.0008, notes: "Titik kumpul utama warga." },
    residents: [
      {
        n: 104, cluster: 0, name: "Zainal Abidin", birth: "1962-06-25", gender: "LAKI_LAKI", at: [-0.0003, -0.0004], alone: false, ability: "PERLU_BANTUAN", critical: false,
        mobility: "Berjalan dengan kruk; sulit melewati jalan becek.", communication: null, medical: null, evacuation: "Butuh bantuan melewati jalan tergenang.",
        vulns: [["TUNADAKSA", 3, "Pengguna kruk"]],
        contacts: [["Marlina", "Istri", "0812-0000-1104", true]]
      },
      {
        n: 105, cluster: 0, name: "Abu Bakar", birth: "1947-10-09", gender: "LAKI_LAKI", at: [0.0005, 0.0006], alone: true, ability: "TIDAK_BISA_SENDIRI", critical: true,
        mobility: "Lemah, sulit berjalan jauh, tinggal sendiri.", communication: null, medical: "Diabetes dengan suntik insulin harian.", evacuation: "Perlu diangkat; bawa insulin dan obat.",
        vulns: [["LANSIA", 4, "Lemah dan tinggal sendiri"], ["PENYAKIT_KRONIS", 4, "Diabetes, insulin"]],
        contacts: [["Syukri", "Keponakan", "0812-0000-1105", false]]
      },
      {
        n: 106, cluster: 0, name: "Maulida", birth: "1994-12-30", gender: "PEREMPUAN", at: [-0.0006, 0.0002], alone: false, ability: "MANDIRI", critical: false,
        mobility: null, communication: null, medical: "Hamil 5 bulan, kondisi sehat.", evacuation: null,
        vulns: [["IBU_HAMIL", 2, "Hamil 5 bulan"]],
        contacts: [["Jamaluddin", "Suami", "0812-0000-1106", true]]
      }
    ],
    devices: [{ id: "JAGA-0104", battery: 66, online: true }, { id: "JAGA-0105", battery: 31, online: true }, { id: "JAGA-0106", battery: 85, online: true }]
  }
];

/** Kalung yang masih di gudang JAGA Pusat (belum didistribusikan ke desa mana pun). */
const warehouseDevices = ["JAGA-0030", "JAGA-0031", "JAGA-0032"];

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

  const clusterOf = (n: number) => clusters.find(item => item.n === n)!;
  const residentPoint = (resident: ResidentSeed) => {
    const center = clusterOf(resident.cluster);
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
    head_name: "Keuchik Yusman",
    head_phone: "0812-1000-0001",
    active: true,
    created_at: created
  }];

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
    for (const n of account.villages) push("organization_service_areas", { organization_id: id("40000000", account.org), village_id: id("10000000", n) });
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
      full_name: resident.name,
      birth_date: resident.birth,
      gender: resident.gender,
      phone: `0812-0000-0${200 + resident.n}`,
      address: village.name,
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
      // JAGA-0001 sedang ±120 m dari rumah (contoh posisi GPS berbeda dari alamat).
      latitude: device.id === "JAGA-0001" ? Number((at.lat + 0.0011).toFixed(6)) : at.lat,
      longitude: at.lng,
      battery: device.battery,
      online: device.online,
      last_seen_at: device.online ? ago(3 * 60_000) : ago(3 * HOUR),
      // Posisi GPS terakhir (kalung dipakai di badan, jadi bisa berbeda dari rumah). Stok belum punya posisi GPS.
      location_at: device.resident === null ? null : device.online ? ago(2 * 60_000) : ago(3 * HOUR),
      location_accuracy_m: device.resident === null ? null : device.online ? 8 : 25,
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
  // Riwayat posisi beberapa kalung (6 titik dalam 90 menit) agar jejak dan telemetri dapat didemonstrasikan.
  tables.device_telemetry = ["JAGA-0001", "JAGA-0002", "JAGA-0003"].flatMap(deviceId => {
    const row = tables.devices!.find(item => item.id === deviceId)!;
    return [90, 75, 60, 45, 30, 15].map((minutes, i) => ({
      device_id: deviceId,
      gateway_id: id("e0000000", 1),
      battery: Math.min(100, Number(row.battery) + (5 - i)),
      signal_strength: -85 - i,
      temperature: null,
      payload: {},
      latitude: Number((Number(row.latitude) - (5 - i) * 0.0002).toFixed(6)),
      longitude: Number((Number(row.longitude) - (5 - i) * 0.0001).toFixed(6)),
      accuracy_m: 10 + i,
      gps_fix: true,
      satellites: 7 + (i % 3),
      recorded_at: ago(minutes * 60_000)
    }));
  });

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
      name: "Aturan Prioritas Banjir",
      disaster_type: null,
      version: 1,
      status: "ACTIVE",
      description: "Aturan prioritas penyelamatan: ancaman, kemampuan mengungsi, dan kebutuhan medis.",
      applies_from: created,
      applies_until: null,
      created_by: id("50000000", 1),
      approved_by: id("50000000", 1),
      approved_at: created,
      created_at: created
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
  tables.priority_thresholds = thresholdSeed.map(threshold => ({ rule_set_id: id("c0000000", 1), ...threshold }));

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
      resolution_notes: closed ? "Dievakuasi ke titik kumpul; kondisi baik." : null,
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
      summary: "Kondisi dikonfirmasi petugas desa lewat pengamatan langsung.",
      observed_at: createdAt,
      created_at: createdAt
    });
    const factors: Array<[string, unknown]> = incident.n === 1 ? [["flood_depth_cm", 40], ["structure_risk", 2]] : [["flood_depth_cm", 30]];
    factors.forEach(([key, value]) => {
      push("assessment_factors", { assessment_id: assessmentId, factor_key: key, factor_value: value, source_note: "Pengamatan Desa", recorded_at: createdAt });
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
    message: "Waspada: permukaan sungai naik, pantau informasi dari petugas desa.",
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

  const sosDevice = tables.devices.find(item => item.id === "JAGA-0004")!;
  tables.notifications = [{
    id: id("0d000000", 1),
    profile_id: null,
    village_id: villageId,
    resident_id: null,
    incident_id: id("90000000", 1),
    channel: "IN_APP",
    title: "SOS",
    body: `Kalung JAGA-0004 menekan SOS di ${village.name} · lokasi terakhir ${Number(sosDevice.latitude).toFixed(5)}, ${Number(sosDevice.longitude).toFixed(5)}`,
    destination: villageId,
    template_code: "SOS",
    status: "QUEUED",
    created_at: ago(25 * 60_000)
  }];
  tables.audit_logs = [];
  tables.sync_operations = [];
  tables.attachments = [];


  // --- Desa tetangga (data contoh)
  const neighborVillageId = (n: number) => id("10000000", n);
  const HEAD_NAMES = ["Imum Firmansyah", "Imum Hamidan"];
  neighborSeed.forEach((nv, vIndex) => {
    push("villages", {
      id: neighborVillageId(nv.n), government_code: null, district_id: "110818", name: nv.name, district: "Kecamatan Langkahan",
      province: "Aceh", regency: "Kabupaten Aceh Utara", latitude: nv.lat, longitude: nv.lng, center: point(nv.lat, nv.lng),
      access_notes: nv.access, population: null, head_name: HEAD_NAMES[vIndex] ?? null, head_phone: `0812-0000-02${10 + vIndex}`, active: true, created_at: created
    });
    push("hazard_zones", {
      id: id("80000000", 3 + vIndex), village_id: neighborVillageId(nv.n), name: nv.hazard.name, hazard_type: "BANJIR",
      risk_level: nv.hazard.risk, center_latitude: Number((nv.lat + nv.hazard.dLat).toFixed(6)), center_longitude: Number((nv.lng + nv.hazard.dLng).toFixed(6)),
      radius_meters: nv.hazard.radius, area: circle(nv.lat + nv.hazard.dLat, nv.lng + nv.hazard.dLng, nv.hazard.radius),
      access_notes: nv.hazard.notes, active_from: ago(6 * HOUR), active_until: null, active: true, created_at: created
    });
    const sLat = Number((nv.lat + nv.shelter.dLat).toFixed(6)), sLng = Number((nv.lng + nv.shelter.dLng).toFixed(6));
    push("evacuation_shelters", {
      id: id("70000000", 4 + vIndex), village_id: neighborVillageId(nv.n), name: nv.shelter.name, address: nv.name,
      latitude: sLat, longitude: sLng, location: point(sLat, sLng), capacity: nv.shelter.capacity,
      accessibility_notes: nv.shelter.notes, active: true
    });
    nv.residents.forEach((resident, rIndex) => {
      const lat = Number((nv.lat + resident.at[0]).toFixed(6)), lng = Number((nv.lng + resident.at[1]).toFixed(6));
      push("residents", {
        id: id("20000000", resident.n), village_id: neighborVillageId(nv.n), full_name: resident.name, birth_date: resident.birth,
        gender: resident.gender, phone: `0812-0000-0${200 + resident.n}`, address: nv.name, latitude: lat, longitude: lng, location: point(lat, lng),
        lives_alone: resident.alone, evacuation_ability: resident.ability, time_critical_medical: resident.critical,
        mobility_notes: resident.mobility, communication_notes: resident.communication, medical_notes: resident.medical, evacuation_notes: resident.evacuation,
        active: true, consented_at: created, created_at: created, updated_at: created
      });
      for (const [code, severity, note] of resident.vulns) {
        const typeId = typeByCode.get(code);
        if (typeId) push("resident_vulnerabilities", { resident_id: id("20000000", resident.n), vulnerability_type_id: typeId, severity, assistance_notes: note, verified_by: null, verified_at: created });
      }
      for (const [name, relationship, phone, livesWith] of resident.contacts) {
        push("resident_contacts", {
          id: id("0b000000", (tables.resident_contacts?.length ?? 0) + 1), resident_id: id("20000000", resident.n),
          name, relationship, phone, is_primary: true, lives_with_resident: livesWith
        });
      }
      const dev = nv.devices[rIndex]!;
      const key = `jrk_${sha256Hex(`${dev.id}:${DEMO_ACCOUNTS[0]?.email ?? "jaga"}`).slice(0, 32)}`;
      deviceKeys.push({ deviceId: dev.id, key });
      push("devices", {
        id: dev.id, village_id: neighborVillageId(nv.n), owner_name: resident.name, hardware_serial: `SN-${dev.id}-0001`, model: "JAGA Rumah v1",
        firmware_version: "1.4.2", status: "ASSIGNED", latitude: lat, longitude: lng, battery: dev.battery, online: dev.online,
        last_seen_at: ago(4 * 60_000), location_at: ago(3 * 60_000), location_accuracy_m: 9, auth_key_hash: sha256Hex(key), notes: "", created_at: created
      });
      push("device_assignments", {
        id: id("30000000", 100 + resident.n), device_id: dev.id, resident_id: id("20000000", resident.n),
        assigned_by: null, assigned_at: ago(10 * DAY), unassigned_at: null, notes: null
      });
    });
  });
  // Kalung cadangan di gudang JAGA Pusat: belum punya desa maupun posisi.
  warehouseDevices.forEach(deviceId => {
    const key = `jrk_${sha256Hex(`${deviceId}:${DEMO_ACCOUNTS[0]?.email ?? "jaga"}`).slice(0, 32)}`;
    deviceKeys.push({ deviceId, key });
    push("devices", {
      id: deviceId, village_id: null, owner_name: "", hardware_serial: `SN-${deviceId}-0001`, model: "JAGA Rumah v1", firmware_version: "1.4.2",
      status: "STOCK", latitude: null, longitude: null, battery: 100, online: false, last_seen_at: created, auth_key_hash: sha256Hex(key), notes: "", created_at: created
    });
  });


  // --- Gateway desa tetangga (SRS: satu titik komando per desa)
  neighborSeed.forEach(nv => {
    const code = `GW-${nv.name.replace("Gampong ", "").replace(/\s+/g, "").toUpperCase()}-01`;
    const key = `gtw_${sha256Hex(`${code}:${DEMO_ACCOUNTS[0]?.email ?? "jaga"}`).slice(0, 32)}`;
    gatewayKeys.push({ gatewayId: code, key });
    push("gateways", {
      id: id("e0000000", nv.n), village_id: neighborVillageId(nv.n), gateway_code: code, name: `Gateway ${nv.name.replace("Gampong ", "")}`,
      latitude: Number((nv.lat + 0.0004).toFixed(6)), longitude: Number((nv.lng + 0.0003).toFixed(6)), firmware_version: "0.9.1", online: true,
      last_seen_at: ago(3 * 60_000), auth_key_hash: sha256Hex(key), created_at: created
    });
  });

  // --- Pengumuman Pusat dan satu operasi lampau dengan laporan pasca-operasi Rescue
  tables.announcements = [
    {
      id: id("0c000000", 1), title: "Uji kesiapsiagaan kalung bulan ini",
      body: "Seluruh JAGA Desa diminta memeriksa baterai dan koneksi kalung warga. Laporkan kalung yang rusak lewat menu Kendala teknis.",
      priority: "INFO", created_by: id("50000000", 1), created_by_name: "Rani Puspita", created_at: ago(6 * HOUR), expires_at: new Date(Date.now() + 7 * DAY).toISOString(), village_ids: null
    },
    {
      id: id("0c000000", 2), title: "Posko banjir Tanah Merah siaga",
      body: "Gampong Seureuke dan Buket Linteung diminta menyiagakan posko dan memastikan perahu cadangan siap. Koordinasi melalui Pusat.",
      priority: "PENTING", created_by: id("50000000", 1), created_by_name: "Rani Puspita", created_at: ago(2 * HOUR), expires_at: new Date(Date.now() + 3 * DAY).toISOString(),
      village_ids: [id("10000000", 2), id("10000000", 3)]
    }
  ];
  const pastOp = id("c1000000", 1);
  tables.operations = [{
    id: pastOp, village_id: villageId, status: "CLOSED", severity: "SIAGA", disaster_type: "BANJIR", area_type: "DESA", water_level_cm: 90,
    note: "Sungai meluap sebagian kawasan Tanah Merah.", alert_command_id: null, opened_by: null, opened_at: ago(3 * DAY),
    closed_by: null, closed_at: ago(3 * DAY - 5 * HOUR), close_note: "Air surut; seluruh warga berkalung dipastikan aman.", created_at: ago(3 * DAY), updated_at: ago(3 * DAY - 5 * HOUR)
  }];
  tables.operation_reports = [{
    id: id("c2000000", 1), operation_id: pastOp, village_id: villageId, organization_id: id("40000000", 3), organization_name: "BPBD Kabupaten Aceh Utara",
    team_name: "TRC BPBD Aceh Utara 01", author_id: id("50000000", 3), author_name: "Dimas Prakoso",
    summary: "Tim menyisir kawasan Tanah Merah dari selatan. Dua warga lansia dievakuasi ke meunasah, satu rumah tidak terjangkau karena jalan tergenang setinggi 80 cm sehingga ditangani dengan perahu.",
    found_count: 3, evacuated_count: 2, not_found_count: 0, unreachable_count: 1, distance_km: 6.4, created_at: ago(3 * DAY - 6 * HOUR)
  }];

  // --- Kendala teknis contoh (Desa/Rescue -> Pusat)
  tables.support_tickets = [
    {
      id: id("0e000000", 1), village_id: villageId, organization_id: id("40000000", 2), reporter_id: id("50000000", 2), reporter_role: "DESA",
      reporter_name: "Zulfahmi", category: "KALUNG", priority: "SEDANG", title: "Baterai kalung JAGA-0004 cepat habis",
      description: "Sudah diisi daya penuh tetapi turun ke 14% dalam sehari. Mohon dikirim kalung pengganti.", status: "OPEN",
      resolution_note: null, created_at: ago(5 * HOUR), updated_at: ago(5 * HOUR), resolved_at: null
    },
    {
      id: id("0e000000", 2), village_id: null, organization_id: id("40000000", 3), reporter_id: id("50000000", 3), reporter_role: "RESCUE",
      reporter_name: "Dimas Prakoso", category: "APLIKASI", priority: "RENDAH", title: "Peta lambat dimuat di lokasi sinyal lemah",
      description: "Ubin peta lama muncul saat tim berada di luar desa.", status: "IN_PROGRESS",
      resolution_note: "Sedang diuji paket peta offline.", created_at: ago(2 * DAY), updated_at: ago(DAY), resolved_at: null
    }
  ];

  tables.internal_accounts = DEMO_ACCOUNTS.map((account, index) => ({
    id: id("a1000000", index + 1),
    email: account.email.toLowerCase(),
    display_name: account.displayName,
    title: account.title,
    password_hash: hashPassword(account.password),
    role: account.role,
    organization_id: id("40000000", account.org),
    profile_id: id("50000000", index + 1),
    village_ids: account.role === "PUSAT" ? null : account.villages.map(n => id("10000000", n)),
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
  await store.insert("residents", {
    id: id("20000000", 90), village_id: villageId, full_name: "Warga Fixture Tes", birth_date: "1950-01-01",
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
