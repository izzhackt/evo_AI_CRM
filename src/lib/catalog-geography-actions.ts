"use server";
import { isStaffPreview, staffHasPermission } from "./platform-access.ts";
import { revalidatePath, revalidateTag } from "next/cache";
import { requirePlatformStaffActor } from "./platform-guards";
import { STUDENT_UNIVERSITY_INDEX_TAG } from "./portal/university-index-tag.ts";
import { COST_STATUSES, exactCityInput, exactCostInput, fxInput } from "./catalog-geography.ts";
import { exactActionStringFields } from "./server/action-form-fields";
import { createSupabaseServerClient } from "./supabase/server";

/**
 * Команды редактора географии и стоимости CRM (план 7.5, контракт
 * docs/catalog/geography-costs-contract.md раздел 3). Одно действие на семь
 * RPC 283: форма шлёт `operation`, `request_id` и строгий JSON `payload`.
 * Организация берётся из сессии, не из формы; решает RPC, здесь только
 * ранний отказ и проверка квитанции. После подтверждённой квитанции CRM и
 * кабинет перечитываются, тег индекса студента сбрасывается сразу.
 */
export type GeographyOperation = "city_upsert" | "city_publish" | "institution_city_set" | "cost_upsert" | "cost_confirm" | "cost_publish" | "fx_rate_set";
export type GeographyActionStatus = "idle" | "saved" | "invalid" | "forbidden" | "stale" | "request_conflict" | "rejected" | "unavailable";
export type GeographyActionState = Readonly<{ status: GeographyActionStatus; requestId: string; operation: GeographyOperation | null }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CITY_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const OPERATIONS: readonly GeographyOperation[] = ["city_upsert", "city_publish", "institution_city_set", "cost_upsert", "cost_confirm", "cost_publish", "fx_rate_set"];
type Row = Record<string, unknown>;
const object = (value: unknown): Row | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? value as Row : null);
const exact = (row: Row, keys: readonly string[]) => Object.keys(row).sort().join() === [...keys].sort().join();
const version = (value: unknown, min: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= 9_007_199_254_740_989;
const cityKey = (value: unknown): value is string => typeof value === "string" && value.length >= 2 && value.length <= 64 && CITY_KEY.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

type Call = Readonly<{ rpc: string; args: Row; receipt: (data: Row) => boolean }>;
/** Строгий вход операции → вызов RPC и проверка его квитанции; null: неверный вход. */
function plan(operation: GeographyOperation, payload: Row, requestId: string, today: string, isAdmin: boolean): Call | "forbidden" | null {
  const keys = (data: Row, list: string) => Object.keys(data).sort().join() === list && data.requestId === requestId;
  switch (operation) {
    case "city_upsert": {
      if (!exact(payload, ["city", "baseVersion"]) || !version(payload.baseVersion, 0)) return null;
      const city = exactCityInput(payload.city, today);
      if (!city) return null;
      return { rpc: "staff_catalog_city_upsert_v1", args: { p_city: city, p_base_version: payload.baseVersion },
        receipt: (data) => keys(data, "cityKey,requestId,status,version") && data.cityKey === city.key && version(data.version, 1) && (data.status === "draft" || data.status === "published") };
    }
    case "city_publish": {
      if (!exact(payload, ["cityKey", "published", "baseVersion"]) || !cityKey(payload.cityKey) || typeof payload.published !== "boolean" || !version(payload.baseVersion, 1)) return null;
      const published = payload.published;
      return { rpc: "staff_catalog_city_publish_v1", args: { p_city_key: payload.cityKey, p_published: published, p_base_version: payload.baseVersion },
        receipt: (data) => keys(data, "cityKey,requestId,status,version") && data.cityKey === payload.cityKey && version(data.version, 1) && data.status === (published ? "published" : "draft") };
    }
    case "institution_city_set": {
      if (!exact(payload, ["institutionId", "cityKey"]) || !uuid(payload.institutionId) || !(payload.cityKey === null || cityKey(payload.cityKey))) return null;
      return { rpc: "staff_catalog_institution_city_set_v1", args: { p_institution_id: payload.institutionId, p_city_key: payload.cityKey },
        receipt: (data) => keys(data, "cityKey,institutionId,requestId") && data.institutionId === payload.institutionId && data.cityKey === payload.cityKey };
    }
    case "cost_upsert": {
      if (!exact(payload, ["cost", "baseVersion"]) || !version(payload.baseVersion, 0)) return null;
      const cost = exactCostInput(payload.cost, null, today);
      if (!cost || (cost.id === null) !== (payload.baseVersion === 0)) return null;
      return { rpc: "staff_catalog_cost_upsert_v1", args: { p_cost: cost, p_base_version: payload.baseVersion },
        receipt: (data) => keys(data, "costId,requestId,status,version") && uuid(data.costId) && (cost.id === null || data.costId === cost.id) && version(data.version, 1) && data.status === "draft" };
    }
    case "cost_confirm": {
      // Подтверждение строк агентств: только системный Admin; RPC проверяет то же.
      if (!isAdmin) return "forbidden";
      const reason = typeof payload.reason === "string" ? payload.reason : "";
      if (!exact(payload, ["costId", "baseVersion", "reason"]) || !uuid(payload.costId) || !version(payload.baseVersion, 1)
        || !reason || reason !== reason.trim() || [...reason].length > 500 || /[\u0000-\u001f\u007f]/.test(reason)) return null;
      return { rpc: "staff_catalog_cost_confirm_v1", args: { p_cost_id: payload.costId, p_base_version: payload.baseVersion, p_reason: reason },
        receipt: (data) => keys(data, "confirmedOn,costId,requestId,status,version") && data.costId === payload.costId && version(data.version, 1) && typeof data.confirmedOn === "string" };
    }
    case "cost_publish": {
      if (!exact(payload, ["costId", "status", "baseVersion"]) || !uuid(payload.costId) || !COST_STATUSES.includes(payload.status as never) || !version(payload.baseVersion, 1)) return null;
      return { rpc: "staff_catalog_cost_publish_v1", args: { p_cost_id: payload.costId, p_status: payload.status, p_base_version: payload.baseVersion },
        receipt: (data) => keys(data, "costId,requestId,status,version") && data.costId === payload.costId && version(data.version, 1) && data.status === payload.status };
    }
    case "fx_rate_set": {
      if (!exact(payload, ["currency", "asOf", "unitsPerUsd", "sourceName", "sourceUrl"]) || typeof payload.unitsPerUsd !== "number"
        || ![payload.currency, payload.asOf, payload.sourceName].every((item) => typeof item === "string") || !(payload.sourceUrl === null || typeof payload.sourceUrl === "string")) return null;
      const { input, errors } = fxInput({ currency: payload.currency as string, asOf: payload.asOf as string, unitsPerUsd: String(payload.unitsPerUsd), sourceName: payload.sourceName as string, sourceUrl: (payload.sourceUrl as string | null) ?? "" }, today);
      if (errors.size || input.currency !== payload.currency || input.sourceName !== payload.sourceName || input.sourceUrl !== payload.sourceUrl || input.unitsPerUsd !== payload.unitsPerUsd) return null;
      return { rpc: "staff_catalog_fx_rate_set_v1", args: { p_currency: input.currency, p_as_of: input.asOf, p_units_per_usd: input.unitsPerUsd, p_source_name: input.sourceName, p_source_url: input.sourceUrl, p_actor_membership_id: null },
        receipt: (data) => keys(data, "asOf,currency,requestId,unitsPerUsd") && data.currency === input.currency && data.asOf === input.asOf && Number(data.unitsPerUsd) === input.unitsPerUsd };
    }
  }
}

const STATUS_BY_CODE: Readonly<Record<string, GeographyActionStatus>> = { "42501": "forbidden", "22023": "invalid", "23505": "request_conflict", "40001": "stale", "23514": "rejected" };

export async function mutateCatalogGeographyAction(previous: GeographyActionState, form: FormData): Promise<GeographyActionState> {
  const actor = await requirePlatformStaffActor();
  let requestId = previous.requestId;
  let operation: GeographyOperation | null = previous.operation;
  const result = (status: GeographyActionStatus): GeographyActionState => ({ status, requestId, operation });
  if (!staffHasPermission(actor, "catalog.import.manage") || isStaffPreview(actor)) return result("forbidden");
  const fields = exactActionStringFields(form, ["operation", "request_id", "payload"]);
  if (!fields || !uuid(fields.get("request_id")) || !OPERATIONS.includes(fields.get("operation") as GeographyOperation)) return result("invalid");
  requestId = fields.get("request_id")!;
  operation = fields.get("operation") as GeographyOperation;
  const raw = fields.get("payload")!;
  let payload: Row | null = null;
  try { payload = raw.length <= 20_000 ? object(JSON.parse(raw)) : null; } catch { payload = null; }
  if (!payload) return result("invalid");
  // Как SQL current_date: день по UTC.
  const call = plan(operation, payload, requestId, new Date().toISOString().slice(0, 10), actor.systemRole === "admin");
  if (call === "forbidden") return result("forbidden");
  if (!call) return result("invalid");
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc(call.rpc, { ...call.args, p_organization_id: actor.organizationId, p_request_id: requestId });
    if (error) return result(STATUS_BY_CODE[error.code ?? ""] ?? "unavailable");
    const receipt = object(data);
    if (!receipt || !call.receipt(receipt)) return result("unavailable");
  } catch {
    return result("unavailable");
  }
  // Подтверждённая запись: перечитать CRM и кабинет; индекс студента без
  // устаревшей копии (следующее чтение ждёт свежую выдачу).
  revalidatePath("/v3/universities", "layout");
  revalidatePath("/portal/universities", "layout");
  revalidateTag(STUDENT_UNIVERSITY_INDEX_TAG, { expire: 0 });
  return result("saved");
}
