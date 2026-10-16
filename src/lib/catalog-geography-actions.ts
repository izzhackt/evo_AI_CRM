"use server";
import { isStaffPreview, staffHasPermission } from "./platform-access.ts";
import { revalidatePath, revalidateTag } from "next/cache";
import { requirePlatformStaffActor } from "./platform-guards";
import { STUDENT_UNIVERSITY_INDEX_TAG } from "./portal/university-index-tag.ts";
import { catalogText } from "./catalog-text.ts";
import {
  COST_STATUSES, exactCityInput, exactCostInput, fxInput, geographyRefusal,
  type GeographyActionStatus, type GeographyOperation, type GeographyRefusal,
} from "./catalog-geography.ts";
import { exactActionStringFields } from "./server/action-form-fields";
import { createSupabaseServerClient } from "./supabase/server";

/**
 * Команды редактора географии и стоимости CRM (план 7.5, контракт
 * docs/catalog/geography-costs-contract.md раздел 3). Одно действие на семь
 * RPC 283: форма шлёт `operation`, `request_id` и строгий JSON `payload`.
 * Организация берётся из сессии, не из формы; решает RPC, здесь только
 * ранний отказ и проверка квитанции. После подтверждённой квитанции CRM и
 * кабинет перечитываются; тег индекса студента сбрасывается только после
 * записи, которая меняет индекс (контракт 2.4, review CRM R7). Отказ базы
 * приходит статусом и, если он известен, причиной из закрытого списка;
 * текст ошибки базы наружу не уходит.
 */
export type { GeographyActionStatus, GeographyOperation, GeographyRefusal };
export type GeographyActionState = Readonly<{ status: GeographyActionStatus; requestId: string; operation: GeographyOperation | null; reason: GeographyRefusal | null }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CITY_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const OPERATIONS: readonly GeographyOperation[] = ["city_upsert", "city_publish", "institution_city_set", "cost_upsert", "cost_confirm", "cost_publish", "fx_rate_set"];
type Row = Record<string, unknown>;
const object = (value: unknown): Row | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? value as Row : null);
const exact = (row: Row, keys: readonly string[]) => Object.keys(row).sort().join() === [...keys].sort().join();
const version = (value: unknown, min: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= 9_007_199_254_740_989;
const cityKey = (value: unknown): value is string => typeof value === "string" && value.length >= 2 && value.length <= 64 && CITY_KEY.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/**
 * `index`: запись меняет индекс студента (контракт 2.4: опубликованный город,
 * публикация, связь вуза с городом, появление или снятие опубликованной
 * стоимости). Черновик города, новая строка (всегда черновик), подтверждение
 * агентства и курс валюты индекс не меняют.
 */
type Call = Readonly<{ rpc: string; args: Row; receipt: (data: Row) => boolean; index: (data: Row) => boolean }>;
/** Строгий вход операции → вызов RPC и проверка его квитанции; null: неверный вход. */
function plan(operation: GeographyOperation, payload: Row, requestId: string, today: string, isAdmin: boolean): Call | "forbidden" | null {
  const keys = (data: Row, list: string) => Object.keys(data).sort().join() === list && data.requestId === requestId;
  switch (operation) {
    case "city_upsert": {
      if (!exact(payload, ["city", "baseVersion"]) || !version(payload.baseVersion, 0)) return null;
      const city = exactCityInput(payload.city, today);
      if (!city) return null;
      return { rpc: "staff_catalog_city_upsert_v1", args: { p_city: city, p_base_version: payload.baseVersion },
        receipt: (data) => keys(data, "cityKey,requestId,status,version") && data.cityKey === city.key && version(data.version, 1) && (data.status === "draft" || data.status === "published"),
        index: (data) => data.status === "published" };
    }
    case "city_publish": {
      if (!exact(payload, ["cityKey", "published", "baseVersion"]) || !cityKey(payload.cityKey) || typeof payload.published !== "boolean" || !version(payload.baseVersion, 1)) return null;
      const published = payload.published;
      return { rpc: "staff_catalog_city_publish_v1", args: { p_city_key: payload.cityKey, p_published: published, p_base_version: payload.baseVersion },
        receipt: (data) => keys(data, "cityKey,requestId,status,version") && data.cityKey === payload.cityKey && version(data.version, 1) && data.status === (published ? "published" : "draft"),
        index: () => true };
    }
    case "institution_city_set": {
      if (!exact(payload, ["institutionId", "cityKey"]) || !uuid(payload.institutionId) || !(payload.cityKey === null || cityKey(payload.cityKey))) return null;
      return { rpc: "staff_catalog_institution_city_set_v1", args: { p_institution_id: payload.institutionId, p_city_key: payload.cityKey },
        receipt: (data) => keys(data, "cityKey,institutionId,requestId") && data.institutionId === payload.institutionId && data.cityKey === payload.cityKey,
        index: () => true };
    }
    case "cost_upsert": {
      if (!exact(payload, ["cost", "baseVersion"]) || !version(payload.baseVersion, 0)) return null;
      const cost = exactCostInput(payload.cost, null, today);
      if (!cost || (cost.id === null) !== (payload.baseVersion === 0)) return null;
      return { rpc: "staff_catalog_cost_upsert_v1", args: { p_cost: cost, p_base_version: payload.baseVersion },
        receipt: (data) => keys(data, "costId,requestId,status,version") && uuid(data.costId) && (cost.id === null || data.costId === cost.id) && version(data.version, 1) && data.status === "draft",
        // Правка существующей строки возвращает её в черновик: опубликованная могла быть последней у вуза.
        index: () => cost.id !== null };
    }
    case "cost_confirm": {
      // Подтверждение строк агентств: только системный Admin; RPC проверяет то же.
      if (!isAdmin) return "forbidden";
      const reason = payload.reason;
      if (!exact(payload, ["costId", "baseVersion", "reason"]) || !uuid(payload.costId) || !version(payload.baseVersion, 1) || !catalogText(reason, 500)) return null;
      return { rpc: "staff_catalog_cost_confirm_v1", args: { p_cost_id: payload.costId, p_base_version: payload.baseVersion, p_reason: reason },
        receipt: (data) => keys(data, "confirmedOn,costId,requestId,status,version") && data.costId === payload.costId && version(data.version, 1) && typeof data.confirmedOn === "string",
        index: () => false };
    }
    case "cost_publish": {
      if (!exact(payload, ["costId", "status", "baseVersion"]) || !uuid(payload.costId) || !COST_STATUSES.includes(payload.status as never) || !version(payload.baseVersion, 1)) return null;
      return { rpc: "staff_catalog_cost_publish_v1", args: { p_cost_id: payload.costId, p_status: payload.status, p_base_version: payload.baseVersion },
        receipt: (data) => keys(data, "costId,requestId,status,version") && data.costId === payload.costId && version(data.version, 1) && data.status === payload.status,
        index: () => true };
    }
    case "fx_rate_set": {
      if (!exact(payload, ["currency", "asOf", "unitsPerUsd", "sourceName", "sourceUrl"]) || typeof payload.unitsPerUsd !== "number"
        || ![payload.currency, payload.asOf, payload.sourceName].every((item) => typeof item === "string") || !(payload.sourceUrl === null || typeof payload.sourceUrl === "string")) return null;
      const { input, errors } = fxInput({ currency: payload.currency as string, asOf: payload.asOf as string, unitsPerUsd: String(payload.unitsPerUsd), sourceName: payload.sourceName as string, sourceUrl: (payload.sourceUrl as string | null) ?? "" }, today);
      if (errors.size || input.currency !== payload.currency || input.sourceName !== payload.sourceName || input.sourceUrl !== payload.sourceUrl || input.unitsPerUsd !== payload.unitsPerUsd) return null;
      return { rpc: "staff_catalog_fx_rate_set_v1", args: { p_currency: input.currency, p_as_of: input.asOf, p_units_per_usd: input.unitsPerUsd, p_source_name: input.sourceName, p_source_url: input.sourceUrl, p_actor_membership_id: null },
        receipt: (data) => keys(data, "asOf,currency,requestId,unitsPerUsd") && data.currency === input.currency && data.asOf === input.asOf && Number(data.unitsPerUsd) === input.unitsPerUsd,
        index: () => false };
    }
  }
}

const STATUS_BY_CODE: Readonly<Record<string, GeographyActionStatus>> = { "42501": "forbidden", "22023": "invalid", "23505": "request_conflict", "40001": "stale", "23514": "rejected" };
/** Отказ RPC: статус по SQLSTATE и причина из закрытого списка 283 (контракт 3.5). */
function refusal(operation: GeographyOperation, payload: Row, code: string | undefined, message: string | undefined,
  result: (status: GeographyActionStatus, reason?: GeographyRefusal | null) => GeographyActionState): GeographyActionState {
  const status = STATUS_BY_CODE[code ?? ""] ?? "unavailable";
  if (status === "unavailable") return result(status);
  // Новый город с занятым ключом: RPC видит чужую версию (40001), это не гонка правок.
  if (operation === "city_upsert" && status === "stale" && payload.baseVersion === 0) return result("invalid", "city_exists");
  const reason = geographyRefusal(message);
  // Уникальность названия города в стране это 23505, но не повтор запроса.
  return result(reason === "duplicate_city_name" ? "invalid" : status, reason);
}

export async function mutateCatalogGeographyAction(previous: GeographyActionState, form: FormData): Promise<GeographyActionState> {
  const actor = await requirePlatformStaffActor();
  let requestId = previous.requestId;
  let operation: GeographyOperation | null = previous.operation;
  const result = (status: GeographyActionStatus, reason: GeographyRefusal | null = null): GeographyActionState => ({ status, requestId, operation, reason });
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
  let receipt: Row | null;
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc(call.rpc, { ...call.args, p_organization_id: actor.organizationId, p_request_id: requestId });
    if (error) return refusal(operation, payload, error.code, error.message, result);
    receipt = object(data);
    if (!receipt || !call.receipt(receipt)) return result("unavailable");
  } catch {
    return result("unavailable");
  }
  // Подтверждённая запись: перечитать CRM и кабинет; индекс студента без
  // устаревшей копии (следующее чтение ждёт свежую выдачу), только если
  // запись его меняет.
  revalidatePath("/v3/universities", "layout");
  revalidatePath("/portal/universities", "layout");
  if (call.index(receipt)) revalidateTag(STUDENT_UNIVERSITY_INDEX_TAG, { expire: 0 });
  return result("saved");
}
