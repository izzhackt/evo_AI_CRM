import "server-only";

import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import type { ActivePlatformActor, PlatformActorResult } from "../platform-auth.ts";
import { parsePlatformRouteUuid } from "../platform-communications.ts";
import type { DialFailureReason, DialRefusalCode } from "../v3/telephony-dial.ts";
import { failure, json, readJsonObject, sameOrigin } from "./ai-agent-route-handlers.ts";
import {
  createTelephonyPbxClient,
  TelephonyPbxError,
  type TelephonyPbxClient,
  type TelephonyPbxErrorCode,
} from "./platform-telephony-pbx-client.ts";
import {
  readPlatformTelephonyPbxConfig,
  type PlatformTelephonyPbxConfig,
  type PlatformTelephonyPbxConfigState,
} from "./platform-telephony-pbx-config.ts";

/**
 * «Позвонить» («Телефония Beeline KG», срез T7; план §5.4, §6.5, §8, §12; миграция 299):
 * `POST /api/v3/telephony/dial` с `{leadId, requestId}`. Браузер присылает идентификатор лида
 * и свой `requestId`, а НЕ номер: номер берётся на сервере из карточки клиента, и его знает
 * только эта цепочка (база → сервер → ВАТС), но не браузер, не ответ и не журнал приложения.
 *
 * Порядок (каждый шаг отказывает раньше следующего):
 *  1. `sameOrigin` (403), сессия сотрудника (401), просмотр роли (403 `preview`: набор пишет в
 *     журнал и тратит деньги), право `telephony.call.dial` (403);
 *  2. тело — ровно два ключа, UUID, пустая строка запроса (400);
 *  3. подключение ВАТС настроено (503 `not_configured`: без ключа звонить некуда, и набор не
 *     создаётся и в журнал не пишется);
 *  4. `telephony_dial_begin_v1` под сессией сотрудника — ВСЕ проверки в базе: флаги, право,
 *     повтор `requestId` (прежний результат, второго звонка нет), видимость лида, номер,
 *     разрешённые префиксы, запрещённые диапазоны, сопоставление с пользователем ВАТС, лимиты.
 *     Отказ → 409/422/429 `dial_refused` с кодом причины (он уже записан);
 *  5. `telephony_dial_target_v1` служебным ключом: логин ВАТС и номер этого набора;
 *  6. живой статус сотрудника (`GET /users/{login}?with=status`, без повторов, 5 с): нет в сети
 *     и нет переадресации на мобильный — отказ `pbx_offline`, клиенту не звонят;
 *  7. `POST /makecall` — ОДНА попытка, без повторов: двойной звонок опаснее потерянного. Ответ
 *     с `callid` — `sent`; всё, после чего звонок мог уйти, — `unconfirmed` («Проверьте
 *     телефон»): 2xx без `callid`, 2xx с оборванным или нечитаемым телом, таймаут, обрыв и
 *     ответ 5xx (шлюз или ВАТС могут ответить уже после начала набора); ответ 4xx (включая
 *     429) — `failed`: звонок не создан;
 *  8. `telephony_dial_finish_v1` записывает итог и одну строку журнала `telephony.dial`.
 *
 * Сбой записи итога после звонка ответа не меняет: пользователь получает то, что на самом деле
 * сказала ВАТС. Строка набора без итога остаётся `requested` и считается в лимитах; в
 * `unconfirmed` (`finish_lost`) её переводит только повтор того же `requestId` через две минуты
 * (кнопка повторяет id лишь после обрыва связи), поэтому после `begin` итог пишется на КАЖДОМ
 * пути, в том числе при сбое `target`. В журнал приложения идут только слова и числа (статус,
 * причина, миллисекунды): ни номера, ни логина, ни `callid`, ни идентификаторов.
 */
type Authorization =
  | Readonly<{ status: "authorized"; actor: ActivePlatformActor }>
  | Readonly<{ status: "anonymous" | "forbidden" | "preview" | "unavailable"; actor: null }>;

export type DialBeginInput = Readonly<{ leadId: string; requestId: string }>;

export type DialRequestStatus = "requested" | "sent" | "unconfirmed" | "failed" | "refused";

export type DialBeginResult =
  | Readonly<{ status: "accepted"; dialRequestId: string }>
  | Readonly<{ status: "refused"; dialRequestId: string; code: string }>
  | Readonly<{ status: "replayed"; dialRequestId: string; requestStatus: DialRequestStatus; code: string | null }>
  | Readonly<{ status: "error"; kind: "forbidden" | "off" | "not_found" | "conflict" | "invalid" | "throttled" | "unavailable" }>;

export type DialTargetResult =
  | Readonly<{ status: "ready"; pbxUser: string; phone: string }>
  | Readonly<{ status: "unavailable" }>;

export type DialFinish =
  | Readonly<{ outcome: "sent"; callId: string; httpStatus: number | null }>
  | Readonly<{ outcome: "unconfirmed" | "failed"; errorCode: string; httpStatus: number | null }>
  | Readonly<{ outcome: "refused"; refusalCode: "pbx_offline" | "pbx_user_not_found" }>;

export type DialFinishResult = Readonly<{ status: "recorded" | "failed" }>;

type LogValue = string | number | boolean;
type PbxPurpose = "status" | "call";

export type TelephonyDialDependencies = Readonly<{
  authorize(): Promise<Authorization>;
  pbxConfig(): PlatformTelephonyPbxConfigState;
  /** `status` — проверка перед набором (5 с, без повторов); `call` — сам `makecall` (одна попытка). */
  pbxClient(config: PlatformTelephonyPbxConfig, purpose: PbxPurpose): TelephonyPbxClient;
  begin(actor: ActivePlatformActor, input: DialBeginInput): Promise<DialBeginResult>;
  target(actor: ActivePlatformActor, dialRequestId: string): Promise<DialTargetResult>;
  finish(actor: ActivePlatformActor, dialRequestId: string, result: DialFinish): Promise<DialFinishResult>;
  log(entry: Readonly<Record<string, LogValue>>): void;
  now(): number;
}>;

type RpcError = Readonly<{ code?: string; message?: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CODE = /^[a-z][a-z0-9_]{0,63}$/u;
const PHONE_E164 = /^\+[1-9][0-9]{8,14}$/u;
const LOGIN = /^[A-Za-z0-9._@+-]{1,128}$/u;
const REQUEST_STATUSES: readonly string[] = ["requested", "sent", "unconfirmed", "failed", "refused"];
const STATUS_CHECK_TIMEOUT_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

/** Отказ базы на начале набора → вид ошибки маршрута; текст исключения номера и логина не несёт. */
export function dialBeginRefusal(error: RpcError): DialBeginResult {
  if (error.code === "42501") return { status: "error", kind: "forbidden" };
  if (error.code === "55000") return { status: "error", kind: "off" };
  if (error.code === "P0002") return { status: "error", kind: "not_found" };
  if (error.code === "PT409") return { status: "error", kind: "conflict" };
  if (error.code === "22023") return { status: "error", kind: "invalid" };
  // Слишком много отказов подряд у одного сотрудника: база ничего не записала.
  if (error.code === "PT429") return { status: "error", kind: "throttled" };
  return { status: "error", kind: "unavailable" };
}

/** Квитанция начала набора: одна из трёх форм ровно с их ключами; другая форма — сбой. */
export function dialBeginReceipt(data: unknown): DialBeginResult {
  const unavailable: DialBeginResult = { status: "error", kind: "unavailable" };
  if (!isRecord(data) || typeof data.dialRequestId !== "string" || !UUID.test(data.dialRequestId)) return unavailable;
  if (data.status === "accepted" && exactKeys(data, ["dialRequestId", "status"])) {
    return { status: "accepted", dialRequestId: data.dialRequestId };
  }
  if (data.status === "refused" && exactKeys(data, ["code", "dialRequestId", "status"])
    && typeof data.code === "string" && CODE.test(data.code)) {
    return { status: "refused", dialRequestId: data.dialRequestId, code: data.code };
  }
  if (data.status === "replayed" && exactKeys(data, ["code", "dialRequestId", "requestStatus", "status"])
    && typeof data.requestStatus === "string" && REQUEST_STATUSES.includes(data.requestStatus)
    && (data.code === null || (typeof data.code === "string" && CODE.test(data.code)))) {
    return {
      status: "replayed",
      dialRequestId: data.dialRequestId,
      requestStatus: data.requestStatus as DialRequestStatus,
      code: data.code,
    };
  }
  return unavailable;
}

/** Квитанция `target`: ровно `{pbxUser, phone}`; номер — E.164, логин — как в справочнике ВАТС. */
export function dialTargetReceipt(data: unknown): DialTargetResult {
  if (!isRecord(data) || !exactKeys(data, ["pbxUser", "phone"])
    || typeof data.pbxUser !== "string" || !LOGIN.test(data.pbxUser)
    || typeof data.phone !== "string" || !PHONE_E164.test(data.phone)) {
    return { status: "unavailable" };
  }
  return { status: "ready", pbxUser: data.pbxUser, phone: data.phone };
}

/** Квитанция `finish`: `{status, changed}`; важно только, что запись состоялась или уже была. */
export function dialFinishReceipt(data: unknown): DialFinishResult {
  if (!isRecord(data) || !exactKeys(data, ["changed", "status"]) || typeof data.changed !== "boolean"
    || typeof data.status !== "string" || !REQUEST_STATUSES.includes(data.status)) {
    return { status: "failed" };
  }
  return { status: "recorded" };
}

/**
 * Сессия → допуск маршрута: нет входа — 401; сбой сессии — 503; просмотр роли администратором —
 * нет; нет права `telephony.call.dial` — нет. Какой лид можно, решает база.
 */
export function dialAuthorization(result: PlatformActorResult): Authorization {
  if (result.status === "anonymous") return { status: "anonymous", actor: null };
  if (result.status === "invalid") return { status: "unavailable", actor: null };
  if (isStaffPreview(result.actor)) return { status: "preview", actor: null };
  if (!staffHasPermission(result.actor, "telephony.call.dial")) return { status: "forbidden", actor: null };
  return { status: "authorized", actor: result.actor };
}

async function defaultAuthorize(): Promise<Authorization> {
  const { resolvePlatformActor } = await import("../platform-auth.ts");
  return dialAuthorization(await resolvePlatformActor());
}

function defaultLog(entry: Readonly<Record<string, LogValue>>): void {
  console.info(JSON.stringify(entry));
}

async function serviceClient() {
  const { getPlatformSupabaseBackendConfig } = await import("./platform-supabase-backend-config.ts");
  const { createPlatformSupabaseServiceClient } = await import("./platform-supabase-service-client.ts");
  return createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
}

const defaultDependencies: TelephonyDialDependencies = {
  authorize: defaultAuthorize,
  pbxConfig: () => readPlatformTelephonyPbxConfig(),
  pbxClient(config, purpose) {
    // Только счётчики попытки: ни адреса, ни ключа, ни номера (план §5.4).
    const onAttempt = (attempt: Readonly<{ operation: string; status: number | null; errorCode: string | null; durationMs: number }>) => {
      defaultLog({
        event: "telephony_pbx_attempt",
        operation: attempt.operation,
        status: attempt.status ?? 0,
        error: attempt.errorCode ?? "none",
        ms: attempt.durationMs,
      });
    };
    return purpose === "status"
      ? createTelephonyPbxClient(config, { timeoutMs: STATUS_CHECK_TIMEOUT_MS, retryDelaysMs: [], onAttempt })
      : createTelephonyPbxClient(config, { onAttempt });
  },
  async begin(actor, input) {
    const { createSupabaseServerClient } = await import("../supabase/server.ts");
    const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc(
      "telephony_dial_begin_v1",
      { p_organization_id: actor.organizationId, p_lead_id: input.leadId, p_request_id: input.requestId },
    );
    return error ? dialBeginRefusal(error) : dialBeginReceipt(data);
  },
  async target(actor, dialRequestId) {
    // Набор уже записан как `requested`: любой сбой (в том числе настройки служебного ключа)
    // здесь — «нет цели», после чего маршрут закрывает набор как `failed`, а не бросает.
    try {
      const client = await serviceClient();
      const { data, error } = await client.schema("platform").rpc("telephony_dial_target_v1", {
        p_organization_id: actor.organizationId,
        p_dial_request_id: dialRequestId,
        p_membership_id: actor.membershipId,
      });
      return error ? { status: "unavailable" } : dialTargetReceipt(data);
    } catch {
      return { status: "unavailable" };
    }
  },
  async finish(actor, dialRequestId, result) {
    try {
      const client = await serviceClient();
      const { data, error } = await client.schema("platform").rpc("telephony_dial_finish_v1", {
        p_organization_id: actor.organizationId,
        p_dial_request_id: dialRequestId,
        p_membership_id: actor.membershipId,
        p_outcome: result.outcome,
        p_pbx_callid: result.outcome === "sent" ? result.callId : null,
        p_pbx_http_status: result.outcome === "refused" ? null : result.httpStatus,
        p_error_code: result.outcome === "unconfirmed" || result.outcome === "failed" ? result.errorCode : null,
        p_refusal_code: result.outcome === "refused" ? result.refusalCode : null,
      });
      return error ? { status: "failed" } : dialFinishReceipt(data);
    } catch {
      return { status: "failed" };
    }
  },
  log: defaultLog,
  now: () => Date.now(),
};

/** Ошибка ВАТС → слово для сотрудника (какая беда, не чьи-то данные). */
export function dialFailureReason(code: TelephonyPbxErrorCode): DialFailureReason {
  switch (code) {
    case "pbx_invalid_token":
    case "pbx_crm_disabled":
    case "pbx_crm_switched_off":
    case "pbx_unauthorized":
    case "pbx_forbidden":
      return "pbx_auth";
    case "pbx_validation_error":
    case "pbx_not_found":
    case "pbx_method_not_allowed":
    case "pbx_redirect_refused":
      return "pbx_rejected";
    default:
      return "pbx_unavailable";
  }
}

/**
 * Итог неудачного `makecall`. `failed` («клиенту не звонили») — только ответ 4xx ВАТС (в том числе
 * 429 и отказ редиректа): запрос отвергнут, звонка нет. Всё остальное `unconfirmed`: запрос мог
 * дойти и звонок мог уйти, поэтому повтора нет, а пользователь проверяет телефон. Это таймаут и
 * обрыв (статуса нет), ЛЮБАЯ ошибка при ответе 2xx (тело нечитаемо, слишком велико или оборвалось
 * на чтении: ВАТС уже ответила «да»), и ответ 5xx (шлюз или ВАТС отвечают ошибкой и после начала
 * набора). Двойной звонок опаснее потерянного (план §5.4).
 */
export function classifyMakeCallError(error: unknown): Extract<DialFinish, { outcome: "unconfirmed" | "failed" }> {
  if (!(error instanceof TelephonyPbxError)) {
    return { outcome: "unconfirmed", errorCode: "pbx_network_error", httpStatus: null };
  }
  const status = error.status;
  const answered2xx = status !== null && status >= 200 && status < 300;
  const serverSide = status !== null && status >= 500;
  if (status === null || answered2xx || serverSide) {
    return { outcome: "unconfirmed", errorCode: error.code, httpStatus: status };
  }
  return { outcome: "failed", errorCode: error.code, httpStatus: status };
}

function refusalResponse(code: string): Response {
  const known = code as DialRefusalCode;
  switch (known) {
    case "rate_gap":
    case "limit_user_day":
    case "limit_org_hour":
    case "limit_org_day":
      return failure(429, "dial_refused", { reason: code });
    case "lead_no_phone":
    case "number_invalid":
    case "prefix_not_allowed":
    case "number_blocked":
      return failure(422, "dial_refused", { reason: code });
    default:
      return failure(409, "dial_refused", { reason: code });
  }
}

function pbxFailedResponse(code: string): Response {
  const reason = dialFailureReason(code as TelephonyPbxErrorCode);
  return failure(502, "pbx_failed", { reason });
}

function authorizationRefusal(status: Exclude<Authorization["status"], "authorized">): Response {
  if (status === "anonymous") return failure(401, "authentication_required");
  if (status === "preview") return failure(403, "preview");
  if (status === "forbidden") return failure(403, "forbidden");
  return failure(503, "unavailable");
}

export function createTelephonyDialHandler(dependencies: TelephonyDialDependencies = defaultDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const started = dependencies.now();
    const finish = (response: Response, reason: string): Response => {
      try {
        dependencies.log({ event: "telephony_dial", status: response.status, reason, ms: Math.max(0, dependencies.now() - started) });
      } catch {
        // Журнал приложения никогда не меняет ответ.
      }
      return response;
    };
    try {
      if (!sameOrigin(request)) return finish(failure(403, "forbidden"), "cross_origin");
      const authorization = await dependencies.authorize();
      if (authorization.status !== "authorized") {
        return finish(authorizationRefusal(authorization.status), `auth_${authorization.status}`);
      }
      const actor = authorization.actor;

      const body = await readJsonObject(request, ["leadId", "requestId"]);
      const leadId = body ? parsePlatformRouteUuid(body.leadId) : null;
      const requestId = body ? parsePlatformRouteUuid(body.requestId) : null;
      if (!body || Object.keys(body).length !== 2 || !leadId || !requestId || new URL(request.url).search !== "") {
        return finish(failure(400, "invalid_request"), "bad_body");
      }

      const pbx = dependencies.pbxConfig();
      if (pbx.status !== "ready") return finish(failure(503, "not_configured"), "not_configured");

      const begun = await dependencies.begin(actor, { leadId, requestId });
      if (begun.status === "error") {
        switch (begun.kind) {
          case "forbidden": return finish(failure(403, "forbidden"), "begin_forbidden");
          case "off": return finish(failure(409, "telephony_off"), "begin_off");
          case "not_found": return finish(failure(404, "not_found"), "begin_not_found");
          case "conflict": return finish(failure(409, "request_conflict"), "begin_conflict");
          case "invalid": return finish(failure(400, "invalid_request"), "begin_invalid");
          case "throttled": return finish(failure(429, "dial_refused", { reason: "rate_gap" }), "begin_throttled");
          default: return finish(failure(503, "unavailable"), "begin_unavailable");
        }
      }
      if (begun.status === "refused") return finish(refusalResponse(begun.code), `refused_${begun.code}`);
      if (begun.status === "replayed") {
        // Повтор: прежний результат, второго звонка нет и ВАТС не спрашивается.
        switch (begun.requestStatus) {
          case "sent": return finish(json(200, { status: "sent", replayed: true }), "replay_sent");
          case "unconfirmed": return finish(json(200, { status: "unconfirmed", replayed: true }), "replay_unconfirmed");
          case "requested": return finish(json(200, { status: "in_progress", replayed: true }), "replay_in_progress");
          case "refused": return finish(refusalResponse(begun.code ?? "unknown"), "replay_refused");
          default: return finish(pbxFailedResponse(begun.code ?? "pbx_unavailable"), "replay_failed");
        }
      }

      // Дальше набор принят и записан как `requested`: у него обязан появиться итог.
      const dialRequestId = begun.dialRequestId;
      let target: DialTargetResult;
      try {
        target = await dependencies.target(actor, dialRequestId);
      } catch {
        target = { status: "unavailable" };
      }
      if (target.status !== "ready") {
        await dependencies.finish(actor, dialRequestId, { outcome: "failed", errorCode: "target_unavailable", httpStatus: null });
        return finish(failure(503, "unavailable"), "target_unavailable");
      }

      // Живой статус сотрудника: нет устройства — клиенту не звонят и деньги не тратятся (§5.4).
      try {
        const live = await dependencies.pbxClient(pbx.config, "status").getUser(target.pbxUser);
        if (live.status === "offline" && live.forwardingMobile !== true) {
          await dependencies.finish(actor, dialRequestId, { outcome: "refused", refusalCode: "pbx_offline" });
          return finish(refusalResponse("pbx_offline"), "pbx_offline");
        }
      } catch (error) {
        const code: TelephonyPbxErrorCode = error instanceof TelephonyPbxError ? error.code : "pbx_network_error";
        const status = error instanceof TelephonyPbxError ? error.status : null;
        if (code === "pbx_not_found") {
          await dependencies.finish(actor, dialRequestId, { outcome: "refused", refusalCode: "pbx_user_not_found" });
          return finish(refusalResponse("pbx_user_not_found"), "pbx_user_not_found");
        }
        // Не удалось проверить: клиенту не звонят, потому что звонок ещё не создан.
        await dependencies.finish(actor, dialRequestId, { outcome: "failed", errorCode: code, httpStatus: status });
        return finish(pbxFailedResponse(code), `status_${code}`);
      }

      // Одна попытка, без повторов. Номер уходит цифрами без «+».
      let result: DialFinish;
      try {
        const call = await dependencies.pbxClient(pbx.config, "call").makeCall({
          phone: target.phone.slice(1),
          user: target.pbxUser,
        });
        result = call.callId === null
          ? { outcome: "unconfirmed", errorCode: "pbx_no_callid", httpStatus: 200 }
          : { outcome: "sent", callId: call.callId, httpStatus: 200 };
      } catch (error) {
        result = classifyMakeCallError(error);
      }
      const recorded = await dependencies.finish(actor, dialRequestId, result);

      if (result.outcome === "failed") return finish(pbxFailedResponse(result.errorCode), `failed_${result.errorCode}`);
      return finish(
        json(200, { status: result.outcome, replayed: false }),
        `${result.outcome}${recorded.status === "recorded" ? "" : "_unrecorded"}`,
      );
    } catch {
      return finish(failure(503, "unavailable"), "internal_error");
    }
  };
}

/** Только `POST`: остальные методы не запускают ни базу, ни ВАТС. */
export function telephonyDialMethodNotAllowed(): Response {
  return Response.json({ error: { code: "method_not_allowed" } }, {
    status: 405,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Allow: "POST" },
  });
}
