import "server-only";

import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import { parsePlatformRouteUuid } from "../platform-communications.ts";
import { LEAD_CALL_PRESSES, isCalendarDay, type LeadCallPress } from "../v3/telephony-lead-calls.ts";
import { failure, json, readJsonObject, sameOrigin } from "./ai-agent-route-handlers.ts";

/**
 * Результат звонка одним нажатием («Телефония Beeline KG», срез T5; план §9.4,
 * §12; миграция 295): `POST /api/v3/telephony/calls/[callId]/result` с
 * `{result: "reached" | "callback" | "not_interested", callbackOn?: "YYYY-MM-DD"}`.
 *
 * Маршрут ничего не решает: сессия, `sameOrigin` (403, как у остальных POST
 * сотрудников) и форма тела проверяются здесь, а право `telephony.call.dial`,
 * флаги `ui_enabled`/`dial_enabled`, «свои»/«все» звонки, окно времени, видимость
 * лида и дата — внутри базы (`platform.telephony_set_result_v1`). Повтор того же
 * нажатия ничего не меняет и не пишется в журнал. «Перезвонить» только записывает
 * выбранный день; задачу «Перезвонить» создаёт срез T8. Просмотр роли
 * администратором (preview) ничего не записывает.
 */
type Authorization =
  | Readonly<{ status: "authorized"; actor: ActivePlatformActor }>
  | Readonly<{ status: "anonymous" | "forbidden" | "preview" | "unavailable"; actor: null }>;

export type TelephonyResultInput = Readonly<{ result: LeadCallPress; callbackOn: string | null }>;

export type TelephonyResultOutcome =
  | Readonly<{
      status: "saved" | "unchanged";
      resultCode: LeadCallPress;
      resultAt: string;
      callbackOn: string | null;
    }>
  | Readonly<{ status: "forbidden" | "not_found" | "not_answered" | "closed" | "off" | "invalid_date" | "invalid" | "unavailable" }>;

export type TelephonyResultDependencies = Readonly<{
  authorize(): Promise<Authorization>;
  setResult(actor: ActivePlatformActor, callId: string, input: TelephonyResultInput): Promise<TelephonyResultOutcome>;
}>;

type RpcError = Readonly<{ code?: string; message?: string }>;

async function defaultAuthorize(): Promise<Authorization> {
  const { resolvePlatformActor } = await import("../platform-auth.ts");
  const result = await resolvePlatformActor();
  if (result.status === "anonymous") return { status: "anonymous", actor: null };
  if (result.status === "invalid") return { status: "unavailable", actor: null };
  if (isStaffPreview(result.actor)) return { status: "preview", actor: null };
  if (!staffHasPermission(result.actor, "telephony.call.dial")) return { status: "forbidden", actor: null };
  return { status: "authorized", actor: result.actor };
}

/** Отказ базы → итог маршрута; текст исключения различает «не отвечен» и «окно закрыто» (оба PT409). */
export function telephonyResultRefusal(error: RpcError): TelephonyResultOutcome {
  if (error.code === "42501") return { status: "forbidden" };
  if (error.code === "P0002") return { status: "not_found" };
  if (error.code === "55000") return { status: "off" };
  if (error.code === "PT409") {
    return { status: error.message === "telephony_result_not_answered" ? "not_answered" : "closed" };
  }
  if (error.code === "22023") return { status: error.message === "telephony_result_date_invalid" ? "invalid_date" : "invalid" };
  return { status: "unavailable" };
}

/**
 * Квитанция базы: `{status: saved|unchanged, callId, resultCode, resultAt, callbackOn}`.
 * Другая форма — не «сохранено», а сбой.
 */
export function telephonyResultReceipt(data: unknown): TelephonyResultOutcome {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { status: "unavailable" };
  const receipt = data as Record<string, unknown>;
  const code = receipt.resultCode;
  const callbackOn = receipt.callbackOn ?? null;
  if ((receipt.status !== "saved" && receipt.status !== "unchanged")
    || typeof code !== "string" || !(LEAD_CALL_PRESSES as readonly string[]).includes(code)
    || typeof receipt.resultAt !== "string" || !Number.isFinite(Date.parse(receipt.resultAt))
    || (callbackOn !== null && !isCalendarDay(callbackOn))
    || (code === "callback") !== (callbackOn !== null)) {
    return { status: "unavailable" };
  }
  return { status: receipt.status, resultCode: code as LeadCallPress, resultAt: receipt.resultAt, callbackOn: callbackOn as string | null };
}

const defaultDependencies: TelephonyResultDependencies = {
  authorize: defaultAuthorize,
  async setResult(actor, callId, input) {
    const { createSupabaseServerClient } = await import("../supabase/server.ts");
    const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc("telephony_set_result_v1", {
      p_organization_id: actor.organizationId,
      p_call_id: callId,
      p_result_code: input.result,
      p_callback_on: input.callbackOn,
    });
    return error ? telephonyResultRefusal(error) : telephonyResultReceipt(data);
  },
};

type CallContext = Readonly<{ params: Promise<Readonly<{ callId: string }>> }>;

function refusal(status: Exclude<Authorization["status"], "authorized">): Response {
  if (status === "anonymous") return failure(401, "authentication_required");
  if (status === "preview") return failure(403, "preview");
  if (status === "forbidden") return failure(403, "forbidden");
  return failure(503, "unavailable");
}

/** Тело нажатия: ровно `result` и, для «Перезвонить», `callbackOn`; иначе null. */
export function parseTelephonyResultBody(body: Record<string, unknown> | null): TelephonyResultInput | null {
  if (!body) return null;
  const result = typeof body.result === "string" && (LEAD_CALL_PRESSES as readonly string[]).includes(body.result)
    ? body.result as LeadCallPress : null;
  if (result === null) return null;
  const hasDay = body.callbackOn !== undefined && body.callbackOn !== null;
  if (result === "callback") {
    return isCalendarDay(body.callbackOn) ? { result, callbackOn: body.callbackOn } : null;
  }
  return hasDay ? null : { result, callbackOn: null };
}

export function createTelephonyResultHandler(dependencies: TelephonyResultDependencies = defaultDependencies) {
  return async function POST(request: Request, context: CallContext): Promise<Response> {
    try {
      if (!sameOrigin(request)) return failure(403, "forbidden");
      const authorization = await dependencies.authorize();
      if (authorization.status !== "authorized") return refusal(authorization.status);
      const callId = parsePlatformRouteUuid((await context.params).callId);
      const input = parseTelephonyResultBody(await readJsonObject(request, ["result", "callbackOn"]));
      if (!callId || !input || new URL(request.url).search !== "") return failure(400, "invalid_request");
      const outcome = await dependencies.setResult(authorization.actor, callId, input);
      switch (outcome.status) {
        case "saved":
        case "unchanged":
          return json(200, {
            status: outcome.status, resultCode: outcome.resultCode, resultAt: outcome.resultAt, callbackOn: outcome.callbackOn,
          });
        case "forbidden": return failure(403, "forbidden");
        case "not_found": return failure(404, "not_found");
        case "not_answered": return failure(409, "not_answered");
        case "closed": return failure(409, "result_closed");
        case "off": return failure(409, "telephony_off");
        case "invalid_date": return failure(422, "invalid_date");
        case "invalid": return failure(400, "invalid_request");
        default: return failure(503, "unavailable");
      }
    } catch {
      return failure(503, "unavailable");
    }
  };
}
