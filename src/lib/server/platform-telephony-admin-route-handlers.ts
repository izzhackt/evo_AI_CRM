import "server-only";

import { isStaffPreview, staffCanAccessRoute, staffHasPermission } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import { isTelephonyPatchShape, type TelephonyPatch } from "../v3/telephony-settings.ts";
import { failure, json, readJsonObject, sameOrigin } from "./ai-agent-route-handlers.ts";
import {
  mapTelephonyExtension,
  saveTelephonySettings,
  type TelephonyMapResult,
  type TelephonySaveResult,
} from "./platform-telephony-admin.ts";

/**
 * Команды «Настроек → Телефония» (план телефонии §6.4, §11, §12; срез T4b):
 *
 *  - `POST /api/v3/telephony/settings` — `{requestId, expectedVersion, patch}`:
 *    правка настроек одним патчем (`telephony_settings_save_v1`, миграция 295);
 *  - `POST /api/v3/telephony/extensions` — `{requestId, extensionId,
 *    previousMembershipId, membershipId}`: сопоставление пользователя ВАТС и
 *    сотрудника EVO (`telephony_extension_map_v1`), человек подтверждает то, что
 *    видел на экране.
 *
 * Оба маршрута: `sameOrigin` (403), сессия сотрудника (401), не просмотр роли
 * (403), право `telephony.manage` и доступ к «Настройкам» (403) — и только
 * потом база, которая повторяет право и решает остальное. Тело — небольшой
 * JSON с точным набором ключей. В ответе — квитанция без значений env, ключей,
 * логинов и номеров.
 */

type Authorization =
  | Readonly<{ status: "authorized"; actor: ActivePlatformActor }>
  | Readonly<{ status: "anonymous" | "forbidden" | "preview" | "unavailable"; actor: null }>;

export type TelephonyAdminRouteDependencies = Readonly<{
  authorize(): Promise<Authorization>;
  save(actor: ActivePlatformActor, input: Parameters<typeof saveTelephonySettings>[1]): Promise<TelephonySaveResult>;
  map(actor: ActivePlatformActor, input: Parameters<typeof mapTelephonyExtension>[1]): Promise<TelephonyMapResult>;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

async function defaultAuthorize(): Promise<Authorization> {
  const { resolvePlatformActor } = await import("../platform-auth.ts");
  const result = await resolvePlatformActor();
  if (result.status === "anonymous") return { status: "anonymous", actor: null };
  if (result.status === "invalid") return { status: "unavailable", actor: null };
  // Просмотр роли — только вид экрана: настройки он не меняет.
  if (isStaffPreview(result.actor)) return { status: "preview", actor: null };
  if (!staffHasPermission(result.actor, "telephony.manage") || !staffCanAccessRoute(result.actor, "/v3/settings")) {
    return { status: "forbidden", actor: null };
  }
  return { status: "authorized", actor: result.actor };
}

const defaultDependencies: TelephonyAdminRouteDependencies = {
  authorize: defaultAuthorize,
  save: (actor, input) => saveTelephonySettings(actor, input),
  map: (actor, input) => mapTelephonyExtension(actor, input),
};

function refusal(status: Exclude<Authorization["status"], "authorized">): Response {
  if (status === "anonymous") return failure(401, "authentication_required");
  if (status === "preview") return failure(403, "preview");
  if (status === "forbidden") return failure(403, "forbidden");
  return failure(503, "unavailable");
}

const uuidOrNull = (value: unknown): string | null => (typeof value === "string" && UUID.test(value) ? value : null);
/** `null` — осознанное «никого»; `undefined` — не UUID и не `null`. */
const optionalUuid = (value: unknown): string | null | undefined => (value === null ? null : (uuidOrNull(value) ?? undefined));

function failed(result: Extract<TelephonySaveResult | TelephonyMapResult, { status: "failed" }>): Response {
  return failure(result.http, result.code, result.constraint ? { constraint: result.constraint } : {});
}

/** `POST /api/v3/telephony/settings`. */
export function createTelephonySettingsHandler(dependencies: TelephonyAdminRouteDependencies = defaultDependencies) {
  return async function POST(request: Request): Promise<Response> {
    try {
      if (!sameOrigin(request)) return failure(403, "forbidden");
      const authorization = await dependencies.authorize();
      if (authorization.status !== "authorized") return refusal(authorization.status);
      const body = await readJsonObject(request, ["requestId", "expectedVersion", "patch"], 4096);
      const requestId = body ? uuidOrNull(body.requestId) : null;
      const version = body?.expectedVersion;
      if (!body || !requestId || typeof version !== "number" || !Number.isSafeInteger(version) || version < 1
        || !isTelephonyPatchShape(body.patch) || new URL(request.url).search !== "") {
        return failure(400, "invalid_request");
      }
      const result = await dependencies.save(authorization.actor, {
        requestId, expectedVersion: version, patch: body.patch as TelephonyPatch,
      });
      if (result.status === "ok") return json(200, { receipt: result.receipt });
      return failed(result);
    } catch {
      return failure(503, "unavailable");
    }
  };
}

/** `POST /api/v3/telephony/extensions`. */
export function createTelephonyExtensionHandler(dependencies: TelephonyAdminRouteDependencies = defaultDependencies) {
  return async function POST(request: Request): Promise<Response> {
    try {
      if (!sameOrigin(request)) return failure(403, "forbidden");
      const authorization = await dependencies.authorize();
      if (authorization.status !== "authorized") return refusal(authorization.status);
      const body = await readJsonObject(request, ["requestId", "extensionId", "previousMembershipId", "membershipId"], 1024);
      const requestId = body ? uuidOrNull(body.requestId) : null;
      const extensionId = body ? uuidOrNull(body.extensionId) : null;
      const previous = optionalUuid(body?.previousMembershipId);
      const next = optionalUuid(body?.membershipId);
      if (!body || !requestId || !extensionId || previous === undefined || next === undefined
        || new URL(request.url).search !== "") {
        return failure(400, "invalid_request");
      }
      const result = await dependencies.map(authorization.actor, {
        requestId, extensionId, previousMembershipId: previous, membershipId: next,
      });
      if (result.status === "ok") return json(200, { receipt: result.receipt });
      return failed(result);
    } catch {
      return failure(503, "unavailable");
    }
  };
}
