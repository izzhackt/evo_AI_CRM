import "server-only";

import { isStaffPreview, staffCanAccessRoute, staffHasPermission } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import { parsePlatformRouteUuid } from "../platform-communications.ts";
import { normalizeAiAnswerView, type AiAnswerView, type AiIntent } from "../v3/ai-agent.ts";
import { normalizeAiMemoryView, type AiMemoryView } from "../v3/ai-agent-memory.ts";
import { normalizeAiAutosendChat, type AiAutosendChat } from "../v3/ai-agent-autosend.ts";
import { aiAgentSignedHeaders, readAiAgentConfig, type AiAgentConfig } from "./ai-agent-internal-auth.ts";
import { aiAutosendServerState } from "./ai-agent-send-config.ts";

/**
 * Маршруты окна ИИ в чате продаж (план §4.3, §6.7, §12.1). Браузер никогда не
 * обращается к агенту напрямую:
 *
 *  - `POST /api/v3/ai-agent/conversations/[id]/answer` — билет базы по сессии
 *    сотрудника (`platform.ai_agent_ticket_v1`: право ai.agent.use, чтение
 *    диалога продаж, согласие на Gemini), подписанный запрос к агенту по
 *    внутренней сети и поток SSE агента — в браузер без буферизации. Закрыл
 *    браузер поток — CRM обрывает запрос к агенту;
 *  - `GET  /api/v3/ai-agent/conversations/[id]/answer` — сохранённый ответ и
 *    его актуальность (`ai_agent_answer_current_v1`, источники — из базы, 270),
 *    без вызова агента и Gemini;
 *  - `POST /api/v3/ai-agent/answers/[id]/insert` — «Вставить в ответ»
 *    (`ai_agent_answer_insert_v1`): проверенный сохранённый текст, 409 — ответ
 *    устарел. Ничего не отправляет;
 *  - `GET/DELETE /api/v3/ai-agent/conversations/[id]/memory` (P3) — «Что ИИ
 *    знает о клиенте» и «Забыть сводку» (`ai_agent_memory_v1`,
 *    `ai_agent_memory_clear_v1`, 274), без агента и Gemini;
 *  - `GET/PUT /api/v3/ai-agent/conversations/[id]/autosend` (P4) —
 *    «Автоответчик в этом чате»: состояние и исключение чата
 *    (`ai_agent_autosend_chat_v1`, `ai_agent_autosend_exclusion_v1`, 277).
 *
 * Сами маршруты ничего не решают: доступ, актуальность и лимиты держит база.
 * Просмотр роли администратором ИИ не вызывает. Без секрета агента функция
 * выключена (503 `ai_agent_off`), остальная CRM работает как обычно.
 */
const JSON_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
});
const SSE_HEADERS = Object.freeze({
  "Content-Type": "text/event-stream; charset=utf-8",
  // no-transform: сжатие и прокси не держат кадры у себя.
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
});
/** Сколько ждать заголовков агента (билет, поиск ещё не начат). */
export const AI_AGENT_HEADERS_TIMEOUT_MS = 10_000;
/** Предел одного потока: генерация агента — до 30 с, с запасом на поиск и проверки. */
export const AI_AGENT_STREAM_LIMIT_MS = 120_000;
const AGENT_ERROR_BODY_LIMIT = 4096;

type Authorization =
  | Readonly<{ status: "authorized"; actor: ActivePlatformActor }>
  | Readonly<{ status: "anonymous" | "forbidden" | "preview" | "unavailable"; actor: null }>;

export type AiTicketResult =
  | Readonly<{ status: "issued"; ticket: string }>
  | Readonly<{ status: "refused"; code: "consent_required" | "rate_limited" | "forbidden" | "invalid_request" | "unavailable" }>;

export type AiInsertResult = Readonly<{ status: "inserted"; text: string }>
  | Readonly<{ status: "stale" | "forbidden" | "not_found" | "invalid" | "unavailable" }>;

export type AiAgentRouteDependencies = Readonly<{
  authorize(): Promise<Authorization>;
  config(): AiAgentConfig | null;
  issueTicket(actor: ActivePlatformActor, input: Readonly<{ conversationId: string; refId: string | null }>): Promise<AiTicketResult>;
  readAnswer(actor: ActivePlatformActor, conversationId: string, intent: AiIntent | null): Promise<AiAnswerView | "forbidden">;
  insertAnswer(actor: ActivePlatformActor, answerId: string, part: "reply" | "question"): Promise<AiInsertResult>;
  fetch: typeof fetch;
  now(): number;
}>;

type RpcError = Readonly<{ code?: string; message?: string }>;

export function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: JSON_HEADERS });
}
export function failure(status: number, code: string, extra: Readonly<Record<string, unknown>> = {}): Response {
  return json(status, { error: { code, ...extra } });
}
function refusal(status: Exclude<Authorization["status"], "authorized">): Response {
  if (status === "anonymous") return failure(401, "authentication_required");
  if (status === "preview") return failure(403, "preview");
  if (status === "forbidden") return failure(403, "forbidden");
  return failure(503, "unavailable");
}

/** Тот же Origin/Host/протокол, что у остальных POST-маршрутов staff CRM. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const host = request.headers.get("host")?.trim();
    const forwardedProto = request.headers.get("x-forwarded-proto")?.trim();
    return origin === parsed.origin && !!host && !host.includes(",") && !/\s/u.test(host)
      && parsed.host === host.toLowerCase()
      && (forwardedProto === undefined || /^(?:http|https)$/u.test(forwardedProto))
      && parsed.protocol === (forwardedProto ? `${forwardedProto}:` : new URL(request.url).protocol);
  } catch {
    return false;
  }
}

/** Небольшое тело JSON с точным набором ключей; иначе null. */
export async function readJsonObject(request: Request, allowed: readonly string[], limit = 1024): Promise<Record<string, unknown> | null> {
  const declared = request.headers.get("content-length");
  if (!/^application\/json(?:;\s*charset=utf-8)?$/iu.test(request.headers.get("content-type") ?? "")
    || (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > limit))) return null;
  // Тело читается с пределом по мере прихода: ни ложная длина, ни поток без
  // неё не заставят держать в памяти больше предела (1 КБ по умолчанию).
  let raw = "";
  try {
    const reader = request.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch {
    return null;
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key))) return null;
  return value as Record<string, unknown>;
}

async function defaultAuthorize(): Promise<Authorization> {
  const { resolvePlatformActor } = await import("../platform-auth.ts");
  const result = await resolvePlatformActor();
  if (result.status === "anonymous") return { status: "anonymous", actor: null };
  if (result.status === "invalid") return { status: "unavailable", actor: null };
  if (isStaffPreview(result.actor)) return { status: "preview", actor: null };
  if (!staffHasPermission(result.actor, "ai.agent.use") || !staffCanAccessRoute(result.actor, "/v3/inbox")) {
    return { status: "forbidden", actor: null };
  }
  return { status: "authorized", actor: result.actor };
}

async function rpcClient() {
  const { createSupabaseServerClient } = await import("../supabase/server.ts");
  return (await createSupabaseServerClient()).schema("platform");
}

function ticketRefusal(error: RpcError): AiTicketResult {
  if (error.code === "PT412") return { status: "refused", code: "consent_required" };
  if (error.code === "PT429") return { status: "refused", code: "rate_limited" };
  if (error.code === "42501") return { status: "refused", code: "forbidden" };
  if (error.code === "22023") return { status: "refused", code: "invalid_request" };
  return { status: "refused", code: "unavailable" };
}

const defaultDependencies: AiAgentRouteDependencies = {
  authorize: defaultAuthorize,
  config: () => readAiAgentConfig(),
  async issueTicket(actor, { conversationId, refId }) {
    const { data, error } = await (await rpcClient()).rpc("ai_agent_ticket_v1", {
      p_organization_id: actor.organizationId, p_purpose: "answer", p_conversation_id: conversationId, p_ref_id: refId,
    });
    if (error) return ticketRefusal(error);
    const ticket = typeof data === "object" && data !== null ? (data as Record<string, unknown>).ticket : null;
    return typeof ticket === "string" && /^[0-9a-f]{64}$/u.test(ticket)
      ? { status: "issued", ticket } : { status: "refused", code: "unavailable" };
  },
  async readAnswer(actor, conversationId, intent) {
    const { data, error } = await (await rpcClient()).rpc("ai_agent_answer_current_v1", {
      p_organization_id: actor.organizationId, p_conversation_id: conversationId, p_intent: intent,
    });
    if (error) {
      if (error.code === "42501") return "forbidden";
      throw new Error("ai_answer_unavailable");
    }
    return normalizeAiAnswerView(data);
  },
  async insertAnswer(actor, answerId, part) {
    const { data, error } = await (await rpcClient()).rpc("ai_agent_answer_insert_v1", {
      p_organization_id: actor.organizationId, p_answer_id: answerId, p_part: part,
    });
    if (error) {
      if (error.code === "PT409") return { status: "stale" };
      if (error.code === "42501") return { status: "forbidden" };
      if (error.code === "P0002") return { status: "not_found" };
      if (error.code === "22023") return { status: "invalid" };
      return { status: "unavailable" };
    }
    const text = typeof data === "object" && data !== null ? (data as Record<string, unknown>).text : null;
    return typeof text === "string" && text.trim() ? { status: "inserted", text } : { status: "unavailable" };
  },
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
};

type ConversationContext = Readonly<{ params: Promise<Readonly<{ conversationId: string }>> }>;
type AnswerContext = Readonly<{ params: Promise<Readonly<{ answerId: string }>> }>;

/**
 * Коды агента, которые окно показывает своим текстом; остальное — «недоступен».
 * `lab_*` — Лаборатория (P2): знания или предложение изменились (409), правка
 * больше не применима (422), проверка устарела или её нет (409).
 */
const AGENT_CODES = new Set(["consent_required", "rate_limited", "budget_exhausted", "model_unpriced", "gemini_billing",
  "gemini_quota_day", "agent_unavailable", "superseded", "taken_over",
  "lab_changed", "lab_edit_invalid", "lab_expired", "lab_session_missing"]);
const STATUS_FOR_CODE: Readonly<Record<string, number>> = {
  consent_required: 412, rate_limited: 429, budget_exhausted: 402, model_unpriced: 402, gemini_billing: 402,
  gemini_quota_day: 429, superseded: 409, taken_over: 409,
  lab_changed: 409, lab_edit_invalid: 422, lab_expired: 409, lab_session_missing: 409,
};

/** Отказ агента до открытия потока: JSON `{error: {code, message_ru, status}}`. */
export async function agentRefusal(upstream: Response): Promise<Response> {
  let code = "agent_unavailable";
  try {
    const reader = upstream.body?.getReader();
    let raw = "";
    if (reader) {
      const decoder = new TextDecoder();
      while (raw.length <= AGENT_ERROR_BODY_LIMIT) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
      }
      await reader.cancel().catch(() => undefined);
    }
    const parsed = JSON.parse(raw) as { error?: { code?: unknown } };
    const candidate = parsed?.error?.code;
    if (typeof candidate === "string" && AGENT_CODES.has(candidate)) code = candidate;
  } catch {
    // Неразборчивый ответ агента — «недоступен», текст агента браузеру не уходит.
  }
  // 401 (подпись) и отказ билета (403) — неисправность связки CRM ↔ агент, а
  // не решение для сотрудника: «ИИ-агент сейчас недоступен».
  return failure(STATUS_FOR_CODE[code] ?? 503, code);
}

const encoder = new TextEncoder();
const unavailableFrame = () => encoder.encode(
  `\n\nevent: error\ndata: ${JSON.stringify({ code: "agent_unavailable", message_ru: "ИИ-агент сейчас недоступен.", status: 503 })}\n\n`,
);

/**
 * Подписанный POST к агенту и его поток SSE — в браузер без буферизации
 * (§4.3): окно ответа (P1) и Лаборатория (P2). Отказ агента до открытия
 * потока — JSON `{error: {code}}` со своим статусом; обрыв потока — кадр
 * ошибки; закрыл браузер поток — CRM обрывает запрос к агенту.
 */
export async function streamFromAgent(
  request: Request,
  config: AiAgentConfig,
  path: string,
  payload: string,
  dependencies: Pick<AiAgentRouteDependencies, "fetch" | "now">,
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  const headersTimer = setTimeout(abort, AI_AGENT_HEADERS_TIMEOUT_MS);
  const release = () => {
    clearTimeout(headersTimer);
    request.signal.removeEventListener("abort", abort);
  };
  let upstream: Response;
  try {
    upstream = await dependencies.fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...aiAgentSignedHeaders(config, "POST", path, payload, dependencies.now()),
      },
      body: payload,
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    release();
    return failure(503, "agent_unavailable");
  }
  clearTimeout(headersTimer);
  if (upstream.status !== 200 || !(upstream.headers.get("content-type") ?? "").startsWith("text/event-stream") || !upstream.body) {
    release();
    return agentRefusal(upstream);
  }

  const reader = upstream.body.getReader();
  const streamTimer = setTimeout(abort, AI_AGENT_STREAM_LIMIT_MS);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(streamTimer);
    release();
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(output) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish();
          output.close();
          return;
        }
        output.enqueue(value);
      } catch {
        // Агент оборвал поток (упал, перезапуск, предел времени): кадр
        // ошибки — последнее, что увидит окно.
        finish();
        if (!request.signal.aborted) output.enqueue(unavailableFrame());
        output.close();
      }
    },
    async cancel(reason) {
      // Браузер закрыл поток — запрос к агенту обрывается.
      finish();
      controller.abort();
      await reader.cancel(reason).catch(() => undefined);
    },
  });
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}

export function createAiAnswerStreamHandler(dependencies: AiAgentRouteDependencies = defaultDependencies) {
  return async function POST(request: Request, context: ConversationContext): Promise<Response> {
    try {
      if (!sameOrigin(request)) return failure(403, "forbidden");
      const authorization = await dependencies.authorize();
      if (authorization.status !== "authorized") return refusal(authorization.status);
      const conversationId = parsePlatformRouteUuid((await context.params).conversationId);
      const body = await readJsonObject(request, ["intent", "refId"]);
      const intent = body?.intent === "reply" || body?.intent === "followup" ? body.intent : null;
      const refId = body?.refId === null || body?.refId === undefined ? null : parsePlatformRouteUuid(body.refId);
      if (!conversationId || !body || !intent || (body.refId !== null && body.refId !== undefined && refId === null)) {
        return failure(400, "invalid_request");
      }
      const config = dependencies.config();
      if (!config) return failure(503, "ai_agent_off");
      const ticket = await dependencies.issueTicket(authorization.actor, { conversationId, refId });
      if (ticket.status !== "issued") {
        const status = { consent_required: 412, rate_limited: 429, forbidden: 403, invalid_request: 400, unavailable: 503 }[ticket.code];
        return failure(status, ticket.code);
      }

      return await streamFromAgent(request, config, "/v1/answer", JSON.stringify({ ticket: ticket.ticket, intent }), dependencies);
    } catch {
      return failure(503, "unavailable");
    }
  };
}

export function createAiAnswerReadHandler(dependencies: AiAgentRouteDependencies = defaultDependencies) {
  return async function GET(request: Request, context: ConversationContext): Promise<Response> {
    try {
      const authorization = await dependencies.authorize();
      if (authorization.status !== "authorized") return refusal(authorization.status);
      const conversationId = parsePlatformRouteUuid((await context.params).conversationId);
      const url = new URL(request.url);
      const keys = [...url.searchParams.keys()];
      const rawIntent = url.searchParams.get("intent");
      const intent = rawIntent === "reply" || rawIntent === "followup" ? rawIntent : null;
      if (!conversationId || keys.some((key) => key !== "intent") || keys.length > 1 || (rawIntent !== null && intent === null)) {
        return failure(400, "invalid_request");
      }
      const view = await dependencies.readAnswer(authorization.actor, conversationId, intent);
      if (view === "forbidden") return failure(403, "forbidden");
      return json(200, { view, featureOn: dependencies.config() !== null });
    } catch {
      return failure(503, "unavailable");
    }
  };
}

export function createAiAnswerInsertHandler(dependencies: AiAgentRouteDependencies = defaultDependencies) {
  return async function POST(request: Request, context: AnswerContext): Promise<Response> {
    try {
      if (!sameOrigin(request)) return failure(403, "forbidden");
      const authorization = await dependencies.authorize();
      if (authorization.status !== "authorized") return refusal(authorization.status);
      const answerId = parsePlatformRouteUuid((await context.params).answerId);
      const body = await readJsonObject(request, ["part"]);
      const part = body?.part === "reply" || body?.part === "question" ? body.part : null;
      if (!answerId || !part) return failure(400, "invalid_request");
      const result = await dependencies.insertAnswer(authorization.actor, answerId, part);
      if (result.status === "inserted") return json(200, { text: result.text });
      if (result.status === "stale") return failure(409, "stale_answer");
      if (result.status === "forbidden") return failure(403, "forbidden");
      if (result.status === "not_found") return failure(404, "not_found");
      if (result.status === "invalid") return failure(400, "invalid_request");
      return failure(503, "unavailable");
    } catch {
      return failure(503, "unavailable");
    }
  };
}

// ------------------------------------------------------------------ P3 память

export type AiMemoryClearResult =
  /**
   * Квитанция 274: `deleted` — была ли строка памяти; `enqueued` — поставлена ли
   * пересборка в очередь агента сразу (память работает и собирать есть что).
   * Повтор тем же id отдаёт прежнюю квитанцию.
   */
  | Readonly<{ status: "cleared"; deleted: boolean; enqueued: boolean }>
  | Readonly<{ status: "conflict" | "forbidden" | "not_found" | "invalid" | "unavailable" }>;

export type AiMemoryRouteDependencies = Readonly<{
  authorize(): Promise<Authorization>;
  readMemory(actor: ActivePlatformActor, conversationId: string): Promise<AiMemoryView | "forbidden" | "not_found">;
  clearMemory(actor: ActivePlatformActor, conversationId: string, requestId: string): Promise<AiMemoryClearResult>;
}>;

const defaultMemoryDependencies: AiMemoryRouteDependencies = {
  authorize: defaultAuthorize,
  async readMemory(actor, conversationId) {
    const { data, error } = await (await rpcClient()).rpc("ai_agent_memory_v1", {
      p_organization_id: actor.organizationId, p_conversation_id: conversationId,
    });
    if (error) {
      if (error.code === "42501") return "forbidden";
      if (error.code === "P0002") return "not_found";
      throw new Error("ai_memory_unavailable");
    }
    return normalizeAiMemoryView(data);
  },
  async clearMemory(actor, conversationId, requestId) {
    const { data, error } = await (await rpcClient()).rpc("ai_agent_memory_clear_v1", {
      p_organization_id: actor.organizationId, p_conversation_id: conversationId, p_request_id: requestId,
    });
    return aiMemoryClearOutcome(error, data);
  },
};

/**
 * Квитанция `ai_agent_memory_clear_v1` или его отказ → итог маршрута.
 * Квитанция (274, через `ai_request_finish` 269): `{status: 'cleared',
 * conversationId, deleted, enqueued, replayed}`. Другая форма — не «удалено»,
 * а сбой.
 */
export function aiMemoryClearOutcome(error: RpcError | null, data: unknown): AiMemoryClearResult {
  if (error) {
    // 23505 — тот же id запроса уже записан с другим вводом (ai_request_replay, 269).
    if (error.code === "PT409" || error.code === "23505") return { status: "conflict" };
    if (error.code === "42501") return { status: "forbidden" };
    if (error.code === "P0002") return { status: "not_found" };
    if (error.code === "22023") return { status: "invalid" };
    return { status: "unavailable" };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { status: "unavailable" };
  const receipt = data as Record<string, unknown>;
  if (receipt.status !== "cleared" || typeof receipt.deleted !== "boolean" || typeof receipt.enqueued !== "boolean") {
    return { status: "unavailable" };
  }
  return { status: "cleared", deleted: receipt.deleted, enqueued: receipt.enqueued };
}

/**
 * «Что ИИ знает о клиенте» (план §9, §12.1; P3): `GET …/conversations/[id]/memory`
 * — память диалога и карточка лида (`ai_agent_memory_v1`, 274) при открытии
 * окна. Ни агента, ни Gemini; без секрета агента блок тоже читается — память
 * лежит в базе. Права (ai.agent.use, чтение диалога продаж) решает база.
 */
export function createAiMemoryReadHandler(dependencies: AiMemoryRouteDependencies = defaultMemoryDependencies) {
  return async function GET(request: Request, context: ConversationContext): Promise<Response> {
    try {
      const authorization = await dependencies.authorize();
      if (authorization.status !== "authorized") return refusal(authorization.status);
      const conversationId = parsePlatformRouteUuid((await context.params).conversationId);
      if (!conversationId || new URL(request.url).search !== "") return failure(400, "invalid_request");
      const memory = await dependencies.readMemory(authorization.actor, conversationId);
      if (memory === "forbidden") return failure(403, "forbidden");
      if (memory === "not_found") return failure(404, "not_found");
      return json(200, { memory });
    } catch {
      return failure(503, "unavailable");
    }
  };
}

/**
 * «Забыть сводку» (P3, Q9 — может любой сотрудник с ai.agent.use):
 * `DELETE …/conversations/[id]/memory` с `{requestId}` — строка памяти
 * удаляется (`ai_agent_memory_clear_v1`), повтор тем же id возвращает прежнюю
 * квитанцию; ответ — `{deleted, enqueued}` (была ли строка; поставлена ли
 * пересборка). В журнале — только числа и флаги, без текста. Пока память
 * работает, база сразу ставит пересборку в очередь агента — не дожидаясь
 * нового сообщения клиента (274).
 */
export function createAiMemoryClearHandler(dependencies: AiMemoryRouteDependencies = defaultMemoryDependencies) {
  return async function DELETE(request: Request, context: ConversationContext): Promise<Response> {
    try {
      if (!sameOrigin(request)) return failure(403, "forbidden");
      const authorization = await dependencies.authorize();
      if (authorization.status !== "authorized") return refusal(authorization.status);
      const conversationId = parsePlatformRouteUuid((await context.params).conversationId);
      const body = await readJsonObject(request, ["requestId"]);
      const requestId = body ? parsePlatformRouteUuid(body.requestId) : null;
      if (!conversationId || !requestId || new URL(request.url).search !== "") return failure(400, "invalid_request");
      const result = await dependencies.clearMemory(authorization.actor, conversationId, requestId);
      if (result.status === "cleared") return json(200, { deleted: result.deleted, enqueued: result.enqueued });
      if (result.status === "conflict") return failure(409, "request_conflict");
      if (result.status === "forbidden") return failure(403, "forbidden");
      if (result.status === "not_found") return failure(404, "not_found");
      if (result.status === "invalid") return failure(400, "invalid_request");
      return failure(503, "unavailable");
    } catch {
      return failure(503, "unavailable");
    }
  };
}

export type AiAgentStatus =
  | Readonly<{ state: "off" }>
  | Readonly<{ state: "unavailable" }>
  | Readonly<{ state: "ready"; keyAccepted: boolean; model: string | null; block: string | null }>;

/**
 * Состояние агента для «Расходов» (§12.2): подписанный `GET /v1/status` —
 * ключ Gemini принят (бесплатный `models.get`, кэш агента 5 мин), блокировка
 * баланса или дневной квоты. Генерации нет. Нет секрета — «не подключён».
 */
export async function readAiAgentStatus(
  organizationId: string,
  options: Readonly<{ config?: AiAgentConfig | null; fetch?: typeof fetch; now?: () => number; timeoutMs?: number }> = {},
): Promise<AiAgentStatus> {
  const config = options.config === undefined ? readAiAgentConfig() : options.config;
  if (!config) return { state: "off" };
  const path = `/v1/status?organization_id=${encodeURIComponent(organizationId)}`;
  try {
    const response = await (options.fetch ?? fetch)(`${config.baseUrl}${path}`, {
      method: "GET",
      headers: aiAgentSignedHeaders(config, "GET", path, "", (options.now ?? Date.now)()),
      signal: AbortSignal.timeout(options.timeoutMs ?? 2500),
      redirect: "error",
      cache: "no-store",
    });
    if (response.status !== 200) return { state: "unavailable" };
    const body = await response.json() as Record<string, unknown>;
    const block = typeof body.block === "object" && body.block !== null ? (body.block as Record<string, unknown>).code : null;
    return {
      state: "ready",
      keyAccepted: body.keyAccepted === true,
      model: typeof body.model === "string" ? body.model.slice(0, 80) : null,
      block: typeof block === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(block) ? block : null,
    };
  } catch {
    return { state: "unavailable" };
  }
}

// ------------------------------------------------------------------ P4 автоответчик

export type AiAutosendExclusionResult =
  | Readonly<{ status: "saved" }>
  | Readonly<{ status: "conflict" | "forbidden" | "not_found" | "invalid" | "unavailable" }>;

export type AiAutosendChatRouteDependencies = Readonly<{
  authorize(): Promise<Authorization>;
  readChat(actor: ActivePlatformActor, conversationId: string): Promise<AiAutosendChat | "forbidden" | "not_found">;
  setExclusion(actor: ActivePlatformActor, conversationId: string, excluded: boolean, requestId: string): Promise<AiAutosendExclusionResult>;
  serverOn(): boolean;
}>;

const defaultAutosendChatDependencies: AiAutosendChatRouteDependencies = {
  authorize: defaultAuthorize,
  async readChat(actor, conversationId) {
    const { data, error } = await (await rpcClient()).rpc("ai_agent_autosend_chat_v1", {
      p_organization_id: actor.organizationId, p_conversation_id: conversationId,
    });
    if (error) {
      if (error.code === "42501") return "forbidden";
      if (error.code === "P0002") return "not_found";
      throw new Error("ai_autosend_unavailable");
    }
    return normalizeAiAutosendChat(data);
  },
  async setExclusion(actor, conversationId, excluded, requestId) {
    const { data, error } = await (await rpcClient()).rpc("ai_agent_autosend_exclusion_v1", {
      p_organization_id: actor.organizationId, p_conversation_id: conversationId, p_excluded: excluded, p_request_id: requestId,
    });
    return aiAutosendExclusionOutcome(error, data, excluded);
  },
  serverOn: () => aiAutosendServerState() === "on",
};

/**
 * Квитанция `ai_agent_autosend_exclusion_v1` (277, через `ai_request_finish`):
 * `{status: 'applied', conversationId, excluded, cancelled}`. Другая форма или
 * другое положение — не «записано», а сбой.
 */
export function aiAutosendExclusionOutcome(error: RpcError | null, data: unknown, excluded: boolean): AiAutosendExclusionResult {
  if (!error) {
    const receipt = typeof data === "object" && data !== null && !Array.isArray(data) ? data as Record<string, unknown> : null;
    return receipt?.status === "applied" && receipt.excluded === excluded ? { status: "saved" } : { status: "unavailable" };
  }
  if (error.code === "PT409" || error.code === "23505") return { status: "conflict" };
  if (error.code === "42501") return { status: "forbidden" };
  if (error.code === "P0002") return { status: "not_found" };
  if (error.code === "22023") return { status: "invalid" };
  return { status: "unavailable" };
}

/**
 * «Автоответчик в этом чате» (P4, §11–12.1): `GET …/conversations/[id]/autosend`
 * — состояние автоответчика для чата (включён ли, режим, пауза, исключён ли
 * чат) и выключатель сервера. Ни агента, ни Gemini, ни WhatsApp.
 */
export function createAiAutosendChatReadHandler(dependencies: AiAutosendChatRouteDependencies = defaultAutosendChatDependencies) {
  return async function GET(request: Request, context: ConversationContext): Promise<Response> {
    try {
      const authorization = await dependencies.authorize();
      if (authorization.status !== "authorized") return refusal(authorization.status);
      const conversationId = parsePlatformRouteUuid((await context.params).conversationId);
      if (!conversationId || new URL(request.url).search !== "") return failure(400, "invalid_request");
      const chat = await dependencies.readChat(authorization.actor, conversationId);
      if (chat === "forbidden") return failure(403, "forbidden");
      if (chat === "not_found") return failure(404, "not_found");
      return json(200, { chat, serverOn: dependencies.serverOn() });
    } catch {
      return failure(503, "unavailable");
    }
  };
}

/**
 * Исключить чат из автоответчика или вернуть (Q9 — любой сотрудник, которому
 * виден диалог): `PUT …/autosend` с `{requestId, excluded}`. Повтор тем же id
 * отдаёт прежнюю квитанцию; ничего не отправляет.
 */
export function createAiAutosendChatExclusionHandler(dependencies: AiAutosendChatRouteDependencies = defaultAutosendChatDependencies) {
  return async function PUT(request: Request, context: ConversationContext): Promise<Response> {
    try {
      if (!sameOrigin(request)) return failure(403, "forbidden");
      const authorization = await dependencies.authorize();
      if (authorization.status !== "authorized") return refusal(authorization.status);
      const conversationId = parsePlatformRouteUuid((await context.params).conversationId);
      const body = await readJsonObject(request, ["requestId", "excluded"]);
      const requestId = body ? parsePlatformRouteUuid(body.requestId) : null;
      if (!conversationId || !requestId || typeof body?.excluded !== "boolean" || new URL(request.url).search !== "") {
        return failure(400, "invalid_request");
      }
      const result = await dependencies.setExclusion(authorization.actor, conversationId, body.excluded, requestId);
      if (result.status === "saved") return json(200, { excluded: body.excluded });
      if (result.status === "conflict") return failure(409, "request_conflict");
      if (result.status === "forbidden") return failure(403, "forbidden");
      if (result.status === "not_found") return failure(404, "not_found");
      if (result.status === "invalid") return failure(400, "invalid_request");
      return failure(503, "unavailable");
    } catch {
      return failure(503, "unavailable");
    }
  };
}
