import { config, supabaseEnabled } from "./config.js";
import { loadDemoData } from "./seed.js";
import { MemoryStore } from "./store-memory.js";
import { createPostgrestStore } from "./store-postgrest.js";
import type { Store } from "./store.js";

const isProduction = () => config.env === "production";

async function memoryStore(reason: string): Promise<Store> {
  const memory = new MemoryStore();
  await loadDemoData(memory);
  console.log(`[jaga] memakai penyimpanan memori dengan data demo (${reason})`);
  return memory;
}

/**
 * Menyiapkan penyimpanan aplikasi.
 *
 * - Supabase: dipakai bila SUPABASE_URL dan SUPABASE_SECRET_KEY terisi.
 * - Memori: hanya untuk pengembangan/demonstrasi. Data demo memuat akun dengan
 *   kata sandi yang diketahui publik, jadi memori TIDAK dipakai otomatis di produksi
 *   dan tidak menjadi cadangan diam-diam bila Supabase gagal.
 *
 * Variabel:
 * - JAGA_FORCE_MEMORY=true       paksa memori (pengembangan lokal / tes).
 * - JAGA_ALLOW_MEMORY_FALLBACK=true  izinkan beralih ke memori bila Supabase gagal.
 */
export async function createStore(): Promise<Store> {
  if (process.env.JAGA_FORCE_MEMORY === "true" || process.env.NODE_ENV === "test") {
    return memoryStore("dipaksa");
  }

  const remote = createPostgrestStore();
  if (remote) {
    const ping = await remote.ping();
    if (ping.ok) {
      console.log("[jaga] terhubung ke Supabase");
      return remote;
    }
    const detail = ping.detail ?? "tidak diketahui";
    if (isProduction() || process.env.JAGA_ALLOW_MEMORY_FALLBACK !== "true") {
      throw new Error(`Supabase tidak dapat dihubungi (${detail}). Server dihentikan agar tidak berjalan dengan data demo. ` +
        "Set JAGA_ALLOW_MEMORY_FALLBACK=true hanya untuk pengembangan.");
    }
    console.warn(`[jaga] Supabase tidak dapat dihubungi (${detail}), beralih ke memori karena JAGA_ALLOW_MEMORY_FALLBACK=true`);
    return memoryStore("cadangan");
  }

  if (supabaseEnabled) throw new Error("Konfigurasi Supabase tidak valid");
  if (isProduction()) {
    throw new Error("Produksi memerlukan SUPABASE_URL dan SUPABASE_SECRET_KEY. Penyimpanan memori hanya untuk pengembangan.");
  }
  return memoryStore("tanpa Supabase");
}
