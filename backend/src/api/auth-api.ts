import { config, supabaseEnabled } from "../config.js";
import {
  authenticate, clearSessionCookie, hashPassword, newDeviceKey, newGatewayKey,
  requireRole, SESSION_COOKIE, sessionCookie, usingEphemeralSessionSecret
} from "../auth.js";
import { record } from "../audit.js";
import { badRequest, clean, conflict, forbidden, notFound, nowIso, oneOf, optionalText, randomToken, sha256Hex, text } from "../lib.js";
import { param, type Ctx } from "../router.js";
import type { JagaRole, Row, Session } from "../types.js";

const ROLES: JagaRole[] = ["PUSAT", "DESA", "RESCUE"];
const nowMs = () => Date.now();

/* -------------------------------------------------------------- Sesi */

export async function login(ctx: Ctx) {
  const email = clean(ctx.body.email).toLowerCase();
  const password = String(ctx.body.password ?? "");
  const { token, session } = await authenticate(ctx.store, email, password);
  await record(ctx.store, {
    actorId: session.profileId,
    action: "AUTH_LOGIN",
    entityType: "profiles",
    entityId: session.profileId,
    summary: `Login ${session.displayName} (${session.role})`
  });
  ctx.res.setHeader("set-cookie", sessionCookie(token, config.sessionTtlSeconds));
  return { token, session, cookie: SESSION_COOKIE };
}

export async function logout(ctx: Ctx) {
  await record(ctx.store, {
    actorId: ctx.session.profileId,
    action: "AUTH_LOGOUT",
    entityType: "profiles",
    entityId: ctx.session.profileId,
    summary: `Logout ${ctx.session.displayName}`
  });
  ctx.res.setHeader("set-cookie", clearSessionCookie());
  return { message: "Sesi ditutup" };
}

export async function me(ctx: Ctx): Promise<Session> {
  return {
    ...ctx.session,
    capabilities: {
      canManageMasterData: ctx.session.role === "PUSAT",
      canPublishRules: ctx.session.role === "PUSAT",
      canAssignTeam: ctx.session.role === "PUSAT" || ctx.session.role === "RESCUE",
      canSendAlert: ctx.session.role !== "RESCUE",
      canRecordAssessment: true,
      scope: ctx.session.villageIds === null ? "seluruh wilayah" : `${ctx.session.villageIds.length} desa`
    },
    storage: supabaseEnabled ? "supabase" : "memory"
  } as Session;
}

export const whoami = me;

export async function sessionInfo(ctx: Ctx) {
  return {
    authenticated: true,
    session: ctx.session,
    storage: supabaseEnabled ? "supabase" : "memory",
    devRoleHeaderEnabled: config.devRoleHeader,
    ephemeralSessionSecret: usingEphemeralSessionSecret,
    mqttConfigured: Boolean(config.mqttUrl && config.mqttUsername)
  };
}

/* ---------------------------------------------------------- Akun Whitt */

const accountSummary = (row: Row) => ({
  email: row.email,
  displayName: row.display_name,
  title: row.title ?? null,
  role: row.role,
  active: row.active !== false,
  organizationId: row.organization_id ?? null,
  villageIds: row.village_ids ?? null,
  lastLoginAt: row.last_login_at ?? null,
  mustChangePassword: row.must_change_password === true,
  authSource: row.auth_source ?? (supabaseEnabled ? "supabase" : "internal")
});

/** Daftar akun mengikuti sumber autentikasi yang aktif. */
export async function listAccounts(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "DESA"], "Hanya pusat atau desa yang dapat melihat daftar akun");
  if (supabaseEnabled) {
    const profiles = await ctx.store.list("profiles", { order: { display_name: "asc" } });
    const memberships = await ctx.store.list("organization_members", {});
    const byProfile = new Map<string, Row>();
    for (const row of memberships) byProfile.set(String(row.profile_id), row);
    return profiles.map(profile => {
      const membership = byProfile.get(String(profile.id));
      return {
        email: profile.email ?? "",
        displayName: profile.display_name,
        title: profile.title ?? null,
        role: profile.role,
        active: profile.active !== false,
        organizationId: membership?.organization_id ?? null,
        villageIds: null,
        lastLoginAt: null,
        mustChangePassword: false,
        authSource: "supabase"
      };
    });
  }
  const rows = await ctx.store.list("internal_accounts", {});
  const filtered = ctx.session.role === "PUSAT"
    ? rows
    : rows.filter(row => row.role === "DESA" && ctx.session.villageIds?.includes(String(row.organization_id ?? "")));
  return filtered.map(accountSummary);
}

interface SupabaseAdminUser {
  id: string;
  email: string;
}

/** Buat user lewat Supabase Auth Admin. Secret key wajib di header Authorization. */
async function createSupabaseUser(email: string, password: string, displayName: string, title: string | null): Promise<SupabaseAdminUser> {
  const response = await fetch(config.supabaseUrl + "/auth/v1/admin/users", {
    method: "POST",
    headers: {
      apikey: config.supabaseSecretKey,
      Authorization: "Bearer " + config.supabaseSecretKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { display_name: displayName, title } })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw badRequest("Gagal membuat user di Supabase Auth: " + response.status + " " + detail.slice(0, 300));
  }
  const user = await response.json() as { id?: string; email?: string };
  if (!user.id) throw badRequest("Supabase Auth tidak mengembalikan id user");
  return { id: String(user.id), email: String(user.email ?? email) };
}

async function setSupabasePassword(userId: string, password: string): Promise<void> {
  const response = await fetch(config.supabaseUrl + "/auth/v1/admin/users/" + userId, {
    method: "PUT",
    headers: {
      apikey: config.supabaseSecretKey,
      Authorization: "Bearer " + config.supabaseSecretKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ password })
  });
  if (!response.ok) throw badRequest("Gagal mengganti kata sandi di Supabase Auth: " + response.status);
}

export async function createAccount(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT"], "Hanya JAGA Pusat yang dapat membuat akun");
  const body = ctx.body;
  const email = clean(body.email).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest("Format email tidak valid");
  const displayName = text(body.displayName, "Nama lengkap", { max: 120 });
  const title = optionalText(body.title, "Jabatan", 120);
  const role = oneOf(body.role, ROLES, "Peran") as JagaRole;
  const password = String(body.password ?? "");
  if (password.length < 8) throw badRequest("Kata sandi minimal 8 karakter");
  const villageIds = Array.isArray(body.villageIds) ? body.villageIds.map(String) : [];
  if (role !== "PUSAT" && !villageIds.length) {
    throw badRequest("Akun desa dan tim rescue wajib punya minimal satu desa lingkup");
  }

  let organizationId = optionalText(body.organizationId, "Organisasi");
  if (role === "DESA" && !organizationId) {
    organizationId = randomToken(16);
    await ctx.store.insert("organizations", {
      id: organizationId,
      name: text(body.organizationName ?? ("Pemdes " + displayName), "Nama organisasi", { max: 160 }),
      type: "PEMERINTAH_DESA",
      email,
      phone: optionalText(body.phone, "Telepon", 40),
      active: true,
      created_at: nowIso()
    });
  }
  if (role !== "PUSAT" && !organizationId) throw badRequest("Akun desa dan tim rescue wajib terikat organisasi");

  let profileId: string;
  if (supabaseEnabled) {
    const user = await createSupabaseUser(email, password, displayName, title);
    profileId = user.id;
  } else {
    profileId = optionalText(body.profileId, "Profil") ?? randomToken(16);
  }

  await ctx.store.upsert("profiles", [{
    id: profileId,
    email,
    display_name: displayName,
    title,
    role,
    active: true,
    created_at: nowIso(),
    updated_at: nowIso()
  }], ["id"]);

  if (organizationId) {
    await ctx.store.upsert("organization_members", [{
      organization_id: organizationId, profile_id: profileId, role, joined_at: nowIso()
    }], ["organization_id", "profile_id"]);
    await ctx.store.removeWhere("organization_service_areas", { eq: { organization_id: organizationId } });
    if (villageIds.length) {
      await ctx.store.insertMany("organization_service_areas", villageIds.map(villageId => ({
        organization_id: organizationId, village_id: villageId, created_at: nowIso()
      })));
    }
  }

  if (!supabaseEnabled) {
    const accountId = randomToken(16);
    await ctx.store.insert("internal_accounts", {
      id: accountId,
      email,
      password_hash: hashPassword(password),
      display_name: displayName,
      title,
      role,
      organization_id: organizationId,
      village_ids: role === "PUSAT" ? null : villageIds,
      profile_id: profileId,
      active: true,
      must_change_password: body.mustChangePassword === true,
      last_login_at: null,
      created_at: nowIso()
    });
  }

  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "ACCOUNT_CREATE", entityType: "profiles",
    entityId: profileId, summary: "Membuat akun " + email + " (" + role + ")"
  });
  return {
    id: profileId,
    email,
    displayName,
    title,
    role,
    organizationId,
    villageIds,
    authSource: supabaseEnabled ? "supabase" : "internal",
    note: supabaseEnabled
      ? "User dibuat di Supabase Auth..Password awal tetap berlaku sampai pengguna menggantinya."
      : "Akun internal aktif seketika."
  };
}

export async function updateAccount(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT"]);
  const id = param(ctx, "id");
  const existing = await ctx.store.one("profiles", { eq: { id } });
  if (!existing) throw notFound("Profil tidak ditemukan");
  const memberships = await ctx.store.list("organization_members", { eq: { profile_id: id } });
  const organizationId = memberships[0]?.organization_id ? String(memberships[0].organization_id) : null;

  const patch: Row = { updated_at: nowIso() };
  if (ctx.body.displayName !== undefined) patch.display_name = text(ctx.body.displayName, "Nama lengkap", { max: 120 });
  if (ctx.body.title !== undefined) patch.title = optionalText(ctx.body.title, "Jabatan", 120);
  if (ctx.body.role !== undefined) patch.role = oneOf(ctx.body.role, ROLES, "Peran");
  if (ctx.body.active !== undefined) patch.active = Boolean(ctx.body.active);
  if (ctx.body.email !== undefined) patch.email = clean(ctx.body.email).toLowerCase();
  const updated = await ctx.store.update("profiles", id, patch);

  if (Array.isArray(ctx.body.villageIds) && organizationId) {
    await ctx.store.removeWhere("organization_service_areas", { eq: { organization_id: organizationId } });
    const ids = ctx.body.villageIds.map(String);
    if (ids.length) {
      await ctx.store.insertMany("organization_service_areas", ids.map(villageId => ({
        organization_id: organizationId, village_id: villageId, created_at: nowIso()
      })));
    }
  }

  if (ctx.body.password) {
    if (String(ctx.body.password).length < 8) throw badRequest("Kata sandi minimal 8 karakter");
    if (supabaseEnabled) await setSupabasePassword(id, String(ctx.body.password));
    else {
      const account = await ctx.store.one("internal_accounts", { eq: { profile_id: id } });
      if (!account) throw notFound("Akun internal tidak ditemukan");
      await ctx.store.update("internal_accounts", String(account.id), {
        password_hash: hashPassword(String(ctx.body.password)), must_change_password: false
      });
    }
  }

  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "ACCOUNT_UPDATE", entityType: "profiles",
    entityId: id, summary: "Memperbarui akun " + (existing.email ?? existing.display_name), before: existing, after: updated
  });
  return {
    ...accountSummary({ ...existing, ...(updated ?? {}), organization_id: organizationId }),
    villageIds: Array.isArray(ctx.body.villageIds) ? ctx.body.villageIds.map(String) : null
  };
}

export async function rotateDeviceKey(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "DESA"]);
  const device = await ctx.store.one("devices", { eq: { id: param(ctx, "id") } });
  if (!device) throw notFound("Perangkat tidak ditemukan");
  if (ctx.session.role === "DESA") {
    const village = String(device.village_id ?? "");
    if (!ctx.session.villageIds?.includes(village)) throw forbidden("Perangkat di luar kewenangan Anda");
  }
  const key = newDeviceKey();
  await ctx.store.update("devices", device.id, { auth_key_hash: sha256Hex(key), updated_at: nowIso() });
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "DEVICE_KEY_ROTATE", entityType: "devices",
    entityId: String(device.id), summary: "Rotasi kunci perangkat " + device.id
  });
  return { deviceId: device.id, deviceKey: key, note: "Simpan sekali. Kunci lama langsung tidak berlaku." };
}

export async function rotateGatewayKey(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT"]);
  const gateway = await ctx.store.one("gateways", { eq: { id: param(ctx, "id") } });
  if (!gateway) throw notFound("Gateway tidak ditemukan");
  const key = newGatewayKey();
  await ctx.store.update("gateways", gateway.id, { auth_key_hash: sha256Hex(key), updated_at: nowIso() });
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "GATEWAY_KEY_ROTATE", entityType: "gateways",
    entityId: String(gateway.id), summary: "Rotasi kunci gateway " + gateway.gateway_code
  });
  return { gatewayId: gateway.id, gatewayCode: gateway.gateway_code, gatewayKey: key };
}

export { nowMs };
