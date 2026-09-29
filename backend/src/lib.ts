import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Row } from "./types.js";

export class HttpError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export const badRequest = (message: string, detail?: unknown) => new HttpError(400, message, detail);
export const unauthorized = (message = "Sesi tidak valid atau sudah berakhir") => new HttpError(401, message);
export const forbidden = (message = "Anda tidak memiliki kewenangan untuk tindakan ini") => new HttpError(403, message);
export const notFound = (message = "Data tidak ditemukan") => new HttpError(404, message);
export const conflict = (message: string, detail?: unknown) => new HttpError(409, message, detail);

export function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(payload);
}

export const ok = (res: ServerResponse, data: unknown, status = 200) =>
  json(res, status, { data });

export async function readBody(req: IncomingMessage, limitBytes = 512 * 1024): Promise<Row> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limitBytes) throw badRequest("Permintaan terlalu besar");
    chunks.push(Buffer.from(chunk as Buffer));
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
    return parsed as Row;
  } catch {
    throw badRequest("Format JSON tidak valid");
  }
}

export const nowIso = () => new Date().toISOString();
export const uuid = () => randomUUID();

export const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, expected] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const derived = scryptSync(password, salt, 64);
  const target = Buffer.from(expected, "hex");
  return derived.length === target.length && timingSafeEqual(derived, target);
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a ?? "", "utf8");
  const right = Buffer.from(b ?? "", "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export const clean = (value: unknown): string => String(value ?? "").trim();

export function text(value: unknown, field: string, opts: { min?: number; max?: number } = {}): string {
  const result = clean(value);
  const min = opts.min ?? 1;
  if (result.length < min) throw badRequest(`${field} minimal ${min} karakter`);
  if (opts.max && result.length > opts.max) throw badRequest(`${field} maksimal ${opts.max} karakter`);
  return result;
}

export function optionalText(value: unknown, field: string, max = 4000): string | null {
  const result = clean(value);
  if (!result) return null;
  if (result.length > max) throw badRequest(`${field} maksimal ${max} karakter`);
  return result;
}

export function bool(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export function numberOrNull(value: unknown, field: string, min?: number, max?: number): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw badRequest(`${field} harus berupa angka`);
  if (min !== undefined && parsed < min) throw badRequest(`${field} minimal ${min}`);
  if (max !== undefined && parsed > max) throw badRequest(`${field} maksimal ${max}`);
  return parsed;
}

export function intOr(value: unknown, fallback: number, min: number, max: number, field: string): number {
  const parsed = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed)) throw badRequest(`${field} harus berupa angka`);
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback?: T): T {
  const result = clean(value).toUpperCase();
  if (!result && fallback) return fallback;
  if (!allowed.includes(result as T)) {
    throw badRequest(`${field} harus salah satu dari: ${allowed.join(", ")}`);
  }
  return result as T;
}

export const isUuid = (value: unknown): boolean =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function requireUuid(value: unknown, field: string): string {
  if (!isUuid(value)) throw badRequest(`${field} tidak valid`);
  return String(value);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key) result[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

export const toArray = <T>(value: T | T[] | null | undefined): T[] =>
  value === null || value === undefined ? [] : Array.isArray(value) ? value : [value];

export function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = map.get(k);
    if (bucket) bucket.push(row);
    else map.set(k, [row]);
  }
  return map;
}

export const indexBy = <T>(rows: T[], key: (row: T) => string): Map<string, T> => {
  const map = new Map<string, T>();
  for (const row of rows) map.set(key(row), row);
  return map;
};

export const unique = <T>(rows: T[]): T[] => Array.from(new Set(rows));

export function parseListParam(value: string | null): string[] {
  if (!value) return [];
  return unique(value.split(",").map(part => part.trim()).filter(Boolean));
}
