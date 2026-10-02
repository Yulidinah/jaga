import { config, supabaseEnabled } from "./config.js";
import { HttpError, nowIso } from "./lib.js";
import type { Row } from "./types.js";
import { HAS_CREATED_AT, HAS_UPDATED_AT, type Query, type Store } from "./store.js";

const encodeValue = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const postgrestValue = (value: unknown): string => {
  if (Array.isArray(value)) return `(${value.map(item => `"${String(item).replace(/"/g, '\\"')}"`).join(",")})`;
  const text = encodeValue(value);
  return /[(),\s"'\\:]/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
};

/** Nilai filter di-encode agar karakter seperti & # + % tidak menyisipkan parameter baru. */
const enc = (value: string): string =>
  encodeURIComponent(value).replace(/%28/g, "(").replace(/%29/g, ")").replace(/%2C/g, ",").replace(/%22/g, '"');

/** Menerjemahkan Query menjadi string PostgREST. */
export function toQueryString(query: Query = {}): string {
  const parts: string[] = ["select=*"];
  const push = (key: string, raw: string) => parts.push(`${key}=${enc(raw)}`);

  for (const [column, value] of Object.entries(query.eq ?? {})) {
    if (value === null) parts.push(`${column}=is.null`);
    else push(column, `eq.${postgrestValue(value)}`);
  }
  for (const [column, value] of Object.entries(query.neq ?? {})) {
    push(column, `neq.${postgrestValue(value)}`);
  }
  for (const [column, values] of Object.entries(query.in ?? {})) {
    // Daftar kosong berarti tidak ada baris yang cocok (sama seperti penyimpanan memori).
    push(column, `in.(${values.map(postgrestValue).join(",")})`);
  }
  for (const [column, value] of Object.entries(query.gt ?? {})) push(column, `gt.${postgrestValue(value)}`);
  for (const [column, value] of Object.entries(query.gte ?? {})) push(column, `gte.${postgrestValue(value)}`);
  for (const [column, value] of Object.entries(query.lt ?? {})) push(column, `lt.${postgrestValue(value)}`);
  for (const [column, value] of Object.entries(query.lte ?? {})) push(column, `lte.${postgrestValue(value)}`);
  for (const [column, isNull] of Object.entries(query.isNull ?? {})) {
    parts.push(isNull ? `${column}=is.null` : `${column}=not.is.null`);
  }
  for (const [column, value] of Object.entries(query.like ?? {})) push(column, `ilike.${postgrestValue(value)}`);
  const alternatives = (query.anyOf ?? []).filter(item => item.values.length);
  if (alternatives.length) {
    parts.push(`or=${enc(`(${alternatives.map(item => `${item.column}.in.(${item.values.map(postgrestValue).join(",")})`).join(",")})`)}`);
  }

  const order = Object.entries(query.order ?? {});
  if (order.length) {
    parts.push(`order=${order.map(([column, direction]) => `${column}.${direction}`).join(",")}`);
  }
  if (query.limit) parts.push(`limit=${Math.min(query.limit, config.maxPageSize)}`);
  if (query.offset) parts.push(`offset=${query.offset}`);
  return parts.join("&");
}

export class PostgrestStore implements Store {
  readonly kind = "supabase" as const;
  private readonly base: string;
  private readonly headers: Record<string, string>;

  constructor(url = config.supabaseUrl, key = config.supabaseSecretKey) {
    if (!url || !key) throw new Error("Supabase belum dikonfigurasi");
    this.base = `${url}/rest/v1`;
    this.headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  }

  private async request(path: string, init: RequestInit = {}): Promise<Row[]> {
    let response: Response;
    try {
      response = await fetch(`${this.base}/${path}`, { ...init, headers: { ...this.headers, ...(init.headers ?? {}) } });
    } catch (error) {
      throw new HttpError(503, `Tidak dapat menghubungi basis data: ${(error as Error).message}`);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new HttpError(502, `Basis data menolak permintaan (${response.status})`, text.slice(0, 800));
    }
    if (!text.trim()) return [];
    try {
      const parsed = JSON.parse(text) as unknown;
      return Array.isArray(parsed) ? (parsed as Row[]) : [parsed as Row];
    } catch {
      return [];
    }
  }

  /** created_at hanya ditambahkan untuk tabel yang memang punya kolomnya. */
  private stamp(table: string, row: Row): Row {
    if (!HAS_CREATED_AT.has(table)) {
      const { created_at: _ignored, ...rest } = row;
      return rest;
    }
    return { ...row, created_at: row.created_at ?? nowIso() };
  }

  async list(table: string, query: Query = {}): Promise<Row[]> {
    if (!query.pred) return this.request(`${table}?${toQueryString(query)}`);
    // Predikat JS tidak bisa didorong ke PostgREST, jadi tabel dibaca penuh
    // lalu disaring di backend. Jangan pakai pada tabel besar.
    const rows = await this.request(`${table}?${toQueryString({ ...query, limit: undefined, offset: undefined })}`);
    return rows.filter(row => query.pred?.(row) ?? true);
  }

  async one(table: string, query: Query): Promise<Row | null> {
    const rows = await this.list(table, { ...query, limit: 1 });
    return rows[0] ?? null;
  }

  async first(table: string, query: Query): Promise<Row | null> {
    return this.one(table, query);
  }

  async count(table: string, query: Query = {}): Promise<number> {
    if (query.pred) return (await this.list(table, query)).length;
    const params = new URLSearchParams(toQueryString(query));
    params.set("select", "*");
    params.set("limit", "1");
    const response = await fetch(`${this.base}/${table}?${params.toString()}`, {
      headers: { ...this.headers, Prefer: "count=exact", Range: "0-0" }
    });
    if (!response.ok) throw new HttpError(502, `Gagal menghitung ${table} (${response.status})`);
    const contentRange = response.headers.get("content-range") ?? "";
    const total = Number(contentRange.split("/")[1] ?? 0);
    return Number.isFinite(total) ? total : 0;
  }

  async insert(table: string, row: Row): Promise<Row> {
    const payload = this.stamp(table, row);
    const rows = await this.request(table, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload)
    });
    if (!rows[0]) throw new HttpError(500, `Basis data tidak mengembalikan data ${table}`);
    return rows[0];
  }

  async insertMany(table: string, rowsToInsert: Row[]): Promise<Row[]> {
    if (!rowsToInsert.length) return [];
    const payload = rowsToInsert.map(row => this.stamp(table, row));
    return this.request(table, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload)
    });
  }

  async upsert(table: string, rowsToUpsert: Row[], onConflict: string[]): Promise<Row[]> {
    if (!rowsToUpsert.length) return [];
    const query = `on_conflict=${onConflict.join(",")}`;
    const payload = rowsToUpsert.map(row => this.stamp(table, row));
    return this.request(`${table}?${query}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(payload)
    });
  }

  async update(table: string, id: unknown, patch: Row): Promise<Row | null> {
    const rows = await this.updateWhere(table, { eq: { id } }, patch);
    return rows[0] ?? null;
  }

  async updateWhere(table: string, query: Query, patch: Row): Promise<Row[]> {
    const body = { ...patch };
    if (HAS_UPDATED_AT.has(table)) {
      if (!("updated_at" in body)) body.updated_at = nowIso();
    } else {
      delete body.updated_at;
    }
    const rows = await this.list(table, { ...query, limit: 1 });
    if (!rows.length) return [];
    return this.request(`${table}?${toQueryString({ ...query, limit: undefined, offset: undefined, order: undefined })}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body)
    });
  }

  async remove(table: string, id: unknown): Promise<void> {
    if (id && typeof id === "object") return this.removeWhere(table, { eq: id as Record<string, unknown> });
    await this.request(`${table}?id=eq.${encodeURIComponent(String(id))}`, { method: "DELETE" });
  }

  async removeWhere(table: string, query: Query): Promise<void> {
    const rows = await this.list(table, { ...query, limit: 1 });
    if (!rows.length) return;
    await this.request(`${table}?${toQueryString({ ...query, limit: undefined, offset: undefined, order: undefined })}`, {
      method: "DELETE"
    });
  }

  async rpc(fn: string, payload: Row = {}): Promise<Row | Row[] | null> {
    const rows = await this.request(`rpc/${fn}`, { method: "POST", body: JSON.stringify(payload) });
    if (!rows.length) return null;
    return rows.length === 1 ? (rows[0] ?? null) : rows;
  }

  async ping(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.request("villages?select=id&limit=1");
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: (error as Error).message };
    }
  }
}

export const createPostgrestStore = (): Store | null => (supabaseEnabled ? new PostgrestStore() : null);
