import { config, supabaseEnabled } from "./config.js";
import { loadDemoData } from "./seed.js";
import { MemoryStore } from "./store-memory.js";
import { createPostgrestStore } from "./store-postgrest.js";
import type { Store } from "./store.js";

/**
 * Menyiapkan penyimpanan aplikasi.
 *
 * - Supabase: dipakai bila SUPABASE_URL dan SUPABASE_SECRET_KEY terisi.
 * - Memori: fallback lengkap dengan data demo, berguna untuk pengembangan
 *   dan demonstrasi tanpa koneksi database.
 */
export async function createStore(): Promise<Store> {
  const remote = createPostgrestStore();
  if (remote) {
    const ping = await remote.ping();
    if (ping.ok) {
      console.log("[jaga] terhubung ke Supabase");
      return remote;
    }
    console.warn(`[jaga] Supabase tidak dapat dihubungi (${ping.detail ?? "tidak diketahui"}), beralih ke penyimpanan memori`);
  }
  if (supabaseEnabled) {
    console.warn("[jaga] kredensial Supabase terisi tetapi koneksi gagal. Data demo akan dipakai, perubahan tidak tersimpan.");
  }
  const memory = new MemoryStore();
  await loadDemoData(memory);
  console.log("[jaga] memakai penyimpanan memori dengan data demo");
  void config;
  return memory;
}
