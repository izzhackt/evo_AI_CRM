import "server-only";

import { PRODUCTION_STAFF_ORIGIN } from "../platform-public-origin.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import { staffHasPermission } from "../platform-access.ts";
import type { TelephonyIntegrationFacts, TelephonyServerFacts } from "../v3/telephony-health.ts";
import {
  normalizeTelephonyOverview,
  normalizeTelephonyMapReceipt,
  normalizeTelephonySaveReceipt,
  type TelephonyMapReceipt,
  type TelephonyOverview,
  type TelephonyPatch,
  type TelephonySaveReceipt,
} from "../v3/telephony-settings.ts";
import { isPlatformTelephonyEnabled, readPlatformTelephonyCrmTokens } from "./platform-telephony-ingress-config.ts";
import { readPlatformTelephonyPbxConfig } from "./platform-telephony-pbx-config.ts";

/**
 * Чтение и правка «Настроек → Телефония» (план телефонии §12, срез T4b). Три
 * функции базы (миграция 295) вызываются сессией сотрудника; право
 * `telephony.manage` каждая проверяет сама, а страница и маршруты повторяют его
 * до обращения. Из окружения сервера берутся только факты «задан/не задан/
 * неверен» и «приём включён»: ключи, адреса и значения env сюда не попадают.
 */

/** Адрес приёма, который вносят в кабинет ВАТС («Адрес вашей CRM», план §5.6). */
export const TELEPHONY_INBOUND_URL = `${PRODUCTION_STAFF_ORIGIN}/api/v2/telephony/beeline/inbound`;

export function readTelephonyServerFacts(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): TelephonyServerFacts {
  const tokens = readPlatformTelephonyCrmTokens(environment);
  const pbx = readPlatformTelephonyPbxConfig(environment);
  return Object.freeze({
    ingestEnabled: isPlatformTelephonyEnabled(environment),
    crmKey: tokens === null ? "missing" : "configured",
    crmKeyRotating: tokens?.next != null,
    pbx: pbx.status,
  });
}

export type TelephonyAdminRead =
  | Readonly<{ status: "ready"; overview: TelephonyOverview; server: TelephonyServerFacts; inboundUrl: string }>
  | Readonly<{ status: "unavailable"; server: TelephonyServerFacts }>
  | Readonly<{ status: "forbidden" }>;

type RpcError = Readonly<{ code?: string; message?: string; details?: string }>;
export type TelephonyRpc = (name: string, args: Readonly<Record<string, unknown>>) => Promise<Readonly<{ data: unknown; error: RpcError | null }>>;

async function sessionRpc(): Promise<TelephonyRpc> {
  const { createSupabaseServerClient } = await import("../supabase/server.ts");
  const schema = (await createSupabaseServerClient()).schema("platform");
  return async (name, args) => {
    const { data, error } = await schema.rpc(name, args as Record<string, unknown>);
    return { data, error: error ? { code: error.code, message: error.message, details: error.details } : null };
  };
}

/** Экран «Телефония»: настройки, здоровье, пользователи ВАТС и сотрудники — одним чтением базы. */
export async function readTelephonyAdmin(
  actor: ActivePlatformActor,
  dependencies: Readonly<{ rpc?: TelephonyRpc; environment?: Readonly<Record<string, string | undefined>> }> = {},
): Promise<TelephonyAdminRead> {
  const server = readTelephonyServerFacts(dependencies.environment);
  if (!staffHasPermission(actor, "telephony.manage")) return { status: "forbidden" };
  try {
    const rpc = dependencies.rpc ?? (await sessionRpc());
    const { data, error } = await rpc("telephony_manage_overview_v1", { p_organization_id: actor.organizationId });
    if (error) return error.code === "42501" ? { status: "forbidden" } : { status: "unavailable", server };
    const overview = normalizeTelephonyOverview(data);
    return overview ? { status: "ready", overview, server, inboundUrl: TELEPHONY_INBOUND_URL } : { status: "unavailable", server };
  } catch {
    return { status: "unavailable", server };
  }
}

/**
 * Факты для строки «Телефония» таблицы «Интеграции»: прочитано — как есть, база не
 * ответила — «нет данных» (`overview: null`), права нет или чтения не было — строки нет.
 */
export function telephonyIntegrationFactsFrom(read: TelephonyAdminRead | null): TelephonyIntegrationFacts | undefined {
  if (read === null || read.status === "forbidden") return undefined;
  return read.status === "ready" ? { server: read.server, overview: read.overview } : { server: read.server, overview: null };
}

/** Результат команды: слово для маршрута, а не текст базы. */
export type TelephonyCommandFailure = Readonly<{
  status: "failed";
  http: 403 | 404 | 409 | 412 | 422 | 503;
  code: string;
  constraint?: string;
}>;
export type TelephonySaveResult = Readonly<{ status: "ok"; receipt: TelephonySaveReceipt }> | TelephonyCommandFailure;
export type TelephonyMapResult = Readonly<{ status: "ok"; receipt: TelephonyMapReceipt }> | TelephonyCommandFailure;

const SETTINGS_CONSTRAINT = /^telephony_settings_[a-z0-9_]{1,60}$/u;

/**
 * Ошибка функции базы → слово маршрута. Семантику несёт `message` (код вида
 * `telephony_…`, без значений), SQLSTATE — класс.
 */
export function telephonyCommandFailure(error: RpcError): TelephonyCommandFailure {
  const message = typeof error.message === "string" ? error.message : "";
  if (error.code === "42501") return { status: "failed", http: 403, code: "forbidden" };
  if (error.code === "P0002") return { status: "failed", http: 404, code: "not_found" };
  if (error.code === "23505") return { status: "failed", http: 409, code: "request_conflict" };
  if (error.code === "PT409") {
    if (message === "telephony_membership_taken") return { status: "failed", http: 409, code: "membership_taken" };
    if (message === "telephony_mapping_changed") return { status: "failed", http: 409, code: "mapping_changed" };
    return { status: "failed", http: 409, code: "version_conflict" };
  }
  if (error.code === "PT412") {
    if (message === "telephony_extension_inactive") return { status: "failed", http: 412, code: "extension_inactive" };
    return { status: "failed", http: 412, code: "projection_required" };
  }
  if (error.code === "22023") {
    if (message === "telephony_escalation_invalid") return { status: "failed", http: 422, code: "escalation_invalid" };
    if (message === "telephony_membership_invalid") return { status: "failed", http: 422, code: "membership_invalid" };
    const detail = typeof error.details === "string" ? error.details : "";
    return SETTINGS_CONSTRAINT.test(detail)
      ? { status: "failed", http: 422, code: "settings_invalid", constraint: detail }
      : { status: "failed", http: 422, code: "settings_invalid" };
  }
  return { status: "failed", http: 503, code: "unavailable" };
}

export async function saveTelephonySettings(
  actor: ActivePlatformActor,
  input: Readonly<{ requestId: string; expectedVersion: number; patch: TelephonyPatch }>,
  rpc?: TelephonyRpc,
): Promise<TelephonySaveResult> {
  try {
    const call = rpc ?? (await sessionRpc());
    const { data, error } = await call("telephony_settings_save_v1", {
      p_organization_id: actor.organizationId,
      p_expected_version: input.expectedVersion,
      p_patch: input.patch,
      p_request_id: input.requestId,
    });
    if (error) return telephonyCommandFailure(error);
    const receipt = normalizeTelephonySaveReceipt(data);
    return receipt ? { status: "ok", receipt } : { status: "failed", http: 503, code: "unavailable" };
  } catch {
    return { status: "failed", http: 503, code: "unavailable" };
  }
}

export async function mapTelephonyExtension(
  actor: ActivePlatformActor,
  input: Readonly<{ requestId: string; extensionId: string; previousMembershipId: string | null; membershipId: string | null }>,
  rpc?: TelephonyRpc,
): Promise<TelephonyMapResult> {
  try {
    const call = rpc ?? (await sessionRpc());
    const { data, error } = await call("telephony_extension_map_v1", {
      p_organization_id: actor.organizationId,
      p_extension_id: input.extensionId,
      p_previous_membership_id: input.previousMembershipId,
      p_membership_id: input.membershipId,
      p_request_id: input.requestId,
    });
    if (error) return telephonyCommandFailure(error);
    const receipt = normalizeTelephonyMapReceipt(data);
    return receipt ? { status: "ok", receipt } : { status: "failed", http: 503, code: "unavailable" };
  } catch {
    return { status: "failed", http: 503, code: "unavailable" };
  }
}
