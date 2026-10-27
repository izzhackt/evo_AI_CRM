import "server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  classifyWazzupPayload,
  splitWazzupPortions,
  WAZZUP_MAX_BODY_BYTES,
  WAZZUP_WEBHOOK_HOST,
  wazzupElementTimeMs,
  type WazzupElement,
} from "../platform-wazzup-webhook.ts";
import {
  getPlatformMessagingBackendConfig,
  type PlatformMessagingBackendConfig,
} from "./platform-messaging-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import { TelephonyFailureLimiter } from "./platform-telephony-ingress.ts";
import {
  isPlatformWazzupIngressEnabled,
  readPlatformWazzupIntakeOwner,
  readPlatformWazzupWebhookTokens,
  type PlatformWazzupWebhookTokens,
} from "./platform-wazzup-ingress-config.ts";

/**
 * Wazzup -> CRM: приём вебхуков WhatsApp продаж, `POST /api/v2/whatsapp/wazzup/inbound?token=<64 hex>`
 * (docs/EVO_WAZZUP_WHATSAPP_PLAN_2026-10-27.md §5.1, §9; миграции 324-325).
 *
 * Wazzup у Sidecar-ключа тело не подписывает (страница «Webhooks»: `Authorization: Bearer` бывает только при `crmKey`),
 * поэтому единственная защита - токен в адресе. Порядок - от дешёвого к дорогому; ДО проверки токена тело не читается,
 * база не вызывается и ничего не пишется:
 *   1. метод не POST - 405;
 *   2. аварийный стоп env `EVO_PLATFORM_WAZZUP_INGRESS_ENABLED` не ровно "1" - 503 `wazzup_webhook_unavailable`;
 *   3. нет годного `EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN` - 503;
 *   4. `Host` не `crm.evoadmissions.com` - 404 (вторая линия к edge, §5.7);
 *   5. токен из query сравнивается постоянным по времени сравнением с текущим и `…_NEXT`; неверный - 401 без тела,
 *      больше 20 неверных в минуту с адреса - 429 на минуту (адрес - только из `X-Evo-Wazzup-Ip`, который перезаписывает
 *      edge); запрос с верным токеном ограничитель не останавливает; токен нигде не хранится и не пишется в журнал;
 *      заголовок `Authorization` игнорируется;
 *   6. тело - не больше 1 МиБ (413), читается потоком с тем же пределом;
 *   7. ровно `{"test": true}` (проверка `PATCH /v3/webhooks`) - сразу 200 `{"ok":true}`, без базы и до проверки пути;
 *   8. разбор верхнего уровня; `statuses` и лишние подписки - только счётчики;
 *   9. запись сырых событий порциями не больше 100 элементов (`platform.wazzup_webhook_persist_v1`, каждый элемент в
 *      подтранзакции); действующий путь не Wazzup - 503 `transport_inactive`, ничего не записано; база недоступна - 503;
 *  10. встроенная проекция новых событий с общим бюджетом 5 с (`platform.wazzup_project_event_v1`); не успели или
 *      ошибка - ответ всё равно 200, остальное догрузит таймер;
 *  11. новое входящее при включённом в базе запуске ИИ - `scheduleAiAgentEvent`, как у WAHA.
 *
 * Журнал приложения - только слова и счётчики: без адреса запроса, токена, номеров и текстов.
 */

const DEFAULT_DATABASE_DEADLINE_MS = 8_000;
/** Все вызовы записи одного запроса: меньше таймаута Wazzup (30 с). */
const DEFAULT_REQUEST_BUDGET_MS = 25_000;
const DEFAULT_PROJECTION_BUDGET_MS = 5_000;
const ADDRESS_HEADER = "x-evo-wazzup-ip";
const RESPONSE_HEADERS = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } as const;
const EMPTY_HEADERS = { "cache-control": "no-store" } as const;
const PERSIST_OUTCOMES: ReadonlySet<string> = new Set(["stored", "deduplicated", "unparsed", "filtered", "element_failed"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

type RpcClient = Pick<SupabaseClient, "schema">;
type LogValue = string | number | boolean;
type JsonObject = Record<string, unknown>;

type Reason =
  | "method_not_allowed"
  | "ingress_off"
  | "not_configured"
  | "wrong_host"
  | "invalid_token"
  | "rate_limited"
  | "payload_too_large"
  | "parse_failed"
  | "test_ok"
  | "backend_not_configured"
  | "transport_inactive"
  | "database_unavailable"
  | "budget_exceeded"
  | "processed"
  | "internal_error";

/** Ограничитель неудач - тот же, что у телефонии (>20 неверных в минуту с адреса - 429 на минуту), свой экземпляр. */
export class WazzupFailureLimiter extends TelephonyFailureLimiter {}

export type PlatformWazzupInboundDependencies = Readonly<{
  createServiceClient(config: PlatformMessagingBackendConfig): RpcClient;
  environment: Readonly<Record<string, string | undefined>>;
  limiter: WazzupFailureLimiter;
  log(entry: Readonly<Record<string, LogValue>>): void;
  now(): number;
  /** Один вызов базы. */
  databaseDeadlineMs: number;
  /** Все вызовы записи одного запроса. */
  requestBudgetMs: number;
  /** Все вызовы встроенной проекции одного запроса. */
  projectionBudgetMs: number;
  /** Запуск включённых ИИ-агентов после нового входящего; не бросает и не ждёт. */
  scheduleAiAgents(): void;
}>;

function defaultLog(entry: Readonly<Record<string, LogValue>>): void {
  console.info(JSON.stringify(entry));
}

function defaultScheduleAiAgents(): void {
  // Динамический импорт: маршрут без нового входящего не тянет модуль агентов, а тесты Node его не грузят.
  void import("./ai-agents/dispatch.ts").then(
    (dispatch) => dispatch.scheduleAiAgentEvent({ kind: "whatsapp_inbound", ref: null }),
    () => undefined,
  ).catch(() => undefined);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

// SHA-256 обеих сторон и timingSafeEqual: равная длина при любом присланном значении; оба слота сравниваются всегда.
function matchTokenSlot(supplied: string | null, tokens: PlatformWazzupWebhookTokens): "current" | "next" | null {
  const suppliedDigest = digest(supplied ?? "");
  const current = timingSafeEqual(suppliedDigest, digest(tokens.current));
  const next = tokens.next !== null && timingSafeEqual(suppliedDigest, digest(tokens.next));
  if (current) return "current";
  return next ? "next" : null;
}

// Адрес - только из заголовка, который перезаписывает edge `{remote_host}`; X-Forwarded-For и всё, что может поставить
// клиент, игнорируется. Нет заголовка - общий счётчик `unknown`: худший исход - общий или обойдённый счётчик неудач,
// верный токен ограничитель не останавливает.
function clientAddress(request: Request): string {
  const raw = request.headers.get(ADDRESS_HEADER)?.trim().toLowerCase() ?? "";
  return raw !== "" && isIP(raw) !== 0 ? raw : "unknown";
}

function hostIsAllowed(request: Request): boolean {
  const raw = request.headers.get("host")?.trim().toLowerCase().replace(/\.$/u, "") ?? "";
  return raw === WAZZUP_WEBHOOK_HOST;
}

function declaredLengthExceedsBound(request: Request): boolean {
  const declared = request.headers.get("content-length")?.trim();
  return declared !== undefined && /^[0-9]+$/u.test(declared) && Number(declared) > WAZZUP_MAX_BODY_BYTES;
}

/** Тело потоком с жёстким пределом: превышение отменяет загрузку, бесконечное тело не копится. Null - больше предела. */
async function readBoundedWazzupBody(request: Request): Promise<Uint8Array | null> {
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > WAZZUP_MAX_BODY_BYTES) {
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function bodyBucket(bytes: number | null): string {
  if (bytes === null || bytes > WAZZUP_MAX_BODY_BYTES) return "gt_1m";
  if (bytes <= 1024) return "le_1k";
  if (bytes <= 32 * 1024) return "le_32k";
  if (bytes <= 256 * 1024) return "le_256k";
  return "le_1m";
}

class DeadlineExceeded extends Error {}

async function withDeadline<T>(operation: PromiseLike<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded = Promise.resolve(operation);
  // Поздний сбой брошенного вызова не должен стать необработанным отказом.
  guarded.catch(() => undefined);
  try {
    return await Promise.race([
      guarded,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new DeadlineExceeded()), Math.max(1, milliseconds));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

type StoredEvent = Readonly<{ eventId: string; order: number; timeMs: number | null }>;

type PersistPortion = Readonly<{
  transportActive: boolean;
  counts: Readonly<Record<"stored" | "deduplicated" | "unparsed" | "filtered" | "failed", number>>;
  toProject: readonly StoredEvent[];
}>;

/** Ответ порции -> числа и события для проекции; любая другая форма - null (503: запись не подтверждена). */
function readPersistPortion(data: unknown, portion: readonly WazzupElement[], base: number): PersistPortion | null {
  if (!isObject(data) || typeof data.transportActive !== "boolean") return null;
  const counts = { stored: 0, deduplicated: 0, unparsed: 0, filtered: 0, failed: 0 };
  if (!data.transportActive) return { transportActive: false, counts, toProject: [] };
  if (!Array.isArray(data.results) || data.results.length !== portion.length) return null;
  const toProject: StoredEvent[] = [];
  for (const item of data.results as unknown[]) {
    if (!isObject(item) || typeof item.outcome !== "string" || !PERSIST_OUTCOMES.has(item.outcome)) return null;
    const index = item.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= portion.length) return null;
    switch (item.outcome) {
      case "stored":
      case "unparsed": {
        if (item.outcome === "stored") counts.stored += 1;
        else counts.unparsed += 1;
        const eventId = typeof item.eventId === "string" ? item.eventId.toLowerCase() : "";
        if (!UUID_PATTERN.test(eventId)) return null;
        toProject.push({ eventId, order: base + index, timeMs: wazzupElementTimeMs(portion[index]?.element) });
        break;
      }
      case "deduplicated":
        counts.deduplicated += 1;
        break;
      case "filtered":
        counts.filtered += 1;
        break;
      default:
        counts.failed += 1;
    }
  }
  return { transportActive: true, counts, toProject };
}

export function createPlatformWazzupInboundHandler(
  overrides: Partial<PlatformWazzupInboundDependencies> = {},
): (request: Request) => Promise<Response> {
  const dependencies: PlatformWazzupInboundDependencies = {
    createServiceClient: createPlatformSupabaseServiceClient,
    environment: process.env,
    limiter: new WazzupFailureLimiter(),
    log: defaultLog,
    now: Date.now,
    databaseDeadlineMs: DEFAULT_DATABASE_DEADLINE_MS,
    requestBudgetMs: DEFAULT_REQUEST_BUDGET_MS,
    projectionBudgetMs: DEFAULT_PROJECTION_BUDGET_MS,
    scheduleAiAgents: defaultScheduleAiAgents,
    ...overrides,
  };

  const handle = async (request: Request): Promise<Response> => {
    const startedAt = dependencies.now();
    const context: Record<string, LogValue> = { body_bucket: "none" };

    const finish = (
      status: number,
      body: Readonly<Record<string, unknown>> | null,
      reason: Reason,
      headers: Readonly<Record<string, string>> = {},
    ): Response => {
      try {
        dependencies.log({ event: "wazzup_inbound", service: "evo-crm", status, reason, ...context });
      } catch {
        // Журнал не меняет ответ Wazzup.
      }
      if (body === null) return new Response(null, { status, headers: { ...EMPTY_HEADERS, ...headers } });
      return new Response(JSON.stringify(body), { status, headers: { ...RESPONSE_HEADERS, ...headers } });
    };

    const unavailable = (reason: Reason) => finish(503, { error: "wazzup_webhook_unavailable" }, reason);

    // Отказ до доказанного токена: считается по адресу, при превышении - 429.
    const refuse = (
      address: string,
      status: number,
      body: Readonly<Record<string, unknown>> | null,
      reason: Reason,
    ): Response => {
      if (dependencies.limiter.recordFailure(address)) {
        return finish(429, { error: "rate_limited" }, "rate_limited", { "retry-after": "60" });
      }
      return finish(status, body, reason);
    };

    // 1. Метод.
    if (request.method !== "POST") {
      return finish(405, { error: "method_not_allowed" }, "method_not_allowed", { allow: "POST" });
    }

    // 2. Аварийный стоп env.
    if (!isPlatformWazzupIngressEnabled(dependencies.environment)) return unavailable("ingress_off");

    // 3. Нет годного токена - нечем проверять.
    const tokens = readPlatformWazzupWebhookTokens(dependencies.environment);
    if (tokens === null) return unavailable("not_configured");

    // 4. Хост.
    if (!hostIsAllowed(request)) return finish(404, null, "wrong_host");

    // 5. Токен. Он уходит из запроса здесь и нигде не сохраняется.
    const address = clientAddress(request);
    let suppliedToken: string | null = null;
    try {
      suppliedToken = new URL(request.url).searchParams.get("token");
    } catch {
      suppliedToken = null;
    }
    const slot = matchTokenSlot(suppliedToken, tokens);
    suppliedToken = null;
    if (slot === null) return refuse(address, 401, null, "invalid_token");

    // 6. Тело: предел по заявленной длине и по прочитанному.
    if (declaredLengthExceedsBound(request)) {
      context.body_bucket = "gt_1m";
      return finish(413, { error: "payload_too_large" }, "payload_too_large");
    }
    let raw: Uint8Array | null;
    try {
      raw = await readBoundedWazzupBody(request);
    } catch {
      return finish(400, { error: "invalid_json" }, "parse_failed");
    }
    if (raw === null) {
      context.body_bucket = "gt_1m";
      return finish(413, { error: "payload_too_large" }, "payload_too_large");
    }
    context.body_bucket = bodyBucket(raw.byteLength);

    // 7. Один JSON-объект; `{"test": true}` - проверка PATCH /v3/webhooks, без базы.
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    } catch {
      return finish(400, { error: "invalid_json" }, "parse_failed");
    }
    const classified = classifyWazzupPayload(parsedBody);
    parsedBody = null;
    if (classified === null) return finish(400, { error: "invalid_json" }, "parse_failed");
    if (classified.kind === "test") return finish(200, { ok: true }, "test_ok");

    context.slot = slot;
    context.elements = classified.elements.length;
    context.statuses = classified.statuses;
    context.ignored = classified.ignored;

    // 8. База.
    let config: PlatformMessagingBackendConfig;
    let client: RpcClient;
    try {
      config = getPlatformMessagingBackendConfig(dependencies.environment as NodeJS.ProcessEnv);
      client = dependencies.createServiceClient(config);
    } catch {
      return unavailable("backend_not_configured");
    }

    // 9. Запись порциями. Счётчики статусов и лишних подписок уходят с первой порцией (один раз).
    const batchSha256 = createHash("sha256").update(raw).digest("hex");
    const portions = splitWazzupPortions(classified.elements);
    if (portions.length === 0) portions.push([]);
    context.portions = portions.length;
    const counters: Record<string, number> = {};
    if (classified.statuses > 0) counters.status = classified.statuses;
    if (classified.ignored > 0) counters.ignored_subscription = classified.ignored;

    const totals = { stored: 0, deduplicated: 0, unparsed: 0, filtered: 0, failed: 0 };
    const toProject: StoredEvent[] = [];
    const budgetEnd = startedAt + dependencies.requestBudgetMs;
    let base = 0;
    for (let index = 0; index < portions.length; index += 1) {
      const portion = portions[index] as WazzupElement[];
      const remaining = budgetEnd - dependencies.now();
      if (remaining <= 0) return unavailable("budget_exceeded");
      let outcome: { data: unknown; error: unknown };
      try {
        outcome = await withDeadline(
          client.schema("platform").rpc("wazzup_webhook_persist_v1", {
            p_organization_id: config.organizationId,
            p_batch_sha256: batchSha256,
            p_token_slot: slot,
            p_elements: portion,
            p_counters: index === 0 ? counters : {},
          }),
          Math.min(dependencies.databaseDeadlineMs, remaining),
        );
      } catch {
        return unavailable("database_unavailable");
      }
      const result = outcome.error ? null : readPersistPortion(outcome.data, portion, base);
      if (result === null) return unavailable("database_unavailable");
      if (!result.transportActive) {
        // Действующий путь не Wazzup (§9): база ничего не записала. Wazzup, если и повторит, повторит в пустоту.
        return finish(503, { error: "transport_inactive" }, "transport_inactive");
      }
      for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += result.counts[key];
      toProject.push(...result.toProject);
      base += portion.length;
    }
    Object.assign(context, totals);

    // 10. Встроенная проекция новых событий: в порядке времени сообщения, с общим бюджетом. Не успели - догрузит таймер.
    const projection = { projected: 0, deferred: 0, failed: 0, newInbound: 0 };
    let aiTrigger = false;
    const owner = readPlatformWazzupIntakeOwner(dependencies.environment);
    if (toProject.length > 0 && owner === null) {
      projection.deferred = toProject.length;
      context.projection = "no_owner";
    } else if (toProject.length > 0 && owner !== null) {
      const ordered = [...toProject].sort((left, right) => {
        const l = left.timeMs ?? Number.POSITIVE_INFINITY;
        const r = right.timeMs ?? Number.POSITIVE_INFINITY;
        return l === r ? left.order - right.order : l - r;
      });
      const projectionEnd = dependencies.now() + dependencies.projectionBudgetMs;
      for (let position = 0; position < ordered.length; position += 1) {
        const left = projectionEnd - dependencies.now();
        if (left <= 0) {
          projection.deferred += ordered.length - position;
          break;
        }
        const event = ordered[position] as StoredEvent;
        try {
          const response = await withDeadline(
            client.schema("platform").rpc("wazzup_project_event_v1", {
              p_organization_id: config.organizationId,
              p_event_id: event.eventId,
              p_intake_sales_membership_id: owner,
              p_request_id: randomUUID(),
            }),
            Math.min(dependencies.databaseDeadlineMs, left),
          );
          const data = response.error ? null : response.data;
          if (!isObject(data) || typeof data.outcome !== "string") {
            projection.failed += 1;
            continue;
          }
          if (data.outcome === "transport_inactive") {
            projection.deferred += ordered.length - position;
            break;
          }
          if (data.outcome === "failed") projection.failed += 1;
          else if (data.outcome === "busy" || data.outcome === "deferred") projection.deferred += 1;
          else projection.projected += 1;
          if (data.newInbound === true) {
            projection.newInbound += 1;
            if (data.aiTriggerEnabled === true) aiTrigger = true;
          }
        } catch (error) {
          // Не уложились в бюджет или база не ответила: событие уже сохранено, его догрузит таймер.
          if (error instanceof DeadlineExceeded) {
            projection.deferred += ordered.length - position;
            break;
          }
          projection.failed += 1;
        }
      }
    }
    Object.assign(context, {
      projected: projection.projected,
      projection_deferred: projection.deferred,
      projection_failed: projection.failed,
      new_inbound: projection.newInbound,
    });

    // 11. Новое входящее при включённом в базе запуске ИИ: агентов запускают после ответа, без ожидания.
    if (aiTrigger) {
      try {
        dependencies.scheduleAiAgents();
        context.ai_scheduled = true;
      } catch {
        // Запуск агентов не меняет ответ Wazzup.
      }
    }

    return finish(
      200,
      {
        ok: true,
        stored: totals.stored,
        deduplicated: totals.deduplicated,
        unparsed: totals.unparsed,
        filtered: totals.filtered,
        failed: totals.failed,
        projected: projection.projected,
        deferred: projection.deferred,
      },
      "processed",
    );
  };

  // Страховка: непредвиденный сбой - всё равно JSON 503 (не страница ошибки фреймворка), счётчик в журнале.
  return async (request: Request): Promise<Response> => {
    try {
      return await handle(request);
    } catch {
      try {
        dependencies.log({ event: "wazzup_inbound", service: "evo-crm", status: 503, reason: "internal_error" });
      } catch {
        // Журнал не меняет ответ.
      }
      return new Response(JSON.stringify({ error: "wazzup_webhook_unavailable" }), { status: 503, headers: RESPONSE_HEADERS });
    }
  };
}
