import { config } from "../config.js";
import { recentAudit } from "../audit.js";
import { forbidden } from "../lib.js";
import { Router } from "../router.js";
import * as auth from "./auth-api.js";
import * as residents from "./residents-api.js";
import * as incidents from "./incidents-api.js";
import * as teams from "./teams-api.js";
import * as devices from "./devices-api.js";
import * as alerts from "./alerts-api.js";
import * as rulesets from "./rulesets-api.js";
import * as dashboard from "./dashboard-api.js";

const CENTRAL = ["PUSAT"] as const;

export function buildRouter(): Router {
  const router = new Router();

  /* ------------------------------------------------------------- Sistem */
  router.get("/api/health", async ctx => ({
    status: "ok",
    storage: ctx.store.kind,
    serverTime: new Date().toISOString()
  }), { public: true });

  router.get("/api/config", async ctx => ({
    storage: ctx.store.kind,
    devRoleHeaderEnabled: config.devRoleHeader,
    mqttConfigured: Boolean(config.mqttUrl && config.mqttUsername),
    pushConfigured: Boolean(config.fcmServerKey),
    smsConfigured: Boolean(config.twilioAuthToken),
    pageSizeLimit: config.maxPageSize
  }), { public: true });

  /* --------------------------------------------------------------- Sesi */
  router.post("/api/auth/login", auth.login, { public: true, status: 200 });
  router.post("/api/auth/logout", auth.logout);
  router.get("/api/auth/me", auth.me);
  router.get("/api/session", auth.sessionInfo);

  /* -------------------------------------------------------------- Akun */
  router.get("/api/accounts", auth.listAccounts, { roles: ["PUSAT", "DESA"] });
  router.post("/api/accounts", auth.createAccount, { roles: CENTRAL, status: 201 });
  router.patch("/api/accounts/:id", auth.updateAccount, { roles: CENTRAL });

  /* ----------------------------------------------------------- Referensi */
  router.get("/api/villages", residents.listVillages);
  router.get("/api/hamlets", residents.listHamlets);
  router.get("/api/vulnerability-types", residents.listVulnerabilityTypes);
  router.get("/api/hazard-zones", residents.listHazardZones);
  router.get("/api/shelters", residents.listShelters);

  /* ------------------------------------------------------------- Warga */
  router.get("/api/residents", residents.listResidents);
  router.get("/api/residents/:id", residents.getResident);
  router.post("/api/residents", residents.createResident, { status: 201 });
  router.patch("/api/residents/:id", residents.updateResident);
  router.delete("/api/residents/:id", residents.deleteResident);
  router.put("/api/residents/:id/vulnerabilities", residents.saveVulnerabilities);
  router.post("/api/residents/:id/contacts", residents.addContact, { status: 201 });
  router.delete("/api/residents/:id/contacts/:contactId", residents.deleteContact);

  /* ------------------------------------------------------------ Insiden */
  router.get("/api/incidents", incidents.listIncidents);
  router.get("/api/incidents/:id", incidents.getIncident);
  router.patch("/api/incidents/:id", incidents.updateIncident);
  router.patch("/api/incidents/:id/status", incidents.updateIncidentStatus);
  router.post("/api/incidents/:id/assessments", incidents.createAssessment, { status: 201 });
  router.get("/api/incidents/:id/recommendation", incidents.previewRecommendation);
  router.post("/api/incidents/:id/recommendation", incidents.recalculateRecommendation);
  router.post("/api/incidents/:id/recommendation/override", incidents.overrideRecommendation, { status: 201 });
  router.get("/api/incidents/:id/routes", incidents.planRoutes);
  router.post("/api/incidents/:id/routes", incidents.saveRoute, { status: 201 });
  router.get("/api/incidents/:id/attachments", incidents.listAttachments);
  router.get("/api/incidents/:id/audit", incidents.listIncidentAudit);
  router.post("/api/incidents/:id/assignments", teams.assignTeam, { roles: ["PUSAT", "RESCUE"], status: 201 });
  router.delete("/api/incidents/:id/assignments/:assignmentId", teams.unassignTeam, { roles: ["PUSAT", "RESCUE"] });

  router.post("/api/sos", incidents.createSosPublic, { status: 201 });
  router.get("/api/assignments", teams.listAssignments);

  /* ---------------------------------------------------------------- Tim */
  router.get("/api/teams", teams.listTeams);
  router.get("/api/teams/:id", teams.getTeam);
  router.post("/api/teams", teams.createTeam, { roles: CENTRAL, status: 201 });
  router.patch("/api/teams/:id", teams.updateTeam, { roles: ["PUSAT", "RESCUE"] });
  router.patch("/api/teams/:id/status", teams.setTeamStatus, { roles: ["PUSAT", "RESCUE"] });
  router.post("/api/teams/:id/members", teams.addTeamMember, { roles: ["PUSAT", "RESCUE"], status: 201 });
  router.delete("/api/teams/:id/members/:profileId", teams.removeTeamMember, { roles: ["PUSAT", "RESCUE"] });
  router.post("/api/teams/:id/position", teams.reportTeamPosition, { roles: ["PUSAT", "RESCUE"], status: 201 });
  router.get("/api/teams/:id/trail", teams.teamTrail);
  router.get("/api/teams/:id/eta", teams.teamEta);
  router.post("/api/teams/:id/accept", teams.acceptAssignment, { roles: ["PUSAT", "RESCUE"] });

  /* ---------------------------------------------------------- Perangkat */
  router.get("/api/devices", devices.listDevices);
  router.post("/api/devices", devices.createDevice, { roles: ["PUSAT", "DESA"], status: 201 });
  router.patch("/api/devices/:id", devices.updateDevice, { roles: ["PUSAT", "DESA"] });
  router.post("/api/devices/:id/assign", devices.assignDevice, { roles: ["PUSAT", "DESA"], status: 201 });
  router.post("/api/devices/:id/unassign", devices.unassignDevice, { roles: ["PUSAT", "DESA"] });
  router.get("/api/devices/:id/telemetry", devices.deviceTelemetry);
  router.post("/api/devices/:id/key", devices.rotateDeviceKey, { roles: ["PUSAT", "DESA"] });
  router.get("/api/gateways", devices.listGateways);
  router.post("/api/gateways", devices.createGateway, { roles: CENTRAL, status: 201 });
  router.post("/api/gateways/:id/key", devices.rotateGatewayKey, { roles: CENTRAL });

  /* ---------------------------------------------------- Endpoint perangkat */
  router.post("/api/device/telemetry", devices.ingestTelemetry, { public: true, status: 202 });
  router.post("/api/device/sos", devices.deviceSos, { public: true, status: 201 });
  router.get("/api/device/location", devices.deviceLocation, { public: true });
  router.get("/api/device/inbox", devices.deviceInbox, { public: true });
  router.post("/api/device/receipts/:receiptId", alerts.acknowledgeAlert, { public: true });

  /* -------------------------------------------------------------- Alert */
  router.get("/api/alerts", alerts.listAlerts);
  router.get("/api/alerts/:id", alerts.getAlert);
  router.post("/api/alerts", alerts.createAlert, { roles: ["PUSAT", "DESA"], status: 201 });
  router.post("/api/alerts/receipts/:receiptId", alerts.acknowledgeAlert);
  router.post("/api/alerts/expire", alerts.expireAlerts, { roles: CENTRAL });
  router.get("/api/notifications", alerts.listNotifications);
  router.post("/api/notifications/:id/read", alerts.markNotificationRead);

  /* ---------------------------------------------------------- Rule set */
  // Rute literal harus didaftarkan sebelum /api/rulesets/:id.
  router.get("/api/rulesets/factors", async () => rulesets.factorCatalog());
  router.get("/api/rulesets/overrides", rulesets.listOverrides, { roles: ["PUSAT", "DESA"] });
  router.get("/api/rulesets", rulesets.listRuleSets);
  router.get("/api/rulesets/:id", rulesets.getRuleSet);
  router.post("/api/rulesets", rulesets.createRuleSet, { roles: CENTRAL, status: 201 });
  router.patch("/api/rulesets/:id", rulesets.updateRuleSet, { roles: CENTRAL });
  router.put("/api/rulesets/:id/rules", rulesets.saveRules, { roles: CENTRAL });
  router.post("/api/rulesets/:id/publish", rulesets.publishRuleSet, { roles: CENTRAL });
  router.post("/api/rulesets/:id/simulate", rulesets.simulateRuleSet);
  router.get("/api/thresholds", rulesets.listThresholds);
  router.post("/api/thresholds", rulesets.upsertThreshold, { roles: CENTRAL, status: 201 });

  /* ---------------------------------------------------------- Dashboard */
  router.get("/api/dashboard", dashboard.overview);
  router.get("/api/dashboard/map", dashboard.mapData);
  router.get("/api/dashboard/priorities", dashboard.priorityBoard);
  router.get("/api/dashboard/safety", dashboard.safetySummary);
  router.get("/api/dashboard/feed", dashboard.activityFeed);
  router.get("/api/dashboard/resident/:id", dashboard.residentSnapshot);
  router.get("/api/audit/recent", async ctx => {
    if (ctx.session.role !== "PUSAT") throw forbidden("Log audit lintas wilayah hanya untuk JAGA Pusat");
    return recentAudit(100).map(({ before_data: _before, after_data: _after, ip_address: _ip, user_agent: _agent, ...entry }) => entry);
  });

  return router;
}
