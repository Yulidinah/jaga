import type { GeoPoint, Row } from "./types.js";

export const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export function haversine(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearing(a: GeoPoint, b: GeoPoint): number {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function isValidPoint(point: Partial<GeoPoint> | null | undefined): point is GeoPoint {
  return typeof point?.latitude === "number" && typeof point?.longitude === "number"
    && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
}

/** Titik baru pada jarak dan arah tertentu dari titik asal. */
export function destination(origin: GeoPoint, distanceMeters: number, angleDeg: number): GeoPoint {
  const angular = distanceMeters / EARTH_RADIUS_M;
  const theta = toRad(angleDeg);
  const lat1 = toRad(origin.latitude);
  const lon1 = toRad(origin.longitude);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(theta));
  const lon2 = lon1 + Math.atan2(
    Math.sin(theta) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
  );
  return { latitude: toDeg(lat2), longitude: ((toDeg(lon2) + 540) % 360) - 180 };
}

/** Jalur polyline yang mengikuti garis lurus dengan satu simpang kecil. */
export function polylineBetween(from: GeoPoint, to: GeoPoint, bendDegrees = 18): GeoPoint[] {
  const total = haversine(from, to);
  const direct = bearing(from, to);
  const side = ((from.latitude * 7919 + from.longitude * 104729) % 2 === 0 ? 1 : -1);
  const middle = destination(from, total * 0.5, direct + side * bendDegrees);
  return [from, middle, to];
}

const ACCESS_KEYWORDS: Array<{ pattern: RegExp; difficulty: number; label: string; speedKmh: number }> = [
  { pattern: /jalan aspal|aspal baik/i, difficulty: 1, label: "Jalan desa teraspal", speedKmh: 20 },
  { pattern: /tanpa aspal/i, difficulty: 5, label: "Jalan tanpa aspal", speedKmh: 3 },
  { pattern: /tangga/i, difficulty: 5, label: "Ada tangga", speedKmh: 2.5 },
  { pattern: /sempit|narrow/i, difficulty: 4, label: "Jalan sempit", speedKmh: 5 },
  { pattern: /jembatan|sambungan|gubuk|cevak/i, difficulty: 4, label: "Akses lemah melewati jembatan penghubung", speedKmh: 5 },
  { pattern: /banjir|genangan|banjiran/i, difficulty: 3, label: "Ruas rawan genangan", speedKmh: 7 },
  { pattern: /lumpur|tanah/i, difficulty: 3, label: "Permukaan tanah/lumpur", speedKmh: 7 },
  { pattern: /jalan desa|beton|paving|aspal baik/i, difficulty: 1, label: "Jalan desa terbuka", speedKmh: 18 }
];

export interface AccessProfile {
  difficulty: number;
  label: string;
  speedKmh: number;
}

/** Menentukan kesulitan akses dari catatan lapangan yang sudah diverifikasi petugas. */
export function accessProfile(notes: string | null | undefined): AccessProfile {
  const text = String(notes ?? "");
  if (!text.trim()) return { difficulty: 3, label: "Belum ada catatan akses", speedKmh: 10 };
  let best: AccessProfile | null = null;
  for (const item of ACCESS_KEYWORDS) {
    if (item.pattern.test(text) && (!best || item.difficulty > best.difficulty)) {
      best = { difficulty: item.difficulty, label: item.label, speedKmh: item.speedKmh };
    }
  }
  if (best) return best;
  return { difficulty: 2, label: "Akses relatif terbuka", speedKmh: 14 };
}

export interface ZoneLike {
  center?: GeoPoint | null;
  radiusMeters?: number | null;
  riskLevel?: number | null;
  active?: boolean;
}

export const isZoneActive = (zone: ZoneLike, at = new Date()) => {
  if (zone.active === false) return false;
  return true;
};

export function distanceToZone(point: GeoPoint, zone: ZoneLike): number | null {
  if (!isValidPoint(zone.center)) return null;
  const distance = haversine(point, zone.center);
  const radius = Number(zone.radiusMeters ?? 0);
  if (!radius) return distance;
  return distance - radius;
}

export function zonesTouching(point: GeoPoint, zones: Row[]): Row[] {
  return zones.filter(zone => {
    const remaining = distanceToZone(point, zone as ZoneLike);
    if (remaining === null) return false;
    const risk = Number(zone.risk_level ?? zone.riskLevel ?? 1);
    return remaining <= 0 ? true : remaining < risk * 60;
  });
}

export interface RouteEstimate {
  distanceMeters: number;
  durationSeconds: number;
  riskScore: number;
  accessDifficulty: number;
  accessLabel: string;
  hazards: string[];
  path: GeoPoint[];
  confidence: "rendah" | "sedang" | "tinggi";
  basis: string;
}

export interface RouteOptions {
  from: GeoPoint;
  to: GeoPoint;
  hazards?: Row[];
  accessNotes?: string | null;
  teamLoad?: number;
  avoidHazards?: boolean;
}

/**
 * Estimasi rute berbasis jarak lurus, difficulty akses, dan zona bahaya.
 * Bukan routing jalan: nilai Agost dipakai sebagai pembanding awal dan wajib
 * dikonfirmasi petugas di lapangan.
 */
export function estimateRoute(options: RouteOptions): RouteEstimate {
  const { from, to, hazards = [], accessNotes, avoidHazards = true } = options;
  const straight = haversine(from, to);
  const profile = accessProfile(accessNotes);
  // Jalan desa memanjang mengikuti kontur, sehingga jarak tempuh tidak pernah sama dengan jarak lurus.
  const detourFactor = 1 + profile.difficulty * 0.12;
  const crossing = avoidHazards ? hazards.filter(zone => isZoneActive(zone as ZoneLike) && (distanceToZone(to, zone as ZoneLike) ?? 1e9) <= 0) : [];
  const hazardPenalty = crossing.length * 0.25;
  const distanceMeters = Math.round(straight * (detourFactor + hazardPenalty));
  const speed = Math.max(1.5, profile.speedKmh - crossing.length * 2);
  const durationSeconds = Math.round(distanceMeters / ((speed * 1000) / 3600));
  const riskScore = Math.min(5, Math.max(1, Math.round(
    profile.difficulty * 0.55 + crossing.reduce((sum, zone) => sum + Number(zone.risk_level ?? 1), 0) * 0.6
  )));
  return {
    distanceMeters,
    durationSeconds,
    riskScore,
    accessDifficulty: profile.difficulty,
    accessLabel: profile.label,
    hazards: crossing.map(zone => String(zone.name ?? "Zona bahaya")),
    path: polylineBetween(from, to),
    confidence: hazards.length && accessNotes ? "sedang" : "rendah",
    basis: "Estimasi jarak lurus + kesulitan akses + zona bahaya. Belum memakai jaringan jalan."
  };
}

export function estimateAlternativeRoute(options: RouteOptions, variant: "aman" | "cepat"): RouteEstimate {
  const base = estimateRoute(options);
  if (variant === "cepat") return base;
  // Rute aman menambah pengalanan jalan dan menghindari zona berisiko tinggi.
  const hazards = (options.hazards ?? []).filter(zone => Number(zone.risk_level ?? 1) >= 3);
  const safe = estimateRoute({ ...options, hazards, avoidHazards: true });
  const inflated: RouteEstimate = {
    ...safe,
    distanceMeters: Math.round(safe.distanceMeters * 1.25),
    durationSeconds: Math.round(safe.durationSeconds * 1.25),
    riskScore: Math.max(1, safe.riskScore - 1),
    basis: "Varian aman: menghindari zona berisiko tinggi dengan pengalanan jarak 25%."
  };
  return inflated;
}

export const riskBand = (score: number): "rendah" | "sedang" | "tinggi" => {
  const value = Number(score ?? 0);
  if (value >= 4) return "tinggi";
  if (value >= 3) return "sedang";
  return "rendah";
};
