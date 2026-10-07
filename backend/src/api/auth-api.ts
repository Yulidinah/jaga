import { config } from "../config.js";
import {
  authenticate, clearSessionCookie, hashPassword,
  requireRole, revokeInternalToken, revokeSupabaseToken, SESSION_COOKIE, sessionCookie, tokenFromRequest, usingEphemeralSessionSecret
} from "../auth.js";
import { record } from "../audit.js";
import { checkRateLimit, resetRateLimit, badRequest, clean, conflict, forbidden, notFound, nowIso, oneOf, optionalText, sha256Hex, text, uuid } from "../lib.js";
import { param, type Ctx } from "../router.js";
import type { JagaRole, Row, Session } from "../types.js";

/** Akun yang dihapus tetapi masih direferensikan riwayat (audit) disamarkan ke domain ini dan disembunyikan dari daftar. */
const DELETED_DOMAIN = "@dihapus.jaga.invalid";
const ROLES: JagaRole[] = ["PUSAT", "DESA", "RESCUE"];
const ORG_TYPES = ["BPBD", "BASARNAS", "DAMKAR", "POLISI", "TNI", "RELAWAN", "LAYANAN_KESEHATAN", "LAINNYA"] as const;

/* -------------------------------------------------------------- Sesi */

export async function login(ctx: Ctx) {
  const email = clean(ctx.body.email).toLowerCase();
  const password = String(ctx.body.password ?? "");
  const limitKey = `${ctx.req.socket.remoteAddress ?? "?"}|${email}`;
  checkRateLimit(limitKey);
  const { token, session } = await authenticate(ctx.store, email, password);
  resetRateLimit(limitKey);
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
  const presented = tokenFromRequest(ctx.req);
  if (presented) { revokeInternalToken(presented); if (ctx.store.kind === "supabase") await revokeSupabaseToken(presented); }
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
    storage: ctx.store.kind
  } as Session;
}

export const whoami = me;

export async function sessionInfo(ctx: Ctx) {
  return {
    authenticated: true,
    session: ctx.session,
    storage: ctx.store.kind,
    devRoleHeaderEnabled: config.devRoleHeader,
    ephemeralSessionSecret: usingEphemeralSessionSecret,
    mqttConfigured: Boolean(config.mqttUrl && config.mqttUsername)
  };
}

/* ---------------------------------------------------------- Akun Whitt */

const accountSummary = (row: Row, supabase = false) => ({
  id: row.profile_id ?? row.id ?? null,
  email: row.email,
  displayName: row.display_name,
  title: row.title ?? null,
  role: row.role,
  active: row.active !== false,
  organizationId: row.organization_id ?? null,
  villageIds: row.village_ids ?? null,
  lastLoginAt: row.last_login_at ?? null,
  mustChangePassword: row.must_change_password === true,
  authSource: row.auth_source ?? (supabase ? "supabase" : "internal")
});

/** Daftar akun mengikuti sumber autentikasi yang aktif; DESA hanya melihat akun di lingkupnya. */
export async function listAccounts(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT", "DESA"], "Hanya pusat atau desa yang dapat melihat daftar akun");
  const scope = ctx.session.role === "PUSAT" ? null : new Set(ctx.session.villageIds ?? []);
  const inScope = (villageIds: unknown) =>
    scope === null || (Array.isArray(villageIds) && villageIds.some(id => scope.has(String(id))));

  if (ctx.store.kind === "supabase") {
    const profiles = await ctx.store.list("profiles", { order: { display_name: "asc" } });
    const memberships = await ctx.store.list("organization_members", {});
    const areas = await ctx.store.list("organization_service_areas", {});
    const orgVillages = new Map<string, string[]>();
    for (const row of areas) {
      const key = String(row.organization_id);
      orgVillages.set(key, [...(orgVillages.get(key) ?? []), String(row.village_id)]);
    }
    const byProfile = new Map<string, Row>();
    for (const row of memberships) byProfile.set(String(row.profile_id), row);
    return profiles
      .map(profile => {
        const membership = byProfile.get(String(profile.id));
        const organizationId = membership?.organization_id ? String(membership.organization_id) : null;
        return {
          id: profile.id,
          email: profile.email ?? "",
          displayName: profile.display_name,
          title: profile.title ?? null,
          role: profile.role,
          active: profile.active !== false,
          organizationId,
          villageIds: profile.role === "PUSAT" ? null : organizationId ? orgVillages.get(organizationId) ?? [] : [],
          lastLoginAt: null,
          mustChangePassword: false,
          authSource: "supabase"
        };
      })
      .filter(row => !String(row.email).endsWith(DELETED_DOMAIN))
      .filter(row => scope === null || (row.role === "DESA" && inScope(row.villageIds)));
  }
  const rows = await ctx.store.list("internal_accounts", {});
  return rows
    .filter(row => scope === null || (row.role === "DESA" && inScope(row.village_ids)))
    .map(row => accountSummary(row));
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

/** Menambah wilayah ke organisasi tanpa menghapus wilayah yang sudah dimiliki anggota lain. */
async function addServiceAreas(ctx: Ctx, organizationId: string, villageIds: string[]) {
  const existing = new Set((await ctx.store.list("organization_service_areas", { eq: { organization_id: organizationId } })).map(row => String(row.village_id)));
  const fresh = villageIds.filter(villageId => !existing.has(villageId));
  if (fresh.length) {
    await ctx.store.insertMany("organization_service_areas", fresh.map(villageId => ({ organization_id: organizationId, village_id: villageId })));
  }
}

/** Menjaga internal_accounts (mode memori) selaras dengan perubahan profil. */
async function syncInternalScope(ctx: Ctx, profileId: string, patch: Row) {
  if (ctx.store.kind === "supabase") return;
  const account = await ctx.store.one("internal_accounts", { eq: { profile_id: profileId } });
  if (account) await ctx.store.update("internal_accounts", String(account.id), patch);
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
    organizationId = uuid();
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
  if (role === "RESCUE" && !organizationId) {
    organizationId = uuid();
    await ctx.store.insert("organizations", {
      id: organizationId,
      name: text(body.organizationName, "Nama organisasi", { max: 160 }),
      type: oneOf(body.organizationType ?? "LAINNYA", ORG_TYPES, "Jenis organisasi"),
      email,
      phone: optionalText(body.phone, "Telepon", 40),
      active: true,
      created_at: nowIso()
    });
  }
  if (role !== "PUSAT" && !organizationId) throw badRequest("Akun desa dan tim rescue wajib terikat organisasi");

  let profileId: string;
  if (ctx.store.kind === "supabase") {
    const user = await createSupabaseUser(email, password, displayName, title);
    profileId = user.id;
  } else {
    profileId = uuid();
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
      organization_id: organizationId, profile_id: profileId, title, joined_at: nowIso()
    }], ["organization_id", "profile_id"]);
    await addServiceAreas(ctx, organizationId, villageIds);
  }

  if (ctx.store.kind !== "supabase") {
    const accountId = uuid();
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
    authSource: ctx.store.kind === "supabase" ? "supabase" : "internal",
    note: ctx.store.kind === "supabase"
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
  const internalPatch: Row = {};
  if (patch.role !== undefined) internalPatch.role = patch.role;
  if (patch.email !== undefined) internalPatch.email = patch.email;
  if (patch.display_name !== undefined) internalPatch.display_name = patch.display_name;
  if (patch.title !== undefined) internalPatch.title = patch.title;
  if (patch.active !== undefined) internalPatch.active = patch.active;
  if (Object.keys(internalPatch).length) await syncInternalScope(ctx, id, internalPatch);

  if (Array.isArray(ctx.body.villageIds) && organizationId) {
    const ids = ctx.body.villageIds.map(String);
    await addServiceAreas(ctx, organizationId, ids);
    await syncInternalScope(ctx, id, { village_ids: ids });
  }

  if (ctx.body.password) {
    if (String(ctx.body.password).length < 8) throw badRequest("Kata sandi minimal 8 karakter");
    if (ctx.store.kind === "supabase") await setSupabasePassword(id, String(ctx.body.password));
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



const adminHeaders = () => ({
  apikey: config.supabaseSecretKey, Authorization: "Bearer " + config.supabaseSecretKey, "Content-Type": "application/json"
});

async function deleteSupabaseUser(userId: string): Promise<void> {
  const response = await fetch(config.supabaseUrl + "/auth/v1/admin/users/" + userId, { method: "DELETE", headers: adminHeaders() });
  if (!response.ok && response.status !== 404) throw badRequest("Gagal menghapus user di Supabase Auth: " + response.status);
}

/** Dipakai bila profil masih dirujuk riwayat: user tidak dihapus, tetapi dilarang masuk dan emailnya disamarkan. */
async function disableSupabaseUser(userId: string, email: string): Promise<void> {
  const response = await fetch(config.supabaseUrl + "/auth/v1/admin/users/" + userId, {
    method: "PUT", headers: adminHeaders(), body: JSON.stringify({ email, ban_duration: "876000h" })
  });
  if (!response.ok && response.status !== 404) throw badRequest("Gagal menonaktifkan user di Supabase Auth: " + response.status);
}

/**
 * Hapus akun (hanya JAGA Pusat). Login dicabut seketika. Profil dihapus bila tidak ada riwayat yang merujuknya;
 * bila ada (audit, penugasan), profil disamarkan dan dinonaktifkan agar riwayat tetap utuh.
 */
export async function deleteAccount(ctx: Ctx) {
  requireRole(ctx.session, ["PUSAT"], "Hanya JAGA Pusat yang dapat menghapus akun");
  const id = param(ctx, "id");
  if (id === ctx.session.profileId) throw forbidden("Anda tidak dapat menghapus akun yang sedang dipakai");
  const existing = await ctx.store.one("profiles", { eq: { id } });
  if (!existing) throw notFound("Akun tidak ditemukan");
  if (String(existing.role) === "PUSAT") {
    const pusat = (await ctx.store.list("profiles", { eq: { role: "PUSAT", active: true } })).filter(row => !String(row.email).endsWith(DELETED_DOMAIN));
    if (pusat.length <= 1) throw conflict("Akun JAGA Pusat terakhir tidak dapat dihapus");
  }

  if (ctx.store.kind !== "supabase") await ctx.store.removeWhere("internal_accounts", { eq: { profile_id: id } });
  await ctx.store.removeWhere("organization_members", { eq: { profile_id: id } });

  // Hapus profil bila tidak ada riwayat yang merujuknya; bila ada (audit, penugasan), profil disamarkan agar riwayat utuh.
  let mode: "dihapus" | "disamarkan" = "dihapus";
  const anonymous = "akun-" + id.slice(0, 8) + DELETED_DOMAIN;
  try {
    await ctx.store.remove("profiles", id);
  } catch {
    mode = "disamarkan";
    await ctx.store.update("profiles", id, { email: anonymous, display_name: "Akun dihapus", title: null, active: false, updated_at: nowIso() });
  }
  if (ctx.store.kind === "supabase") {
    if (mode === "dihapus") await deleteSupabaseUser(id);
    else await disableSupabaseUser(id, anonymous);
  }
  await record(ctx.store, {
    actorId: ctx.session.profileId, action: "ACCOUNT_DELETE", entityType: "profiles",
    entityId: id, summary: "Menghapus akun " + (existing.email ?? existing.display_name) + " (" + existing.role + ")"
  });
  return { id, deleted: true, mode };
}
