/**
 * «Менеджеры в отчёте» (Э8.6, миграция 253): написания менеджера в «Отчёте
 * продаж» сводятся к ключу (регистр, пробелы, точки в конце — и ничего
 * больше), а имя ключу даёт владелец: сотрудник CRM или просто имя человека
 * без аккаунта. Здесь — разбор ответа `read_sales_manager_labels_v1` точными
 * ключами; сохранение — `saveSalesManagerLabelAction`.
 */
import { parseSalesInteger, parseSalesUuid } from "./platform-sales-register-contract.ts";

export type SalesManagerLabel = Readonly<{
  key: string;
  /** Самое частое написание без лишних пробелов — имя, пока владелец не дал своё. */
  tidy: string;
  recordCount: number;
  /** Исходные написания записей — как в отчёте, с числом записей. */
  spellings: readonly Readonly<{ spelling: string; count: number }>[];
  /** null — сопоставления не было; `displayName` null — сопоставление снято (версия остаётся). */
  mapping: Readonly<{ displayName: string | null; membershipId: string | null; version: number; updatedAt: string }> | null;
}>;
export type SalesManagerLabels = Readonly<{
  labels: readonly SalesManagerLabel[];
  staffOptions: readonly Readonly<{ id: string; label: string }>[];
}>;
export type SalesManagerLabelsRead =
  | Readonly<{ status: "ready"; data: SalesManagerLabels }>
  | Readonly<{ status: "denied" }>
  | Readonly<{ status: "unavailable" }>;

function fail(): never { throw new Error("Sales manager labels are unavailable."); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || Object.keys(record).some((key) => !keys.includes(key))) fail();
  return record;
}
function text(value: unknown, max: number): string {
  return typeof value === "string" && [...value].length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value) ? value : fail();
}
function list(value: unknown, max: number): unknown[] { return Array.isArray(value) && value.length <= max ? value : fail(); }
function count(value: unknown): number { return parseSalesInteger(value) ?? fail(); }
function uuid(value: unknown): string { return parseSalesUuid(value) ?? fail(); }

export function parseSalesManagerLabels(raw: unknown, organizationId: string): SalesManagerLabels {
  const r = exact(raw, ["organization_id", "labels", "staff_options"]);
  if (r.organization_id !== organizationId) fail();
  const labels = list(r.labels, 1000).map((value) => {
    const label = exact(value, ["key", "tidy", "record_count", "spellings", "mapping"]);
    const key = text(label.key, 300);
    if (!key) fail();
    const mapping = label.mapping === null ? null : exact(label.mapping, ["display_name", "membership_id", "version", "updated_at"]);
    const version = mapping ? count(mapping.version) : 0;
    const updatedAt = mapping ? text(mapping.updated_at, 64) : "";
    if (mapping && (version < 1 || !Number.isFinite(Date.parse(updatedAt)))) fail();
    const displayName = mapping && mapping.display_name !== null ? text(mapping.display_name, 300) : null;
    const membershipId = mapping && mapping.membership_id !== null ? uuid(mapping.membership_id) : null;
    if (membershipId && !displayName) fail();
    return {
      key, tidy: text(label.tidy, 300), recordCount: count(label.record_count),
      spellings: list(label.spellings, 1000).map((one) => {
        const spelling = exact(one, ["spelling", "count"]);
        return { spelling: text(spelling.spelling, 300), count: count(spelling.count) };
      }),
      mapping: mapping ? { displayName, membershipId, version, updatedAt } : null,
    };
  });
  if (new Set(labels.map((label) => label.key)).size !== labels.length) fail();
  const staffOptions = list(r.staff_options, 1000).map((value) => {
    const option = exact(value, ["id", "label"]);
    return { id: uuid(option.id), label: text(option.label, 300) };
  });
  return { labels, staffOptions };
}

/** Имя в отчёте: имя владельца, иначе самое частое написание. */
export function salesManagerLabelName(label: SalesManagerLabel): string {
  return label.mapping?.displayName ?? label.tidy;
}
