import { assertVillageAccess, scopeIds } from "../auth.js";
import { accessProfile, riskBand } from "../geo.js";
import { indexBy, notFound } from "../lib.js";
import { recentAudit } from "../audit.js";
import { subscriberCount } from "../realtime.js";
import { LEVEL_LABEL } from "../recommend.js";
import { param, type Ctx } from "../router.js";
import type { RecommendationLevel, Row } from "../types.js";
import { loadSupportProfile, scopedQuery } from "./common.js";
import { statusLabel } from "./incidents-api.js";

const CLOSED = new Set(["SAFE", "CANCELLED", "CLOSED"]);

const uniqueIds = (rows: Row[], column = "resident_id") =>
  Array.from(new Set(rows.map(row => String(row[column])).filter(Boolean)));

/** Tim yang boleh dilihat: PUSAT semua; RESCUE organisasinya; DESA yang bermarkas di desanya. */
async function visibleTeams(ctx: Ctx): Promise<Row[]> {
  const teams = await ctx.store.list("rescue_teams", {});
  if (ctx.session.role === "PUSAT") return teams;
  const ids = scopeIds(ctx.session) ?? [];
  return teams.filter(team =>
    (ctx.session.role === "RESCUE" && ctx.session.organizationId && String(team.organization_id) === ctx.session.organizationId)
    || (team.home_village_id && ids.includes(String(team.home_village_id))));
}

export async function overview(ctx: Ctx) {
  const ids = scopeIds(ctx.session);
  const [residents, incidents, teams, devices, alerts, villages, zones, shelters, gateways] = await Promise.all([
    ctx.store.list("residents", scopedQuery(ctx.session, "village_id", { eq: { active: true } })),
    ctx.store.list("incidents", scopedQuery(ctx.session, "village_id", {})),
    visibleTeams(ctx),
    ctx.store.list("devices", scopedQuery(ctx.session, "village_id", {})),
    ctx.store.list("alert_commands", scopedQuery(ctx.session, "village_id", {})),
    ctx.store.list("villages", ids === null ? {} : ids.length ? { in: { id: ids } } : { in: { id: ["__tidak_ada__"] } }),
    ctx.store.list("hazard_zones", scopedQuery(ctx.session, "village_id", {})),
    ctx.store.list("evacuation_shelters", scopedQuery(ctx.session, "village_id", {})),
    ctx.store.list("gateways", scopedQuery(ctx.session, "village_id", {}))
  ]);

  const activeIncidents = incidents.filter(row => !CLOSED.has(String(row.status)));
  // Perangkat terpasang dan kerentanan dihitung untuk seluruh warga dalam lingkup, bukan hanya warga yang punya insiden.
  const residentIds = residents.map(row => String(row.id));
  const assignments = residentIds.length
    ? await ctx.store.list("device_assignments", { in: { resident_id: residentIds }, isNull: { unassigned_at: true } })
    : [];
  const vulns = residentIds.length ? await ctx.store.list("resident_vulnerabilities", { in: { resident_id: residentIds } }) : [];
  const types = await ctx.store.list("vulnerability_types", {});
  const typeMap = indexBy(types, row => String(row.id));

  const vulnerableResidents = new Set(
    vulns.filter(row => {
      const type = typeMap.get(String(row.vulnerability_type_id));
      return type && ["LANSIA", "DISABILITAS", "IBU_HAMIL", "ANAK", "PENYAKIT_KRONIS"].includes(String(type.category));
    }).map(row => String(row.resident_id))
  );

  const offlineDevices = devices.filter(row => row.online !== true);
  const lowBattery = devices.filter(row => Number(row.battery ?? 100) <= 20);
  const unassignedDevices = devices.filter(row => !assignments.some(item => String(item.device_id) === String(row.id)));

  const byStatus = new Map<string, number>();
  for (const incident of activeIncidents) {
    const key = String(incident.status);
    byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
  }

  const oldest = activeIncidents
    .map(row => ({ id: row.id, owner: row.owner_name, status: row.status, createdAt: row.created_at, type: row.disaster_type }))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(0, 5);

  return {
    scope: ids === null ? "Seluruh wilayah" : `${ids.length} desa`,
    role: ctx.session.role,
    counters: {
      residents: residents.length,
      vulnerableResidents: residents.filter(row => vulnerableResidents.has(String(row.id))).length,
      residentsWithDevice: new Set(assignments.map(row => String(row.resident_id))).size,
      activeIncidents: activeIncidents.length,
      criticalIncidents: activeIncidents.filter(row => String(row.severity) === "EVAKUASI").length,
      teamsAvailable: teams.filter(row => row.status === "AVAILABLE" && row.active !== false).length,
      teamsTotal: teams.length,
      teamsBusy: teams.filter(row => ["ASSIGNED", "EN_ROUTE", "ON_SCENE"].includes(String(row.status))).length,
      devicesTotal: devices.length,
      devicesOnline: devices.length - offlineDevices.length,
      devicesLowBattery: lowBattery.length,
      devicesUnassigned: unassignedDevices.length,
      gatewaysOnline: gateways.filter(row => row.online === true).length,
      activeAlerts: alerts.filter(row => ["QUEUED", "SENT"].includes(String(row.status)) && (!row.expires_at || String(row.expires_at) > new Date().toISOString())).length,
      hazardZones: zones.filter(row => !row.active_until || String(row.active_until) > new Date().toISOString()).length,
      shelters: shelters.length,
      shelterCapacity: shelters.reduce((sum, row) => sum + Number(row.capacity ?? 0), 0),
      villages: villages.length
    },
    incidentStatus: Array.from(byStatus.entries()).map(([status, count]) => ({ status, label: statusLabel(status), count })),
    attention: {
      oldestOpenIncidents: oldest,
      offlineDevices: offlineDevices.slice(0, 5).map(row => ({ id: row.id, lastSeenAt: row.last_seen_at, status: row.status })),
      lowBattery: lowBattery.slice(0, 5).map(row => ({ id: row.id, battery: row.battery, resident: row.owner_name })),
      unassignedDevices: unassignedDevices.slice(0, 5).map(row => ({ id: row.id, status: row.status }))
    },
    realtime: { subscribers: subscriberCount() }
  };
}

/** Peta operasional: satu payload untuk seluruh layer peta. */
export async function mapData(ctx: Ctx) {
  const ids = scopeIds(ctx.session);
  const [villages, residents, devices, incidents, zones, shelters, teams, gateways] = await Promise.all([
    ctx.store.list("villages", ids === null ? {} : ids.length ? { in: { id: ids } } : { in: { id: ["__tidak_ada__"] } }),
    ctx.store.list("residents", scopedQuery(ctx.session, "village_id", { eq: { active: true } })),
    ctx.store.list("devices", scopedQuery(ctx.session, "village_id", {})),
    ctx.store.list("incidents", scopedQuery(ctx.session, "village_id", {})),
    ctx.store.list("hazard_zones", scopedQuery(ctx.session, "village_id", {})),
    ctx.store.list("evacuation_shelters", scopedQuery(ctx.session, "village_id", {})),
    visibleTeams(ctx),
    ctx.store.list("gateways", scopedQuery(ctx.session, "village_id", {}))
  ]);

  const residentIds = residents.map(row => String(row.id));
  const vulns = residentIds.length ? await ctx.store.list("resident_vulnerabilities", { in: { resident_id: residentIds } }) : [];
  const types = await ctx.store.list("vulnerability_types", {});
  const typeMap = indexBy(types, row => String(row.id));
  const severityByResident = new Map<string, number>();
  for (const vuln of vulns) {
    const key = String(vuln.resident_id);
    severityByResident.set(key, Math.max(severityByResident.get(key) ?? 0, Number(vuln.severity ?? 1)));
  }

  return {
    villages: villages.map(row => ({
      id: row.id,
      name: row.name,
      latitude: row.latitude ?? null,
      longitude: row.longitude ?? null,
      accessNotes: row.access_notes ?? null,
      accessDifficulty: accessProfile(row.access_notes).difficulty,
      population: row.population ?? null
    })),
    residents: residents
      .filter(row => row.latitude !== null && row.longitude !== null)
      .map(row => ({
        id: row.id,
        villageId: row.village_id,
        fullName: ctx.session.role === "RESCUE" ? "Warga rentan" : row.full_name,
        latitude: row.latitude,
        longitude: row.longitude,
        livesAlone: row.lives_alone === true,
        severity: severityByResident.get(String(row.id)) ?? 0,
        categories: vulns
          .filter(vuln => String(vuln.resident_id) === String(row.id))
          .map(vuln => typeMap.get(String(vuln.vulnerability_type_id))?.category)
          .filter(Boolean)
      })),
    devices: devices.map(row => ({
      id: row.id,
      villageId: row.village_id,
      latitude: row.latitude,
      longitude: row.longitude,
      battery: row.battery,
      online: row.online === true,
      status: row.status,
      ownerName: ctx.session.role === "RESCUE" ? null : row.owner_name,
      lastSeenAt: row.last_seen_at
    })),
    incidents: incidents.filter(row => !CLOSED.has(String(row.status))).map(row => ({
      id: row.id,
      villageId: row.village_id,
      latitude: row.latitude,
      longitude: row.longitude,
      status: row.status,
      statusLabel: statusLabel(String(row.status)),
      disasterType: row.disaster_type,
      severity: row.severity ?? null,
      ownerName: row.owner_name,
      createdAt: row.created_at
    })),
    hazardZones: zones.map(row => ({
      id: row.id,
      villageId: row.village_id,
      name: row.name,
      hazardType: row.hazard_type,
      riskLevel: row.risk_level,
      riskBand: riskBand(Number(row.risk_level ?? 1)),
      centerLatitude: row.center_latitude ?? null,
      centerLongitude: row.center_longitude ?? null,
      radiusMeters: row.radius_meters ?? null,
      accessNotes: row.access_notes ?? null
    })),
    shelters: shelters.map(row => ({
      id: row.id,
      villageId: row.village_id,
      name: row.name,
      latitude: row.latitude ?? null,
      longitude: row.longitude ?? null,
      capacity: row.capacity ?? null
    })),
    teams: teams
      .filter(row => row.latitude !== null && row.longitude !== null)
      .map(row => ({
        id: row.id,
        name: row.name,
        callSign: row.call_sign,
        status: row.status,
        latitude: row.latitude,
        longitude: row.longitude,
        homeVillageId: row.home_village_id ?? null
      })),
    gateways: gateways.map(row => ({
      id: row.id,
      code: row.gateway_code,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      online: row.online === true
    })),
    generatedAt: new Date().toISOString()
  };
}

/** Rekomendasi prioritas terkini untuk seluruh insiden aktif. */
export async function priorityBoard(ctx: Ctx) {
  const incidents = await ctx.store.list("incidents", scopedQuery(ctx.session, "village_id", {}));
  const active = incidents.filter(row => !CLOSED.has(String(row.status)));
  if (!active.length) return [];
  const incidentIds = active.map(row => String(row.id));
  const recommendations = await ctx.store.list("priority_recommendations", { in: { incident_id: incidentIds }, isNull: { superseded_at: true } });
  const [overrides, residents] = await Promise.all([
    recommendations.length ? ctx.store.list("priority_overrides", { in: { recommendation_id: recommendations.map(row => String(row.id)) } }) : [],
    ctx.store.list("residents", { in: { id: active.filter(row => row.resident_id).map(row => String(row.resident_id)) } })
  ]);
  const residentMap = indexBy(residents, row => String(row.id));
  const latestOverride = new Map<string, Row>();
  for (const row of overrides) {
    const key = String(row.incident_id);
    const current = latestOverride.get(key);
    if (!current || String(row.created_at) > String(current.created_at)) latestOverride.set(key, row);
  }
  const levelRank: Record<RecommendationLevel, number> = { DARURAT: 0, RESPONS_CEPAT: 1, SEGERA_TINJAU: 2, PANTAU: 3 };

  return active.map(row => {
    const incidentId = String(row.id);
    const recommendation = recommendations.find(item => String(item.incident_id) === incidentId) ?? null;
    const override = latestOverride.get(incidentId) ?? null;
    const level = (override?.selected_level ?? recommendation?.suggested_level ?? "PANTAU") as RecommendationLevel;
    return {
      incidentId,
      ownerName: row.resident_id ? residentMap.get(String(row.resident_id))?.full_name ?? row.owner_name : row.owner_name,
      villageId: row.village_id,
      disasterType: row.disaster_type,
      status: row.status,
      createdAt: row.created_at,
      score: recommendation?.score ?? null,
      level,
      levelLabel: LEVEL_LABEL[level],
      overridden: Boolean(override),
      reasons: recommendation?.reasons ?? [],
      dataCompleteness: recommendation?.data_completeness ?? null,
      missingFactors: [] as string[]
    };
  }).sort((a, b) => {
    const rank = levelRank[a.level] - levelRank[b.level];
    if (rank !== 0) return rank;
    return (b.score ?? 0) - (a.score ?? 0);
  });
}

/** Ringkasan kondisi warga: aman, perlu bantuan, dan belum terlayani. */
export async function safetySummary(ctx: Ctx) {
  const residents = await ctx.store.list("residents", scopedQuery(ctx.session, "village_id", { eq: { active: true } }));
  const ids = residents.map(row => String(row.id));
  const [incidents, assignments, vulns] = await Promise.all([
    ids.length ? ctx.store.list("incidents", { in: { resident_id: ids } }) : [],
    ids.length ? ctx.store.list("device_assignments", { in: { resident_id: ids }, isNull: { unassigned_at: true } }) : [],
    ids.length ? ctx.store.list("resident_vulnerabilities", { in: { resident_id: ids } }) : []
  ]);
  const types = await ctx.store.list("vulnerability_types", {});
  const typeMap = indexBy(types, row => String(row.id));
  const priorityCategories = new Set(["LANSIA", "DISABILITAS", "IBU_HAMIL", "ANAK", "PENYAKIT_KRONIS"]);
  const vulnerable = new Set(
    vulns.filter(vuln => priorityCategories.has(String(typeMap.get(String(vuln.vulnerability_type_id))?.category)))
      .map(vuln => String(vuln.resident_id))
  );
  const assigned = new Set(assignments.map(row => String(row.resident_id)));
  // Kondisi warga mengikuti insiden terbarunya: insiden lama yang sudah SAFE tidak menutupi insiden aktif baru.
  const latest = new Map<string, Row>();
  for (const incident of incidents) {
    const key = String(incident.resident_id);
    const current = latest.get(key);
    if (!current || String(incident.created_at) > String(current.created_at)) latest.set(key, incident);
  }
  const activeSet = new Set(Array.from(latest.entries()).filter(([, row]) => !CLOSED.has(String(row.status)) && row.status !== "EVACUATED").map(([key]) => key));
  const safeSet = new Set(Array.from(latest.entries()).filter(([, row]) => ["SAFE", "EVACUATED"].includes(String(row.status))).map(([key]) => key));

  const safe = residents.filter(row => safeSet.has(String(row.id)));
  const inProgress = residents.filter(row => !safeSet.has(String(row.id)) && activeSet.has(String(row.id)));
  const waiting = residents.filter(row => !safeSet.has(String(row.id)) && !activeSet.has(String(row.id)) && vulnerable.has(String(row.id)));
  const normal = residents.filter(row => !safeSet.has(String(row.id)) && !activeSet.has(String(row.id)) && !vulnerable.has(String(row.id)));

  return {
    total: residents.length,
    safe: safe.length,
    inProgress: inProgress.length,
    waitingHelp: waiting.length,
    normal: normal.length,
    coverage: residents.length ? Math.round((assigned.size / residents.length) * 100) : 0,
    breakdown: [
      { key: "safe", label: "Sudah aman", value: safe.length, color: "#16a34a" },
      { key: "inProgress", label: "Dalam penanganan", value: inProgress.length, color: "#2563eb" },
      { key: "waiting", label: "Menunggu bantuan", value: waiting.length, color: "#ea580c" },
      { key: "normal", label: "Belum ada laporan", value: normal.length, color: "#64748b" }
    ]
  };
}

export async function activityFeed(ctx: Ctx) {
  const incidents = await ctx.store.list("incidents", scopedQuery(ctx.session, "village_id", { order: { updated_at: "desc" }, limit: 20 }));
  const history = incidents.length
    ? await ctx.store.list("incident_status_history", { in: { incident_id: incidents.map(row => String(row.id)) }, order: { created_at: "desc" }, limit: 40 })
    : [];
  // Ringkasan audit lintas wilayah hanya untuk PUSAT; peran lain memakai riwayat status insiden dalam lingkupnya.
  const audits = ctx.session.role === "PUSAT" ? recentAudit(30).filter(entry => !entry.entity_type || entry.entity_type === "incidents") : [];
  return {
    incidents: incidents.map(row => ({
      id: row.id,
      ownerName: row.owner_name,
      status: row.status,
      statusLabel: statusLabel(String(row.status)),
      disasterType: row.disaster_type,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })),
    statusChanges: history.map(row => ({
      incidentId: row.incident_id,
      from: row.from_status,
      to: row.to_status,
      label: statusLabel(String(row.to_status)),
      changedBy: row.changed_by,
      notes: row.notes,
      createdAt: row.created_at
    })),
    audits: audits.map(row => ({
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      summary: row.summary,
      actorId: row.actor_id,
      createdAt: row.created_at ?? row.at
    }))
  };
}

export async function residentSnapshot(ctx: Ctx) {
  const profile = await loadSupportProfile(ctx.store, param(ctx, "id"));
  if (!profile) throw notFound("Warga tidak ditemukan");
  assertVillageAccess(ctx.session, profile.resident.village_id);
  return {
    residentId: param(ctx, "id"),
    fullName: profile.resident.full_name,
    livesAlone: profile.resident.lives_alone === true,
    riskFlags: profile.riskFlags,
    completeness: profile.completeness,
    openIncidents: profile.openIncidents,
    device: profile.device ? { id: profile.device.id, battery: profile.device.battery, online: profile.device.online } : null,
    contacts: profile.contacts.length
  };
}
