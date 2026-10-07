import { scopeIds } from "../auth.js";
import { indexBy } from "../lib.js";
import type { Row, Session } from "../types.js";
import type { Store } from "../store.js";
import type { Query } from "../store.js";

export interface SupportProfile {
  resident: Row;
  village: Row | null;
  vulnerabilities: Array<Row & { type: Row | null }>;
  contacts: Row[];
  device: Row | null;
  deviceAssignment: Row | null;
  latestTelemetry: Row | null;
  openIncidents: Row[];
  riskFlags: string[];
  completeness: number;
}

const completenessOf = (profile: Omit<SupportProfile, "completeness" | "riskFlags">): number => {
  const checks = [
    Boolean(profile.resident.full_name),
    Boolean(profile.resident.phone),
    Boolean(profile.resident.birth_date),
    Boolean(profile.resident.latitude && profile.resident.longitude),
    Boolean(cleanField(profile.resident.address)),
    profile.vulnerabilities.length > 0,
    profile.contacts.length > 0
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100) / 100;
};

const cleanField = (value: unknown) => String(value ?? "").trim();

export async function loadSupportProfile(store: Store, residentId: string): Promise<SupportProfile | null> {
  const resident = await store.one("residents", { eq: { id: residentId } });
  if (!resident) return null;

  const [village, vulnerabilities, contacts, assignments, incidents] = await Promise.all([
    resident.village_id ? store.one("villages", { eq: { id: String(resident.village_id) } }) : null,
    store.list("resident_vulnerabilities", { eq: { resident_id: residentId } }),
    store.list("resident_contacts", { eq: { resident_id: residentId } }),
    store.list("device_assignments", { eq: { resident_id: residentId }, isNull: { unassigned_at: true } }),
    store.list("incidents", { eq: { resident_id: residentId } })
  ]);

  const typeIds = vulnerabilities.map(row => String(row.vulnerability_type_id));
  const types = typeIds.length ? await store.list("vulnerability_types", { in: { id: typeIds } }) : [];
  const typeMap = indexBy(types, row => String(row.id));

  const assignment = assignments[0] ?? null;
  const device = assignment ? await store.one("devices", { eq: { id: String(assignment.device_id) } }) : null;
  const telemetry = device
    ? await store.first("device_telemetry", { eq: { device_id: String(device.id) }, order: { recorded_at: "desc" } })
    : null;

  const categories = vulnerabilities.map(row => typeMap.get(String(row.vulnerability_type_id))?.category).filter(Boolean) as string[];

  const riskFlags: string[] = [];
  if (resident.lives_alone === true) riskFlags.push("Hidup sendiri tanpa penghubung");
  if (categories.includes("LANSIA") || categories.includes("DISABILITAS")) riskFlags.push("Kelompok rentan prioritas");
  if (categories.includes("IBU_HAMIL")) riskFlags.push("Ibu hamil");
  if (!contacts.length) riskFlags.push("Tidak ada kontak darurat");
  if (!resident.latitude || !resident.longitude) riskFlags.push("Koordinat belum lengkap");
  if (cleanField(resident.mobility_notes)) riskFlags.push("Perlu bantuan mobilitas");
  if (cleanField(resident.medical_notes)) riskFlags.push("Kebutuhan medis khusus");
  if (device ? device.battery < 25 : true) riskFlags.push("Perangkat baterai lemah atau tidak terpasang");

  const base = {
    resident, village,
    vulnerabilities: vulnerabilities.map(row => ({ ...row, type: typeMap.get(String(row.vulnerability_type_id)) ?? null })),
    contacts, device, deviceAssignment: assignment, latestTelemetry: telemetry,
    openIncidents: incidents.filter(row => !["SAFE", "CANCELLED", "CLOSED"].includes(String(row.status)))
  };
  return { ...base, riskFlags, completeness: completenessOf(base) };
}

export const scopedQuery = (session: Session, column = "village_id", extra: Query = {}): Query => {
  const ids = scopeIds(session);
  const scoped: Query = ids === null ? { ...extra } : { ...extra, ...(ids.length ? { in: { [column]: ids } } : { in: { [column]: ["__tidak_ada_desa_yang_terdaftar__"] } }) };
  return scoped;
};

/** Menggabungkan filter eq opsional ke dalam satu objek (tanpa saling menimpa). */
export const eqFilter = (...filters: Array<Record<string, unknown> | null | undefined>): { eq?: Record<string, unknown> } => {
  const eq = Object.assign({}, ...filters.filter(Boolean));
  return Object.keys(eq).length ? { eq } : {};
};

export const visibleVillageIds = (session: Session): string[] | null => scopeIds(session);

export function parsePaging(query: URLSearchParams, max: number) {
  const limit = Math.min(max, Math.max(1, Number(query.get("limit") ?? 200) || 200));
  const offset = Math.max(0, Number(query.get("offset") ?? 0) || 0);
  return { limit, offset };
}

export const searchText = (rows: Row[], term: string, fields: string[]): Row[] => {
  if (!term) return rows;
  const needle = term.toLowerCase();
  return rows.filter(row => fields.some(field => String(row[field] ?? "").toLowerCase().includes(needle)));
};
