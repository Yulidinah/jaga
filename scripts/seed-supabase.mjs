#!/usr/bin/env node
/**
 * seed-supabase.mjs
 * Menulis data demo JAGA ke Supabase memakai data yang sama dengan mode memori
 * (backend/src/seed.ts -> buildDemoData).
 *
 * Prasyarat:
 *  1. supabase/migrations/202609220002_operational.sql SUDAH dijalankan di SQL Editor.
 *  2. .env memuat SUPABASE_URL dan SUPABASE_SECRET_KEY.
 *
 * Perintah:
 *  node --env-file=.env scripts/seed-supabase.mjs --dry-run    # cek saja
 *  node --env-file=.env scripts/seed-supabase.mjs              # tulis data + akun
 *  node --env-file=.env scripts/seed-supabase.mjs --reset      # hapus data lama dulu
 *
 * Catatan penting:
 *  - profiles.id wajib menunjuk auth.users.id, jadi profil TIDAK boleh di-seed
 *    dengan UUID buatan. Akun dibuat lewat Supabase Auth Admin.
 *  - internal_accounts hanya dipakai mode memori, dilewati di sini.
 */

import { randomBytes } from "node:crypto";
import { buildDemoData, DEMO_ACCOUNTS } from "../backend/dist/seed.js";
import { config } from "../backend/dist/config.js";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const reset = args.has("--reset");

if (!config.supabaseUrl || !config.supabaseSecretKey) {
  console.error("GAGAL: SUPABASE_URL / SUPABASE_SECRET_KEY belum diisi di .env");
  process.exit(1);
}

/** Tabel yang hanya hidup di mode memori. */
const MEMORY_ONLY = new Set(["internal_accounts"]);
/** Tabel yang bergantung pada auth.users, ditangani pada tahap "--accounts". */
const AUTH_LINKED = new Set(["profiles"]);

/** Urutan hapus untuk --reset (anak lebih dulu). */
const TABLES = [
  "support_tickets", "operation_reports", "operations", "announcements", "platform_settings", "audit_logs", "notifications", "attachments", "command_receipts", "alert_commands",
  "evacuation_routes", "incident_assignments", "assessment_factors", "incident_assessments",
  "incident_status_history", "priority_recommendations", "priority_overrides", "incidents",
  "priority_thresholds", "priority_rules", "priority_rule_sets",
  "team_location_history", "rescue_team_members", "rescue_teams",
  "device_telemetry", "device_assignments", "devices", "gateways",
  "resident_contacts", "resident_vulnerabilities", "residents",
  "evacuation_shelters", "hazard_zones",
  "organization_service_areas", "organization_members", "profiles",
  "organizations", "villages",
  "districts", "regencies", "provinces", "sync_operations"
];

const headers = (prefer = "return=representation") => ({
  apikey: config.supabaseSecretKey,
  Authorization: `Bearer ${config.supabaseSecretKey}`,
  "Content-Type": "application/json",
  Prefer: prefer
});

async function rest(path, options = {}) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, { headers: headers(), ...options });
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} :: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : [];
}

/** PostgREST menolak sisipan massal bila kunci objek tidak seragam ("All object keys must match"); samakan dengan null. */
const uniform = rows => {
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
  return rows.map(row => Object.fromEntries(keys.map(key => [key, row[key] ?? null])));
};

const insertRows = (table, rows) =>
  rest(table, {
    method: "POST",
    headers: headers("resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify(uniform(rows))
  });

const ZERO = "00000000-0000-0000-0000-000000000000";
/** Kolom penyaring penghapusan per tabel: PostgREST menolak DELETE tanpa filter, dan tipe kuncinya berbeda-beda. */
const WIPE_FILTER = {
  audit_logs: "id=gt.0", incident_status_history: "id=gt.0", device_telemetry: "id=gt.0", assessment_factors: "id=gt.0", team_location_history: "id=gt.0",
  platform_settings: "key=neq.__tidak_ada__",
  devices: "id=neq.__tidak_ada__", provinces: "id=neq.__tidak_ada__", regencies: "id=neq.__tidak_ada__", districts: "id=neq.__tidak_ada__",
  priority_thresholds: `rule_set_id=neq.${ZERO}`, resident_vulnerabilities: `resident_id=neq.${ZERO}`, organization_service_areas: `organization_id=neq.${ZERO}`,
  organization_members: `organization_id=neq.${ZERO}`, rescue_team_members: `team_id=neq.${ZERO}`
};
const wipe = table => rest(`${table}?${WIPE_FILTER[table] ?? `id=neq.${ZERO}`}`, { method: "DELETE" });

/** Hapus user Auth lama milik demo agar seed bisa diulang. */
async function listAuthUsers() {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/admin/users?per_page=200`, {
    headers: { apikey: config.supabaseSecretKey, Authorization: `Bearer ${config.supabaseSecretKey}` }
  });
  if (!response.ok) return [];
  const data = await response.json();
  return data.users ?? [];
}

// Kata sandi demo di source bersifat publik. Untuk Supabase dibuat acak, kecuali SEED_DEMO_PASSWORDS=true.
const generated = new Map();
const passwordFor = account => {
  if (process.env.SEED_DEMO_PASSWORDS === "true") return account.password;
  if (!generated.has(account.email)) generated.set(account.email, randomBytes(12).toString("base64url") + "A1!");
  return generated.get(account.email);
};

async function createAuthUser(account) {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      email: account.email,
      password: passwordFor(account),
      email_confirm: true,
      user_metadata: { display_name: account.displayName, title: account.title, role: account.role }
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    // 422/400 = email sudah terdaftar, ambil id yang sudah ada.
    const message = JSON.stringify(body).toLowerCase();
    if (message.includes("already") || message.includes("registered") || message.includes("exists")) {
      const existing = (await listAuthUsers()).find(user => user.email === account.email);
      if (existing) {
        // Samakan kata sandi dengan yang dicetak di akhir, supaya login tidak gagal setelah seed diulang.
        await fetch(`${config.supabaseUrl}/auth/v1/admin/users/${existing.id}`, {
          method: "PUT", headers: headers(), body: JSON.stringify({ password: passwordFor(account), email_confirm: true })
        }).catch(() => undefined);
        console.log(`    = ${account.email} sudah ada, kata sandi diperbarui`);
        return existing.id;
      }
    }
    throw new Error(`${account.email}: ${response.status} ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body.id;
}

/** UUID profil demo (50000000-...) diganti ID user Supabase Auth yang sebenarnya. */
const PROFILE_PREFIX = "50000000-";

async function main() {
  const demo = buildDemoData();
  const entries = Object.entries(demo.tables).filter(([table]) => !MEMORY_ONLY.has(table));
  const dataTables = entries.filter(([table]) => !AUTH_LINKED.has(table));
  const dataRows = dataTables.reduce((sum, [, rows]) => sum + rows.length, 0);

  console.log("=".repeat(66));
  console.log("SEED JAGA (data dummy Aceh Utara) -> " + config.supabaseUrl);
  console.log("=".repeat(66));
  console.log(`Mode            : ${dryRun ? "DRY-RUN (tidak menulis)" : "TULIS"}`);
  console.log(`Baris data      : ${dataRows} di ${dataTables.length} tabel`);
  console.log(`Akun demo       : ${DEMO_ACCOUNTS.length} pengguna Supabase Auth`);
  console.log(`Dilewati        : ${[...MEMORY_ONLY].join(", ")} (hanya mode memori)`);

  if (dryRun) {
    for (const [table, rows] of entries) {
      const note = MEMORY_ONLY.has(table) ? " (mode memori, dilewati)"
        : AUTH_LINKED.has(table) ? " (dibuat bersama akun Auth)" : "";
      console.log(`  cek ${table.padEnd(30)} ${String(rows.length).padStart(3)} baris, ${String(Object.keys(rows[0] ?? {}).length).padStart(2)} kolom${note}`);
    }
    console.log("\nDry-run selesai. Tidak ada data yang diubah.");
    return;
  }

  if (reset) {
    console.log("\n[1/4] Menghapus data lama...");
    for (const table of TABLES) {
      if (MEMORY_ONLY.has(table)) continue;
      try { await wipe(table); } catch (error) { console.log(`  lewati ${table}: ${String(error.message).slice(0, 70)}`); }
    }
    console.log("  selesai");
  }

  const failed = [];
  let written = 0;

  // Akun dan profil dibuat lebih dulu: banyak tabel merujuk profil (assigned_by, approved_by, dst.),
  // dan profiles.id harus sama dengan auth.users.id.
  console.log("\n[2/4] Membuat akun demo di Supabase Auth...");
  const profileIdMap = new Map();
  const demoProfiles = demo.tables.profiles ?? [];
  try {
    for (const account of DEMO_ACCOUNTS) {
      const profileId = await createAuthUser(account);
      const seeded = demoProfiles.find(row => row.email === account.email);
      if (seeded) profileIdMap.set(String(seeded.id), profileId);
      await insertRows("profiles", [{
        id: profileId,
        display_name: account.displayName,
        email: account.email,
        phone: seeded?.phone ?? null,
        role: account.role,
        title: account.title,
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }]);
      written += 1;
      console.log(`  + ${account.email.padEnd(32)} ${account.role}`);
    }
  } catch (error) {
    failed.push(`profiles/accounts :: ${String(error.message).slice(0, 240)}`);
    report(failed, written);
    console.log("\nBerhenti: profil diperlukan oleh tabel lain.");
    return;
  }

  // Jenis kerentanan sudah dibuat migrasi 001 (kunci unik: code) dengan UUID acak. Pakai yang ada dan petakan ID seed.
  const typeIdMap = new Map();
  try {
    const existing = await rest("vulnerability_types?select=id,code");
    for (const seeded of demo.tables.vulnerability_types ?? []) {
      const found = existing.find(row => row.code === seeded.code);
      if (found) typeIdMap.set(String(seeded.id), String(found.id));
    }
  } catch { /* tabel belum ada: akan gagal pada langkah berikut dengan pesan jelas */ }

  const remap = row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (typeof value !== "string") return [key, value];
    if (value.startsWith(PROFILE_PREFIX)) return [key, profileIdMap.get(value) ?? null];
    return [key, typeIdMap.get(value) ?? value];
  }));

  console.log("\n[3/4] Menulis data...");
  for (const [table, rows] of dataTables) {
    if (!rows.length) continue;
    if (table === "vulnerability_types" && typeIdMap.size === rows.length) {
      console.log(`  = ${table.padEnd(30)} memakai ${rows.length} baris dari migrasi`);
      continue;
    }
    try {
      await insertRows(table, rows.map(remap));
      written += rows.length;
      console.log(`  + ${table.padEnd(30)} ${rows.length}`);
    } catch (error) {
      failed.push(`${table} :: ${String(error.message).slice(0, 240)}`);
      console.log(`  ! ${table.padEnd(30)} GAGAL`);
    }
  }

  console.log("\n[4/4] Selesai");
  report(failed, written);
  console.log("\nAKUN DEMO (password awal, catat sekarang karena tidak disimpan; ganti setelah login pertama):");
  for (const account of DEMO_ACCOUNTS) {
    console.log(`  ${account.email.padEnd(32)} ${account.role.padEnd(7)} ${passwordFor(account)}`);
  }
  console.log("\nSet JAGA_DATA_IS_DUMMY=true di .env agar dashboard menampilkan label data dummy.");
}

function report(failed, written) {
  console.log("\n" + "-".repeat(66));
  console.log(`Selesai: ${written} baris ditulis.`);
  if (failed.length) {
    console.log(`\n${failed.length} tabel GAGAL. Kemungkinan migrasi belum dijalankan berurutan (001, 002, 202610020001, 202610020002):`);
    for (const line of failed) console.log("  - " + line);
  } else {
    console.log("Tidak ada kegagalan.");
  }
}

main().catch(error => {
  console.error("\nGAGAL TOTAL:", error.message);
  process.exit(1);
});
