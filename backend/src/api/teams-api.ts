import { record } from "../audit.js";
import { assertVillageAccess, requireRole, scopeIds } from "../auth.js";
import { accessProfile, estimateRoute, isValidPoint, riskBand } from "../geo.js";
import { badRequest, clean, conflict, forbidden, indexBy, notFound, nowIso, oneOf, optionalText, text } from "../lib.js";
import { publish } from "../realtime.js";
import { param, type Ctx } from "../router.js";
import type { Row, TeamStatus } from "../types.js";

const TEAM_STATUSES: TeamStatus[] = ["AVAILABLE", "ASSIGNED", "EN_ROUTE", "ON_SCENE", "OFF_DUTY"];

/** PUSAT bebas; RESCUE hanya untuk tim organisasinya sendiri. */
const assertTeamControl = (ctx: Ctx, team: Row) => {
  if (ctx.session.role === "PUSAT") return;
  if (ctx.session.role !== "RESCUE" || !ctx.session.organizationId || String(team.organization_id) !== ctx.session.organizationId) {
    throw forbidden("Tim ini berada di luar organisasi Anda");
  }
};

/** Membaca detail/jejak tim: PUSAT semua, RESCUE organisasinya, DESA tim yang bermarkas di desanya. */
const assertTeamView = (ctx: Ctx, team: Row) => {
  if (ctx.session.role === "DESA") {
    const ids = scopeIds(ctx.session) ?? [];
    if (!team.home_village_id || !ids.includes(String(team.home_village_id))) throw forbidden("Tim ini berada di luar wilayah Anda");
    return;
  }
  assertTeamControl(ctx, team);
};

const teamShape = (team: Row) => ({
  id: team.id,
  organizationId: team.organization_id,
  name: team.name,
  callSign: team.call_sign,
  vehicleInfo: team.vehicle_info,
  status: team.status,
  homeVillageId: team.home_village_id ?? null,
  latitude: team.latitude ?? null,
  longitude: team.longitude ?? null,
  capacity: team.capacity ?? null,
  active: team.active !== false,
  updatedAt: team.updated_at ?? null
});

export async function listTeams(ctx: Ctx) {
  const rows = await ctx.store.list("rescue_teams", { order: { name: "asc" } });
  const ids = scopeIds(ctx.session);
  const scoped = ids === null ? rows : rows.filter(team => {
    const home = team.home_village_id ? String(team.home_village_id) : null;
    const village = team.village_id ? String(team.village_id) : null;
    return !home && !village ? ctx.session.role === "PUSAT" : ids.includes(home ?? village ?? "");
  });
  const memberRows = scoped.length ? await ctx.store.list("rescue_team_members", { in: { team_id: scoped.map(team => String(team.id)) } }) : [];
  const memberCounts = new Map<string, number>();
  for (const row of memberRows) {
    const key = String(row.team_id);
    memberCounts.set(key, (memberCounts.get(key) ?? 0) + 1);
  }
  return scoped.map(team => ({ ...teamShape(team), memberCount: memberCounts.get(String(team.id)) ?? 0 }));
}

export async function getTeam(ctx: Ctx) {
  const team = await ctx.store.one("rescue_teams", { eq: { id: param(ctx, "id") } });
  if (!team) throw notFound("Tim tidak ditemukan");
  assertTeamView(ctx, team);
  const [members, assignments, history] = await Promise.all([
    ctx.store.list("rescue_team_members", { eq: { team_id: param(ctx, "id") } }),
    ctx.store.list("incident_assignments", { eq: { team_id: param(ctx, "id") } }),
    ctx.store.list("team_location_history", { eq: { team_id: param(ctx, "id") }, order: { recorded_at: "desc" }, limit: 50 })
  ]);
  const profileIds = members.map(row => String(row.profile_id));
  const profiles = profileIds.length ? await ctx.store.list("profiles", { in: { id: profileIds } }) : [];
  const profileMap = indexBy(profiles, row => String(row.id));
  const incidentIds = assignments.map(row => String(row.incident_id));
  const incidents = incidentIds.length ? await ctx.store.list("incidents", { in: { id: incidentIds } }) : [];
  const incidentMap = indexBy(incidents, row => String(row.id));

  return {
    ...teamShape(team),
    members: members.map(row => ({
      profileId: row.profile_id,
      name: profileMap.get(String(row.profile_id))?.display_name ?? row.profile_id,
      isLeader: row.is_leader === true
    })),
    assignments: assignments.map(row => ({
      id: row.id,
      incidentId: row.incident_id,
      incidentType: incidentMap.get(String(row.incident_id))?.disaster_type ?? null,
      status: incidentMap.get(String(row.incident_id))?.status ?? null,
      assignedAt: row.assigned_at,
      completedAt: row.completed_at
    })),
    trail: history
  };
}

export async function createTeam(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT"], "Hanya JAGA Pusat yang dapat menambah tim");
  const organizationId = optionalText(ctx.body.organizationId, "Organisasi");
  if (!organizationId) throw badRequest("Organisasi tim wajib diisi");
  const homeVillageId = optionalText(ctx.body.homeVillageId, "Desa induk");
  if (homeVillageId) assertVillageAccess(ctx.session, homeVillageId);
  const team = await ctx.store.insert("rescue_teams", {
    organization_id: organizationId,
    name: text(ctx.body.name, "Nama tim", { max: 160 }),
    call_sign: optionalText(ctx.body.callSign, "Call sign", 40),
    vehicle_info: optionalText(ctx.body.vehicleInfo, "Informasi kendaraan", 300),
    status: "AVAILABLE",
    home_village_id: homeVillageId,
    capacity: ctx.body.capacity ? Number(ctx.body.capacity) : null,
    active: true,
    created_at: nowIso(),
    updated_at: nowIso()
  });
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "TEAM_CREATE", entityType: "rescue_teams",
    entityId: String(team.id), summary: `Membuat tim ${team.name}`, after: team
  });
  return teamShape(team);
}

export async function updateTeam(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "RESCUE"]);
  const team = await ctx.store.one("rescue_teams", { eq: { id: param(ctx, "id") } });
  if (!team) throw notFound("Tim tidak ditemukan");
  assertTeamControl(ctx, team);
  const patch: Row = { updated_at: nowIso() };
  if (ctx.body.name !== undefined) patch.name = text(ctx.body.name, "Nama tim", { max: 160 });
  if (ctx.body.callSign !== undefined) patch.call_sign = optionalText(ctx.body.callSign, "Call sign", 40);
  if (ctx.body.vehicleInfo !== undefined) patch.vehicle_info = optionalText(ctx.body.vehicleInfo, "Kendaraan", 300);
  if (ctx.body.capacity !== undefined) patch.capacity = ctx.body.capacity === null ? null : Number(ctx.body.capacity);
  if (ctx.body.active !== undefined) patch.active = Boolean(ctx.body.active);
  if (ctx.body.status !== undefined) {
    if (ctx.session.role === "DESA") throw forbidden("Petugas desa tidak dapat mengubah status tim");
    patch.status = oneOf(ctx.body.status, TEAM_STATUSES, "Status tim");
  }
  const updated = await ctx.store.update("rescue_teams", param(ctx, "id"), patch);
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "TEAM_UPDATE", entityType: "rescue_teams",
    entityId: param(ctx, "id"), summary: "Memperbarui tim", before: team, after: updated
  });
  publish("team.updated", { id: param(ctx, "id"), status: updated?.status }, team.home_village_id ?? undefined);
  return teamShape(updated ?? team);
}

export async function setTeamStatus(ctx: Ctx) {
  if (ctx.session.role === "DESA") throw forbidden("Petugas desa tidak dapat mengubah status tim");
  const team = await ctx.store.one("rescue_teams", { eq: { id: param(ctx, "id") } });
  if (!team) throw notFound("Tim tidak ditemukan");
  assertTeamControl(ctx, team);
  const status = oneOf(ctx.body.status, TEAM_STATUSES, "Status tim");
  const updated = await ctx.store.update("rescue_teams", param(ctx, "id"), { status, updated_at: nowIso() });
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "TEAM_STATUS", entityType: "rescue_teams",
    entityId: param(ctx, "id"), summary: `Status tim ${team.status} menjadi ${status}`, before: team, after: updated
  });
  publish("team.updated", { id: param(ctx, "id"), status }, team.home_village_id ?? undefined);
  return teamShape(updated ?? team);
}

export async function addTeamMember(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "RESCUE"]);
  const team = await ctx.store.one("rescue_teams", { eq: { id: param(ctx, "id") } });
  if (!team) throw notFound("Tim tidak ditemukan");
  assertTeamControl(ctx, team);
  const profileId = clean(ctx.body.profileId);
  const profile = await ctx.store.one("profiles", { eq: { id: profileId } });
  if (!profile) throw badRequest("Profil anggota tidak ditemukan");
  if (String(profile.role) !== "RESCUE") throw badRequest("Anggota tim harus berrole RESCUE");
  await ctx.store.upsert("rescue_team_members", [{
    team_id: param(ctx, "id"), profile_id: profileId, is_leader: Boolean(ctx.body.isLeader)
  }], ["team_id", "profile_id"]);
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "TEAM_MEMBER_ADD", entityType: "rescue_teams",
    entityId: param(ctx, "id"), summary: `Menambah ${profile.display_name} ke tim ${team.name}`
  });
  return { teamId: param(ctx, "id"), profileId, isLeader: Boolean(ctx.body.isLeader) };
}

export async function removeTeamMember(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "RESCUE"]);
  const team = await ctx.store.one("rescue_teams", { eq: { id: param(ctx, "id") } });
  if (!team) throw notFound("Tim tidak ditemukan");
  assertTeamControl(ctx, team);
  await ctx.store.removeWhere("rescue_team_members", { eq: { team_id: param(ctx, "id"), profile_id: param(ctx, "profileId") } });
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "TEAM_MEMBER_REMOVE", entityType: "rescue_teams",
    entityId: param(ctx, "id"), summary: `Menghapus anggota tim ${param(ctx, "profileId")}`
  });
  return { removed: true };
}

/* -------------------------------------------------------------- Posisi tim */

export async function reportTeamPosition(ctx: Ctx) {
  const team = await ctx.store.one("rescue_teams", { eq: { id: param(ctx, "id") } });
  if (!team) throw notFound("Tim tidak ditemukan");
  assertTeamControl(ctx, team);
  const point = { latitude: Number(ctx.body.latitude), longitude: Number(ctx.body.longitude) };
  if (!isValidPoint(point)) throw badRequest("Koordinat posisi tim tidak valid");
  const incidentId = optionalText(ctx.body.incidentId, "Insiden");

  await ctx.store.update("rescue_teams", param(ctx, "id"), { latitude: point.latitude, longitude: point.longitude, updated_at: nowIso() });
  const trail = await ctx.store.insert("team_location_history", {
    team_id: param(ctx, "id"),
    incident_id: incidentId,
    latitude: point.latitude,
    longitude: point.longitude,
    location: `SRID=4326;POINT(${point.longitude} ${point.latitude})`,
    accuracy_meters: Number.isFinite(Number(ctx.body.accuracyMeters)) && ctx.body.accuracyMeters ? Number(ctx.body.accuracyMeters) : null,
    recorded_at: nowIso()
  });
  publish("team.position", { id: param(ctx, "id"), ...point, incidentId }, team.home_village_id ?? undefined);
  return { recorded: true, trailId: trail.id ?? null };
}

export async function teamTrail(ctx: Ctx) {
  const owner = await ctx.store.one("rescue_teams", { eq: { id: param(ctx, "id") } });
  if (!owner) throw notFound("Tim tidak ditemukan");
  assertTeamView(ctx, owner);
  const limit = Math.min(500, Math.max(1, Number(ctx.query.get("limit") ?? 100) || 100));
  return ctx.store.list("team_location_history", { eq: { team_id: param(ctx, "id") }, order: { recorded_at: "desc" }, limit });
}

export async function teamEta(ctx: Ctx) {
  const team = await ctx.store.one("rescue_teams", { eq: { id: param(ctx, "id") } });
  if (!team) throw notFound("Tim tidak ditemukan");
  assertTeamView(ctx, team);
  const incidentId = clean(ctx.query.get("incidentId"));
  if (!incidentId) throw badRequest("Parameter query incidentId wajib diisi");
  const incident = await ctx.store.one("incidents", { eq: { id: incidentId } });
  if (!incident) throw notFound("Insiden tidak ditemukan");
  assertVillageAccess(ctx.session, incident.village_id);
  if (team.latitude === null || team.latitude === undefined || team.longitude === null || team.longitude === undefined) throw badRequest("Posisi tim belum dilaporkan");

  const village = incident.village_id ? await ctx.store.one("villages", { eq: { id: String(incident.village_id) } }) : null;
  const zones = incident.village_id ? await ctx.store.list("hazard_zones", { eq: { village_id: String(incident.village_id) } }) : [];
  const estimate = estimateRoute({
    from: { latitude: Number(team.latitude), longitude: Number(team.longitude) },
    to: { latitude: Number(incident.latitude), longitude: Number(incident.longitude) },
    hazards: zones,
    accessNotes: village?.access_notes ?? null
  });
  return {
    teamId: param(ctx, "id"),
    incidentId,
    distanceMeters: estimate.distanceMeters,
    durationSeconds: estimate.durationSeconds,
    durationMinutes: Math.round(estimate.durationSeconds / 60),
    riskScore: estimate.riskScore,
    riskBand: riskBand(estimate.riskScore),
    accessLabel: estimate.accessLabel,
    hazards: estimate.hazards,
    path: estimate.path,
    confidence: estimate.confidence,
    basis: estimate.basis
  };
}

/* ------------------------------------------------------------ Penugasan */

export async function assignTeam(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "RESCUE"]);
  const incident = await ctx.store.one("incidents", { eq: { id: param(ctx, "id") } });
  if (!incident) throw notFound("Insiden tidak ditemukan");
  assertVillageAccess(ctx.session, incident.village_id);
  if (["SAFE", "CANCELLED", "CLOSED"].includes(String(incident.status))) {
    throw conflict("Insiden sudah ditutup, penugasan tidak dapat ditambah");
  }
  const team = await ctx.store.one("rescue_teams", { eq: { id: clean(ctx.body.teamId) } });
  if (!team) throw badRequest("Tim tidak ditemukan; kirim teamId pada body");
  assertTeamControl(ctx, team);
  if (team.active === false) throw badRequest("Tim sedang tidak aktif");
  const already = await ctx.store.one("incident_assignments", { eq: { incident_id: param(ctx, "id"), team_id: String(team.id) }, isNull: { completed_at: true } });
  if (already) throw conflict(`Tim ${team.name} sudah ditugaskan pada insiden ini`);
  const busy = await ctx.store.list("incident_assignments", { eq: { team_id: String(team.id) }, isNull: { completed_at: true } });
  if (busy.length && !ctx.body.force) {
    throw conflict(`Tim ${team.name} masih bertugas pada insiden lain. Gunakan force untuk memaksa.`, { busy });
  }

  const assignment = await ctx.store.insert("incident_assignments", {
    incident_id: param(ctx, "id"),
    team_id: String(team.id),
    assigned_by: ctx.session.profileId,
    assigned_at: nowIso()
  });
  if (String(team.status) === "AVAILABLE" || String(team.status) === "OFF_DUTY") {
    await ctx.store.update("rescue_teams", String(team.id), { status: "ASSIGNED", updated_at: nowIso() });
  }
  if (String(incident.status) === "NEW" || String(incident.status) === "ACKNOWLEDGED") {
    await ctx.store.update("incidents", param(ctx, "id"), { status: "ASSIGNED", updated_at: nowIso() });
    await ctx.store.insert("incident_status_history", {
      incident_id: param(ctx, "id"), from_status: incident.status, to_status: "ASSIGNED",
      changed_by: ctx.session.profileId, notes: `Ditugaskan ke ${team.name}`, created_at: nowIso()
    });
  }
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "TEAM_ASSIGN", entityType: "incidents",
    entityId: param(ctx, "id"), summary: `Menugaskan ${team.name}`, after: assignment
  });
  publish("assignment.created", { incidentId: param(ctx, "id"), teamId: team.id, teamName: team.name }, String(incident.village_id ?? ""));
  return assignment;
}

export async function unassignTeam(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "RESCUE"]);
  const assignment = await ctx.store.one("incident_assignments", { eq: { id: param(ctx, "assignmentId") } });
  if (!assignment) throw notFound("Penugasan tidak ditemukan");
  const incident = await ctx.store.one("incidents", { eq: { id: String(assignment.incident_id) } });
  if (incident) assertVillageAccess(ctx.session, incident.village_id);
  const assignedTeam = await ctx.store.one("rescue_teams", { eq: { id: String(assignment.team_id) } });
  if (assignedTeam) assertTeamControl(ctx, assignedTeam);
  // Tim kembali tersedia hanya bila tidak punya penugasan aktif lain (pada insiden mana pun).
  const remaining = await ctx.store.list("incident_assignments", { eq: { team_id: String(assignment.team_id) }, neq: { id: param(ctx, "assignmentId") }, isNull: { completed_at: true } });
  await ctx.store.update("incident_assignments", param(ctx, "assignmentId"), { completed_at: nowIso() });
  if (!remaining.length) {
    await ctx.store.update("rescue_teams", String(assignment.team_id), { status: "AVAILABLE", updated_at: nowIso() });
  }
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "TEAM_UNASSIGN", entityType: "incidents",
    entityId: String(assignment.incident_id), summary: "Melepas tim dari insiden", before: assignment
  });
  return { removed: true };
}

export async function acceptAssignment(ctx: Ctx) {
  const team = await ctx.store.one("rescue_teams", { eq: { id: param(ctx, "id") } });
  if (!team) throw notFound("Tim tidak ditemukan");
  assertTeamControl(ctx, team);
  const assignments = await ctx.store.list("incident_assignments", { eq: { team_id: param(ctx, "id") }, isNull: { accepted_at: true, completed_at: true } });
  if (!assignments.length) throw notFound("Tidak ada penugasan yang menunggu");
  const accepted = [];
  for (const assignment of assignments) {
    accepted.push(await ctx.store.update("incident_assignments", String(assignment.id), { accepted_at: nowIso() }));
  }
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "TEAM_ACCEPT", entityType: "rescue_teams",
    entityId: param(ctx, "id"), summary: `Menerima ${assignments.length} penugasan`
  });
  return { accepted: accepted.filter(Boolean) };
}

export async function listAssignments(ctx: Ctx) {
  const teamId = clean(ctx.query.get("teamId"));
  const allRows = await ctx.store.list("incident_assignments", teamId ? { eq: { team_id: teamId } } : {});
  const incidentIds = Array.from(new Set(allRows.map(row => String(row.incident_id))));
  const scope = scopeIds(ctx.session);
  const incidents = incidentIds.length
    ? await ctx.store.list("incidents", { in: { id: incidentIds }, ...(scope === null ? {} : { pred: (row: Row) => scope.includes(String(row.village_id)) }) })
    : [];
  const map = indexBy(incidents, row => String(row.id));
  const rows = allRows.filter(row => map.has(String(row.incident_id)));
  return rows.map(row => ({
    id: row.id,
    incidentId: row.incident_id,
    teamId: row.team_id,
    incidentStatus: map.get(String(row.incident_id))?.status ?? null,
    villageId: map.get(String(row.incident_id))?.village_id ?? null,
    assignedAt: row.assigned_at,
    acceptedAt: row.accepted_at,
    completedAt: row.completed_at
  }));
}

export { teamShape, accessProfile };
