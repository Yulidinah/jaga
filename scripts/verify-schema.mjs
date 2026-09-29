// verify-schema.mjs
// Membandingkan kolom yang ditulis backend dengan skema nyata (migration 001 + 002).
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
const root = "D:/LOMBA/udare/udare 4.0/jaga";

const parseMigrations = async () => {
  const tables = new Map();
  const add = async (file) => {
    const t = await readFile(join(root, "supabase/migrations", file), "utf8");
    for (const m of t.matchAll(/create table(?: if not exists)?\s+public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
      const cols = new Set(tables.get(m[1]) ?? []);
      for (const c of m[2].matchAll(/^\s{2}(\w+)\s/gm)) cols.add(c[1]);
      tables.set(m[1], cols);
    }
    for (const m of t.matchAll(/alter table public\.(\w+) add column if not exists (\w+)/g)) {
      if (!tables.has(m[1])) tables.set(m[1], new Set());
      tables.get(m[1]).add(m[2]);
    }
  };
  await add("202609220001_initial_jaga.sql");
  await add("202609220002_operational.sql");
  return tables;
}

async function collect() {
  const usage = new Map();
  const dir = join(root, "backend/src/api");
  const files = (await readdir(dir)).filter(f => f.endsWith(".ts")).map(f => join(dir, f));
  files.push(join(root, "backend/src/seed.ts"));
  // Kunci ini milik objek opsi/payload lain, bukan kolom tabel.
  const NOT_A_COLUMN = new Set(["min", "max", "field", "default", "onConflict", "select", "order", "limit"]);
  for (const file of files) {
    const raw = await readFile(file, "utf8");
    // Buang blok record(ctx.store, {...}) supaya tidak ikut terhitung sebagai kolom.
    const t = raw.replace(/record\(\s*ctx\.store\s*,[\s\S]*?\n\s*\}\);/g, "");
    const short = file.split(/[\\/]/).pop();
    for (const m of t.matchAll(/store\.(?:insert|upsert|update)\(\s*"(\w+)"\s*,\s*(?:\w+\s*,\s*)?\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
      const table = m[1];
      const cols = [...m[2].matchAll(/(\w+)\s*:/g)].map(c => c[1]).filter(c => !NOT_A_COLUMN.has(c));
      if (!usage.has(table)) usage.set(table, new Map());
      for (const col of cols) {
        if (!usage.get(table).has(col)) usage.get(table).set(col, []);
        if (!usage.get(table).get(col).includes(short)) usage.get(table).get(col).push(short);
      }
    }
  }
  return usage;
}

const schema = await parseMigrations();
const usage = await collect();
const problems = [];
for (const [table, cols] of [...usage].sort()) {
  if (!schema.has(table)) {
    problems.push(`TABEL TIDAK ADA di DB: ${table}  (dipakai di ${[...cols.values()].flat().join(", ")})`);
    continue;
  }
  for (const [col, files] of cols) {
    if (!schema.get(table).has(col)) {
      problems.push(`KOLOM TIDAK ADA: ${table}.${col}  (dipakai di ${files.join(", ")})`);
    }
  }
}
console.log(problems.length ? problems.join("\n") : "SEMUA KOLOM COCOK dengan skema");
console.log(`\ntabel diperiksa: ${usage.size} | tabel di skema: ${schema.size}`);

