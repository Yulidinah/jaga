import type { IncomingMessage, ServerResponse } from "node:http";
import { badRequest, forbidden, json, notFound, ok, readBody, unauthorized } from "./lib.js";
import type { JagaRole, Row, Session } from "./types.js";
import type { Store } from "./store.js";

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  params: Record<string, string>;
  query: URLSearchParams;
  store: Store;
  session: Session;
  body: Row;
  /** Diisi untuk endpoint perangkat dan gateway. */
  device?: Row;
  deviceAuth?: { device: Row; residentId: string | null };
  gateway?: { gateway: Row };
}

export type Handler = (ctx: Ctx) => Promise<unknown | void>;

export interface RouteOptions {
  roles?: readonly JagaRole[];
  /** Izinkan akses tanpa sesi (login, health, device ingest). */
  public?: boolean;
  status?: number;
}

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  options: RouteOptions;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler, options: RouteOptions = {}): this {
    this.routes.push({
      method: method.toUpperCase(),
      segments: pattern.split("/").filter(Boolean),
      handler,
      options
    });
    return this;
  }

  get(pattern: string, handler: Handler, options?: RouteOptions) { return this.add("GET", pattern, handler, options); }
  post(pattern: string, handler: Handler, options?: RouteOptions) { return this.add("POST", pattern, handler, options); }
  patch(pattern: string, handler: Handler, options?: RouteOptions) { return this.add("PATCH", pattern, handler, options); }
  put(pattern: string, handler: Handler, options?: RouteOptions) { return this.add("PUT", pattern, handler, options); }
  delete(pattern: string, handler: Handler, options?: RouteOptions) { return this.add("DELETE", pattern, handler, options); }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    const parts = path.split("/").filter(Boolean);
    let pathMatched = false;
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const segment = route.segments[i] ?? "";
        const actual = parts[i] ?? "";
        if (segment.startsWith(":")) params[segment.slice(1)] = decodeURIComponent(actual);
        else if (segment !== actual) { matched = false; break; }
      }
      if (!matched) continue;
      pathMatched = true;
      if (route.method === method.toUpperCase()) return { route, params };
    }
    if (pathMatched) throw badRequest("Metode tidak didukung untuk endpoint ini");
    return null;
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    store: Store,
    resolveSession: (r: IncomingMessage) => Promise<Session | null>,
    options: { extra?: Partial<Ctx>; session?: Session | null } = {}
  ): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = (req.method ?? "GET").toUpperCase();
    if (method === "OPTIONS") {
      res.writeHead(204, { allow: "GET,POST,PATCH,PUT,DELETE,OPTIONS" });
      res.end();
      return;
    }
    const found = this.match(method, url.pathname);
    if (!found) throw notFound("Endpoint tidak ditemukan");

    const session = (await resolveSession(req)) ?? options.session ?? null;
    // Endpoint dilindungi yang belum punya sesi harus melaporkan 401, bukan 404,
    // supaya klien tahu persis langkah berikutnya (masuk atau perpanjang sesi).
    if (!session && !found.route.options.public) {
      throw unauthorized("Anda harus masuk terlebih dahulu");
    }
    if (session && found.route.options.roles && !found.route.options.roles.includes(session.role)) {
      throw forbidden(`Role ${session.role} tidak diizinkan untuk endpoint ini`);
    }

    const needsBody = method !== "GET" && method !== "HEAD";
    const body = needsBody ? (options.extra?.body ?? await readBody(req)) : {};

    const ctx: Ctx = {
      req, res, url, method,
      params: found.params,
      query: url.searchParams,
      store,
      session: session as Session,
      body,
      ...options.extra
    };
    const result = await found.route.handler(ctx);
    if (res.headersSent) return;
    if (result === undefined) { ok(res, null, found.route.options.status ?? 204); return; }
    ok(res, result, found.route.options.status ?? 200);
  }
}

export const param = (ctx: Ctx, name: string): string => {
  const value = ctx.params[name];
  if (value === undefined) throw badRequest(`Parameter ${name} tidak ditemukan pada endpoint ini`);
  return value;
};

export const paged = <T>(rows: T[], query: URLSearchParams, max: number) => {
  const limit = Math.min(max, Math.max(1, Number(query.get("limit") ?? 200) || 200));
  const offset = Math.max(0, Number(query.get("offset") ?? 0) || 0);
  return { data: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
};

export { json };
