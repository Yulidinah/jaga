import { badRequest, clean, nowIso, oneOf } from "./lib.js";
import type { RecommendationLevel, Row } from "./types.js";
import type { Store } from "./store.js";

export const LEVELS: RecommendationLevel[] = ["PANTAU", "SEGERA_TINJAU", "RESPONS_CEPAT", "DARURAT"];

export const LEVEL_LABEL: Record<RecommendationLevel, string> = {
  PANTAU: "Pantau berkala",
  SEGERA_TINJAU: "Segera ditinjau",
  RESPONS_CEPAT: "Respons cepat",
  DARURAT: "Darurat"
};

/** Ambang skor bawaan. Nilai di antara ambang diambil oleh level yang lebih rendah. */
const DEFAULT_BANDS: Array<{ min: number; level: RecommendationLevel }> = [
  { min: 70, level: "DARURAT" },
  { min: 45, level: "RESPONS_CEPAT" },
  { min: 25, level: "SEGERA_TINJAU" },
  { min: -999, level: "PANTAU" }
];

export type Bands = Array<{ min: number; level: RecommendationLevel }>;

/** Mengubah baris priority_thresholds menjadi pita skor (diurutkan dari ambang tertinggi). */
export const bandsFrom = (rows: Row[]): Bands => {
  const bands = rows
    .filter(row => LEVELS.includes(String(row.level) as RecommendationLevel) && Number.isFinite(Number(row.min_score)))
    .map(row => ({ min: Number(row.min_score), level: String(row.level) as RecommendationLevel }))
    .sort((a, b) => b.min - a.min);
  return bands.length ? [...bands, { min: -Infinity, level: "PANTAU" as RecommendationLevel }] : DEFAULT_BANDS;
};

export const levelForScore = (score: number, bands: Bands = DEFAULT_BANDS): RecommendationLevel =>
  bands.find(band => score >= band.min)?.level ?? "PANTAU";

export interface FactorContext {
  factors: Record<string, unknown>;
  known: Set<string>;
}

export type FactorSource = "SYSTEM" | "PROFILE" | "ASSESSMENT" | "MANUAL" | "INCIDENT" | "DEVICE";

export interface FactorInput {
  key: string;
  value: unknown;
  source: FactorSource;
  note?: string;
}

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Umur dalam tahun lengkap dari tanggal lahir. */
export function ageFrom(birthDate: unknown): number | null {
  const raw = clean(birthDate);
  if (!raw) return null;
  const born = new Date(raw);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const monthDiff = now.getMonth() - born.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < born.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(entry => String(entry)) : typeof value === "string" && value ? [value] : [];

function compare(operator: string, actual: unknown, expected: unknown): boolean {
  const inList = list(actual);
  switch (operator) {
    case "EQ":
      if (typeof expected === "boolean") return String(actual) === String(expected) || actual === expected;
      if (typeof expected === "number") return num(actual) === expected;
      return String(actual ?? "").toLowerCase() === String(expected ?? "").toLowerCase();
    case "NEQ":
      return !compare("EQ", actual, expected);
    case "GT": {
      const a = num(actual); const b = num(expected);
      return a !== null && b !== null && a > b;
    }
    case "GTE": {
      const a = num(actual); const b = num(expected);
      return a !== null && b !== null && a >= b;
    }
    case "LT": {
      const a = num(actual); const b = num(expected);
      return a !== null && b !== null && a < b;
    }
    case "LTE": {
      const a = num(actual); const b = num(expected);
      return a !== null && b !== null && a <= b;
    }
    case "IN":
      return inList.some(entry => list(expected).some(candidate => candidate.toLowerCase() === entry.toLowerCase()));
    case "EXISTS":
      return actual !== null && actual !== undefined && actual !== "" && !(Array.isArray(actual) && !actual.length);
    default:
      return false;
  }
}

export function evaluateRules(rules: Row[], context: FactorContext): {
  score: number;
  reasons: Array<{ factor: string; delta: number; explanation: string }>;
  applied: number;
  total: number;
} {
  const ordered = [...rules].sort((a, b) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0));
  const reasons: Array<{ factor: string; delta: number; explanation: string }> = [];
  let score = 0;
  let applied = 0;
  for (const rule of ordered) {
    if (rule.active === false) continue;
    const key = String(rule.factor_key);
    if (!context.known.has(key)) continue;
    const operator = String(rule.operator ?? "EQ").toUpperCase();
    const expected = rule.comparison_value;
    const actual = context.factors[key];
    if (!compare(operator, actual, expected)) continue;
    const delta = Number(rule.score_delta ?? 0);
    score += delta;
    applied += 1;
    reasons.push({ factor: key, delta, explanation: String(rule.explanation) });
  }
  return { score: Math.round(score * 100) / 100, reasons, applied, total: ordered.length };
}

export function completeness(context: FactorContext, expectedKeys: string[]): number {
  if (!expectedKeys.length) return 1;
  const present = expectedKeys.filter(key => context.known.has(key)).length;
  return Math.round((present / expectedKeys.length) * 100) / 100;
}

export interface RecommendationInput {
  ruleSet: Row;
  rules: Row[];
  factors: FactorInput[];
  overrideLevel?: RecommendationLevel | null;
  overrideReason?: string | null;
  bands?: Bands;
}

export interface RecommendationResult {
  ruleSetId: string;
  ruleSetName: string;
  ruleSetVersion: number;
  score: number;
  suggestedLevel: RecommendationLevel;
  /** Level murni hasil aturan, sebelum override petugas. */
  systemLevel: RecommendationLevel;
  levelLabel: string;
  reasons: Array<{ factor: string; delta: number; explanation: string }>;
  missingFactors: string[];
  dataCompleteness: number;
  rulesEvaluated: number;
  rulesMatched: number;
  isOverridden: boolean;
  overrideReason: string | null;
  calculatedAt: string;
}

export const REQUIRED_FACTORS = [
  "vulnerability_categories",
  "vulnerability_severity",
  "age",
  "lives_alone",
  "mobility_aid",
  "medical_equipment",
  "has_contact",
  "incident_type",
  "water_depth_cm",
  "fire_risk",
  "structure_risk",
  "terrain_isolation",
  "distance_km",
  "is_night",
  "flood_depth_cm",
  "landslide_risk"
];

export function recommend(input: RecommendationInput): RecommendationResult {
  const factors: Record<string, unknown> = {};
  const known = new Set<string>();
  for (const factor of input.factors) {
    factors[factor.key] = factor.value;
    known.add(factor.key);
  }
  const context: FactorContext = { factors, known };
  const result = evaluateRules(input.rules, context);
  const suggested = levelForScore(result.score, input.bands);
  const overridden = input.overrideLevel && input.overrideLevel !== suggested ? input.overrideLevel : null;

  return {
    ruleSetId: String(input.ruleSet.id),
    ruleSetName: String(input.ruleSet.name),
    ruleSetVersion: Number(input.ruleSet.version ?? 1),
    score: result.score,
    suggestedLevel: overridden ?? suggested,
    systemLevel: suggested,
    levelLabel: LEVEL_LABEL[overridden ?? suggested],
    reasons: result.reasons,
    missingFactors: REQUIRED_FACTORS.filter(key => !known.has(key)),
    dataCompleteness: completeness(context, REQUIRED_FACTORS),
    rulesEvaluated: result.total,
    rulesMatched: result.applied,
    isOverridden: Boolean(overridden),
    overrideReason: input.overrideReason ?? null,
    calculatedAt: nowIso()
  };
}

/** Faktor yang dapat dihitung langsung dari data warga. */
export function profileFactors(resident: Row, vulns: Row[], contacts: Row[]): FactorInput[] {
  // Baris kerentanan membawa kategori lewat relasi `type`; jangan jatuh ke UUID jenis kerentanan.
  const categories = vulns.map(vuln => String(vuln.type?.category ?? vuln.category ?? "")).filter(Boolean);
  const severities = vulns.map(vuln => Number(vuln.severity ?? 0));
  const highest = severities.length ? Math.max(...severities) : 0;
  const age = ageFrom(resident.birth_date);
  const coResidents = contacts.filter(contact => contact.lives_with_resident === true);
  return [
    { key: "vulnerability_categories", value: categories, source: "PROFILE" },
    { key: "vulnerability_severity", value: highest, source: "PROFILE" },
    { key: "age", value: age, source: "PROFILE" },
    { key: "age_group", value: age === null ? null : age < 5 ? "BAYI" : age < 12 ? "ANAK" : age >= 65 ? "LANSIA" : "DEWASA", source: "PROFILE" },
    { key: "lives_alone", value: resident.lives_alone === true, source: "PROFILE" },
    { key: "lives_with_others", value: coResidents.length > 0, source: "PROFILE" },
    { key: "mobility_aid", value: clean(resident.mobility_notes), source: "PROFILE" },
    { key: "mobility_limited", value: Boolean(clean(resident.mobility_notes)) || categories.includes("DISABILITAS"), source: "PROFILE" },
    { key: "medical_equipment", value: clean(resident.medical_notes), source: "PROFILE" },
    { key: "communication_notes", value: clean(resident.communication_notes), source: "PROFILE" },
    { key: "evacuation_notes", value: clean(resident.evacuation_notes), source: "PROFILE" },
    { key: "has_contact", value: contacts.length > 0, source: "PROFILE" },
    { key: "contact_count", value: contacts.length, source: "PROFILE" },
    { key: "is_pregnant", value: categories.includes("IBU_HAMIL"), source: "PROFILE" },
    { key: "is_disabled", value: categories.includes("DISABILITAS"), source: "PROFILE" }
  ];
}

/** Faktor yang berasal dari situation report / device / penilaian lapangan. */
export function incidentFactors(incident: Row, telemetry: Row | null, device: Row | null = null): FactorInput[] {
  // Malam hari ditentukan menurut WIB, bukan zona waktu server.
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Jakarta" }).format(new Date())) % 24;
  const factors: FactorInput[] = [
    { key: "incident_type", value: String(incident.disaster_type ?? ""), source: "INCIDENT", note: "Jenis bencana dari laporan warga" },
    { key: "severity_reported", value: clean(incident.severity), source: "INCIDENT" },
    { key: "affected_count", value: num(incident.affected_count), source: "INCIDENT" },
    { key: "device_battery", value: num(device?.battery ?? telemetry?.battery), source: "DEVICE" },
    { key: "device_online", value: device ? device.online === true : null, source: "DEVICE" },
    { key: "is_night", value: hour < 6 || hour >= 18, source: "SYSTEM" }
  ];
  return factors;
}

export function assessmentFactors(assessments: Row[]): FactorInput[] {
  const factors: FactorInput[] = [];
  for (const assessment of assessments) {
    const entries = Array.isArray(assessment.factors) ? assessment.factors : [];
    for (const entry of entries as Array<Row>) {
      factors.push({
        key: String(entry.factor_key),
        value: entry.factor_value,
        source: "ASSESSMENT",
        note: clean(entry.source_note) || `Dinilai oleh ${assessment.source ?? "tim"}`
      });
    }
  }
  return factors;
}

export function mergeFactors(...groups: FactorInput[][]): FactorInput[] {
  const byKey = new Map<string, FactorInput>();
  for (const group of groups) {
    for (const factor of group) {
      const existing = byKey.get(factor.key);
      if (!existing) { byKey.set(factor.key, factor); continue; }
      // Faktor manual mengungguliassessment; assessment mengungguli profil.
      const rank: Record<string, number> = { MANUAL: 3, ASSESSMENT: 2, DEVICE: 2, INCIDENT: 1, PROFILE: 0, SYSTEM: 1 };
      if ((rank[factor.source] ?? 0) >= (rank[existing.source] ?? 0)) byKey.set(factor.key, factor);
    }
  }
  return Array.from(byKey.values());
}

/** Aturan khusus jenis bencana didahulukan; bila tidak ada, dipakai aturan umum (tanpa jenis bencana). */
export async function activeRuleSet(store: Store, disasterType?: string | null): Promise<{ ruleSet: Row; rules: Row[]; bands: Bands; fallback: boolean }> {
  const ruleSets = await store.list("priority_rule_sets", { eq: { status: "ACTIVE" } });
  const byVersion = (a: Row, b: Row) => Number(b.version ?? 0) - Number(a.version ?? 0);
  const exact = ruleSets.filter(row => disasterType && String(row.disaster_type ?? "") === disasterType).sort(byVersion)[0]
    ?? ruleSets.filter(row => !row.disaster_type).sort(byVersion)[0];
  // Tanpa aturan yang cocok, pakai aturan aktif lain agar SOS tetap mendapat rekomendasi, tetapi tandai sebagai cadangan.
  const chosen = exact ?? [...ruleSets].sort(byVersion)[0];
  if (!chosen) throw badRequest("Belum ada rule set prioritas berstatus ACTIVE untuk jenis bencana ini. Publikasikan satu lewat /api/rulesets.");
  const [rules, thresholds] = await Promise.all([
    store.list("priority_rules", { eq: { rule_set_id: String(chosen.id) } }),
    store.list("priority_thresholds", { eq: { rule_set_id: String(chosen.id) } })
  ]);
  return { ruleSet: chosen, rules, bands: bandsFrom(thresholds), fallback: !exact };
}

export const parseOverrideLevel = (value: unknown): RecommendationLevel | null => {
  const result = clean(value).toUpperCase();
  if (!result) return null;
  if (!LEVELS.includes(result as RecommendationLevel)) {
    throw badRequest(`Level harus salah satu dari: ${LEVELS.join(", ")}`);
  }
  return result as RecommendationLevel;
};

export const requiredFactorKeys = () => [...REQUIRED_FACTORS];

export { compare as compareRule, oneOf };
