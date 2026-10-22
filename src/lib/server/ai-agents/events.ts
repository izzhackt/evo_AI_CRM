import {
  AI_AGENT_TOOL_LABELS,
  stripAiAgentAuthorityNote,
  type AiAgentRunStatus,
  type AiAgentUiEvent,
} from "../../ai-agents/contract.ts";

/*
 * События сессии Claude → хроника для интерфейса (контракт §C.2.3). Чистые
 * функции без сети: проверяются на образцах событий из документации. Тексты
 * поручений и ответов здесь только преобразуются — в журнал приложения не идут.
 */

export type RawSessionEvent = Readonly<Record<string, unknown>>;
/** id вызова инструмента (`agent.mcp_tool_use.id`) → имя инструмента. */
export type ToolNameMap = Map<string, string>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

const ARGS_SUMMARY_LIMIT = 200;
const RESULT_PREVIEW_LIMIT = 240;
const ERROR_MESSAGE_LIMIT = 300;
/** Тексты вида `text`/`body`/`body_md`/… в сводке аргументов заменяются длиной. */
const TEXT_ARG_KEYS = new Set(["text", "body", "body_md", "description", "query", "title", "reason", "metrics", "edited_text", "content", "command"]);
const SESSION_STATUS_BY_TYPE = {
  "session.status_running": "running",
  "session.status_idle": "idle",
  "session.status_rescheduled": "rescheduled",
  "session.status_terminated": "terminated",
} as const;

function clip(text: string, limit: number): string {
  const clean = text.replace(/\s+/gu, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

/** Склеивает `text`-блоки; `redacted` и прочие блоки пропускаются. */
export function eventText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("");
}

/** Короткая сводка аргументов вызова: ключи и скаляры, длинные тексты — «<N симв.>». Не больше 200 символов. */
export function summarizeToolArgs(input: unknown): string {
  if (!isRecord(input)) return "";
  const parts: string[] = [];
  for (const [name, value] of Object.entries(input)) {
    let shown: string;
    if (typeof value === "string") shown = TEXT_ARG_KEYS.has(name) || value.length > 40 ? `<${value.length} симв.>` : value;
    else if (typeof value === "number" || typeof value === "boolean" || value === null) shown = String(value);
    else if (Array.isArray(value)) shown = `[${value.length}]`;
    else shown = "{…}";
    parts.push(`${name}=${shown}`);
  }
  return clip(parts.join(", "), ARGS_SUMMARY_LIMIT);
}

/** Первые 240 символов текста результата инструмента. */
export function previewToolResult(content: unknown): string {
  return clip(eventText(content), RESULT_PREVIEW_LIMIT);
}

/** Центы из `list_cost`: `{amount:"125",currency}`, строка или число. */
export function costCentsOf(listCost: unknown): number {
  const raw = isRecord(listCost) ? listCost.amount : listCost;
  const value = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+(\.\d+)?$/u.test(raw) ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

const nonNegativeInt = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;

/** Итог GET /v1/sessions/{id} или события `session.usage`: токены, расход, секунды работы. */
export function readUsage(source: unknown): Readonly<{
  inputTokens: number; outputTokens: number; cacheReadTokens: number; costCents: number; activeSeconds: number | null;
}> {
  const root = isRecord(source) ? source : {};
  const usage = isRecord(root.usage) ? root.usage : root;
  const seconds = usage.active_seconds;
  return {
    inputTokens: nonNegativeInt(usage.input_tokens),
    outputTokens: nonNegativeInt(usage.output_tokens),
    cacheReadTokens: nonNegativeInt(usage.cache_read_input_tokens),
    costCents: costCentsOf(usage.list_cost),
    activeSeconds: typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 100) / 100 : null,
  };
}

function errorMessage(error: Record<string, unknown> | null): { code: string; message: string } {
  const code = str(error?.type) ?? "session_error";
  if (code === "mcp_authentication_failed_error") return { code, message: "Токен MCP не принят — обновите токен в настройках" };
  if (code === "mcp_connection_failed_error") return { code, message: "MCP недоступен: проверьте адрес и IP-фильтр" };
  const text = str(error?.message);
  return { code, message: text ? clip(text, ERROR_MESSAGE_LIMIT) : "Ошибка сессии Claude" };
}

/**
 * Одно событие сессии → событие интерфейса (или null: тип не показывается).
 * `toolNames` пополняется вызовами, чтобы результат знал имя инструмента.
 */
export function convertSessionEvent(
  event: RawSessionEvent,
  toolNames: ToolNameMap,
  nowIso: string,
): AiAgentUiEvent | null {
  const type = str(event.type);
  const id = str(event.id);
  if (!type || !id) return null;
  const at = str(event.processed_at) ?? str(event.created_at) ?? nowIso;

  switch (type) {
    case "user.message":
      return { id, at, kind: "user", text: stripAiAgentAuthorityNote(eventText(event.content)) };
    case "agent.message": {
      const text = eventText(event.content);
      return text.trim() ? { id, at, kind: "agent", text } : null;
    }
    case "agent.mcp_tool_use": {
      const tool = str(event.name) ?? "инструмент";
      toolNames.set(id, tool);
      return { id, at, kind: "tool_call", tool, label: AI_AGENT_TOOL_LABELS[tool] ?? tool, argsSummary: summarizeToolArgs(event.input), builtin: false };
    }
    case "agent.tool_use": {
      const tool = str(event.name) ?? "инструмент";
      toolNames.set(id, tool);
      return { id, at, kind: "tool_call", tool, label: `Песочница: ${tool}`, argsSummary: summarizeToolArgs(event.input), builtin: true };
    }
    case "agent.mcp_tool_result": {
      const useId = str(event.mcp_tool_use_id);
      const tool = (useId ? toolNames.get(useId) : undefined) ?? "инструмент";
      return { id, at, kind: "tool_result", tool, ok: event.is_error !== true, preview: previewToolResult(event.content) };
    }
    case "session.status_running":
    case "session.status_idle":
    case "session.status_rescheduled":
    case "session.status_terminated": {
      const stop = isRecord(event.stop_reason) ? str(event.stop_reason.type) : null;
      return { id, at, kind: "status", status: SESSION_STATUS_BY_TYPE[type], stopReason: stop };
    }
    case "session.error": {
      const { code, message } = errorMessage(isRecord(event.error) ? event.error : null);
      return { id, at, kind: "error", code, message };
    }
    case "session.usage": {
      const usage = readUsage(event);
      return { id, at, kind: "usage", inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costCents: usage.costCents };
    }
    default:
      return null;
  }
}

export function convertSessionEvents(
  events: readonly RawSessionEvent[],
  toolNames: ToolNameMap,
  nowIso: string,
): AiAgentUiEvent[] {
  const result: AiAgentUiEvent[] = [];
  for (const event of events) {
    const converted = convertSessionEvent(event, toolNames, nowIso);
    if (converted) result.push(converted);
  }
  return result;
}

/* ------------------------------------------------------------- состояние запуска */

export type RunDerivation = Readonly<{
  status: AiAgentRunStatus;
  /** Статус изменился относительно `current` из-за событий. */
  changed: boolean;
  errorCode: string | null;
  /** Текст последнего ответа агента в этой пачке (для сводки запуска). */
  lastAgentText: string | null;
}>;

function retryExhausted(retryStatus: unknown): boolean {
  const type = typeof retryStatus === "string" ? retryStatus : isRecord(retryStatus) ? str(retryStatus.type) : null;
  return type === "exhausted" || type === "terminal" || type === "failed";
}

/**
 * Статус запуска по пачке событий в порядке времени:
 * idle/end_turn → completed (interrupted, если перед этим было `user.interrupt`),
 * budget_reached → budget_reached, requires_action → needs_attention,
 * terminated → failed, session.error с исчерпанными повторами без дальнейшего
 * running → failed. `session.status_running` возвращает работу (продолжение разговора).
 */
export function deriveRunState(events: readonly RawSessionEvent[], current: AiAgentRunStatus): RunDerivation {
  let status = current;
  let errorCode: string | null = null;
  let lastAgentText: string | null = null;
  let interruptPending = false;
  let exhaustedError: string | null = null;
  for (const event of events) {
    const type = str(event.type);
    if (type === "user.interrupt") interruptPending = true;
    else if (type === "agent.message") {
      const text = eventText(event.content);
      if (text.trim()) lastAgentText = text;
    } else if (type === "session.status_running") {
      status = "running";
      errorCode = null;
      exhaustedError = null;
    } else if (type === "session.status_idle") {
      const stop = isRecord(event.stop_reason) ? str(event.stop_reason.type) : null;
      if (stop === "budget_reached") status = "budget_reached";
      else if (stop === "requires_action") status = "needs_attention";
      else status = interruptPending ? "interrupted" : "completed";
      interruptPending = false;
      exhaustedError = null;
    } else if (type === "session.status_terminated") {
      status = interruptPending ? "interrupted" : "failed";
      errorCode = interruptPending ? null : "terminated";
      interruptPending = false;
    } else if (type === "session.error") {
      const error = isRecord(event.error) ? event.error : null;
      if (retryExhausted(error?.retry_status ?? event.retry_status)) exhaustedError = str(error?.type) ?? "session_error";
    }
  }
  if (exhaustedError && status === "running") {
    status = "failed";
    errorCode = exhaustedError;
  }
  return { status, changed: status !== current, errorCode, lastAgentText };
}

/** Статус запуска, после которого события и расход больше не меняются сами. */
export const AI_AGENT_TERMINAL_RUN_STATUSES: readonly AiAgentRunStatus[] = [
  "completed", "failed", "budget_reached", "interrupted", "needs_attention",
];
export const isTerminalRunStatus = (status: AiAgentRunStatus): boolean => AI_AGENT_TERMINAL_RUN_STATUSES.includes(status);

/* ---------------------------------------------------------------------- курсор */

/**
 * Курсор опроса: `t` — `processed_at` последнего события, `ids` — id событий с
 * таким же `t` (уже показаны), `u` — вызовы инструментов без результата (имя
 * для следующей пачки), `n` — сколько событий уже обработано.
 */
export type EventCursor = Readonly<{ t: string | null; ids: readonly string[]; u: Readonly<Record<string, string>>; n: number }>;

export function encodeEventCursor(cursor: EventCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.t, ids: cursor.ids, u: cursor.u, n: cursor.n }), "utf8").toString("base64url");
}

export function decodeEventCursor(value: string | null): EventCursor | null {
  if (!value || value.length > 8_000) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!isRecord(parsed)) return null;
    const t = parsed.t === null ? null : str(parsed.t);
    if (parsed.t !== null && t === null) return null;
    const ids = Array.isArray(parsed.ids) ? parsed.ids.filter((item): item is string => typeof item === "string").slice(0, 200) : [];
    const u: Record<string, string> = {};
    if (isRecord(parsed.u)) {
      for (const [key, name] of Object.entries(parsed.u).slice(0, 40)) if (typeof name === "string") u[key] = name;
    }
    const n = typeof parsed.n === "number" && Number.isFinite(parsed.n) && parsed.n >= 0 ? Math.floor(parsed.n) : 0;
    return { t, ids, u, n };
  } catch {
    return null;
  }
}

const eventTime = (event: RawSessionEvent): string | null => str(event.processed_at);

/** Оставляет события, которых курсор ещё не видел (то же `t` — по списку id). */
export function unseenEvents(events: readonly RawSessionEvent[], cursor: EventCursor | null): RawSessionEvent[] {
  if (!cursor || cursor.t === null) return [...events];
  const since = cursor.t;
  const seen = new Set(cursor.ids);
  return events.filter((event) => {
    const at = eventTime(event);
    if (at === null || at === since) return !seen.has(str(event.id) ?? "");
    return at > since;
  });
}

/** Новый курсор после пачки `fresh` (уже без виденных). */
export function advanceCursor(
  previous: EventCursor | null,
  fresh: readonly RawSessionEvent[],
  toolNames: ToolNameMap,
): EventCursor {
  let t = previous?.t ?? null;
  let ids = previous?.ids ?? [];
  for (const event of fresh) {
    const at = eventTime(event);
    const id = str(event.id);
    if (at === null || !id) continue;
    if (t === null || at > t) {
      t = at;
      ids = [id];
    } else if (at === t) {
      ids = ids.includes(id) ? ids : [...ids, id];
    }
  }
  // Вызовы без результата — имя для результата в следующей пачке (не больше 20 последних).
  const resulted = new Set<string>();
  for (const event of fresh) {
    if (event.type === "agent.mcp_tool_result") {
      const useId = str(event.mcp_tool_use_id);
      if (useId) resulted.add(useId);
    }
  }
  const pending: Record<string, string> = { ...(previous?.u ?? {}) };
  for (const useId of resulted) delete pending[useId];
  for (const event of fresh) {
    const id = str(event.id);
    if (id && event.type === "agent.mcp_tool_use" && !resulted.has(id)) {
      const name = toolNames.get(id);
      if (name) pending[id] = name;
    }
  }
  const entries = Object.entries(pending).slice(-20);
  return { t, ids: ids.slice(-200), u: Object.fromEntries(entries), n: (previous?.n ?? 0) + fresh.length };
}
