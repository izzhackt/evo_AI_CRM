import { parseUniversityDrafts, universityUuid } from "./platform-university-catalog.ts";

export type ManageIndex = { q: string; cursor: string | null };
export type ManageCursor = { q: string; createdAt: string; id: string };
export type ManageMode = "draft" | "edit" | "identify" | "template" | "new" | "batch";
export type ManageRoute = { kind: "index"; index: ManageIndex } | { kind: "editor"; mode: ManageMode; value: string; listContext: string | null };
const path = "/v3/universities/manage";
const controls = /[\u0000-\u001f\u007f-\u009f]/;
const bytes = (value: string) => new TextEncoder().encode(value).length;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, names: string[]) => Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
export function normalizeManageQuery(value: unknown): string | null {
  return typeof value === "string" && !controls.test(value) && value.trim().length <= 200 ? value.trim() : null;
}
/** Validate the calendar without discarding the PostgreSQL microseconds. */
export function isManageTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value) || value.startsWith("0000")) return false;
  const milliseconds = value.slice(0, 23) + "Z";
  const date = new Date(milliseconds);
  return !Number.isNaN(date.getTime()) && date.toISOString() === milliseconds;
}
export function parseManageCursor(value: unknown, q: string): ManageCursor | null {
  if (typeof value !== "string" || bytes(value) > 2048) return null;
  try {
    const row: unknown = JSON.parse(value);
    if (!record(row) || !keys(row, ["q", "createdAt", "id"]) || row.q !== q || normalizeManageQuery(q) !== q || !isManageTimestamp(row.createdAt) || typeof row.id !== "string" || universityUuid(row.id) !== row.id || row.id !== row.id.toLowerCase()) return null;
    const cursor = { q, createdAt: row.createdAt, id: row.id as string };
    return JSON.stringify(cursor) === value ? cursor : null;
  } catch { return null; }
}
export function parseManageIndex(q: unknown = "", cursor: unknown = null): ManageIndex | null {
  const query = normalizeManageQuery(q);
  if (query === null || !(cursor === null || parseManageCursor(cursor, query))) return null;
  return { q: query, cursor: cursor as string | null };
}
export function parseManageListContext(value: unknown): ManageIndex | null {
  if (typeof value !== "string" || bytes(value) > 4096) return null;
  try {
    const row: unknown = JSON.parse(value);
    if (!record(row) || !keys(row, ["q", "cursor"])) return null;
    const index = parseManageIndex(row.q, row.cursor);
    return index && JSON.stringify(index) === value ? index : null;
  } catch { return null; }
}
export function manageListContext(index: ManageIndex): string | null {
  const valid = parseManageIndex(index.q, index.cursor);
  if (!valid) throw new Error("Invalid manage context");
  return valid.q || valid.cursor ? JSON.stringify(valid) : null;
}
export function manageListHref(index: ManageIndex): string {
  const valid = parseManageIndex(index.q, index.cursor);
  if (!valid) throw new Error("Invalid manage context");
  const params = new URLSearchParams();
  if (valid.q) params.set("q", valid.q);
  if (valid.cursor) params.set("cursor", valid.cursor);
  return path + (params.size ? `?${params}` : "");
}
export function parseManageRoute(entries: Iterable<readonly [string, unknown]>): ManageRoute | null {
  const params = new Map<string, string>();
  for (const [key, value] of entries) {
    if (params.has(key) || typeof value !== "string") return null;
    params.set(key, value);
  }
  const modes: ManageMode[] = ["draft", "edit", "identify", "template", "new", "batch"];
  const selected = modes.filter((mode) => params.has(mode));
  if (!selected.length) {
    if ([...params.keys()].some((key) => key !== "q" && key !== "cursor")) return null;
    const index = parseManageIndex(params.get("q") ?? "", params.get("cursor") ?? null);
    return index ? { kind: "index", index } : null;
  }
  if (selected.length !== 1) return null;
  const mode = selected[0], value = params.get(mode)!;
  if ([...params.keys()].some((key) => key !== mode && key !== "listContext")) return null;
  if ((["draft", "edit", "identify"].includes(mode) && !universityUuid(value)) || (["new", "batch"].includes(mode) && value !== "1") || (mode === "template" && (!value || value.length > 200 || controls.test(value)))) return null;
  const raw = params.get("listContext");
  const index = raw === undefined ? null : parseManageListContext(raw);
  if (raw !== undefined && !index) return null;
  return { kind: "editor", mode, value, listContext: index ? manageListContext(index) : null };
}
export function manageEditorHref(mode: ManageMode, value: string, listContext: string | null = null): string {
  const params = new URLSearchParams([[mode, value]]);
  if (listContext !== null) params.set("listContext", listContext);
  const route = parseManageRoute(params);
  if (!route || route.kind !== "editor") throw new Error("Invalid manage destination");
  if (route.listContext === null) params.delete("listContext");
  return `${path}?${params}`;
}
export function parseManageDraftPage(value: unknown, organizationId: string, index: ManageIndex) {
  if (!record(value) || !keys(value, ["organizationId", "query", "items", "nextCursor"]) || value.organizationId !== organizationId || value.query !== index.q || !parseManageIndex(index.q, index.cursor)) return null;
  const items = parseUniversityDrafts(value.items);
  if (!items) return null;
  let previous = index.cursor ? parseManageCursor(index.cursor, index.q) : null;
  for (const item of items) {
    if (!isManageTimestamp(item.createdAt) || item.id !== item.id.toLowerCase() || (previous && !(item.createdAt < previous.createdAt || (item.createdAt === previous.createdAt && item.id > previous.id)))) return null;
    previous = { q: index.q, createdAt: item.createdAt, id: item.id };
  }
  if (value.nextCursor === null) return { items, nextCursor: null };
  const next = value.nextCursor, last = items.at(-1);
  if (!record(next) || !keys(next, ["createdAt", "id"]) || items.length !== 50 || !last || next.createdAt !== last.createdAt || next.id !== last.id) return null;
  return { items, nextCursor: JSON.stringify({ q: index.q, createdAt: last.createdAt, id: last.id }) };
}
