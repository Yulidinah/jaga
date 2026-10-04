import type { Row } from "./types.js";

export type SortDirection = "asc" | "desc";

export interface Query {
  eq?: Record<string, unknown>;
  neq?: Record<string, unknown>;
  in?: Record<string, unknown[]>;
  gt?: Record<string, unknown>;
  gte?: Record<string, unknown>;
  lt?: Record<string, unknown>;
  lte?: Record<string, unknown>;
  isNull?: Record<string, boolean>;
  like?: Record<string, string>;
  /**.some( column IN values ), digabung dengan OR. */
  anyOf?: Array<{ column: string; values: unknown[] }>;
  order?: Record<string, SortDirection>;
  limit?: number;
  offset?: number;
  /** Predikat tambahan. Hanya dijalankan pada penyimpanan di memori. */
  pred?: (row: Row) => boolean;
}

export interface Store {
  readonly kind: "supabase" | "memory";
  list(table: string, query?: Query): Promise<Row[]>;
  one(table: string, query: Query): Promise<Row | null>;
  first(table: string, query: Query): Promise<Row | null>;
  count(table: string, query?: Query): Promise<number>;
  insert(table: string, row: Row): Promise<Row>;
  insertMany(table: string, rows: Row[]): Promise<Row[]>;
  upsert(table: string, rows: Row[], onConflict: string[]): Promise<Row[]>;
  update(table: string, id: unknown, patch: Row): Promise<Row | null>;
  updateWhere(table: string, query: Query, patch: Row): Promise<Row[]>;
  remove(table: string, id: unknown): Promise<void>;
  removeWhere(table: string, query: Query): Promise<void>;
  rpc(fn: string, payload?: Row): Promise<Row | Row[] | null>;
  ping(): Promise<{ ok: boolean; detail?: string }>;
}

export type IdKind = "uuid" | "text" | "identity" | "composite" | "none";

/**
 * Kunci tabel yang dipakai API. Supaya penyimpanan di memori menghasilkan kunci
 * dengan bentuk yang sama seperti kolom di PostgreSQL.
 */
export const TABLE_ID_KIND: Record<string, IdKind> = {
  provinces: "text",
  regencies: "text",
  districts: "text",
  villages: "uuid",
  hamlets: "uuid",
  organizations: "uuid",
  organization_service_areas: "composite",
  profiles: "uuid",
  organization_members: "composite",
  residents: "uuid",
  vulnerability_types: "uuid",
  resident_vulnerabilities: "composite",
  resident_contacts: "uuid",
  evacuation_shelters: "uuid",
  hazard_zones: "uuid",
  devices: "text",
  device_assignments: "uuid",
  gateways: "uuid",
  device_telemetry: "identity",
  incidents: "uuid",
  incident_status_history: "identity",
  priority_rule_sets: "uuid",
  priority_rules: "uuid",
  priority_thresholds: "identity",
  priority_recommendations: "uuid",
  priority_overrides: "identity",
  incident_assessments: "uuid",
  assessment_factors: "identity",
  rescue_teams: "uuid",
  rescue_team_members: "composite",
  incident_assignments: "uuid",
  team_location_history: "identity",
  evacuation_routes: "uuid",
  alert_commands: "uuid",
  command_receipts: "uuid",
  notifications: "uuid",
  attachments: "uuid",
  audit_logs: "identity",
  operations: "uuid",
  sync_operations: "uuid",
  internal_accounts: "composite"
};

/** Kolom yang selalu diisi server bila klien tidak mengirim. */
export const TIMESTAMP_COLUMNS = ["created_at", "updated_at", "recorded_at", "assigned_at", "joined_at", "sent_at", "last_seen_at"];

export const identityTables = new Set(
  Object.entries(TABLE_ID_KIND)
    .filter(([, kind]) => kind === "identity")
    .map(([table]) => table)
);

/** Tabel yang punya kolom created_at / updated_at di skema Supabase (migrasi 001 + 002). */
export const HAS_CREATED_AT = new Set([
  "villages", "hamlets", "organizations", "profiles", "residents", "devices", "gateways", "incidents",
  "incident_status_history", "priority_rule_sets", "priority_rules", "incident_assessments",
  "priority_recommendations", "priority_overrides", "rescue_teams", "evacuation_routes", "alert_commands", "operations",
  "notifications", "attachments", "audit_logs", "sync_operations", "hazard_zones", "priority_thresholds"
]);
export const HAS_UPDATED_AT = new Set(["profiles", "residents", "incidents", "devices", "gateways", "rescue_teams", "operations"]);
