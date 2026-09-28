/**
 * «Связать с лидом» (Э8.7, миграция 254): владелец 28.09.2026 — «можно
 * связать, но это не рабочее место, просто связать». Разбор трёх ответов
 * точными ключами: поиск лида (`sales_record_lead_options_v1`), связь записи
 * для панели (`sales_record_lead_link_v1`) и сама команда
 * (`link_sales_record_lead_v1`) возвращает ту же квитанцию, что
 * `manage_sales_register_v2` (record_id/version/operation/request_id).
 */
import { isResolvedSalesStage, type ResolvedSalesStage } from "./v3/sales-stage.ts";
import { parseSalesDate, parseSalesInteger, parseSalesUuid } from "./platform-sales-register-contract.ts";

function fail(): never { throw new Error("Sales record lead link is unavailable."); }
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
function uuid(value: unknown): string { return parseSalesUuid(value) ?? fail(); }

/* --------------------------------------------------------- «Связать с лидом»: поиск */

export type SalesRecordLeadOption = Readonly<{
  id: string;
  name: string;
  stage: ResolvedSalesStage;
  /** День создания лида (`YYYY-MM-DD`) — без времени. */
  createdOn: string;
}>;

export function parseSalesRecordLeadOptions(raw: unknown, organizationId: string): readonly SalesRecordLeadOption[] {
  const r = exact(raw, ["organization_id", "query", "options"]);
  if (r.organization_id !== organizationId) fail();
  const options = list(r.options, 20).map((value) => {
    const option = exact(value, ["id", "name", "stage", "created_on"]);
    const stage = option.stage;
    if (!isResolvedSalesStage(stage)) fail();
    const createdOn = parseSalesDate(option.created_on);
    if (!createdOn) fail();
    return { id: uuid(option.id), name: text(option.name, 300), stage, createdOn };
  });
  if (new Set(options.map((option) => option.id)).size !== options.length) fail();
  return options;
}

/* -------------------------------------------------- Связь записи: чтение для панели */

/**
 * null — запись не связана. `visible: false` — связана, но у актёра нет
 * `lead.read` на этот лид: ни имени, ни прочерка наугад.
 */
export type SalesRecordLeadLink =
  | null
  | Readonly<{ visible: true; leadId: string; name: string }>
  | Readonly<{ visible: false }>;

export function parseSalesRecordLeadLink(raw: unknown, organizationId: string, recordId: string): SalesRecordLeadLink {
  const r = exact(raw, ["organization_id", "record_id", "link"]);
  if (r.organization_id !== organizationId || r.record_id !== recordId) fail();
  if (r.link === null) return null;
  const link = exact(r.link, ["visible", "lead_id", "name"]);
  if (typeof link.visible !== "boolean") fail();
  if (!link.visible) {
    if (link.lead_id !== null || link.name !== null) fail();
    return { visible: false };
  }
  return { visible: true, leadId: uuid(link.lead_id), name: text(link.name, 300) };
}

/* -------------------------------------------------------------- Команда: квитанция */

export type SalesRecordLeadLinkActionState = Readonly<{
  status: "idle" | "saved" | "invalid" | "forbidden" | "stale" | "request_conflict" | "unavailable"
    /** Этот лид уже связан с другой записью. */
    | "lead_already_linked"
    /** У этого лида уже есть продажа pipeline (`lead_id`), связывать нечего. */
    | "lead_has_sale";
  requestId: string; recordId: string | null;
}>;

export function parseSalesRecordLeadLinkReceipt(raw: unknown, expected: Readonly<{
  organizationId: string; recordId: string; requestId: string; expectedVersion: number; operation: "link" | "unlink";
}>): number | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).length !== 5 || r.organization_id !== expected.organizationId || r.record_id !== expected.recordId
    || r.operation !== expected.operation || r.request_id !== expected.requestId) return null;
  const version = parseSalesInteger(r.version);
  return version === expected.expectedVersion + 1 ? version : null;
}
