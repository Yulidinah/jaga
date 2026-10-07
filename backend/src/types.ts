export type Row = Record<string, any>;

export type JagaRole = "PUSAT" | "DESA" | "RESCUE";

export type IncidentStatus =
  | "NEW" | "ACKNOWLEDGED" | "ASSIGNED" | "EN_ROUTE"
  | "ARRIVED" | "EVACUATED" | "NOT_FOUND" | "UNREACHABLE" | "SAFE" | "CANCELLED" | "CLOSED";

export type Severity = "WASPADA" | "SIAGA" | "AWAS";
export type AlertTargetType = "DESA" | "KELOMPOK_RENTAN" | "PERANGKAT" | "ZONA";
export type CommandStatus = "QUEUED" | "SENT" | "ACKNOWLEDGED" | "FAILED" | "EXPIRED";
export type RecommendationLevel = "PANTAU" | "SEGERA_TINJAU" | "RESPONS_CEPAT" | "DARURAT";
export type RuleSetStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
export type TeamStatus = "AVAILABLE" | "ASSIGNED" | "EN_ROUTE" | "ON_SCENE" | "OFF_DUTY";
export type VulnerabilityCategory =
  | "DISABILITAS" | "LANSIA" | "IBU_HAMIL" | "ANAK" | "PENYAKIT_KRONIS" | "CEDERA" | "LAINNYA";
export type DeviceStatus = "STOCK" | "ASSIGNED" | "MAINTENANCE" | "LOST" | "RETIRED";
export type NotificationChannel = "IN_APP" | "PUSH" | "SMS" | "EMAIL";
export type OrganizationType =
  | "PUSAT" | "PEMERINTAH_DESA" | "BPBD" | "BASARNAS" | "DAMKAR"
  | "POLISI" | "TNI" | "RELAWAN" | "LAYANAN_KESEHATAN" | "LAINNYA";
export type IncidentType = "BANYANG" | "BANJIR" | "LONGSOR" | "GEMPA" | "ERUPSI" | "KEBAKARAN" | "ANJIRAN_UDARA" | "LAINNYA";

export const ACTIVE_INCIDENT_STATUSES: IncidentStatus[] = [
  "NEW", "ACKNOWLEDGED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "EVACUATED", "NOT_FOUND", "UNREACHABLE"
];
export const CLOSED_INCIDENT_STATUSES: IncidentStatus[] = ["SAFE", "CANCELLED", "CLOSED"];

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface Session {
  userId: string;
  profileId: string;
  displayName: string;
  email: string;
  role: JagaRole;
  organizationId: string | null;
  organizationName: string | null;
  /** null berarti seluruh wilayah (khusus JAGA Pusat). */
  villageIds: string[] | null;
  villageNames: string[];
  authSource: "supabase" | "internal";
  expiresAt: number;
}

export interface ApiErrorShape {
  error: string;
  detail?: unknown;
}
