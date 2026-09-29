import { hashPassword, nowIso, sha256Hex } from "./lib.js";
import type { MemoryStore } from "./store-memory.js";
import type { Row } from "./types.js";

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
    email: "desa.sukamaju@jaga.id",
    password: "JagaDesa2026!",
    displayName: "Ahmad Sopandi",
    title: "Ketua Tim Desa Sukamaju",
    role: "DESA" as const,
    org: 2,
    villages: [1]
  },
  {
    email: "desa.sukawening@jaga.id",
    password: "JagaDesa2026!",
    displayName: "Yulianti Ningsih",
    title: "Pengelola Desa Sukawening",
    role: "DESA" as const,
    org: 3,
    villages: [2]
  },
  {
    email: "rescue.bpbd@jaga.id",
    password: "JagaRescue2026!",
    displayName: "Dimas Prakoso",
    title: "Komandan Tim Rescue",
    role: "RESCUE" as const,
    org: 4,
    villages: [1, 2, 3, 4, 5, 6]
  },
  {
    email: "rescue.damkar@jaga.id",
    password: "JagaRescue2026!",
    displayName: "Bayu Setiawan",
    title: "Parla Damkar-evac",
    role: "RESCUE" as const,
    org: 5,
    villages: [1, 2, 3]
  }
];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const provinces = [
  { id: "32", name: "Jawa Barat" },
  { id: "34", name: "DI Yogyakarta" }
];

const regencies = [
  { id: "3205", province_id: "32", name: "Kabupaten Garut" },
  { id: "3216", province_id: "32", name: "Kabupaten Sumedang" },
  { id: "3402", province_id: "34", name: "Kabupaten Bantul" }
];

const districts = [
  { id: "320501", regency_id: "3205", name: "Kecamatan Sukamaju" },
  { id: "320507", regency_id: "3205", name: "Kecamatan Cisurupan" },
  { id: "320514", regency_id: "3205", name: "Kecamatan Pameungpeuk" },
  { id: "320531", regency_id: "3205", name: "Kecamatan Bayongbong" },
  { id: "321601", regency_id: "3216", name: "Kecamatan Sumedang Selatan" },
  { id: "340205", regency_id: "3402", name: "Kecamatan Jetis" }
];

const villageSeed: Array<{ n: number; code: string; district_id: string; name: string; regency: string; lat: number; lng: number; access: string }> = [
  { n: 1, code: "3205012001", district_id: "320501", name: "Desa Sukamaju", regency: "Kabupaten Garut", lat: -7.2279, lng: 107.9087, access: "Jalan desa beton, dua dusun terisolasi diseite lereng." },
  { n: 2, code: "3205012002", district_id: "320501", name: "Desa Sukawening", regency: "Kabupaten Garut", lat: -7.2145, lng: 107.883, access: "Jalan sempit tanpa aspal menuju dusun Cerme." },
  { n: 3, code: "3205072003", district_id: "320507", name: "Desa Cisurupan", regency: "Kabupaten Garut", lat: -7.193, lng: 107.953, access: "Jalan utama desa terbuka,countries jalur pasar." },
  { n: 4, code: "3205142004", district_id: "320514", name: "Desa Pameungpeuk", regency: "Kabupaten Garut", lat: -7.186, lng: 107.738, access: "Jalan tanpa aspal, sering tergenang air." },
  { n: 5, code: "3205312005", district_id: "320531", name: "Desa Bayongbong", regency: "Kabupaten Garut", lat: -7.189, lng: 107.649, access: "Jalan menanjak, hanya satu arah masuk dan keluar." },
  { n: 6, code: "3216012006", district_id: "321601", name: "Desa Suralaya", regency: "Kabupaten Sumedang", lat: -7.101, lng: 107.933, access: "Jalan dataran, mudah diakses kendaraan berat." }
];

const organizations = [
  { n: 1, name: "Pusat Kebencanaan JAGA", type: "PUSAT", email: "pusat@jaga.id", phone: "0262-000111" },
  { n: 2, name: "Pemerintah Desa Sukamaju", type: "PEMERINTAH_DESA", email: "desa.sukamaju@jaga.id" },
  { n: 3, name: "Pemerintah Desa Sukawening", type: "PEMERINTAH_DESA", email: "desa.sukawening@jaga.id" },
  { n: 4, name: "BPBD Kabupaten Garut", type: "BPBD", email: "rescue.bpbd@jaga.id", phone: "0262-222333" },
  { n: 5, name: "Damkar Kabupaten Garut", type: "DAMKAR", email: "rescue.damkar@jaga.id", phone: "0262-444555" }
];

const vulnerabilitySeed: Array<{ code: string; category: string; name: string; assistance: string; description: string }> = [
  { code: "TUNARUNGU", category: "DISABILITAS", name: "Tunarungu", assistance: "Gunakan cahaya, getaran, teks, dan pendamping komunikasi.", description: "Gangguan pendengaran; peringatan perlu kombinasi media visual dan getaran." },
  { code: "TUNANETRA", category: "DISABILITAS", name: "Tunanetra", assistance: "Berikan panduan suara dan pendamping mobilitas.", description: "Gangguan penglihatan; arahan harus berupa suara dan rambu verbal." },
  { code: "TUNADAKSA", category: "DISABILITAS", name: "Disabilitas fisik/mobilitas", assistance: "Siapkan bantuan mobilitas dan jalur yang dapat diakses.", description: "Keterbatasan gerak; perlu kursi roda, tandu, atau alat bantu dengar." },
  { code: "DISABILITAS_INTELEKTUAL", category: "DISABILITAS", name: "Disabilitas intelektual", assistance: "Gunakan instruksi sederhana dan pendamping tepercaya.", description: "Butuh instruksi singkat, berulang, dan pendamping yang dikenal." },
  { code: "AUTISME", category: "DISABILITAS", name: "Autisme", assistance: "Kurangi rangsangan dan gunakan komunikasi yang konsisten.", description: "Sensitif terhadap bunyi keras dan cahaya menyilaukan." },
  { code: "DISABILITAS_GANDA", category: "DISABILITAS", name: "Disabilitas ganda", assistance: "Ikuti kebutuhan bantuan individual yang telah diverifikasi.", description: "Kombinasi gangguan yang berbeda tiap individu." },
  { code: "LANSIA", category: "LANSIA", name: "Lansia", assistance: "Prioritaskan pemeriksaan kondisi dan bantuan mobilitas.", description: "Lanjut usia; stamina menurun dan risiko jatuh lebih tinggi." },
  { code: "IBU_HAMIL", category: "IBU_HAMIL", name: "Ibu hamil", assistance: "Prioritaskan transportasi aman dan bantuan medis bila diperlukan.", description: "Perlu perhatian khusus selama perjalanan dan pemeriksaan berkala." },
  { code: "ANAK_TANPA_PENDAMPING", category: "ANAK", name: "Anak tanpa pendamping", assistance: "Pastikan pendampingan dan reunifikasi keluarga.", description: "Anak yang memerlukan pendampingan orang dewasa saat evakuasi" },
  { code: "PENYAKIT_KRONIS", category: "PENYAKIT_KRONIS", name: "Penyakit kronis", assistance: "Bawa obat, dokumen medis, dan periksa kebutuhan klinis.", description: "Memerlukan obat rutin dan pemantauan kondisi saat dipindahkan." }
];

interface ResidentSeed {
  n: number;
  village: number;
  hamlet: number;
  name: string;
  birth: string;
  gender: "LAKI_LAKI" | "PEREMPUAN" | "LAINNYA";
  lat: number;
  lng: number;
  alone: boolean;
  phone: string;
  address: string;
  mobility: string | null;
  communication: string | null;
  medical: string | null;
  evacuation: string | null;
  vulns: Array<[string, number, string]>;
  contacts?: Array<[string, string, string, boolean]>;
}

const residentSeed: ResidentSeed[] = [
  {
    n: 1, village: 1, hamlet: 1, name: "Siti Aminah", birth: "1954-04-12", gender: "PEREMPUAN",
    lat: -7.2279, lng: 107.9087, alone: true, phone: "0812-1100-2201", address: "Dusun Cempaka RT 02 RW 01",
    mobility: "Memerlukan bantuan untuk berjalan jauh.", communication: "Gunakan teks, gerakan visual, atau pendamping.", medical: null,
    evacuation: "Jalan masuk sempit; siapkan satu pendamping.",
    vulns: [
      ["TUNARUNGU", 3, "Pastikan peringatan visual dan pendamping komunikasi."],
      ["LANSIA", 3, "Memerlukan bantuan mobilitas saat evakuasi."]
    ],
    contacts: [["Asep Kurniawan", "Putra", "0813-2200-3301", true]]
  },
  {
    n: 2, village: 1, hamlet: 1, name: "Budi Santoso", birth: "1981-09-23", gender: "LAKI_LAKI",
    lat: -7.2312, lng: 107.9014, alone: false, phone: "0812-1100-2202", address: "Dusun Cempaka RT 01 RW 03",
    mobility: "Dapat berjalan dengan pendamping.", communication: "Berikan petunjuk suara yang jelas.", medical: null,
    evacuation: "Pendamping keluarga berada di rumah.",
    vulns: [["TUNANETRA", 4, "Sebutkan arah dan hambatan secara verbal."]]
  },
  {
    n: 3, village: 1, hamlet: 1, name: "Rina Marlina", birth: "1950-01-08", gender: "PEREMPUAN",
    lat: -7.2198, lng: 107.9151, alone: false, phone: "0812-1100-2203", address: "Dusun Cempaka RT 03 RW 02",
    mobility: "Menggunakan tongkat.", communication: null, medical: "Membawa obat rutin.",
    evacuation: "Hindari jalur dengan tangga.", vulns: [["LANSIA", 2, "Periksa stamina dan obat sebelum perjalanan."]]
  },
  {
    n: 4, village: 1, hamlet: 1, name: "Dedi Supriadi", birth: "1976-02-17", gender: "LAKI_LAKI",
    lat: -7.2251, lng: 107.9119, alone: false, phone: "0812-1100-2204", address: "Dusun Cempaka RT 02 RW 01",
    mobility: "Tidak dapat berjalan sendiri sejak kecelakaan.", communication: "Merespons getaran dan cahaya.",
    medical: "Menggunakan kursi roda, tidak dapat dipindahkan tanpa alat.", evacuation: "Perlu kursi roda dan dua orang.",
    vulns: [
      ["TUNADAKSA", 5, "Prioritaskan alat mobilitas dan jalur tanpa tangga."],
      ["TUNARUNGU", 2, "Kombinasi peringatan cahaya dan getaran."]
    ],
    contacts: [["Maya Lestari", "Istri", "0813-2200-3302", true]]
  },
  {
    n: 5, village: 1, hamlet: 2, name: "Waridin", birth: "1948-11-03", gender: "LAKI_LAKI",
    lat: -7.2338, lng: 107.9159, alone: true, phone: "0812-1100-2205", address: "Dusun Cempaka RT 04 RW 04",
    mobility: "Tunanetra berat, tidak dapat berjalan tanpa bantuan.", communication: "Tidak dapat mendengar alarm suara.",
    medical: "Penyakit jantung, obat penting.", evacuation: "Dusun Cerme, akses tanpa aspal.",
    vulns: [
      ["TUNANETRA", 5, "Perlu pendampingan penuh."],
      ["LANSIA", 3, "Pemeriksaan kondisi setiap 30 menit."],
      ["PENYAKIT_KRONIS", 4, "Bawa obat dan catatan medis."]
    ]
  },
  {
    n: 6, village: 2, hamlet: 3, name: "Nurhayati", birth: "1962-07-21", gender: "PEREMPUAN",
    lat: -7.2141, lng: 107.8824, alone: false, phone: "0812-1100-2206", address: "Dusun Cerme RT 01 RW 02",
    mobility: "Bisa berjalan pendek saja.", communication: "Gunakan bahasa sederhana.",
    medical: "Diabetes, memerlukan jadwal makan.", evacuation: "Jalan tanpa aspal, licin saat hujan.",
    vulns: [
      ["LANSIA", 3, "Waktu perjalanan maksimal 20 menit."],
      ["PENYAKIT_KRONIS", 3, "Bawa makanan dan obat."]
    ],
    contacts: [["Agus Setiawan", "Suami", "0813-2200-3303", true]]
  },
  {
    n: 7, village: 2, hamlet: 3, name: "Iwan Kurniawan", birth: "1994-03-11", gender: "LAKI_LAKI",
    lat: -7.2163, lng: 107.8851, alone: false, phone: "0812-1100-2207", address: "Dusun Cerme RT 02 RW 01",
    mobility: "Tangan kanan lumpuh, dapat berjalan.", communication: "Butuh instruksi berulang.",
    medical: null, evacuation: "Dukungan keluarga kuat.",
    vulns: [["TUNADAKSA", 3, "Bawa dua orang untuk membantu."]]
  },
  {
    n: 8, village: 2, hamlet: 3, name: "Karsih", birth: "1945-12-30", gender: "PEREMPUAN",
    lat: -7.2122, lng: 107.8872, alone: true, phone: "0812-1100-2208", address: "Dusun Cerme RT 03 RW 03",
    mobility: "Tidak dapat bergerak sejak stroke.", communication: "Tidak dapat berbicara, gunakan kartu komunikasi sederhana.",
    medical: "Stroke, bergantung pada orang lain untuk hampir semua aktivitas.", evacuation: "Butuh tandu dan dua orang.",
    vulns: [
      ["TUNADAKSA", 5, "Prioritaskan tandu."],
      ["TUNARUNGU", 3, "Pakai kartu komunikasi."],
      ["LANSIA", 4, "Kondisi tubuh rapuh."],
      ["PENYAKIT_KRONIS", 5, "Prioritaskan penanganan medis."]
    ]
  },
  {
    n: 9, village: 3, hamlet: 4, name: "Lilis Suryani", birth: "1986-05-09", gender: "PEREMPUAN",
    lat: -7.1928, lng: 107.9527, alone: false, phone: "0812-1100-2209", address: "Dusun Pasar RT 05 RW 02",
    mobility: "Normal, dapat evakuasi mandiri.", communication: "Dengar dan lihat baik.", medical: null,
    evacuation: "Dekat pasar desa.",
    vulns: [["IBU_HAMIL", 4, "Prioritaskan kendaraan dan kursi roda."]]
  },
  {
    n: 10, village: 3, hamlet: 4, name: "Rahmat Hidayat", birth: "1971-01-25", gender: "LAKI_LAKI",
    lat: -7.1955, lng: 107.9558, alone: true, phone: "0812-1100-2210", address: "Dusun Pasar RT 02 RW 05",
    mobility: "Gangguan jantung, tidak boleh berjalan jauh.", communication: "Butuh instruksi tenang.",
    medical: "Jantung koroner, obat darurat.", evacuation: "Jauh dari posko, 3 km.",
    vulns: [
      ["PENYAKIT_KRONIS", 5, "Prioritaskan akses ke PPK."],
      ["LANSIA", 2, "Kurangi beban."]
    ]
  },
  {
    n: 11, village: 4, hamlet: 5, name: "Siti Rohmah", birth: "1959-08-14", gender: "PEREMPUAN",
    lat: -7.1856, lng: 107.7372, alone: false, phone: "0812-1100-2211", address: "Dusun Panembong RT 01 RW 01",
    mobility: "Memakai kruk, jarak pendek saja.", communication: "Gunakan suara keras.",
    medical: "Diabetes tipe 2.", evacuation: "Jalan sering tergenang, tanpa aspal.",
    vulns: [
      ["LANSIA", 3, "Waktu perjalanan pendek."],
      ["TUNADAKSA", 3, "Bawa tongkat lipat."],
      ["PENYAKIT_KRONIS", 3, "Cek gula darah sebelum berangkat."]
    ],
    contacts: [["Dedi Hidayat", "Suami", "0813-2200-3304", true]]
  },
  {
    n: 12, village: 4, hamlet: 5, name: "Ujang Solihin", birth: "1990-02-06", gender: "LAKI_LAKI",
    lat: -7.1879, lng: 107.7401, alone: false, phone: "0812-1100-2212", address: "Dusun Panembong RT 02 RW 02",
    mobility: "Dapat berjalan dengan sedikit bantuan.", communication: "Baik.", medical: null,
    evacuation: "Saudara serumah siap membantu kapan saja.",
    vulns: [["TUNANETRA", 2, "Panduan suara satu arah."]]
  },
  {
    n: 13, village: 5, hamlet: 6, name: "Elis Suryani", birth: "1975-10-19", gender: "PEREMPUAN",
    lat: -7.1882, lng: 107.6483, alone: true, phone: "0812-1100-2213", address: "Dusun Ciherang RT 01 RW 01",
    mobility: "Mengasuh anak usia 2 tahun.", communication: "Perlu instruksi singkat.",
    medical: "Riwayat asma, perlu inhaler saat darurat.", evacuation: "Akses terisolasi, satu jalan.",
    vulns: [
      ["IBU_HAMIL", 3, "Prioritaskan tenaga medis saat perjalanan."],
      ["ANAK_TANPA_PENDAMPING", 4, "Anak usia balita harus dibawa."]
    ]
  },
  {
    n: 14, village: 5, hamlet: 6, name: "Rusli Tanjung", birth: "1943-06-08", gender: "LAKI_LAKI",
    lat: -7.1915, lng: 107.6512, alone: true, phone: "0812-1100-2214", address: "Dusun Ciherang RT 03 RW 02",
    mobility: "Tunarungu dan tunanetra, tidak dapat berjalan sendiri.", communication: "Tidak mendengar dan buta, komunikasi lewat pendamping.",
    medical: "Gagal ginjal, dialysis dua kali seminggu.", evacuation: "Jauh dari rumah sakit, akses sulit.",
    vulns: [
      ["TUNARUNGU", 5, "Kombinasi cahaya, getaran, pendamping."],
      ["TUNANETRA", 5, "Perlu pendamping penuh."],
      ["LANSIA", 5, "Prioritaskan BLS."],
      ["PENYAKIT_KRONIS", 5, "Perlu persiapan medis."]
    ]
  },
  {
    n: 15, village: 6, hamlet: 7, name: "Tono Hartono", birth: "1969-04-02", gender: "LAKI_LAKI",
    lat: -7.1005, lng: 107.9326, alone: false, phone: "0812-1100-2215", address: "Dusun Cimalayan RT 01 RW 01",
    mobility: "Penyakit Parkinson, mudah jatuh.", communication: "Suara pelan.", medical: "Parkinson tahap 2.",
    evacuation: "Akses mudah, posko dekat.",
    vulns: [
      ["LANSIA", 3, "Waktu perjalanan singkat."],
      ["PENYAKIT_KRONIS", 3, "Bawa obat"]
    ]
  },
  {
    n: 16, village: 6, hamlet: 7, name: "Marniati", birth: "1983-11-27", gender: "PEREMPUAN",
    lat: -7.1027, lng: 107.9359, alone: false, phone: "0812-1100-2216", address: "Dusun Cimalayan RT 02 RW 03",
    mobility: "Gangguan autisme dan verbal.", communication: "Kurangi bunyi keras.",
    medical: "Gangguan sensorik.", evacuation: "Jangan gunakan sirene di dekat rumah.",
    vulns: [
      ["AUTISME", 4, "Instruksi singkat, lingkungan tenang."],
      ["DISABILITAS_GANDA", 3, "Pendamping keluarga hadir setiap hari"]
    ],
    contacts: [["Hendra Wijaya", "Suami", "0813-2200-3305", true]]
  }
];

const hamlets = [
  { n: 1, village: 1, name: "Dusun Cempaka" },
  { n: 2, village: 1, name: "Dusun Cerme" },
  { n: 3, village: 2, name: "Dusun Cerme" },
  { n: 4, village: 3, name: "Dusun Pasar" },
  { n: 5, village: 4, name: "Dusun Panembong" },
  { n: 6, village: 5, name: "Dusun Ciherang" },
  { n: 7, village: 6, name: "Dusun Cimalayan" }
];

const deviceSeed: Array<{ id: string; village: number; resident: number | null; battery: number; online: boolean; status: string; lat: number; lng: number }> = [
  { id: "JAGA-0048", village: 1, resident: 1, battery: 73, online: true, status: "ASSIGNED", lat: -7.2279, lng: 107.9087 },
  { id: "JAGA-0052", village: 1, resident: 2, battery: 61, online: true, status: "ASSIGNED", lat: -7.2312, lng: 107.9014 },
  { id: "JAGA-0061", village: 1, resident: 3, battery: 84, online: true, status: "ASSIGNED", lat: -7.2198, lng: 107.9151 },
  { id: "JAGA-0074", village: 1, resident: 4, battery: 28, online: true, status: "ASSIGNED", lat: -7.2251, lng: 107.9119 },
  { id: "JAGA-0088", village: 1, resident: 5, battery: 12, online: false, status: "MAINTENANCE", lat: -7.2338, lng: 107.9159 },
  { id: "JAGA-0103", village: 2, resident: 6, battery: 55, online: true, status: "ASSIGNED", lat: -7.2141, lng: 107.8824 },
  { id: "JAGA-0111", village: 2, resident: 7, battery: 90, online: true, status: "ASSIGNED", lat: -7.2163, lng: 107.8851 },
  { id: "JAGA-0129", village: 2, resident: 8, battery: 41, online: false, status: "ASSIGNED", lat: -7.2122, lng: 107.8872 },
  { id: "JAGA-0140", village: 3, resident: 9, battery: 77, online: true, status: "ASSIGNED", lat: -7.1928, lng: 107.9527 },
  { id: "JAGA-0156", village: 3, resident: 10, battery: 66, online: true, status: "ASSIGNED", lat: -7.1955, lng: 107.9558 },
  { id: "JAGA-0172", village: 4, resident: 11, battery: 49, online: true, status: "ASSIGNED", lat: -7.1856, lng: 107.7372 },
  { id: "JAGA-0185", village: 4, resident: 12, battery: 33, online: false, status: "ASSIGNED", lat: -7.1879, lng: 107.7401 },
  { id: "JAGA-0198", village: 5, resident: 13, battery: 71, online: true, status: "ASSIGNED", lat: -7.1882, lng: 107.6483 },
  { id: "JAGA-0204", village: 5, resident: 14, battery: 19, online: true, status: "ASSIGNED", lat: -7.1915, lng: 107.6512 },
  { id: "JAGA-0219", village: 6, resident: 15, battery: 58, online: true, status: "ASSIGNED", lat: -7.1005, lng: 107.9326 },
  { id: "JAGA-0225", village: 6, resident: 16, battery: 95, online: true, status: "ASSIGNED", lat: -7.1027, lng: 107.9359 },
  { id: "JAGA-0231", village: 1, resident: null, battery: 100, online: false, status: "STOCK", lat: -7.2279, lng: 107.9087 }
];

const gatewaySeed = [
  { n: 1, village: 1, code: "GW-SUKAMAJU-01", name: "Gateway Dusun Cempaka", lat: -7.2281, lng: 107.9091, online: true },
  { n: 2, village: 2, code: "GW-SUKAWENING-01", name: "Gateway Dusun Cerme", lat: -7.2147, lng: 107.8836, online: true },
  { n: 3, village: 4, code: "GW-PAMEUNGPEUK-01", name: "Gateway Panembong", lat: -7.1868, lng: 107.7387, online: false }
];

const hazardSeed = [
  { n: 1, village: 1, name: "Bendungan Cerme", hazard_type: "BANJIR", risk_level: 5, lat: -7.2287, lng: 107.9071, radius: 620, notes: "Air naik setinggi pinggir jalan. Akses RT 02 terendam lebih dulu." },
  { n: 2, village: 1, name: "Lereng Cempaka", hazard_type: "LONGSOR", risk_level: 4, lat: -7.2326, lng: 107.9142, radius: 480, notes: "Tebing licin, material longsoran dari lereng atas." },
  { n: 3, village: 2, name: "Sungai Cerme Bawah", hazard_type: "BANJIR", risk_level: 4, lat: -7.2132, lng: 107.8808, radius: 540, notes: "Aliran deras, sungai sering meluap." },
  { n: 4, village: 4, name: "Rawa Panembong", hazard_type: "BANJIR", risk_level: 5, lat: -7.1869, lng: 107.7393, radius: 700, notes: "Genangan terbuka tanpa saluran, jalan RT 01 tergenang." },
  { n: 5, village: 5, name: "Jalan rusak Ciherang", hazard_type: "JALAN_PUTUS", risk_level: 5, lat: -7.1895, lng: 107.6498, radius: 380, notes: "Akses satu arah, tanah licin saat hujan." },
  { n: 6, village: 3, name: "Kemiringan Pasar", hazard_type: "LONGSOR", risk_level: 3, lat: -7.1948, lng: 107.9545, radius: 320, notes: "Rel aman, dinding retak pada sambungan." }
];

const shelterSeed = [
  { n: 1, village: 1, name: "SDN Sukamaju 01", address: "Lapangan desa, RT 01", lat: -7.2272, lng: 107.9079, capacity: 120, notes: "Lapangan beton, dapat diakses kendaraan roda 4." },
  { n: 2, village: 1, name: "Posko Alternatif SD Cerme", address: "Dusun Cerme, RT 04", lat: -7.2301, lng: 107.9127, capacity: 40, notes: "Gudang beratap tanpa lantai, dekat jalur evakuasi." },
  { n: 3, village: 2, name: "SDN Sukawening 02", address: "Halaman sekolah", lat: -7.2153, lng: 107.8843, capacity: 80, notes: "Akses jalan sempit, hanya bisa dilalui truk kecil." },
  { n: 4, village: 4, name: "Posko Rawa Panembong", address: "Balai RT 02", lat: -7.1881, lng: 107.7412, capacity: 60, notes: "Bangunan bata, lantai tinggi aman dari genangan." },
  { n: 5, village: 5, name: "SDN Bayongbong 03", address: "Lapangan desa", lat: -7.1862, lng: 107.6462, capacity: 150, notes: "Besar, dapat menerima seluruh dusun." },
  { n: 6, village: 6, name: "Gudang Desa Suralaya", address: "Kawasan industri", lat: -7.0992, lng: 107.9301, capacity: 200, notes: "Lantai beton, akses jalan raya." }
];

const teamSeed = [
  { n: 1, org: 4, name: "Tim Rescue 01", call_sign: "RESCUE-01", vehicle: "Truck pick-up 1 ton dan perahu", status: "ON_SCENE", leader: "rescue.bpbd@jaga.id", lat: -7.2292, lng: 107.9089 },
  { n: 2, org: 4, name: "Tim Rescue 02", call_sign: "RESCUE-02", vehicle: "Ambulans", status: "EN_ROUTE", leader: "rescue.bpbd@jaga.id", lat: -7.2163, lng: 107.8901 },
  { n: 3, org: 4, name: "Tim Rescue 03", call_sign: "RESCUE-03", vehicle: "Truck darurat", status: "AVAILABLE", leader: "rescue.bpbd@jaga.id", lat: -7.21, lng: 107.9 },
  { n: 4, org: 5, name: "Tim Damkar 01", call_sign: "DAMKAR-01", vehicle: "Mobil damkar", status: "AVAILABLE", leader: "rescue.damkar@jaga.id", lat: -7.2, lng: 107.92 },
  { n: 5, org: 4, name: "Tim Rescue Siaga 04", call_sign: "RESCUE-04", vehicle: "Perahu fiberglass", status: "OFF_DUTY", leader: "rescue.bpbd@jaga.id", lat: -7.22, lng: 107.87 }
];

const ruleSeed: Array<{ key: string; op: string; value: unknown; delta: number; order: number; text: string }> = [
  { key: "self_evacuation_capable", op: "EQ", value: false, delta: 25, order: 10, text: "Warga tidak dapat melakukan evakuasi mandiri sehingga waktu respons harus dihitung lebih awal." },
  { key: "reported_condition", op: "EQ", value: "CRITICAL", delta: 30, order: 20, text: "Petugas lapangan melaporkan kondisi kritis." },
  { key: "reported_condition", op: "EQ", value: "DECLINING", delta: 12, order: 21, text: "Kondisi menurun dibanding pencatatan sebelumnya." },
  { key: "hazard_exposure", op: "GTE", value: 4, delta: 20, order: 30, text: "Lokasi berada di dalam zona bahaya aktif dengan risiko tinggi." },
  { key: "medical_dependency", op: "EQ", value: true, delta: 18, order: 40, text: "Warga bergantung pada perawatan khusus selama dipindahkan." },
  { key: "hazard_exposure", op: "LTE", value: 1, delta: -8, order: 45, text: "Lokasi jauh dari zona bahaya aktif sehingga risiko langsung rendah." },
  { key: "mobility_assistance", op: "IN", value: ["DOUBLE", "MULTI"], delta: 15, order: 50, text: "Pemindahan warga memerlukan lebih dari satu pendamping." },
  { key: "terrain_isolation", op: "EQ", value: true, delta: 20, order: 55, text: "Wilayah terisolasi; akses satu arah dan rawan terputus." },
  { key: "access_difficulty", op: "GTE", value: 4, delta: 15, order: 60, text: "Jalur menuju lokasi sulit sehingga waktu tiba lebih lama." },
  { key: "communication_support", op: "EQ", value: "NONE", delta: 12, order: 70, text: "Warga tidak dapat menerima instruksi suara sehingga perlu pendamping penuh." },
  { key: "companion_available", op: "EQ", value: false, delta: 12, order: 80, text: "Tidak ada pendamping yang tinggal serumah." },
  { key: "water_level_cm", op: "GTE", value: 100, delta: 18, order: 90, text: "Ketinggian air di lokasi mencapai satu meter atau lebih." },
  { key: "elderly_count", op: "GTE", value: 2, delta: 10, order: 100, text: "Lebih dari satu warga lanjut usia berada di alamat yang sama." },
  { key: "children_count", op: "GTE", value: 1, delta: 10, order: 110, text: "Ada anak yang harus dibawa saat evakuasi." },
  { key: "lives_alone", op: "EQ", value: true, delta: 10, order: 120, text: "Warga tinggal sendiri tanpa pengawalan harian." },
  { key: "rescue_load", op: "GTE", value: 3, delta: 8, order: 130, text: "Satu tim harus mengawal lebih dari tiga warga dalam satu kali tugas." }
];

const REQUIRED_FACTORS = [
  "self_evacuation_capable", "reported_condition", "hazard_exposure",
  "access_difficulty", "companion_available", "medical_dependency",
  "communication_support", "rescue_load"
];

const thresholdSeed = [
  { level: "PANTAU", min_score: 0, display_order: 1 },
  { level: "SEGERA_TINJAU", min_score: 30, display_order: 2 },
  { level: "RESPONS_CEPAT", min_score: 60, display_order: 3 },
  { level: "DARURAT", min_score: 90, display_order: 4 }
];

const incidentSeed = [
  { n: 1, village: 1, resident: 4, device: "JAGA-0074", owner: "Dedi Supriadi", lat: -7.2251, lng: 107.9119, status: "ASSIGNED", disaster: "BANJIR", description: "Air naik setinggi lutus, rumah warga terendam.", createdAgo: 52 * 60_000, updates: ["NEW", "ACKNOWLEDGED", "ASSIGNED"] },
  { n: 2, village: 1, resident: 5, device: "JAGA-0088", owner: "Waridin", lat: -7.2338, lng: 107.9159, status: "EN_ROUTE", disaster: "BANJIR", description: "Warga terisolasi di RT 04 dan tidak dapat bergerak.", createdAgo: 31 * 60_000, updates: ["NEW", "ACKNOWLEDGED", "ASSIGNED", "EN_ROUTE"] },
  { n: 3, village: 2, resident: 8, device: "JAGA-0129", owner: "Karsih", lat: -7.2122, lng: 107.8872, status: "ARRIVED", disaster: "BANJIR", description: "Warga dengan stroke, tim sudah sampai lokasi.", createdAgo: 96 * 60_000, updates: ["NEW", "ACKNOWLEDGED", "ASSIGNED", "EN_ROUTE", "ARRIVED"] },
  { n: 4, village: 1, resident: 1, device: "JAGA-0048", owner: "Siti Aminah", lat: -7.2279, lng: 107.9087, status: "EVACUATED", disaster: "BANJIR", description: "Sudah dipindahkan ke posko SDN Sukamaju 01.", createdAgo: 4 * HOUR, updates: ["NEW", "ACKNOWLEDGED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "EVACUATED"] },
  { n: 5, village: 5, resident: 14, device: "JAGA-0204", owner: "Rusli Tanjung", lat: -7.1915, lng: 107.6512, status: "SAFE", disaster: "JALAN_PUTUS", description: "Sudah dipindahkan ke SDN Bayongbong 03 pada sore tadi.", createdAgo: 2 * DAY, updates: ["NEW", "ACKNOWLEDGED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "EVACUATED", "SAFE"] }
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

  tables.provinces = provinces.map(row => ({ ...row }));
  tables.regencies = regencies.map(row => ({ ...row }));
  tables.districts = districts.map(row => ({ ...row }));
  tables.villages = villageSeed.map(village => ({
    id: id("10000000", village.n),
    government_code: village.code,
    district_id: village.district_id,
    name: village.name,
    district: districts.find(d => d.id === village.district_id)?.name ?? null,
    province: "Jawa Barat",
    regency: village.regency,
    latitude: village.lat,
    longitude: village.lng,
    center: `SRID=4326;POINT(${village.lng} ${village.lat})`,
    access_notes: village.access,
    population: [412, 268, 530, 344, 297, 486][village.n - 1],
    active: true,
    created_at: created
  }));
  tables.hamlets = hamlets.map(hamlet => ({
    id: id("11000000", hamlet.n),
    village_id: id("10000000", hamlet.village),
    name: hamlet.name,
    created_at: created
  }));

  tables.organizations = organizations.map(org => ({
    id: id("40000000", org.n),
    name: org.name,
    type: org.type,
    email: org.email ?? null,
    phone: org.phone ?? null,
    address: null,
    active: true,
    created_at: created
  }));
  DEMO_ACCOUNTS.forEach((account, index) => {
    const organizationId = id("40000000", account.org);
    for (const village of account.villages.length ? account.villages : [1, 2, 3, 4, 5, 6]) {
      push("organization_service_areas", {
        organization_id: organizationId,
        village_id: id("10000000", village),
        created_at: created,
        _sort: index
      });
    }
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

  tables.residents = residentSeed.map(resident => ({
    id: id("20000000", resident.n),
    village_id: id("10000000", resident.village),
    hamlet_id: id("11000000", resident.hamlet),
    full_name: resident.name,
    birth_date: resident.birth,
    gender: resident.gender,
    phone: resident.phone,
    address: resident.address,
    latitude: resident.lat,
    longitude: resident.lng,
    location: `SRID=4326;POINT(${resident.lng} ${resident.lat})`,
    lives_alone: resident.alone,
    mobility_notes: resident.mobility,
    communication_notes: resident.communication,
    medical_notes: resident.medical,
    evacuation_notes: resident.evacuation,
    active: true,
    consented_at: created,
    created_at: created,
    updated_at: created
  }));
  for (const resident of residentSeed) {
    resident.vulns.forEach(([code, severity, note]) => {
      const typeId = typeByCode.get(code);
      if (!typeId) return;
      push("resident_vulnerabilities", {
        resident_id: id("20000000", resident.n),
        vulnerability_type_id: typeId,
        severity,
        assistance_notes: note,
        verified_by: id("50000000", 2),
        verified_at: created
      });
    });
    (resident.contacts ?? []).forEach(([name, relationship, phone, primary]) => {
      push("resident_contacts", {
        id: id("0b000000", (tables.resident_contacts?.length ?? 0) + 1),
        resident_id: id("20000000", resident.n),
        name,
        relationship,
        phone,
        is_primary: primary,
        lives_with_resident: true
      });
    });
  }

  const deviceKeys: DemoData["deviceKeys"] = [];
  tables.devices = deviceSeed.map(device => {
    const key = `jrk_${sha256Hex(`${device.id}:${DEMO_ACCOUNTS[0]?.email ?? "jaga"}`).slice(0, 32)}`;
    deviceKeys.push({ deviceId: device.id, key });
    return {
      id: device.id,
      village_id: id("10000000", device.village),
      owner_name: device.resident ? (residentSeed.find(entry => entry.n === device.resident)?.name ?? "") : "",
      hardware_serial: `SN-${device.id}-0001`,
      model: "JAGA Rumah v1",
      firmware_version: "1.4.2",
      status: device.status,
      latitude: device.lat,
      longitude: device.lng,
      battery: device.battery,
      online: device.online,
      last_seen_at: device.online ? ago(6 * 60_000) : ago(3 * HOUR),
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
      assigned_by: id("50000000", 2),
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
      village_id: id("10000000", gateway.village),
      gateway_code: gateway.code,
      name: gateway.name,
      latitude: gateway.lat,
      longitude: gateway.lng,
      firmware_version: "0.9.1",
      online: gateway.online,
      last_seen_at: gateway.online ? ago(4 * 60_000) : ago(2 * DAY),
      auth_key_hash: sha256Hex(key),
      created_at: created
    };
  });
  tables.device_telemetry = [];

  tables.hazard_zones = hazardSeed.map(zone => ({
    id: id("80000000", zone.n),
    village_id: id("10000000", zone.village),
    name: zone.name,
    hazard_type: zone.hazard_type,
    risk_level: zone.risk_level,
    center_latitude: zone.lat,
    center_longitude: zone.lng,
    radius_meters: zone.radius,
    area: null,
    access_notes: zone.notes,
    active_from: ago(6 * HOUR),
    active_until: null,
    active: true,
    created_at: created
  }));
  tables.evacuation_shelters = shelterSeed.map(shelter => ({
    id: id("70000000", shelter.n),
    village_id: id("10000000", shelter.village),
    name: shelter.name,
    address: shelter.address,
    latitude: shelter.lat,
    longitude: shelter.lng,
    location: null,
    capacity: shelter.capacity,
    accessibility_notes: shelter.notes,
    active: true,
    created_at: created
  }));

  tables.rescue_teams = teamSeed.map(team => ({
    id: id("60000000", team.n),
    organization_id: id("40000000", team.org),
    name: team.name,
    call_sign: team.call_sign,
    vehicle_info: team.vehicle,
    status: team.status,
    home_village_id: id("10000000", Math.min(team.n, 6)),
    latitude: team.lat,
    longitude: team.lng,
    capacity: 8,
    active: true,
    created_at: created
  }));
  tables.rescue_team_members = teamSeed.map((team, index) => ({
    team_id: id("60000000", team.n),
    profile_id: id("50000000", index === 0 || team.leader === "rescue.damkar@jaga.id" ? 4 : 5),
    is_leader: true
  }));

  tables.priority_rule_sets = [
    {
      id: id("c0000000", 1),
      name: "Aturan Prioritas Evakuasi - revisi 1",
      disaster_type: null,
      version: 1,
      status: "ACTIVE",
      description: "Set dasar yang dipakai semua wilayah. Bisa diubah JAGA Pusat melalui menu Tata kelola aturan.",
      applies_from: created,
      applies_until: null,
      created_by: id("50000000", 1),
      approved_by: id("50000000", 1),
      approved_at: created,
      created_at: created
    },
    {
      id: id("c0000000", 2),
      name: "Aturan Prioritas Evakuasi - revisi 2 (draf)",
      disaster_type: null,
      version: 2,
      status: "DRAFT",
      description: "Draf additif: menambah bobot untuk akses terisolasi dan komunikasi tanpa pendamping.",
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
  tables.priority_rules.push(
    {
      id: id("d0000000", 100),
      rule_set_id: id("c0000000", 2),
      factor_key: "terrain_isolation",
      operator: "EQ",
      comparison_value: true,
      score_delta: 24,
      explanation: "Wilayah terisolasi; akses satu arah dan rawan terputus.",
      display_order: 55,
      active: true,
      created_at: ago(2 * DAY)
    },
    {
      id: id("d0000000", 101),
      rule_set_id: id("c0000000", 2),
      factor_key: "communication_support",
      operator: "EQ",
      comparison_value: "NONE",
      score_delta: 16,
      explanation: "Warga tidak dapat menerima instruksi suara sehingga perlu pendamping penuh.",
      display_order: 70,
      active: true,
      created_at: ago(2 * DAY)
    }
  );
  tables.priority_thresholds = thresholdSeed.map(threshold => ({
    rule_set_id: id("c0000000", 1),
    level: threshold.level,
    min_score: threshold.min_score,
    display_order: threshold.display_order
  }));
  tables.priority_thresholds.push(
    { rule_set_id: id("c0000000", 2), level: "PANTAU", min_score: 0, display_order: 1 },
    { rule_set_id: id("c0000000", 2), level: "SEGERA_TINJAU", min_score: 34, display_order: 2 },
    { rule_set_id: id("c0000000", 2), level: "RESPONS_CEPAT", min_score: 66, display_order: 3 },
    { rule_set_id: id("c0000000", 2), level: "DARURAT", min_score: 95, display_order: 4 }
  );

  tables.priority_recommendations = [];
  tables.priority_overrides = [];
  tables.evacuation_routes = [];
  incidentSeed.forEach((incident, index) => {
    const incidentId = id("90000000", incident.n);
    const createdAt = ago(incident.createdAgo);
    push("incidents", {
      id: incidentId,
      village_id: id("10000000", incident.village),
      resident_id: incident.resident ? id("20000000", incident.resident) : null,
      device_id: incident.device,
      disaster_type: incident.disaster,
      owner_name: incident.owner,
      latitude: incident.lat,
      longitude: incident.lng,
      status: incident.status,
      description: incident.description,
      resolution_notes: incident.status === "SAFE" ? "Serah terima warga di posko SDN Bayongbong 03." : null,
      created_at: createdAt,
      acknowledged_at: incident.updates.length > 1 ? new Date(Date.parse(createdAt) + 4 * 60_000).toISOString() : null,
      evacuated_at: incident.updates.length > 5 ? new Date(Date.parse(createdAt) + 40 * 60_000).toISOString() : null,
      closed_at: incident.status === "SAFE" ? new Date(Date.parse(createdAt) + 55 * 60_000).toISOString() : null,
      updated_at: ago(Math.max(60_000, incident.createdAgo / 4))
    });
    incident.updates.forEach((status, step) => {
      push("incident_status_history", {
        incident_id: incidentId,
        from_status: step === 0 ? null : incident.updates[step - 1],
        to_status: status,
        changed_by: status === "NEW" ? null : id("50000000", step <= 2 ? 2 : 4),
        notes: null,
        recorded_at: new Date(Date.parse(createdAt) + step * 6 * 60_000).toISOString()
      });
    });
    if (index < 3) {
      const assessmentId = id("a0000000", incident.n);
      push("incident_assessments", {
        id: assessmentId,
        incident_id: incidentId,
        assessed_by: id("50000000", 2),
        source: "DESA",
        summary: "Kondisi dikonfirmasi lewat telepon warga dan report gateway.",
        observed_at: createdAt,
        created_at: createdAt
      });
      const factors: Array<[string, unknown]> = [
        ["self_evacuation_capable", incident.n === 2 ? false : incident.n === 3 ? false : true],
        ["reported_condition", incident.n === 1 ? "DECLINING" : incident.n === 2 ? "CRITICAL" : "STABLE"],
        ["medical_dependency", [4, 5, 8].includes(incident.resident ?? 0)],
        ["companion_available", !residentSeed[(incident.resident ?? 1) - 1]?.alone],
        ["communication_support", [1, 2, 5, 8].includes(incident.resident ?? 0) ? "NONE" : "COMPANION"],
        ["mobility_assistance", [4, 8].includes(incident.resident ?? 0) ? "MULTI" : [5, 14].includes(incident.resident ?? 0) ? "DOUBLE" : "SINGLE"],
        ["terrain_isolation", incident.village === 5 || (incident.village === 1 && incident.n === 2)],
        ["elderly_count", 1],
        ["children_count", 0],
        ["water_level_cm", incident.n === 1 ? 110 : incident.n === 2 ? 135 : 60]
      ];
      factors.forEach(([key, value]) => {
        push("assessment_factors", {
          assessment_id: assessmentId,
          factor_key: key,
          factor_value: value,
          source_note: key === "terrain_isolation" ? "Dihitung otomatis dari zona bahaya" : null,
          recorded_at: createdAt
        });
      });
    }
  });

  // Penugasan tim untuk insiden yang sudah berjalan.
  const assignments: Array<[number, number, string, number]> = [
    [1, 1, "ASSIGNED", 8 * 60_000],
    [2, 2, "EN_ROUTE", 12 * 60_000],
    [3, 1, "ARRIVED", 40 * 60_000],
    [4, 1, "EVACUATED", 3 * HOUR]
  ];
  assignments.forEach(([incidentN, teamN, status, offset], index) => {
    const incident = incidentSeed[incidentN - 1];
    if (!incident) return;
    push("incident_assignments", {
      id: id("ac000000", index + 1),
      incident_id: id("90000000", incidentN),
      team_id: id("60000000", teamN),
      assigned_by: id("50000000", 2),
      assigned_at: ago(incident.createdAgo / 2),
      accepted_at: ago(incident.createdAgo / 3),
      completed_at: status === "ARRIVED" || status === "EVACUATED" ? ago(incident.createdAgo / 4) : null,
      _status: status
    });
  });

  // Jejak pergerakan tim Rescue 01.
  const trail = teamSeed[0];
  if (trail) {
    const points: Array<[number, number]> = [
      [-7.21, 107.9], [-7.2155, 107.9025], [-7.2212, 107.905], [-7.226, 107.9068], [-7.2292, 107.9089]
    ];
    points.forEach(([lat, lng], index) => {
      push("team_location_history", {
        team_id: id("60000000", 1),
        incident_id: id("90000000", 1),
        latitude: lat,
        longitude: lng,
        accuracy_meters: 8 + index,
        location: null,
        recorded_at: ago((points.length - index) * 7 * 60_000)
      });
    });
  }

  tables.alert_commands = [
    {
      id: id("0a000000", 1),
      village_id: id("10000000", 1),
      target: "ALL",
      target_type: "DESA",
      target_reference: null,
      severity: "SIAGA",
      message: "Segera bersama keluarga menuju titik aman di SDN Sukamaju 01.",
      status: "ACKNOWLEDGED",
      requested_by: id("50000000", 2),
      created_at: ago(55 * 60_000),
      expires_at: new Date(Date.now() + 3 * HOUR).toISOString()
    },
    {
      id: id("0a000000", 2),
      village_id: id("10000000", 2),
      target: "ALL",
      target_type: "DESA",
      target_reference: null,
      severity: "WASPADA",
      message: "Cermati kenaikan air di sungai Cerme.",
      status: "SENT",
      requested_by: id("50000000", 3),
      created_at: ago(40 * 60_000),
      expires_at: new Date(Date.now() + 2 * HOUR).toISOString()
    }
  ];
  deviceSeed.filter(device => device.village === 1).forEach((device, index) => {
    push("command_receipts", {
      id: id("0f000000", index + 1),
      command_id: id("0a000000", 1),
      device_id: device.id,
      status: device.online ? "ACKNOWLEDGED" : "FAILED",
      sent_at: ago(54 * 60_000),
      acknowledged_at: device.online ? ago(53 * 60_000) : null,
      failure_reason: device.online ? null : "Perangkat tidak menjawab dalam 60 detik."
    });
  });
  deviceSeed.filter(device => device.village === 2).forEach((device, index) => {
    push("command_receipts", {
      id: id("0f000000", 100 + index),
      command_id: id("0a000000", 2),
      device_id: device.id,
      status: device.online ? "SENT" : "QUEUED",
      sent_at: device.online ? ago(39 * 60_000) : null,
      acknowledged_at: null,
      failure_reason: null
    });
  });

  tables.notifications = [
    {
      id: id("0d000000", 1),
      profile_id: id("50000000", 1),
      incident_id: null,
      channel: "IN_APP",
      title: "Wilayah diminta melengkapi laporan bulanan",
      body: "Mohon lengkapi data warga kelompok rentan di 6 wilayah yang belum diperbarui.",
      status: "QUEUED",
      read_at: null,
      created_at: ago(6 * HOUR)
    },
    {
      id: id("0d000000", 2),
      profile_id: id("50000000", 4),
      incident_id: id("90000000", 2),
      channel: "IN_APP",
      title: "Waridin terisolasi di RT 04",
      body: "Rekomendasi sistem: DARURAT. Akses tanpa aspal, air setinggi 135 cm.",
      status: "QUEUED",
      read_at: null,
      created_at: ago(28 * 60_000)
    },
    {
      id: id("0d000000", 3),
      profile_id: id("50000000", 2),
      incident_id: id("90000000", 1),
      channel: "IN_APP",
      title: "Tim Rescue 01 ditugaskan",
      body: "Dedi Supriadi dialokasikan ke Tim Rescue 01.",
      status: "READ",
      read_at: ago(20 * 60_000),
      created_at: ago(30 * 60_000)
    }
  ];

  tables.audit_logs = [
    { actor_id: id("50000000", 1), action: "RULE_SET_PUBLISH", entity_type: "priority_rule_sets", entity_id: id("c0000000", 1), summary: "Menerbitkan Aturan Prioritas Evakuasi revisi 1", created_at: ago(29 * DAY) },
    { actor_id: id("50000000", 2), action: "ALERT_SEND", entity_type: "alert_commands", entity_id: id("0a000000", 1), summary: "Mengirim peringatan SIAGA ke 5 perangkat Desa Sukamaju", created_at: ago(55 * 60_000) },
    { actor_id: id("50000000", 4), action: "INCIDENT_STATUS", entity_type: "incidents", entity_id: id("90000000", 2), summary: "Status Waridin EN_ROUTE ke EN_ROUTE", created_at: ago(24 * 60_000) },
    { actor_id: id("50000000", 3), action: "ALERT_SEND", entity_type: "alert_commands", entity_id: id("0a000000", 2), summary: "Mengirim peringatan WASPADA ke 3 perangkat Desa Sukawening", created_at: ago(40 * 60_000) },
    { actor_id: id("50000000", 4), action: "INCIDENT_STATUS", entity_type: "incidents", entity_id: id("90000000", 3), summary: "Status Karsih ARRIVED", created_at: ago(50 * 60_000) }
  ];
  tables.sync_operations = [];
  tables.attachments = [];

  tables.internal_accounts = DEMO_ACCOUNTS.map((account, index) => ({
    email: account.email.toLowerCase(),
    display_name: account.displayName,
    password_hash: hashPassword(account.password),
    role: account.role,
    organization_id: id("40000000", account.org),
    profile_id: id("50000000", index + 1),
    village_ids: account.villages.map(village => id("10000000", village)),
    must_change_password: false,
    active: true,
    created_at: created
  }));

  return { tables, accounts: DEMO_ACCOUNTS, requiredFactors: REQUIRED_FACTORS, deviceKeys, gatewayKeys };
}

export async function loadDemoData(store: MemoryStore): Promise<DemoData> {
  const demo = buildDemoData();
  for (const [table, rows] of Object.entries(demo.tables)) {
    store.hydrate(table, rows.map(row => {
      const { _sort: ignoredSort, _status: ignoredStatus, ...rest } = row;
      void ignoredSort; void ignoredStatus;
      return rest;
    }));
  }
  return demo;
}

export const demoTimestamp = nowIso;
