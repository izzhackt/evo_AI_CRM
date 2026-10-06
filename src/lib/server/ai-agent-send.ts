import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type {
  PlatformManualSendWahaRuntime,
  PlatformManualWhatsAppSendAuthorization,
  PlatformProviderRpcClient,
} from "../platform-provider-workflows.ts";
import { readCappedBody } from "./ai-agent-files.ts";
import { aiAutosendSwitchOn, readAiSendSecret } from "./ai-agent-send-config.ts";
import { AI_AGENT_SIGNATURE_HEADER, AI_AGENT_TIMESTAMP_HEADER } from "./ai-agent-internal-auth.ts";
import {
  executePlatformManualWhatsAppSend,
  type PlatformManualWhatsAppSendExecutionResult,
} from "./platform-provider-orchestrator.ts";
import {
  PlatformWahaProviderError,
  createPlatformWahaProvider,
  type PlatformWahaChatPresence,
  type PlatformWahaProvider,
} from "./platform-waha-provider.ts";

/**
 * Отправка ночного автоответа (план ИИ-агента §11, правило 9; ADR 0031; P4):
 *
 *   POST /api/internal/ai-agent/send   {"decisionId": "<uuid>"}
 *
 * Агент зовёт этот маршрут в `send_at` решения, которое база уже проверила и
 * сохранила (`autosend_commit_v1`, статус `scheduled`). Текста в запросе нет и
 * быть не может: тело — ровно `{decisionId}`, любой другой ключ (и `text`) —
 * 400. Порядок:
 *
 *  1. Выключатель. `EVO_AI_AGENT_AUTOSEND` ровно `1` и секрет отправки задан —
 *     иначе 503 `autosend_disabled`, и ни одного вызова базы или WhatsApp.
 *  2. Подпись — схема брокера Storage со своим секретом
 *     `EVO_AI_AGENT_SEND_SECRET`:
 *       X-EVO-AI-Timestamp: <unix seconds>   (±60 с)
 *       X-EVO-AI-Worker:    <worker ref>
 *       X-EVO-AI-Signature: hex(HMAC_SHA256(secret, "<ts>.POST.<path>.<worker ref>.<sha256 hex of body>"))
 *  3. Живая проверка сессии WhatsApp без кэша: записанное здоровье пишут только
 *     вебхуки `session.status`, ночью оно устаревает.
 *  4. `platform.ai_autosend_authorize_v1` (только service_role): база ещё раз
 *     проверяет правила, берёт СОХРАНЁННЫЙ текст, создаёт авторизацию вида
 *     `ai_autosend` от ответственного сотрудника и ставит работу
 *     `manual_whatsapp_send`. Отказ — 409 (журнал и пауза уже записаны базой).
 *     Повтор того же решения возвращает прежнюю авторизацию РАНЬШЕ всех
 *     проверок базы, поэтому повтор без итога решает CRM (`settleReplay`):
 *     работу, которую ещё не брали, отправляет только в течение минуты после
 *     авторизации и при живой сессии WORKING; взятую — не трогает (409
 *     `in_progress`); завершённую без записи — только записывает.
 *  5. Отправка — тот же код, что у ручной (`executePlatformManualWhatsAppSend`:
 *     claim → WAHA → finish), с детерминированными id claim и finish от
 *     решения: повтор запроса никогда не возьмёт работу второй раз (база не
 *     переигрывает `claimed=true`, 077). Перед самим `sendText` — «прочитано» и
 *     «печатает» (только здесь; их ошибки не мешают отправке).
 *  6. Итог — `platform.ai_autosend_record_v1`; 463/475 (ограничение WhatsApp)
 *     записываются как `provider_restricted`, и база ставит паузу.
 *
 * Ручная отправка этим модулем не затронута: она не видит ни выключателя, ни
 * «печатает», ни записи итога. Маршрут виден только во внутренней сети агента;
 * edge Caddy отвечает 404 на `/api/internal/*`.
 */
export const AI_AUTOSEND_SEND_PATH = "/api/internal/ai-agent/send";
/** Тот же заголовок, что у брокера Storage (`ai-agent-storage-broker.ts`). */
export const AI_AUTOSEND_WORKER_HEADER = "X-EVO-AI-Worker";
export const AI_AUTOSEND_CLOCK_SKEW_SECONDS = 60;
/** Тело — `{"decisionId":"<uuid>"}`: 52 байта; запас на пробелы, не на текст. */
export const AI_AUTOSEND_BODY_LIMIT = 256;
/** Аренда claim: дольше «печатает» (≤ 6 с), трёх вызовов присутствия (≤ 3×5 с) и отправки (20 с). */
export const AI_AUTOSEND_VISIBILITY_TIMEOUT_SECONDS = 120;
export const AI_AUTOSEND_WORKER_REF = "ai-autosend";
/** Пространство имён UUIDv5 id запросов одного решения (claim, finish, authorize, record). */
export const AI_AUTOSEND_ID_NAMESPACE = "3c0f6a52-8d1e-5b7a-9f24-6e1d0c4b8a73";
/**
 * Коды WhatsApp «аккаунт ограничен». Ловятся, только если WAHA отдаёт их
 * HTTP-статусом `sendText`; это не подтверждено для GOWS (код может прийти в
 * теле 500 или позже ack ERROR) — до живого шага сверить (план §15 P4), а пока
 * паузу при таком сбое ставит серия из трёх ошибок (276).
 */
export const AI_AUTOSEND_RESTRICTED_STATUSES = Object.freeze([463, 475] as const);
/**
 * Повтор авторизации, работу которой ещё не брали (CRM упала между
 * авторизацией и claim), отправляет не позже этого срока после авторизации:
 * столько же неотправленная работа держит чат (266: «never claimed within a
 * minute» больше не держит очередь чата). База на повтор правил не проверяет
 * (276 отдаёт сохранённую авторизацию раньше проверок), так что пауза,
 * выключение, исключение чата и ответ сотрудника после авторизации CRM не
 * видны — их окно ограничено этой минутой. Агент повторяет 503 через 10 с.
 */
export const AI_AUTOSEND_REPLAY_WINDOW_SECONDS = 60;

const WORKER = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$/u;
const DECISION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const REASON = /^[a-z][a-z0-9_]{0,63}$/u;
const STATUS_WORD = /^[A-Z][A-Z_]{0,39}$/u; // как проверка p_provider_status в 276
const HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
});

type Env = Readonly<Record<string, string | undefined>>;

export { aiAutosendServerState, aiAutosendSwitchOn, readAiSendSecret } from "./ai-agent-send-config.ts";

export function signAiSendRequest(
  secret: string, timestamp: string, method: string, path: string, workerRef: string, body: Uint8Array | string,
): string {
  const digest = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", secret).update(`${timestamp}.${method.toUpperCase()}.${path}.${workerRef}.${digest}`).digest("hex");
}

/** UUIDv5 (RFC 9562 §5.5): SHA-1 от пространства имён и имени. */
export function uuidV5(namespace: string, name: string): string {
  const hash = createHash("sha1").update(Buffer.from(namespace.replaceAll("-", ""), "hex")).update(name, "utf8").digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Id запроса одного шага решения (claim, finish, authorize, record): повтор запроса — тот же id. */
export function aiAutosendStepId(decisionId: string, step: string): string {
  return uuidV5(AI_AUTOSEND_ID_NAMESPACE, `${decisionId}:${step}`);
}

/** «Печатает» — по длине текста: 25 знаков в секунду, от 1,5 до 6 секунд. */
export function aiAutosendTypingMs(text: string): number {
  const seconds = Math.min(6, Math.max(1.5, Array.from(text).length / 25));
  return Math.round(seconds * 1000);
}

/** Повтор авторизации без итога: состояние работы и время авторизации (276). */
export type AiAutosendReplay = Readonly<{ workState: string; authorizedAt: string }>;

export type AiAutosendAuthorizeResult =
  | Readonly<{ kind: "authorized"; authorization: PlatformManualWhatsAppSendAuthorization; replay: AiAutosendReplay | null }>
  | Readonly<{ kind: "refused"; reason: string }>
  | Readonly<{ kind: "finished"; status: "sent" | "failed" | "unknown" }>
  | Readonly<{ kind: "missing" | "invalid" | "unavailable" }>;

export type AiAutosendOutcome = Readonly<{ outcome: "sent" | "failed" | "unknown"; code: string | null }>;

export type AiAutosendSendDependencies = Readonly<{
  env(): Env;
  /** Организация CRM (`EVO_PLATFORM_ORGANIZATION_ID`); сбой конфигурации — исключение (503). */
  organizationId(): string;
  serviceClient(): Promise<PlatformProviderRpcClient>;
  /** Статус сессии WAHA сейчас, без кэша; null — проверка не может сказать. */
  probe(organizationId: string): Promise<string | null>;
  createWahaProvider(runtime: PlatformManualSendWahaRuntime): PlatformWahaProvider & PlatformWahaChatPresence;
  sleep(milliseconds: number): Promise<void>;
  now(): number;
}>;

function respond(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: HEADERS });
}
function refuse(status: number, code: string, extra: Readonly<Record<string, string>> = {}): Response {
  return respond(status, { error: { code, ...extra } });
}

function signatureMatches(expected: string, given: string): boolean {
  if (!SHA256.test(given)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(given, "hex"));
}

/** Тело: ровно `{"decisionId":"<строчный uuid>"}`; иначе null. */
export function parseAiAutosendBody(body: Uint8Array): string | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "decisionId") return null;
  const decisionId = (value as { decisionId: unknown }).decisionId;
  return typeof decisionId === "string" && DECISION_ID.test(decisionId) ? decisionId : null;
}

// ------------------------------------------------------------ authorize

const AUTHORIZATION_KEYS = Object.freeze([
  "authorized",
  "replayed",
  "ai_autosend_decision_id",
  "organization_id",
  "manual_send_authorization_id",
  "communication_conversation_id",
  "source_message_id",
  "ai_draft_id",
  "final_text",
  "final_text_sha256",
  "authorized_by_membership_id",
  "state",
  "requested_by_membership_id",
  "work_item_id",
  "work_state",
  "queue_message_id",
  "business_key_sha256",
  "waha_readiness",
  "waha_readiness_evidence_kind",
  "waha_readiness_fresh",
  "waha_readiness_observed_at",
] as const);
/** Повтор авторизации (`replayed`) добавляет состояние решения в журнале. */
const AUTHORIZATION_REPLAY_KEYS = Object.freeze([...AUTHORIZATION_KEYS, "decision_status"] as const);
const REFUSAL_KEYS = Object.freeze(["authorized", "reason", "reasonRu", "decisionId", "status", "sendAt"] as const);
/** Решение уже с итогом: повтор запроса ничего не берёт и не пишет. */
const FINISHED_DECISION_STATUSES = Object.freeze(["sent", "failed", "unknown"] as const);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const uuid = (value: unknown): string | null => (typeof value === "string" && UUID.test(value.toLowerCase()) ? value.toLowerCase() : null);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(value);
  return own.length === keys.length && own.every((key) => keys.includes(key));
};

/**
 * Ответ `ai_autosend_authorize_v1` (276) → авторизация для общего кода
 * отправки. Отказ — `{authorized: false, reason, …}`; успех — поля ответа
 * запроса ручной отправки (050/266), `authorized: true`, `replayed` и id
 * решения. Повтор уже записанного решения с итогом — `finished`: ни claim,
 * ни записи. Любая другая форма — сбой: в WhatsApp ничего не уходит. Текст
 * берётся только у базы, и CRM ещё раз сверяет его SHA-256.
 */
export function parseAiAutosendAuthorization(
  data: unknown,
  expected: Readonly<{ organizationId: string; decisionId: string; observedAt: string }>,
): AiAutosendAuthorizeResult {
  if (!isRecord(data)) return { kind: "unavailable" };
  if (data.authorized === false) {
    if (Object.keys(data).some((key) => !(REFUSAL_KEYS as readonly string[]).includes(key))) return { kind: "unavailable" };
    if (data.decisionId !== undefined && uuid(data.decisionId) !== expected.decisionId) return { kind: "unavailable" };
    return typeof data.reason === "string" && REASON.test(data.reason) ? { kind: "refused", reason: data.reason } : { kind: "unavailable" };
  }
  if (data.authorized !== true || typeof data.replayed !== "boolean") return { kind: "unavailable" };
  if (!exactKeys(data, data.replayed ? AUTHORIZATION_REPLAY_KEYS : AUTHORIZATION_KEYS)) return { kind: "unavailable" };
  if (uuid(data.ai_autosend_decision_id) !== expected.decisionId) return { kind: "unavailable" };
  if (data.replayed && (FINISHED_DECISION_STATUSES as readonly unknown[]).includes(data.decision_status)) {
    return { kind: "finished", status: data.decision_status as (typeof FINISHED_DECISION_STATUSES)[number] };
  }
  // Повтор без итога — только решение в `authorized` (275: авторизация есть ровно у authorized/sent/failed/unknown).
  if (data.replayed && data.decision_status !== "authorized") return { kind: "unavailable" };
  const organizationId = uuid(data.organization_id);
  const authorizationId = uuid(data.manual_send_authorization_id);
  const conversationId = uuid(data.communication_conversation_id);
  const sourceMessageId = uuid(data.source_message_id);
  const authorId = uuid(data.authorized_by_membership_id);
  const workItemId = uuid(data.work_item_id);
  const finalText = data.final_text;
  const finalTextSha256 = data.final_text_sha256;
  const queueMessageId = typeof data.queue_message_id === "number" && Number.isSafeInteger(data.queue_message_id) && data.queue_message_id > 0
    ? String(data.queue_message_id)
    : typeof data.queue_message_id === "string" && /^[1-9]\d{0,18}$/u.test(data.queue_message_id) ? data.queue_message_id : null;
  if (
    organizationId !== expected.organizationId || !authorizationId || !conversationId || !sourceMessageId || !authorId || !workItemId
    || data.ai_draft_id !== null
    || typeof finalText !== "string" || finalText !== finalText.trim() || finalText.length < 1 || finalText.length > 1000
    || typeof finalTextSha256 !== "string" || !SHA256.test(finalTextSha256)
    || createHash("sha256").update(finalText, "utf8").digest("hex") !== finalTextSha256
    || data.state !== "manual_send_authorized"
    // Первый раз работа только что поставлена; повтор — в любом её состоянии
    // (claim тем же id её второй раз не возьмёт).
    || (data.replayed ? typeof data.work_state !== "string" || !REASON.test(data.work_state) : data.work_state !== "queued")
    || uuid(data.requested_by_membership_id) !== authorId
    || typeof data.business_key_sha256 !== "string" || !SHA256.test(data.business_key_sha256)
    || queueMessageId === null
    || data.waha_readiness !== "ready" || data.waha_readiness_evidence_kind !== "provider_observed" || data.waha_readiness_fresh !== true
  ) {
    return { kind: "unavailable" };
  }
  const authorizedAt = typeof data.waha_readiness_observed_at === "string" && Number.isFinite(Date.parse(data.waha_readiness_observed_at))
    ? data.waha_readiness_observed_at : null;
  // Повтор без времени авторизации не проверить на срок — не отправлять.
  if (data.replayed && authorizedAt === null) return { kind: "unavailable" };
  const observedAt = authorizedAt ?? expected.observedAt;
  return {
    kind: "authorized",
    replay: data.replayed ? Object.freeze({ workState: data.work_state as string, authorizedAt: authorizedAt! }) : null,
    authorization: Object.freeze({
      organizationId,
      manualSendAuthorizationId: authorizationId,
      communicationConversationId: conversationId,
      sourceMessageId,
      aiDraftId: null,
      finalText,
      finalTextSha256,
      authorizedByMembershipId: authorId,
      state: "manual_send_authorized" as const,
      requestedByMembershipId: authorId,
      workItemId,
      workState: "queued" as const,
      queueMessageId,
      businessKeySha256: data.business_key_sha256,
      // Живая проверка этого запроса (276 пишет время авторизации), не записанное здоровье.
      wahaReadiness: "ready" as const,
      wahaReadinessEvidenceKind: "provider_observed" as const,
      wahaReadinessFresh: true as const,
      wahaReadinessObservedAt: observedAt,
    }),
  };
}

async function authorize(
  client: PlatformProviderRpcClient,
  input: Readonly<{ organizationId: string; decisionId: string; providerStatus: string; observedAt: string }>,
): Promise<AiAutosendAuthorizeResult> {
  try {
    const response = await client.schema("platform").rpc("ai_autosend_authorize_v1", {
      p_organization_id: input.organizationId,
      p_decision_id: input.decisionId,
      p_provider_status: input.providerStatus,
      p_request_id: aiAutosendStepId(input.decisionId, "authorize"),
    });
    if (!isRecord(response) || !("error" in response)) return { kind: "unavailable" };
    const error = response.error as { code?: unknown } | null;
    if (error) {
      if (error.code === "P0002") return { kind: "missing" };
      if (error.code === "22023") return { kind: "invalid" };
      return { kind: "unavailable" };
    }
    return parseAiAutosendAuthorization(response.data, input);
  } catch {
    return { kind: "unavailable" };
  }
}

// ------------------------------------------------------------ outcome

/** Что вернул WhatsApp на `sendText` этого запроса (ошибка провайдера), если он вообще звался. */
export type AiAutosendProviderFailure = Readonly<{ code: string; httpStatus: number | null }> | null;

/**
 * Итог взятой и завершённой отправки → запись журнала автоответчика. 463/475 —
 * ограничение аккаунта WhatsApp: `provider_restricted`, база ставит паузу.
 * Невзятая работа (`not_claimed`) итога не имеет и сюда не попадает.
 */
export function aiAutosendOutcome(
  execution: Extract<PlatformManualWhatsAppSendExecutionResult, { status: "finished" }>,
  failure: AiAutosendProviderFailure,
): AiAutosendOutcome {
  const outcome = execution.result.outcome;
  if (outcome === "succeeded") return { outcome: "sent", code: null };
  if (failure?.httpStatus != null && (AI_AUTOSEND_RESTRICTED_STATUSES as readonly number[]).includes(failure.httpStatus)) {
    return { outcome: "failed", code: "provider_restricted" };
  }
  if (outcome === "terminal_error") return { outcome: "failed", code: failure?.code ?? "send_failed" };
  return { outcome: "unknown", code: failure?.code ?? "send_unknown" };
}

const RECORD_RETRY_DELAYS_MS = Object.freeze([250, 1000]);

/**
 * `ai_autosend_record_v1`: итог — один раз на решение и итог (id запроса — от
 * решения, итога и кода). Повтор с тем же вводом возвращает прежнюю квитанцию.
 */
async function record(
  client: PlatformProviderRpcClient,
  input: Readonly<{ organizationId: string; decisionId: string } & AiAutosendOutcome>,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<boolean> {
  for (let attempt = 0; attempt <= RECORD_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await sleep(RECORD_RETRY_DELAYS_MS[attempt - 1]!);
    try {
      const response = await client.schema("platform").rpc("ai_autosend_record_v1", {
        p_organization_id: input.organizationId,
        p_decision_id: input.decisionId,
        p_outcome: input.outcome,
        p_code: input.code,
        p_request_id: aiAutosendStepId(input.decisionId, `record:${input.outcome}:${input.code ?? "-"}`),
      });
      const error = isRecord(response) ? response.error as { code?: unknown } | null : { code: "shape" };
      if (!error) return true;
      // Итог уже записан (другим вводом того же шага) — повторять нечего.
      if (error.code === "PT409" || error.code === "23505") return true;
      if (error.code === "22023" || error.code === "P0002" || error.code === "42501") return false;
    } catch {
      // сеть — ещё раз
    }
  }
  return false;
}

// ------------------------------------------------------------ replay

/** Работа завершена, итог не записан (запись не удалась): записать по состоянию работы, без отправки. */
const REPLAY_FINISHED_WORK: Readonly<Record<string, AiAutosendOutcome>> = Object.freeze({
  succeeded: { outcome: "sent", code: null },
  dead_lettered: { outcome: "failed", code: "send_failed" },
  unknown_manual_review: { outcome: "unknown", code: "send_unknown" },
  conflict_manual_review: { outcome: "unknown", code: "send_unknown" },
});

export type AiAutosendReplayStep =
  | Readonly<{ step: "send" }>
  | Readonly<{ step: "in_progress"; workState: string }>
  | Readonly<{ step: "close"; outcome: AiAutosendOutcome; refusal: string | null }>;

/**
 * Что делать с повтором авторизации, у которой нет итога (276 отдаёт её до
 * всех своих проверок):
 *  - работа в очереди (claim не было) — отправить, только если авторизации не
 *    больше `AI_AUTOSEND_REPLAY_WINDOW_SECONDS` и сессия сейчас WORKING; иначе
 *    закрыть итогом `failed` (`authorization_expired` / `provider_down`) — в
 *    WhatsApp ничего не уходит;
 *  - работа взята и идёт (`leased`, `retry_wait` и любое незнакомое
 *    состояние) — `in_progress`: ни claim, ни записи; итог запишет исходный
 *    запрос (или сверка);
 *  - работа завершена без записи итога — записать итог по её состоянию.
 */
export function aiAutosendReplayStep(
  replay: AiAutosendReplay,
  input: Readonly<{ now: number; providerStatus: string }>,
): AiAutosendReplayStep {
  if (replay.workState === "queued") {
    const ageSeconds = (input.now - Date.parse(replay.authorizedAt)) / 1000;
    if (!(ageSeconds <= AI_AUTOSEND_REPLAY_WINDOW_SECONDS && ageSeconds >= -AI_AUTOSEND_CLOCK_SKEW_SECONDS)) {
      return { step: "close", outcome: { outcome: "failed", code: "authorization_expired" }, refusal: "authorization_expired" };
    }
    if (input.providerStatus !== "WORKING") {
      return { step: "close", outcome: { outcome: "failed", code: "provider_down" }, refusal: "provider_down" };
    }
    return { step: "send" };
  }
  if (Object.hasOwn(REPLAY_FINISHED_WORK, replay.workState)) {
    return { step: "close", outcome: REPLAY_FINISHED_WORK[replay.workState]!, refusal: null };
  }
  return { step: "in_progress", workState: replay.workState };
}

// ------------------------------------------------------------ handler

const defaultDependencies: AiAutosendSendDependencies = {
  env: () => process.env,
  organizationId: () => {
    const id = (process.env.EVO_PLATFORM_ORGANIZATION_ID ?? "").trim().toLowerCase();
    if (!UUID.test(id) || id === "00000000-0000-0000-0000-000000000000") throw new Error("organization_unconfigured");
    return id;
  },
  async serviceClient() {
    // Ленивая загрузка: выключенный маршрут не трогает ни конфигурацию Supabase, ни клиент.
    const [{ getPlatformSupabaseBackendConfig }, { createPlatformSupabaseServiceClient }] = await Promise.all([
      import("./platform-supabase-backend-config.ts"), import("./platform-supabase-service-client.ts"),
    ]);
    return createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
  },
  async probe(organizationId) {
    const { probePlatformWahaSessionLiveUncached } = await import("./platform-waha-live-health.ts");
    return (await probePlatformWahaSessionLiveUncached(organizationId))?.status ?? null;
  },
  createWahaProvider: (runtime) => createPlatformWahaProvider(runtime),
  sleep: (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); }),
  now: () => Date.now(),
};

export function createAiAutosendSendHandler(dependencies: AiAutosendSendDependencies = defaultDependencies) {
  return async function POST(request: Request): Promise<Response> {
    try {
      // 1. Выключатель — раньше всего остального: выключено — ни подписи, ни базы.
      const env = dependencies.env();
      const secret = aiAutosendSwitchOn(env) ? readAiSendSecret(env) : null;
      if (!secret) return refuse(503, "autosend_disabled");

      const url = new URL(request.url);
      if (url.pathname !== AI_AUTOSEND_SEND_PATH || url.search !== "") return refuse(404, "not_found");
      if (request.method.toUpperCase() !== "POST") return refuse(405, "method_not_allowed", { allow: "POST" });

      // 2. Подпись: время, воркер, тело и путь — в одной строке.
      const timestamp = request.headers.get(AI_AGENT_TIMESTAMP_HEADER)?.trim() ?? "";
      const signature = request.headers.get(AI_AGENT_SIGNATURE_HEADER)?.trim().toLowerCase() ?? "";
      const workerRef = request.headers.get(AI_AUTOSEND_WORKER_HEADER)?.trim() ?? "";
      if (!/^\d{1,12}$/u.test(timestamp) || !signature || !WORKER.test(workerRef)) return refuse(401, "unauthorized");
      if (Math.abs(dependencies.now() / 1000 - Number(timestamp)) > AI_AUTOSEND_CLOCK_SKEW_SECONDS) return refuse(401, "unauthorized");
      if (!/^application\/json(?:;\s*charset=utf-8)?$/iu.test(request.headers.get("content-type") ?? "")) {
        return refuse(415, "json_required");
      }
      const body = await readCappedBody(request, AI_AUTOSEND_BODY_LIMIT);
      if (body === "too_large") return refuse(413, "too_large");
      if (body === "unreadable") return refuse(400, "invalid_request");
      if (!signatureMatches(signAiSendRequest(secret, timestamp, "POST", url.pathname, workerRef, body), signature)) {
        return refuse(401, "unauthorized");
      }
      // 3. Тело — только id решения; текст CRM берёт у базы.
      const decisionId = parseAiAutosendBody(body);
      if (!decisionId) return refuse(400, "invalid_request");

      const organizationId = dependencies.organizationId();
      const client = await dependencies.serviceClient();
      // 4. Живая сессия и авторизация базы.
      const observedAt = new Date(dependencies.now()).toISOString();
      const status = await dependencies.probe(organizationId).catch(() => null);
      const providerStatus = status !== null && STATUS_WORD.test(status) ? status : "UNKNOWN";
      const authorized = await authorize(client, { organizationId, decisionId, providerStatus, observedAt });
      if (authorized.kind === "refused") return refuse(409, "refused", { reason: authorized.reason });
      // Повтор уже записанного решения: итог есть, отправлять и писать нечего.
      if (authorized.kind === "finished") return refuse(409, "already_finished", { status: authorized.status });
      if (authorized.kind === "missing") return refuse(404, "decision_not_found");
      if (authorized.kind === "invalid") return refuse(400, "invalid_request");
      if (authorized.kind !== "authorized") return refuse(503, "unavailable");

      // Повтор без итога: база правил не проверяла — решает CRM (срок, сессия, состояние работы).
      if (authorized.replay) {
        const replay = aiAutosendReplayStep(authorized.replay, { now: dependencies.now(), providerStatus });
        // Работа взята и идёт: итог за исходным запросом; повтор её не берёт и ничего не пишет.
        if (replay.step === "in_progress") return refuse(409, "in_progress", { workState: replay.workState });
        if (replay.step === "close") {
          const recorded = await record(client, { organizationId, decisionId, ...replay.outcome }, dependencies.sleep);
          if (!recorded) return refuse(503, "record_unavailable", { outcome: replay.outcome.outcome });
          return replay.refusal ? refuse(409, "refused", { reason: replay.refusal }) : respond(200, replay.outcome);
        }
      }

      // 5. «Прочитано», «печатает» и отправка тем же кодом, что у ручной.
      let failure: AiAutosendProviderFailure = null;
      const createWahaProvider = (runtime: PlatformManualSendWahaRuntime): PlatformWahaProvider => {
        const provider = dependencies.createWahaProvider(runtime);
        return Object.freeze({
          getMessage: provider.getMessage,
          findUniqueMessage: provider.findUniqueMessage,
          async sendText(input) {
            const chat = { recipientId: input.recipientId };
            await provider.sendSeen(chat).catch(() => undefined);
            await provider.startTyping(chat).catch(() => undefined);
            await dependencies.sleep(aiAutosendTypingMs(input.text));
            await provider.stopTyping(chat).catch(() => undefined);
            try {
              return await provider.sendText(input);
            } catch (error) {
              if (error instanceof PlatformWahaProviderError) failure = { code: error.code, httpStatus: error.statusCode };
              throw error;
            }
          },
        });
      };
      let execution: PlatformManualWhatsAppSendExecutionResult;
      try {
        execution = await executePlatformManualWhatsAppSend(client, {
          authorization: authorized.authorization,
          visibilityTimeoutSeconds: AI_AUTOSEND_VISIBILITY_TIMEOUT_SECONDS,
          workerRef: AI_AUTOSEND_WORKER_REF,
          claimRequestId: aiAutosendStepId(decisionId, "claim"),
          completionRequestId: aiAutosendStepId(decisionId, "complete"),
        }, { createWahaProvider }, { quoteSource: false });
      } catch {
        // Claim или finish недоступны: итог неизвестен, повтор того же решения
        // работу второй раз не возьмёт.
        return refuse(503, "unavailable");
      }

      // Работу не взяли: её уже взял другой запрос того же решения (он и
      // запишет итог) или впереди в чате другая отправка. Итога нет — ничего не
      // писать (иначе запись `unknown` закрыла бы решение раньше настоящего
      // итога); агент повторит через 10 с, и повтор решит по состоянию работы.
      if (execution.status === "not_claimed") return refuse(503, "not_claimed");

      // 6. Итог в журнал автоответчика (и пауза базы на 463/475 или серии сбоев).
      const outcome = aiAutosendOutcome(execution, failure);
      const recorded = await record(client, { organizationId, decisionId, ...outcome }, dependencies.sleep);
      if (!recorded) return refuse(503, "record_unavailable", { outcome: outcome.outcome });
      return respond(200, outcome);
    } catch {
      return refuse(503, "unavailable");
    }
  };
}
