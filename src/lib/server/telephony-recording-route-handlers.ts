import "server-only";

import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import type { ActivePlatformActor, PlatformActorResult } from "../platform-auth.ts";
import { parsePlatformRouteUuid } from "../platform-communications.ts";
import {
  readPlatformTelephonyPbxConfig,
  type PlatformTelephonyPbxConfigState,
} from "./platform-telephony-pbx-config.ts";
import {
  fetchRecording,
  parseRecordingLink,
  parseSingleRange,
  type RecordingFailureReason,
  type RecordingFetchDependencies,
} from "./platform-telephony-recording-stream.ts";

/**
 * Прослушивание записи звонка («Телефония Beeline KG», срез T6; план §7, §11, §12;
 * миграция 297): `GET /api/v3/telephony/recordings/[legId]` — потоковый прокси.
 * Копий нет: сервер берёт ссылку из базы на время одного запроса и передаёт звук
 * браузеру как есть; ссылка не уходит ни в ответ, ни в журнал.
 *
 * Порядок (каждый шаг отказывает раньше следующего):
 *  1. сессия сотрудника (401), просмотр роли администратором ничего не пишет (403
 *     `preview`: выдача пишет в журнал), право слушать хотя бы свои записи (403);
 *  2. идентификатор ноги и пустая строка запроса (404 / 400);
 *  3. подключение ВАТС настроено (503 `not_configured`: без хоста тенанта нет, что
 *     проверять, и разрешение зря не выдаётся и не пишется в журнал);
 *  4. разрешение базы `platform.telephony_recording_grant_v1` под сессией сотрудника:
 *     флаг `ui_enabled`, право «все» или «свои» (участие в любой ноге звонка),
 *     состояние записи, лимит выдач; в журнал — один раз на новое разрешение, а не на
 *     каждый Range-запрос;
 *  5. погашение `platform.telephony_recording_consume_v1` служебным ключом: срок,
 *     лимит обращений, принадлежность — и ссылка, только серверу;
 *  6. проверка ссылки (хост тенанта, строгий путь, глобальный адрес) и запрос к
 *     источнику (`platform-telephony-recording-stream.ts`);
 *  7. ответ источника: 404/410 — решает база по возрасту звонка
 *     (`platform.telephony_recording_report_v1`: ≥ 360 дней — «удалена по сроку
 *     хранения» (410), моложе — «ещё не готова» (404), ссылка сохраняется); сбой,
 *     таймаут, не `audio/mpeg` — 502 без изменения состояния.
 *
 * В журнал приложения идут только слова и числа (статус, причина, диапазон ли): ни
 * ссылки, ни адреса, ни идентификатора ноги, ни тела.
 */
export type RecordingRefusal =
  | "forbidden"
  | "not_found"
  | "recording_unavailable"
  | "expired"
  | "rate_limited"
  | "invalid"
  | "grant_invalid"
  | "unavailable";

type Authorization =
  | Readonly<{ status: "authorized"; actor: ActivePlatformActor }>
  | Readonly<{ status: "anonymous" | "forbidden" | "preview" | "unavailable"; actor: null }>;

export type RecordingGrantResult =
  | Readonly<{ status: "granted"; grantId: string }>
  | Readonly<{ status: "refused"; code: RecordingRefusal }>;

export type RecordingConsumeResult =
  | Readonly<{ status: "consumed"; link: string; notFoundCount: number }>
  | Readonly<{ status: "refused"; code: RecordingRefusal }>;

export type RecordingReportResult =
  | Readonly<{ status: "reported"; state: "none" | "available" | "unavailable" | "expired" }>
  | Readonly<{ status: "failed" }>;

type LogValue = string | number | boolean;

export type TelephonyRecordingDependencies = Readonly<{
  authorize(): Promise<Authorization>;
  pbxConfig(): PlatformTelephonyPbxConfigState;
  grant(actor: ActivePlatformActor, legId: string): Promise<RecordingGrantResult>;
  consume(actor: ActivePlatformActor, grantId: string, legId: string): Promise<RecordingConsumeResult>;
  report(actor: ActivePlatformActor, legId: string, result: "ok" | "not_found"): Promise<RecordingReportResult>;
  fetchOptions?: RecordingFetchDependencies;
  log(entry: Readonly<Record<string, LogValue>>): void;
}>;

type RpcError = Readonly<{ code?: string; message?: string }>;

const RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, no-transform",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const GRANT_KEYS = ["expiresAt", "grantId", "scope", "status"];
const CONSUME_KEYS = ["callId", "legId", "link", "notFoundCount"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

/** Отказ базы → слово; текст исключения различает «разрешение не годится» и «нельзя». */
export function recordingRefusal(error: RpcError): RecordingRefusal {
  if (error.code === "42501") return error.message === "telephony_recording_grant_invalid" ? "grant_invalid" : "forbidden";
  if (error.code === "P0002") return error.message === "telephony_recording_unavailable" ? "recording_unavailable" : "not_found";
  if (error.code === "PT410") return "expired";
  if (error.code === "PT429") return "rate_limited";
  if (error.code === "22023") return "invalid";
  return "unavailable";
}

/** Ответ выдачи: ровно `{status, grantId, expiresAt, scope}`; другая форма — сбой. */
export function recordingGrantReceipt(data: unknown): RecordingGrantResult {
  if (!isRecord(data) || !exactKeys(data, GRANT_KEYS)) return { status: "refused", code: "unavailable" };
  if (
    (data.status !== "issued" && data.status !== "reused")
    || typeof data.grantId !== "string" || !UUID.test(data.grantId.toLowerCase())
    || typeof data.expiresAt !== "string" || !Number.isFinite(Date.parse(data.expiresAt))
    || (data.scope !== "all" && data.scope !== "own")
  ) {
    return { status: "refused", code: "unavailable" };
  }
  return { status: "granted", grantId: data.grantId.toLowerCase() };
}

/** Ответ погашения: ровно `{callId, legId, link, notFoundCount}` и та же нога, что просили. */
export function recordingConsumeReceipt(data: unknown, legId: string): RecordingConsumeResult {
  if (!isRecord(data) || !exactKeys(data, CONSUME_KEYS)) return { status: "refused", code: "unavailable" };
  if (
    typeof data.legId !== "string" || data.legId.toLowerCase() !== legId
    || typeof data.callId !== "string" || !UUID.test(data.callId.toLowerCase())
    || typeof data.link !== "string" || data.link === ""
    || typeof data.notFoundCount !== "number" || !Number.isInteger(data.notFoundCount) || data.notFoundCount < 0
  ) {
    return { status: "refused", code: "unavailable" };
  }
  return { status: "consumed", link: data.link, notFoundCount: data.notFoundCount };
}

/** Ответ учёта: `{state, changed, notFoundCount}`; важно только итоговое состояние ноги. */
export function recordingReportReceipt(data: unknown): RecordingReportResult {
  if (!isRecord(data) || typeof data.state !== "string") return { status: "failed" };
  if (data.state !== "none" && data.state !== "available" && data.state !== "unavailable" && data.state !== "expired") {
    return { status: "failed" };
  }
  return { status: "reported", state: data.state };
}

/**
 * Сессия сотрудника → допуск маршрута: нет входа — 401; сбой сессии — 503; просмотр роли
 * администратором — нет (выдача пишет в журнал, просмотр ничего не пишет); нет ни права «все», ни
 * права «свои» — нет. Какую запись можно слушать, решает база; здесь отсекается тот, кому слушать нечего.
 */
export function recordingAuthorization(result: PlatformActorResult): Authorization {
  if (result.status === "anonymous") return { status: "anonymous", actor: null };
  if (result.status === "invalid") return { status: "unavailable", actor: null };
  if (isStaffPreview(result.actor)) return { status: "preview", actor: null };
  if (
    !staffHasPermission(result.actor, "telephony.recording.listen.own")
    && !staffHasPermission(result.actor, "telephony.recording.listen.all")
  ) {
    return { status: "forbidden", actor: null };
  }
  return { status: "authorized", actor: result.actor };
}

async function defaultAuthorize(): Promise<Authorization> {
  const { resolvePlatformActor } = await import("../platform-auth.ts");
  return recordingAuthorization(await resolvePlatformActor());
}

function defaultLog(entry: Readonly<Record<string, LogValue>>): void {
  console.info(JSON.stringify(entry));
}

const defaultDependencies: TelephonyRecordingDependencies = {
  authorize: defaultAuthorize,
  pbxConfig: () => readPlatformTelephonyPbxConfig(),
  async grant(actor, legId) {
    const { createSupabaseServerClient } = await import("../supabase/server.ts");
    const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc(
      "telephony_recording_grant_v1",
      { p_organization_id: actor.organizationId, p_leg_id: legId },
    );
    return error ? { status: "refused", code: recordingRefusal(error) } : recordingGrantReceipt(data);
  },
  async consume(actor, grantId, legId) {
    const { getPlatformSupabaseBackendConfig } = await import("./platform-supabase-backend-config.ts");
    const { createPlatformSupabaseServiceClient } = await import("./platform-supabase-service-client.ts");
    const client = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
    const { data, error } = await client.schema("platform").rpc("telephony_recording_consume_v1", {
      p_organization_id: actor.organizationId,
      p_grant_id: grantId,
      p_membership_id: actor.membershipId,
    });
    return error ? { status: "refused", code: recordingRefusal(error) } : recordingConsumeReceipt(data, legId);
  },
  async report(actor, legId, result) {
    try {
      const { getPlatformSupabaseBackendConfig } = await import("./platform-supabase-backend-config.ts");
      const { createPlatformSupabaseServiceClient } = await import("./platform-supabase-service-client.ts");
      const client = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
      const { data, error } = await client.schema("platform").rpc("telephony_recording_report_v1", {
        p_organization_id: actor.organizationId,
        p_leg_id: legId,
        p_result: result,
      });
      return error ? { status: "failed" } : recordingReportReceipt(data);
    } catch {
      return { status: "failed" };
    }
  },
  log: defaultLog,
};

type LegContext = Readonly<{ params: Promise<Readonly<{ legId: string }>> }>;

function failure(status: number, code: string, extra: Readonly<Record<string, string>> = {}): Response {
  return Response.json({ error: { code } }, { status, headers: { ...RESPONSE_HEADERS, ...extra } });
}

/** Один слой слов: код отказа базы → HTTP. Причину существования записи не раскрывает. */
function refusalResponse(code: RecordingRefusal): Response {
  switch (code) {
    case "forbidden": return failure(403, "forbidden");
    case "not_found": return failure(404, "not_found");
    case "recording_unavailable": return failure(404, "recording_unavailable");
    case "expired": return failure(410, "recording_expired");
    case "rate_limited": return failure(429, "rate_limited", { "Retry-After": "300" });
    case "invalid": return failure(400, "invalid_request");
    default: return failure(503, "unavailable");
  }
}

function sourceFailure(reason: RecordingFailureReason): Response {
  // Тип не `audio/mpeg` — 502 без тела (план §7.3); прочие сбои источника — 502 со словом.
  if (reason === "content_type") {
    return new Response(null, { status: 502, headers: RESPONSE_HEADERS });
  }
  return failure(502, "recording_temporarily_unavailable");
}

export function createTelephonyRecordingHandler(dependencies: TelephonyRecordingDependencies = defaultDependencies) {
  return async function GET(request: Request, context: LegContext): Promise<Response> {
    const hasRange = request.headers.has("range");
    const finish = (response: Response, reason: string): Response => {
      try {
        dependencies.log({ event: "telephony_recording", status: response.status, reason, range: hasRange });
      } catch {
        // Журнал приложения никогда не меняет ответ.
      }
      return response;
    };
    try {
      const authorization = await dependencies.authorize();
      if (authorization.status !== "authorized") {
        if (authorization.status === "anonymous") return finish(failure(401, "authentication_required"), "anonymous");
        if (authorization.status === "preview") return finish(failure(403, "preview"), "preview");
        if (authorization.status === "forbidden") return finish(failure(403, "forbidden"), "no_right");
        return finish(failure(503, "unavailable"), "session_unavailable");
      }
      const actor = authorization.actor;
      const legId = parsePlatformRouteUuid((await context.params).legId);
      if (!legId) return finish(failure(404, "not_found"), "bad_id");
      if (new URL(request.url).search !== "") return finish(failure(400, "invalid_request"), "query");

      const pbx = dependencies.pbxConfig();
      if (pbx.status !== "ready") return finish(failure(503, "not_configured"), "not_configured");

      // Разрешение и погашение. Если за миг между ними разрешение исчерпало 40 обращений
      // (параллельные Range-запросы), база выдаёт новое: одна повторная попытка.
      let link: string | null = null;
      let notFoundCount = 0;
      for (let attempt = 1; attempt <= 2 && link === null; attempt += 1) {
        const grant = await dependencies.grant(actor, legId);
        if (grant.status === "refused") return finish(refusalResponse(grant.code), `grant_${grant.code}`);
        const consumed = await dependencies.consume(actor, grant.grantId, legId);
        if (consumed.status === "refused") {
          if (consumed.code === "grant_invalid" && attempt === 1) continue;
          return finish(refusalResponse(consumed.code === "grant_invalid" ? "unavailable" : consumed.code),
            `consume_${consumed.code}`);
        }
        link = consumed.link;
        notFoundCount = consumed.notFoundCount;
      }
      if (link === null) return finish(failure(503, "unavailable"), "no_link");

      const url = parseRecordingLink(link, pbx.config.recordingHost);
      // Ссылка не той формы: источнику не уходит ничего; состояние записи не меняется.
      if (url === null) return finish(sourceFailure("address"), "link_rejected");

      const outcome = await fetchRecording(url, parseSingleRange(request.headers.get("range")), request.signal,
        dependencies.fetchOptions);
      if (outcome.kind === "failed") return finish(sourceFailure(outcome.reason), `source_${outcome.reason}`);
      if (outcome.kind === "not_found") {
        // Решение о сроке принимает база по возрасту звонка: ссылку обнуляет только достаточно старый звонок.
        const report = await dependencies.report(actor, legId, "not_found");
        if (report.status !== "reported") return finish(failure(502, "recording_temporarily_unavailable"), "report_failed");
        return report.state === "expired"
          ? finish(failure(410, "recording_expired"), "expired")
          : finish(failure(404, "recording_not_ready"), "not_ready");
      }
      // Источник отдал запись: прежние 404 были временными. Сбой учёта поток не останавливает.
      if (notFoundCount > 0) {
        try {
          await dependencies.report(actor, legId, "ok");
        } catch {
          // Счётчик сбросит следующее прослушивание.
        }
      }
      return finish(outcome.response, "streamed");
    } catch {
      return finish(failure(503, "unavailable"), "internal_error");
    }
  };
}

/** Только `GET`: `HEAD` и прочие методы не запускают выдачу, погашение и запрос к источнику. */
export function telephonyRecordingMethodNotAllowed(): Response {
  return Response.json({ error: { code: "method_not_allowed" } }, {
    status: 405,
    headers: { ...RESPONSE_HEADERS, Allow: "GET" },
  });
}
