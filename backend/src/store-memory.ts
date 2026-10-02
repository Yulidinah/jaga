import { HttpError, nowIso, uuid } from "./lib.js";
import { TABLE_ID_KIND, identityTables, type IdKind, type Query, type Store } from "./store.js";
import type { Row } from "./types.js";

type Table = { rows: Row[]; sequence: number };

const compare = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), "id");
};

const normalize = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && !(value instanceof Date)) return JSON.stringify(value);
  if (value instanceof Date) return value.toISOString();
  return value;
};

const sameValue = (left: unknown, right: unknown) => compare(normalize(left), normalize(right)) === 0;

/** Pencocokan longgar untuk pencarian teks: "Siti Aminah" harus menemukan "siti aminah". */
const looseText = (value: unknown, needle: string) =>
  String(value ?? "").toLowerCase().includes(needle.toLowerCase());

export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private readonly tables = new Map<string, Table>();

  private table(name: string): Table {
    let found = this.tables.get(name);
    if (!found) {
      found = { rows: [], sequence: 0 };
      this.tables.set(name, found);
    }
    return found;
  }

  hydrate(name: string, rows: Row[]): void {
    const table = this.table(name);
    table.rows = rows.map(row => ({ ...row }));
    table.sequence = 0;
  }

  dump(): Record<string, Row[]> {
    const result: Record<string, Row[]> = {};
    for (const [name, table] of this.tables) if (table.rows.length) result[name] = table.rows.map(row => ({ ...row }));
    return result;
  }

  private nextId(name: string): unknown {
    const kind: IdKind = TABLE_ID_KIND[name] ?? "uuid";
    if (kind === "uuid") return uuid();
    if (kind === "text") return `${name.toUpperCase().slice(0, 4)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    return null;
  }

  private matches(row: Row, query: Query): boolean {
    for (const [column, value] of Object.entries(query.eq ?? {})) {
      if (!sameValue(row[column], value)) return false;
    }
    for (const [column, value] of Object.entries(query.neq ?? {})) {
      if (sameValue(row[column], value)) return false;
    }
    for (const [column, values] of Object.entries(query.in ?? {})) {
      if (!values.some(value => sameValue(row[column], value))) return false;
    }
    for (const [column, value] of Object.entries(query.gt ?? {})) {
      if (!(compare(normalize(row[column]), normalize(value)) > 0)) return false;
    }
    for (const [column, value] of Object.entries(query.gte ?? {})) {
      if (!(compare(normalize(row[column]), normalize(value)) >= 0)) return false;
    }
    for (const [column, value] of Object.entries(query.lt ?? {})) {
      if (!(compare(normalize(row[column]), normalize(value)) < 0)) return false;
    }
    for (const [column, value] of Object.entries(query.lte ?? {})) {
      if (!(compare(normalize(row[column]), normalize(value)) <= 0)) return false;
    }
    for (const [column, isNull] of Object.entries(query.isNull ?? {})) {
      const actual = row[column] ?? null;
      if (isNull && actual !== null) return false;
      if (!isNull && actual === null) return false;
    }
    for (const [column, value] of Object.entries(query.like ?? {})) {
      if (!looseText(row[column], String(value).replace(/%/g, ""))) return false;
    }
    const alternatives = (query.anyOf ?? []).filter(item => item.values.length);
    if (alternatives.length && !alternatives.some(item => item.values.some(value => sameValue(row[item.column], value)))) {
      return false;
    }
    return query.pred ? query.pred(row) : true;
  }

  private sort(rows: Row[], order: Query["order"]): Row[] {
    if (!order) return rows;
    const entries = Object.entries(order);
    if (!entries.length) return rows;
    return [...rows].sort((a, b) => {
      for (const [column, direction] of entries) {
        const result = compare(normalize(a[column]), normalize(b[column]));
        if (result !== 0) return direction === "desc" ? -result : result;
      }
      return 0;
    });
  }

  async list(name: string, query: Query = {}): Promise<Row[]> {
    let rows = this.table(name).rows.filter(row => this.matches(row, query));
    rows = this.sort(rows, query.order);
    if (query.offset) rows = rows.slice(query.offset);
    if (query.limit) rows = rows.slice(0, query.limit);
    return rows.map(row => ({ ...row }));
  }

  async one(name: string, query: Query): Promise<Row | null> {
    return (await this.list(name, { ...query, limit: 1 }))[0] ?? null;
  }

  async first(name: string, query: Query): Promise<Row | null> {
    return this.one(name, query);
  }

  async count(name: string, query: Query = {}): Promise<number> {
    return this.table(name).rows.filter(row => this.matches(row, query)).length;
  }

  private stamp(name: string, row: Row): Row {
    const result = { ...row };
    if (result.created_at === undefined) result.created_at = nowIso();
    if (result.updated_at === undefined && name in (TABLE_ID_KIND as Record<string, unknown>)) {
      result.updated_at = nowIso();
    }
    return result;
  }

  private assignIdentity(name: string, row: Row): Row {
    if (identityTables.has(name)) {
      const table = this.table(name);
      table.sequence += 1;
      return { ...row, id: row.id ?? table.sequence };
    }
    return row;
  }

  private enforceUnique(name: string, row: Row): void {
    const keyColumns = TABLE_ID_KIND[name] === "composite" ? this.compositeKeys(name) : ["id"];
    if (!keyColumns.length) return;
    const clash = this.table(name).rows.find(existing =>
      keyColumns.every(column => sameValue(existing[column], row[column]))
    );
    if (clash) throw new HttpError(409, `Data duplikat pada ${name} (${keyColumns.join(", ")})`);
  }

  private compositeKeys(name: string): string[] {
    const composite: Record<string, string[]> = {
      organization_service_areas: ["organization_id", "village_id"],
      organization_members: ["organization_id", "profile_id"],
      resident_vulnerabilities: ["resident_id", "vulnerability_type_id"],
      rescue_team_members: ["team_id", "profile_id"],
      internal_accounts: ["email"]
    };
    return composite[name] ?? [];
  }

  async insert(name: string, row: Row): Promise<Row> {
    const prepared = this.assignIdentity(name, this.stamp(name, { ...row }));
    if (prepared.id === undefined || prepared.id === null) {
      const generated = this.nextId(name);
      if (generated !== null) prepared.id = generated;
    }
    this.enforceUnique(name, prepared);
    this.table(name).rows.push(prepared);
    return { ...prepared };
  }

  async insertMany(name: string, rowsToInsert: Row[]): Promise<Row[]> {
    const result: Row[] = [];
    for (const row of rowsToInsert) result.push(await this.insert(name, row));
    return result;
  }

  async upsert(name: string, rowsToUpsert: Row[], onConflict: string[]): Promise<Row[]> {
    const result: Row[] = [];
    for (const row of rowsToUpsert) {
      const existing = this.table(name).rows.find(candidate =>
        onConflict.every(column => sameValue(candidate[column], row[column]))
      );
      if (existing) {
        Object.assign(existing, row, { updated_at: nowIso() });
        result.push({ ...existing });
      } else {
        result.push(await this.insert(name, row));
      }
    }
    return result;
  }

  async update(name: string, id: unknown, patch: Row): Promise<Row | null> {
    const row = this.table(name).rows.find(candidate => sameValue(candidate.id, id));
    if (!row) return null;
    Object.assign(row, patch);
    if (!("recorded_at" in patch)) row.updated_at = nowIso();
    return { ...row };
  }

  async updateWhere(name: string, query: Query, patch: Row): Promise<Row[]> {
    const targets = this.table(name).rows.filter(row => this.matches(row, query));
    for (const row of targets) {
      Object.assign(row, patch);
      if (!("recorded_at" in patch)) row.updated_at = nowIso();
    }
    return targets.map(row => ({ ...row }));
  }

  async remove(name: string, id: unknown): Promise<void> {
    if (id && typeof id === "object") return this.removeWhere(name, { eq: id as Record<string, unknown> });
    const table = this.table(name);
    const index = table.rows.findIndex(candidate => sameValue(candidate.id, id));
    if (index >= 0) table.rows.splice(index, 1);
  }

  async removeWhere(name: string, query: Query): Promise<void> {
    const table = this.table(name);
    table.rows = table.rows.filter(row => !this.matches(row, query));
  }

  async rpc(): Promise<Row | Row[] | null> {
    return null;
  }

  async ping(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: "Penyimpanan memori aktif. Data kembali ke awal saat server dimatikan." };
  }
}
