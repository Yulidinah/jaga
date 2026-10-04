import { record } from "../audit.js";
import { requireRole, scopeIds } from "../auth.js";
import { badRequest, clean, conflict, indexBy, notFound, nowIso, oneOf, optionalText, requireUuid, text } from "../lib.js";
import { publish } from "../realtime.js";
import { evaluateRules, LEVEL_LABEL, levelForScore, REQUIRED_FACTORS } from "../recommend.js";
import { param, type Ctx } from "../router.js";
import type { Row } from "../types.js";

const OPERATORS = ["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "IN", "EXISTS"] as const;
const STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;

const ruleShape = (rule: Row) => ({
  id: rule.id,
  factorKey: rule.factor_key,
  operator: rule.operator,
  comparisonValue: rule.comparison_value,
  scoreDelta: Number(rule.score_delta ?? 0),
  explanation: rule.explanation,
  displayOrder: rule.display_order,
  active: rule.active !== false
});

const setShape = (row: Row) => ({
  id: row.id,
  name: row.name,
  disasterType: row.disaster_type,
  version: row.version,
  status: row.status,
  description: row.description,
  appliesFrom: row.applies_from,
  appliesUntil: row.applies_until,
  createdBy: row.created_by,
  approvedBy: row.approved_by,
  approvedAt: row.approved_at,
  createdAt: row.created_at
});

export async function listRuleSets(ctx: Ctx) {
  const rows = await ctx.store.list("priority_rule_sets", { order: { version: "desc" } });
  const rules = rows.length ? await ctx.store.list("priority_rules", { in: { rule_set_id: rows.map(row => String(row.id)) } }) : [];
  const counts = new Map<string, number>();
  for (const rule of rules) {
    const key = String(rule.rule_set_id);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return rows.map(row => ({ ...setShape(row), ruleCount: counts.get(String(row.id)) ?? 0 }));
}

export async function getRuleSet(ctx: Ctx) {
  const ruleSet = await ctx.store.one("priority_rule_sets", { eq: { id: param(ctx, "id") } });
  if (!ruleSet) throw notFound("Rule set tidak ditemukan");
  const rules = await ctx.store.list("priority_rules", { eq: { rule_set_id: param(ctx, "id") }, order: { display_order: "asc" } });
  const recommendations = await ctx.store.list("priority_recommendations", { eq: { rule_set_id: param(ctx, "id") }, limit: 20 });
  return {
    ...setShape(ruleSet),
    rules: rules.map(ruleShape),
    sampleRecommendations: recommendations
  };
}

export async function createRuleSet(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT"], "Hanya JAGA Pusat yang dapat menyusun rule set");
  const name = text(ctx.body.name, "Nama rule set", { max: 160 });
  const version = Math.max(1, Number(ctx.body.version ?? 1) || 1);
  const clash = await ctx.store.one("priority_rule_sets", { eq: { name, version } });
  if (clash) throw conflict("Nama dan versi yang sama sudah dipakai");
  const ruleSet = await ctx.store.insert("priority_rule_sets", {
    name,
    disaster_type: optionalText(ctx.body.disasterType, "Jenis bencana", 80),
    version,
    status: "DRAFT",
    description: optionalText(ctx.body.description, "Deskripsi", 2000),
    created_by: ctx.session.profileId,
    created_at: nowIso()
  });
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "RULESET_CREATE", entityType: "priority_rule_sets",
    entityId: String(ruleSet.id), summary: `Membuat rule set ${name} v${version}`, after: ruleSet
  });
  return setShape(ruleSet);
}

export async function updateRuleSet(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT"]);
  const ruleSet = await ctx.store.one("priority_rule_sets", { eq: { id: param(ctx, "id") } });
  if (!ruleSet) throw notFound("Rule set tidak ditemukan");
  if (String(ruleSet.status) === "ARCHIVED") throw conflict("Rule set yang diarsipkan tidak dapat diubah");
  const patch: Row = {};
  if (ctx.body.name !== undefined) patch.name = text(ctx.body.name, "Nama rule set", { max: 160 });
  if (ctx.body.description !== undefined) patch.description = optionalText(ctx.body.description, "Deskripsi", 2000);
  if (ctx.body.disasterType !== undefined) patch.disaster_type = optionalText(ctx.body.disasterType, "Jenis bencana", 80);
  const updated = await ctx.store.update("priority_rule_sets", param(ctx, "id"), patch);
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "RULESET_UPDATE", entityType: "priority_rule_sets",
    entityId: param(ctx, "id"), summary: "Memperbarui rule set", before: ruleSet, after: updated
  });
  return setShape(updated ?? ruleSet);
}

export async function saveRules(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT"]);
  const ruleSet = await ctx.store.one("priority_rule_sets", { eq: { id: param(ctx, "id") } });
  if (!ruleSet) throw notFound("Rule set tidak ditemukan");
  if (String(ruleSet.status) === "ARCHIVED") throw conflict("Rule set yang diarsipkan tidak dapat diubah");
  if (String(ruleSet.status) === "ACTIVE") {
    // Rekomendasi lama merujuk rule set ini; mengubahnya di tempat membuat hasil lama tidak bisa direproduksi.
    throw conflict("Rule set aktif tidak boleh diubah. Buat versi baru.");
  }
  const items = Array.isArray(ctx.body.rules) ? ctx.body.rules : [];
  if (!items.length) throw badRequest("Kirim minimal satu aturan");
  if (items.length > 200) throw badRequest("Maksimal 200 aturan per rule set");

  const known = new Set<string>([...REQUIRED_FACTORS, "age_group", "contact_count", "device_battery", "device_online", "mobility_limited", "communication_notes", "evacuation_notes", "lives_with_others", "severity_reported", "affected_count", "vulnerability_count", "operation_water_level_cm", "is_disabled", "is_pregnant", "time_critical_medical", "vulnerability_codes", "has_active_sos"]);
  const seen = new Set<string>();
  const rows = items.map((item: Row, index: number) => {
    const factorKey = clean(item.factorKey ?? item.factor_key);
    if (!known.has(factorKey)) throw badRequest(`Faktor ${factorKey} tidak dikenal`, { allowed: Array.from(known) });
    if (seen.has(factorKey)) throw badRequest(`Faktor ${factorKey} muncul lebih dari sekali`);
    seen.add(factorKey);
    const operator = oneOf(item.operator ?? "EQ", OPERATORS, "Operator");
    const delta = Number(item.scoreDelta ?? item.score_delta ?? 0);
    if (!Number.isFinite(delta)) throw badRequest("scoreDelta harus berupa angka");
    return {
      rule_set_id: param(ctx, "id"),
      factor_key: factorKey,
      operator,
      comparison_value: item.comparisonValue ?? item.comparison_value ?? null,
      score_delta: delta,
      explanation: text(item.explanation, "Penjelasan", { max: 500 }),
      display_order: Number(item.displayOrder ?? item.display_order ?? index) || index,
      active: item.active === undefined ? true : Boolean(item.active)
    };
  });

  const previous = await ctx.store.list("priority_rules", { eq: { rule_set_id: param(ctx, "id") } });
  await ctx.store.removeWhere("priority_rules", { eq: { rule_set_id: param(ctx, "id") } });
  let saved: Row[];
  try {
    saved = await ctx.store.insertMany("priority_rules", rows);
  } catch (error) {
    // Pulihkan aturan lama bila penyimpanan gagal supaya rule set tidak kosong.
    if (previous.length) await ctx.store.insertMany("priority_rules", previous).catch(() => undefined);
    throw error;
  }
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "RULESET_RULES_SAVE", entityType: "priority_rule_sets",
    entityId: param(ctx, "id"), summary: `Menyimpan ${rows.length} aturan`
  });
  return saved.map(ruleShape);
}

export async function publishRuleSet(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT"], "Hanya JAGA Pusat yang dapat mengaktifkan rule set");
  const ruleSet = await ctx.store.one("priority_rule_sets", { eq: { id: param(ctx, "id") } });
  if (!ruleSet) throw notFound("Rule set tidak ditemukan");
  const rules = await ctx.store.list("priority_rules", { eq: { rule_set_id: param(ctx, "id") } });
  if (!rules.length) throw badRequest("Rule set tanpa aturan tidak dapat diaktifkan");
  const action = clean(ctx.body.action ?? "activate").toLowerCase();

  if (action === "archive") {
    const updated = await ctx.store.update("priority_rule_sets", param(ctx, "id"), { status: "ARCHIVED" });
    await record(ctx.store, {
      actorId: ctx.session.profileId, action: "RULESET_ARCHIVE", entityType: "priority_rule_sets",
      entityId: param(ctx, "id"), summary: "Mengarsipkan rule set", before: ruleSet, after: updated
    });
    return setShape(updated ?? ruleSet);
  }
  if (action === "activate") {
    if (String(ruleSet.status) === "ARCHIVED") throw conflict("Rule set yang diarsipkan tidak dapat diaktifkan kembali. Buat versi baru.");
    const approvalNote = text(ctx.body.approvalNote, "Catatan persetujuan", { min: 5, max: 500 });
    const others = (await ctx.store.list("priority_rule_sets", { eq: { status: "ACTIVE" } }))
      .filter(other => String(other.id) !== param(ctx, "id") && String(other.disaster_type ?? "") === String(ruleSet.disaster_type ?? ""));
    for (const other of others) await ctx.store.update("priority_rule_sets", String(other.id), { status: "ARCHIVED" });
    let updated: Row | null;
    try {
      updated = await ctx.store.update("priority_rule_sets", param(ctx, "id"), {
        status: "ACTIVE", approved_by: ctx.session.profileId, approved_at: nowIso(), applies_from: ruleSet.applies_from ?? nowIso()
      });
    } catch (error) {
      // Kembalikan rule set lama agar tidak ada masa tanpa aturan aktif.
      for (const other of others) await ctx.store.update("priority_rule_sets", String(other.id), { status: "ACTIVE" }).catch(() => undefined);
      throw error;
    }
    await record(ctx.store, {
      actorId: ctx.session.profileId, action: "RULESET_ACTIVATE", entityType: "priority_rule_sets",
      entityId: param(ctx, "id"), summary: `Mengaktifkan ${ruleSet.name} v${ruleSet.version}. ${approvalNote}`, before: ruleSet, after: updated
    });
    publish("rule_set.published", { id: param(ctx, "id"), version: ruleSet.version });
    return setShape(updated ?? ruleSet);
  }
  throw badRequest("action harus activate atau archive");
}

export async function simulateRuleSet(ctx: Ctx) {
  const ruleSet = await ctx.store.one("priority_rule_sets", { eq: { id: param(ctx, "id") } });
  if (!ruleSet) throw notFound("Rule set tidak ditemukan");
  const rules = await ctx.store.list("priority_rules", { eq: { rule_set_id: param(ctx, "id") } });
  const scenarios = Array.isArray(ctx.body.scenarios) ? ctx.body.scenarios : [];
  if (!scenarios.length) throw badRequest("Kirim minimal satu skenario dengan bentuk { factors: { ... } }");
  if (scenarios.length > 50) throw badRequest("Maksimal 50 skenario per simulasi");

  return scenarios.map((scenario: Row) => {
    const factors = scenario.factors && typeof scenario.factors === "object" ? scenario.factors as Record<string, unknown> : {};
    const known = new Set(Object.keys(factors));
    const result = evaluateRules(rules, { factors, known });
    const missing = REQUIRED_FACTORS.filter(key => !known.has(key));
    const level = levelForScore(result.score);
    return {
      name: clean(scenario.name) || "Skenario",
      score: result.score,
      level,
      levelLabel: LEVEL_LABEL[level],
      matchedRules: result.applied,
      totalRules: result.total,
      reasons: result.reasons,
      missingFactors: missing
    };
  });
}

export async function listThresholds(ctx: Ctx) {
  const ruleSetId = clean(ctx.query.get("ruleSetId"));
  const rows = await ctx.store.list("priority_thresholds", { ...(ruleSetId ? { eq: { rule_set_id: ruleSetId } } : {}), order: { min_score: "asc" } });
  return rows.map(row => ({
    minScore: row.min_score,
    level: row.level,
    label: String(row.label ?? LEVEL_LABEL[row.level as keyof typeof LEVEL_LABEL] ?? row.level)
  }));
}

export async function upsertThreshold(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT"]);
  const ruleSetId = requireUuid(ctx.body.ruleSetId, "Rule set");
  const ruleSet = await ctx.store.one("priority_rule_sets", { eq: { id: ruleSetId } });
  if (!ruleSet) throw notFound("Rule set tidak ditemukan");
  if (String(ruleSet.status) === "ACTIVE") throw conflict("Ambang rule set aktif tidak boleh diubah. Buat versi baru.");
  const minScore = Number(ctx.body.minScore ?? 0);
  if (!Number.isFinite(minScore) || minScore < -999 || minScore > 999) throw badRequest("minScore harus angka antara -999 dan 999");
  const level = oneOf(ctx.body.level, ["PANTAU", "SEGERA_TINJAU", "RESPONS_CEPAT", "DARURAT"] as const, "Level");
  const [row] = await ctx.store.upsert("priority_thresholds", [{ rule_set_id: ruleSetId, level, min_score: minScore }], ["rule_set_id", "level"]);
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "THRESHOLD_UPSERT", entityType: "priority_thresholds",
    entityId: ruleSetId, summary: `Ambang ${minScore} -> ${level}`, after: row ?? null
  });
  return row;
}

export async function simulateLive(ctx: Ctx) {
  const rules = await ctx.store.list("priority_rules", { eq: { rule_set_id: param(ctx, "id") } });
  const residents = await ctx.store.list("residents", { eq: { active: true }, limit: 200 });
  const ids = residents.map(row => String(row.id));
  const vulns = ids.length ? await ctx.store.list("resident_vulnerabilities", { in: { resident_id: ids } }) : [];
  const contacts = ids.length ? await ctx.store.list("resident_contacts", { in: { resident_id: ids } }) : [];
  const types = await ctx.store.list("vulnerability_types", {});
  const typeMap = indexBy(types, row => String(row.id));
  const residentMap = indexBy(residents, row => String(row.id));

  return residents.map(resident => {
    const residentId = String(resident.id);
    const residentVulns: Row[] = vulns
      .filter(row => String(row.resident_id) === residentId)
      .map(row => ({ ...row, category: String(typeMap.get(String(row.vulnerability_type_id))?.category ?? "") }));
    const residentContacts = contacts.filter(row => String(row.resident_id) === residentId);
    const factors: Record<string, unknown> = {
      vulnerability_categories: residentVulns.map(row => row.category).filter(Boolean),
      vulnerability_severity: residentVulns.length ? Math.max(...residentVulns.map(row => Number(row.severity ?? 0))) : 0,
      lives_alone: resident.lives_alone === true,
      has_contact: residentContacts.length > 0,
      mobility_limited: Boolean(resident.mobility_notes) || residentVulns.some(row => row.category === "DISABILITAS"),
      medical_equipment: resident.medical_notes ?? ""
    };
    const result = evaluateRules(rules, { factors, known: new Set(Object.keys(factors)) });
    const level = levelForScore(result.score);
    return {
      residentId,
      name: residentMap.get(residentId)?.full_name ?? null,
      score: result.score,
      level,
      levelLabel: LEVEL_LABEL[level],
      reasons: result.reasons
    };
  }).sort((a, b) => b.score - a.score);
}

export const factorCatalog = () => REQUIRED_FACTORS.map(key => ({
  key,
  description: FACTOR_NOTES[key] ?? "Faktor pendukung",
  example: FACTOR_EXAMPLES[key] ?? null
}));

export async function listOverrides(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "DESA"]);
  const allRows = await ctx.store.list("priority_overrides", { order: { created_at: "desc" }, limit: 200 });
  const incidentIds = Array.from(new Set(allRows.map(row => String(row.incident_id))));
  const incidents = incidentIds.length ? await ctx.store.list("incidents", { in: { id: incidentIds } }) : [];
  const scope = scopeIds(ctx.session);
  const visible = scope === null ? incidents : incidents.filter(row => scope.includes(String(row.village_id)));
  const map = indexBy(visible, row => String(row.id));
  const rows = allRows.filter(row => map.has(String(row.incident_id)));
  return rows.map(row => ({
    id: row.id,
    incidentId: row.incident_id,
    incidentOwner: map.get(String(row.incident_id))?.owner_name ?? null,
    previousLevel: row.previous_level,
    selectedLevel: row.selected_level,
    reason: row.reason,
    overriddenBy: row.overridden_by,
    createdAt: row.created_at
  }));
}

const FACTOR_NOTES: Record<string, string> = {
  vulnerability_categories: "Kategori kerentanan yang tercatat pada warga",
  vulnerability_severity: "Tingkat kerentanan tertinggi (1-5)",
  age: "Usia warga dalam tahun",
  age_group: "Kelompok usia: BAYI, ANAK, DEWASA, LANSIA",
  lives_alone: "Warga tinggal sendiri tanpa penghubung",
  lives_with_others: "Ada anggota keluarga atau tetangga yang tinggal bersama",
  mobility_aid: "Keterangan kebutuhan alat bantu mobilitas",
  mobility_limited: "Warga memerlukan bantuan saat bergerak",
  medical_equipment: "Kebutuhan alat atau perawatan medis khusus",
  communication_notes: "Keterangan cara berkomunikasi dengan warga",
  evacuation_notes: "Keterangan khusus proses evakuasi",
  has_contact: "Punya minimal satu kontak darurat",
  contact_count: "Jumlah kontak darurat terdaftar",
  is_pregnant: "Warga termasuk ibu hamil",
  is_disabled: "Warga termasuk penyandang disabilitas",
  incident_type: "Jenis bencana pada insiden",
  severity_reported: "Tingkat kewaspadaan yang dilaporkan",
  affected_count: "Jumlah orang terdampak",
  water_depth_cm: "Kedalaman air dalam sentimeter",
  flood_depth_cm: "Kedalaman banjir dalam sentimeter",
  fire_risk: "Risiko kebakaran (1-5)",
  structure_risk: "Risiko bangunan runtuh (1-5)",
  landslide_risk: "Risiko longsoran (1-5)",
  terrain_isolation: "Tingkat isolasi akses (1-5)",
  distance_km: "Jarak lokasi dalam kilometer",
  is_night: "Peristiwa terjadi pada malam hari",
  device_battery: "Baterai perangkat warga",
  device_online: "Perangkat warga sedang online",
  operation_water_level_cm: "Tinggi air (cm) hasil pengamatan JAGA Desa pada operasi aktif",
  evacuation_ability: "Kemampuan evakuasi mandiri: MANDIRI, PERLU_BANTUAN, atau TIDAK_BISA_SENDIRI",
  time_critical_medical: "Ketergantungan medis yang tidak bisa ditunda (insulin, oksigen, dialisis, kehamilan mendekati persalinan)",
  vulnerability_codes: "Kode jenis kerentanan warga (mis. TUNARUNGU, TUNANETRA)",
  hazard_zone_risk: "Risiko zona bahaya aktif di lokasi rumah (0-5)",
  has_active_sos: "Warga memiliki laporan SOS/insiden yang masih terbuka"
};

const FACTOR_EXAMPLES: Record<string, unknown> = {
  vulnerability_categories: ["LANSIA", "PENYAKIT_KRONIS"],
  vulnerability_severity: 4,
  age: 78,
  age_group: "LANSIA",
  lives_alone: true,
  lives_with_others: false,
  mobility_aid: "Memerlukan kursi roda",
  mobility_limited: true,
  medical_equipment: "Oksigen portabel",
  has_contact: true,
  contact_count: 2,
  is_pregnant: false,
  is_disabled: false,
  incident_type: "BANJIR",
  severity_reported: "SIAGA",
  affected_count: 3,
  water_depth_cm: 60,
  flood_depth_cm: 80,
  fire_risk: 2,
  structure_risk: 3,
  landslide_risk: 1,
  terrain_isolation: 4,
  distance_km: 2.5,
  is_night: false,
  device_battery: 45,
  device_online: true
};
