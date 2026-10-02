import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { config } from "./config.js";
import { badRequest, clean, forbidden, hashPassword, nowIso, parseCookies, randomToken, safeEqual, sha256Hex, unauthorized, verifyPassword } from "./lib.js";
import type { JagaRole, Row, Session } from "./types.js";
import type { Store } from "./store.js";

const ROLES: JagaRole[] = ["PUSAT", "DESA", "RESCUE"];
const SESSION_COOKIE = "jaga_session";

const ephemeralSecret = randomToken(48);
export const sessionSecret = config.sessionSecret || ephemeralSecret;
export const usingEphemeralSessionSecret = !config.sessionSecret;

const sign = (value: string) => createHmac("sha256", sessionSecret).update(value).digest("base64url");

export interface InternalClaims {
  email: string;
  profileId: string;
  role: JagaRole;
  organizationId: string | null;
  villageIds: string[] | null;
  displayName: string;
  exp: number;
}

export function issueInternalToken(claims: Omit<InternalClaims, "exp"> & { exp?: number }): string {
  const payload: InternalClaims = {
    ...claims,
    exp: claims.exp ?? Math.floor(Date.now() / 1000) + config.sessionTtlSeconds
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Token internal yang dicabut saat logout (disimpan sampai kedaluwarsa). */
const revoked = new Map<string, number>();
export function revokeInternalToken(token: string): void {
  const [body, signature] = token.split(".");
  if (!body || !signature) return;
  const claims = readInternalToken(token);
  revoked.set(signature, (claims?.exp ?? Math.floor(Date.now() / 1000) + config.sessionTtlSeconds) * 1000);
  const now = Date.now();
  for (const [key, until] of revoked) if (until < now) revoked.delete(key);
}

export function readInternalToken(token: string): InternalClaims | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  if (revoked.has(signature)) return null;
  const expected = sign(body);
  if (!safeEqual(signature, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as InternalClaims;
    if (!claims.exp || claims.exp * 1000 < Date.now()) return null;
    if (!ROLES.includes(claims.role)) return null;
    return claims;
  } catch {
    return null;
  }
}

const looksLikeJwt = (token: string) => token.split(".").length === 3;

const splitAddress = (fullName: string): { displayName: string; villageNames: string[] } => {
  const parts = fullName.split("::").map(part => part.trim()).filter(Boolean);
  return { displayName: parts[0] ?? fullName, villageNames: parts.slice(1) };
};

export function serializeSession(session: Session) {
  return session;
}

async function villageNames(store: Store, villageIds: string[] | null): Promise<string[]> {
  if (!villageIds?.length) return [];
  const rows = await store.list("villages", { in: { id: villageIds } });
  return rows.map(row => String(row.name ?? ""));
}

async function sessionFromProfile(store: Store, profile: Row, extras: Partial<Session> = {}): Promise<Session> {
  const role = String(profile.role ?? "DESA").toUpperCase() as JagaRole;
  let organizationId = profile.organization_id ? String(profile.organization_id) : null;
  if (!organizationId && profile.id && role !== "PUSAT") {
    const membership = await store.one("organization_members", { eq: { profile_id: String(profile.id) } }).catch(() => null);
    if (membership?.organization_id) organizationId = String(membership.organization_id);
  }
  const declared = Array.isArray(extras.villageIds)
    ? extras.villageIds
    : Array.isArray(profile.village_ids) ? (profile.village_ids as string[]) : null;
  const scopes = organizationId
    ? (await store.list("organization_service_areas", { eq: { organization_id: organizationId } })).map(row => String(row.village_id))
    : [];
  const villageIds = role === "PUSAT" ? null : uniqueList(declared ?? scopes);
  const organization = organizationId ? await store.one("organizations", { eq: { id: organizationId } }) : null;
  return {
    userId: String(profile.user_id ?? profile.id),
    profileId: String(profile.id),
    displayName: String(profile.display_name ?? "Petugas"),
    email: String(profile.email ?? ""),
    role,
    organizationId,
    organizationName: organization ? String(organization.name) : null,
    villageIds,
    villageNames: await villageNames(store, villageIds),
    authSource: extras.authSource ?? "internal",
    expiresAt: Date.now() + config.sessionTtlSeconds * 1000
  };
}

const uniqueList = (values: string[]) => Array.from(new Set(values));

async function supabasePasswordGrant(email: string, password: string): Promise<{ token: string; userId: string; userEmail: string } | null> {
  const apikey = config.supabaseAnonKey || config.supabaseSecretKey;
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) return null;
  const payload = await response.json() as { access_token?: string; user?: { id?: string; email?: string } };
  if (!payload.access_token || !payload.user?.id) return null;
  return { token: payload.access_token, userId: String(payload.user.id), userEmail: String(payload.user.email ?? email) };
}

export async function authenticate(store: Store, email: string, password: string): Promise<{ token: string; session: Session }> {
  const address = clean(email).toLowerCase();
  if (!address || !password) throw badRequest("Email dan kata sandi wajib diisi");

  if (store.kind === "supabase") {
    const grant = await supabasePasswordGrant(address, password).catch(() => null);
    if (grant) {
      const profile = await store.one("profiles", { eq: { id: grant.userId } });
      if (profile) {
        const session = await sessionFromProfile(store, profile, {
          userId: grant.userId,
          email: grant.userEmail,
          authSource: "supabase"
        });
        return { token: grant.token, session };
      }
    }
  }

  const account = store.kind === "supabase"
    ? null
    : await store.one("internal_accounts", { eq: { email: address } });
  if (!account || account.active === false) throw unauthorized("Email atau kata sandi salah");
  if (!(await verifyPassword(password, String(account.password_hash ?? "")))) throw unauthorized("Email atau kata sandi salah");

  const profile = account.profile_id
    ? await store.one("profiles", { eq: { id: String(account.profile_id) } })
    : null;
  const base: Row = profile ?? {
    id: String(account.profile_id ?? sha256Hex(address).slice(0, 32)),
    display_name: account.display_name,
    role: account.role
  };
  if (profile && profile.active === false) throw unauthorized("Akun dinonaktifkan");
  const session = await sessionFromProfile(store, {
    ...base,
    role: account.role ?? base.role,
    email: address,
    organization_id: account.organization_id ?? null,
    village_ids: account.village_ids ?? null
  });
  await store.update("internal_accounts", String(account.id), { last_login_at: nowIso() }).catch(() => null);
  const token = issueInternalToken({
    email: address,
    profileId: session.profileId,
    role: session.role,
    organizationId: session.organizationId,
    villageIds: session.villageIds,
    displayName: session.displayName
  });
  return { token, session };
}

export async function authenticateSupabaseToken(store: Store, token: string): Promise<Session | null> {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: config.supabaseAnonKey || config.supabaseSecretKey, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) return null;
  const user = await response.json() as { id?: string; email?: string };
  if (!user.id) return null;
  const profile = await store.one("profiles", { eq: { id: String(user.id) } });
  if (!profile) return null;
  return sessionFromProfile(store, { ...profile, email: user.email ?? profile.email }, { userId: String(user.id), authSource: "supabase" });
}

export function tokenFromRequest(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE] ?? null;
}

export async function resolveSession(store: Store, req: IncomingMessage): Promise<Session | null> {
  const token = tokenFromRequest(req);
  if (token) {
    if (looksLikeJwt(token) && store.kind === "supabase") {
      const session = await authenticateSupabaseToken(store, token).catch(() => null);
      if (session) return session;
      return null;
    }
    const claims = readInternalToken(token);
    if (!claims) return null;
    // Peran, status, dan wilayah dibaca ulang dari data terbaru supaya perubahan hak akses langsung berlaku.
    if (store.kind !== "supabase") {
      const account = await store.one("internal_accounts", { eq: { email: claims.email } }).catch(() => null);
      if (account) {
        if (account.active === false) return null;
        const live = account.profile_id ? await store.one("profiles", { eq: { id: String(account.profile_id) } }).catch(() => null) : null;
        if (live && live.active === false) return null;
        return sessionFromProfile(store, {
          id: claims.profileId,
          display_name: live?.display_name ?? account.display_name,
          role: live?.role ?? account.role,
          email: claims.email,
          organization_id: account.organization_id ?? null,
          village_ids: account.village_ids ?? null
        }, { userId: claims.email });
      }
    }
    const profile = claims.profileId
      ? await store.one("profiles", { eq: { id: claims.profileId } }).catch(() => null)
      : null;
    if (profile && profile.active === false) return null;
    return sessionFromProfile(store, {
      id: claims.profileId,
      display_name: claims.displayName,
      role: claims.role,
      email: claims.email,
      organization_id: claims.organizationId,
      village_ids: claims.villageIds
    }, { userId: claims.email });
  }

  // Hanya untuk pengembangan: izinkan akses tanpa token lewat header peran.
  if (config.devRoleHeader) {
    const raw = req.headers["x-jaga-role"]?.toString().toUpperCase();
    const role = ROLES.includes(raw as JagaRole) ? (raw as JagaRole) : null;
    if (role) {
      const { displayName, villageNames: extra } = splitAddress(String(req.headers["x-jaga-name"] ?? `Demo ${role}`));
      return {
        userId: `dev-${role}`,
        profileId: `dev-${role}`,
        displayName,
        email: `${role.toLowerCase()}@demo.jaga.id`,
        role,
        organizationId: null,
        organizationName: "Mode pengembangan",
        villageIds: null,
        villageNames: extra,
        authSource: "internal",
        expiresAt: Date.now() + 3_600_000
      };
    }
  }
  return null;
}

export async function requireSession(store: Store, req: IncomingMessage): Promise<Session> {
  const session = await resolveSession(store, req);
  if (!session) throw unauthorized();
  return session;
}

export const requireRole = (session: Session, roles: JagaRole[], message?: string): Session => {
  if (!roles.includes(session.role)) {
    throw forbidden(message ?? `Role ${session.role} tidak diizinkan untuk tindakan ini`);
  }
  return session;
};

export const isCentral = (session: Session) => session.role === "PUSAT";

/** Daftar desa yang boleh diakses. null = seluruh wilayah. */
export const scopeIds = (session: Session): string[] | null => session.role === "PUSAT" ? null : session.villageIds ?? [];

export function applyScope(session: Session, column: string, ids: string[] | null): { in?: Record<string, unknown[]> } {
  if (ids === null) return {};
  if (!ids.length) return { in: { [column]: ["__tidak_ada_desa_yang_terdaftar__"] } };
  return { in: { [column]: ids } };
}

export const assertVillageAccess = (session: Session, villageId: unknown, message = "Wilayah ini di luar kewenangan Anda") => {
  const ids = scopeIds(session);
  if (ids === null) return;
  if (!villageId || !ids.includes(String(villageId))) throw forbidden(message);
};

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`
  ];
  if (config.secureCookie || config.env === "production") parts.push("Secure");
  return parts.join("; ");
}

export const clearSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

export { SESSION_COOKIE };

/* ---------------------------------------------------------------- Devices */

export interface DeviceAuth {
  device: Row;
  residentId: string | null;
}

export async function authenticateDevice(store: Store, req: IncomingMessage, url: URL): Promise<DeviceAuth> {
  void url;
  const key = clean(req.headers["x-jaga-device-key"]);
  const deviceId = clean(req.headers["x-jaga-device-id"]);
  if (!key) throw unauthorized("Kunci perangkat tidak disertakan pada header X-JAGA-Device-Key");
  const device = await store.one("devices", { eq: { id: deviceId } });
  if (!device) throw unauthorized("Perangkat tidak terdaftar");
  if (!device.auth_key_hash || !safeEqual(String(device.auth_key_hash), sha256Hex(key))) {
    throw unauthorized("Kunci perangkat tidak cocok");
  }
  if (["LOST", "RETIRED"].includes(String(device.status))) throw forbidden("Perangkat berstatus hilang atau dipensiunkan");
  const assignment = await store.one("device_assignments", { eq: { device_id: String(device.id) }, isNull: { unassigned_at: true } });
  return { device, residentId: assignment?.resident_id ? String(assignment.resident_id) : null };
}

export interface GatewayAuth {
  gateway: Row;
}

export async function authenticateGateway(store: Store, req: IncomingMessage, url: URL): Promise<GatewayAuth> {
  void url;
  const key = clean(req.headers["x-jaga-gateway-key"]);
  if (!key) throw unauthorized("Kunci gateway tidak disertakan pada header X-JAGA-Gateway-Key");
  const gateway = await store.one("gateways", { eq: { auth_key_hash: sha256Hex(key) } });
  if (!gateway) throw unauthorized("Kunci gateway tidak cocok");
  return { gateway };
}

export const newDeviceKey = () => `jrk_${randomToken(24)}`;
export const newGatewayKey = () => `gtw_${randomToken(24)}`;
export { hashPassword };
