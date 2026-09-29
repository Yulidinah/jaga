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
 *  node --env-file=.env scripts/seed-supabase.mjs --data-only  # tanpa buat akun
 *  node --env-file=.env scripts/seed-supabase.mjs --reset      # hapus data lama dulu
 *
 * Catatan penting:
 *  - profiles.id wajib menunjuk auth.users.id, jadi profil TIDAK boleh di-seed
 *    dengan UUID buatan. Akun dibuat lewat Supabase Auth Admin.
 *  - internal_accounts hanya dipakai mode memori, dilewati di sini.
 */

import { buildDemoData, DEMO_ACCOUNTS } from "../backend/dist/seed.js";
import { config } from "../backend/dist/config.js";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const reset = args.has("--reset");
const dataOnly = args.has("--data-only");

if (!config.supabaseUrl || !config.supabaseSecretKey) {
  console.error("GAGAL: SUPABASE_URL / SUPABASE_SECRET_KEY belum diisi di .env");
  process.exit(1);
}

/** Tabel yang hanya hidup di mode memori. */
const MEMORY_ONLY = new Set(["internal_accounts"]);
/** Tabel yang bergantung pada auth.users, ditangani pada tahap "--accounts". */
const AUTH_LINKED = new Set(["profiles", "organization_members"]);

/** Urutan hapus untuk --reset (anak lebih dulu). */
const TABLES = [
  "audit_logs", "notifications", "attachments", "command_receipts", "alert_commands",
  "incident_assignments", "assessment_factors", "incident_assessments",
  "incident_status_history", "priority_recommendations", "priority_overrides",
  "priority_thresholds", "priority_rules", "priority_rule_sets",
  "team_location_history", "rescue_team_members", "rescue_teams",
  "device_telemetry", "device_assignments", "devices", "gateways",
  "resident_contacts", "resident_vulnerabilities", "residents",
  "evacuation_routes", "evacuation_shelters", "hazard_zones",
  "organization_service_areas", "organization_members", "profiles",
  "organizations", "vulnerability_types", "hamlets", "villages",
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

const insertRows = (table, rows) =>
  rest(table, {
    method: "POST",
    headers: headers("resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify(rows)
  });

const wipe = table =>
  rest(`${table}?id=neq.00000000-0000-0000-0000-000000000000`, { method: "DELETE" })
    .catch(() => rest(`${table}?limit=1`, { method: "DELETE" }));

/** Hapus user Auth lama milik demo agar seed bisa diulang. */
async function listAuthUsers() {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/admin/users?per_page=200`, {
    headers: { apikey: config.supabaseSecretKey, Authorization: `Bearer ${config.supabaseSecretKey}` }
  });
  if (!response.ok) return [];
  const data = await response.json();
  return data.users ?? [];
}

async function createAuthUser(account) {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      email: account.email,
      password: account.password,
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
      if (existing) { console.log(`    = ${account.email} sudah ada, memakai user yang lama`); return existing.id; }
    }
    throw new Error(`${account.email}: ${response.status} ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body.id;
}

async function main() {
  const demo = buildDemoData();
  const entries = Object.entries(demo.tables).filter(([table]) => !MEMORY_ONLY.has(table));
  const total = entries.reduce((sum, [, rows]) => sum + rows.length, 0);
  const dataTables = entries.filter(([table]) => !AUTH_LINKED.has(table));
  const dataRows = dataTables.reduce((sum, [, rows]) => sum + rows.length, 0);

  console.log("=".repeat(66));
  console.log("SEED JAGA -> " + config.supabaseUrl);
  console.log("=".repeat(66));
  console.log(`Mode            : ${dryRun ? "DRY-RUN (tidak menulis)" : "TULIS"}`);
  console.log(`Baris data      : ${dataRows} di ${dataTables.length} tabel`);
  console.log(`Akun demo       : ${dataOnly ? "dilewati (--data-only)" : DEMO_ACCOUNTS.length + " pengguna Supabase Auth"}`);
  console.log(`Dilewati        : ${[...MEMORY_ONLY, ...AUTH_LINKED].join(", ")}`);

  if (dryRun) {
    for (const [table, rows] of entries) {
      const note = MEMORY_ONLY.has(table) ? " (mode memori, dilewati)"
        : AUTH_LINKED.has(table) ? " (dibuat di tahap akun)" : "";
      console.log(`  cek ${table.padEnd(30)} ${String(rows.length).padStart(3)} baris, ${String(Object.keys(rows[0] ?? {}).length).padStart(2)} kolom${note}`);
    }
    console.log("\nDry-run selesai. Tidak ada data yang diubah.");
    return;
  }

  if (reset) {
    console.log("\n[1/3] Menghapus data lama...");
    for (const table of TABLES) {
      if (MEMORY_ONLY.has(table)) continue;
      try { await wipe(table); } catch (error) { console.log(`  lewati ${table}: ${String(error.message).slice(0, 70)}`); }
    }
    console.log("  selesai");
  }

  console.log("\n[2/3] Menulis data...");
  let written = 0;
  const failed = [];
  for (const [table, rows] of dataTables) {
    if (!rows.length) continue;
    try {
      await insertRows(table, rows);
      written += rows.length;
      console.log(`  + ${table.padEnd(30)} ${rows.length}`);
    } catch (error) {
      failed.push(`${table} :: ${String(error.message).slice(0, 240)}`);
      console.log(`  ! ${table.padEnd(30)} GAGAL`);
    }
  }

  if (dataOnly) {
    report(failed, written);
    return;
  }

  console.log("\n[3/3] Membuat akun demo di Supabase Auth...");
  const demoProfiles = demo.tables.profiles ?? [];
  try {
    for (const account of DEMO_ACCOUNTS) {
      const profileId = await createAuthUser(account);
      const seeded = demoProfiles.find(row => row.email === account.email);
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
      console.log(`  + ${account.email.padEnd(30)} ${account.role}`);
    }
  } catch (error) {
    failed.push(`profiles/accounts :: ${String(error.message).slice(0, 240)}`);
  }

  report(failed, written);
  console.log("\nAKUN DEMO (password awal, ganti setelah login pertama):");
  for (const account of DEMO_ACCOUNTS) {
    console.log(`  ${account.email.padEnd(30)} ${account.role.padEnd(7)} ${account.password}`);
  }
  console.log("\nUji login:");
  for (const account of DEMO_ACCOUNTS) {
    console.log(`  curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"${account.email}","password":"${account.password}"}'`);
  }
}

function report(failed, written) {
  console.log("\n" + "-".repeat(66));
  console.log(`Selesai: ${written} baris ditulis.`);
  if (failed.length) {
    console.log(`\n${failed.length} tabel GAGAL. Kemungkinan migration 002 belum dijalankan:`);
    for (const line of failed) console.log("  - " + line);
  } else {
    console.log("Tidak ada kegagalan.");
  }
}

main().catch(error => {
  console.error("\nGAGAL TOTAL:", error.message);
  process.exit(1);
});
