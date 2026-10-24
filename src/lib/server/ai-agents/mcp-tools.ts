import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AI_AGENT_LIMITS,
  AI_AGENT_MCP_RPC,
  AI_AGENT_TOOLS,
  AI_AGENT_TOOL_ERROR_CODES,
  AI_AGENTS_MCP_FILE_PATH_PREFIX,
  type AiAgentJsonSchema,
  type AiAgentKey,
  type AiAgentToolDefinition,
  type AiAgentToolErrorCode,
} from "../../ai-agents/contract.ts";
import { MCP_TOKEN_PATTERN, withDeadline } from "./mcp-auth.ts";
import type { AiAgentWhatsAppSendResult } from "./whatsapp-send.ts";

/*
 * MCP-сервер ИИ-агентов, часть «инструменты» (контракт §B.0, §B.3–§B.6):
 * реестр читается из contract.ts, аргументы проверяет небольшой валидатор,
 * вызов идёт в функцию базы `platform.ai_agent_tool_<имя>_v1`, ответ урезается
 * по размеру, ошибки Postgres переводятся в коды инструментов.
 */

export type McpRpcClient = Pick<SupabaseClient, "schema">;

export type McpToolResult = Readonly<{
  content: readonly Readonly<{ type: "text"; text: string }>[];
  isError: boolean;
}>;

export type McpToolLogStatus = "ok" | "error" | "denied";

export type McpToolOutcome = Readonly<{
  result: McpToolResult;
  status: McpToolLogStatus;
  errorCode: AiAgentToolErrorCode | null;
  durationMs: number;
  /** Что отдать журналу действий: проверенные аргументы или только ключи. */
  logArgs: Readonly<Record<string, unknown>>;
}>;

export type McpToolContext = Readonly<{ organizationId: string; agentKey: AiAgentKey }>;

export type McpSendWhatsAppDraft = (
  input: Readonly<{ organizationId: string; draftId: string; senderMembershipId: string; requestId: string }>,
) => Promise<AiAgentWhatsAppSendResult>;

export type McpToolRuntime = Readonly<{
  client: McpRpcClient;
  sendWhatsAppDraft: McpSendWhatsAppDraft;
  /** Origin публичного адреса MCP (без пути): из него собирается ссылка на файл. */
  mcpOrigin(): string;
  rpcDeadlineMs: number;
  maxOutputChars: number;
  now(): number;
  log(entry: Readonly<Record<string, string | number | boolean>>): void;
}>;

/* ------------------------------------------------------------------- реестр */

const TOOL_BY_NAME: ReadonlyMap<string, AiAgentToolDefinition> = new Map(
  AI_AGENT_TOOLS.map((tool) => [tool.name, tool]),
);

export function findAiAgentTool(name: unknown): AiAgentToolDefinition | null {
  return typeof name === "string" ? (TOOL_BY_NAME.get(name) ?? null) : null;
}

/** Ответ `tools/list`: реестр без изменений, подпись — полем `title`. */
export function listAiAgentMcpTools(): readonly Readonly<{
  name: string;
  title: string;
  description: string;
  inputSchema: AiAgentJsonSchema;
}>[] {
  return AI_AGENT_TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

/* ---------------------------------------------------------------- валидатор */

export type SchemaIssue = Readonly<{ path: string; problem: string }>;
type Schema = Readonly<Record<string, unknown>>;

const MAX_SCHEMA_DEPTH = 10;
const patternCache = new Map<string, RegExp>();

function compilePattern(pattern: string): RegExp {
  let compiled = patternCache.get(pattern);
  if (compiled === undefined) {
    try {
      compiled = new RegExp(pattern, "u");
    } catch {
      compiled = new RegExp(pattern);
    }
    patternCache.set(pattern, compiled);
  }
  return compiled;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countCodePoints(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
    }
    count += 1;
  }
  return count;
}

function childPath(path: string, key: string | number): string {
  return path === "" ? String(key) : `${path}.${key}`;
}

/** true — внутри есть символ NUL или вложенность глубже предела (jsonb такое не примет). */
function hasUnsafeContent(value: unknown, depth = 0): boolean {
  if (depth > 12) return true;
  if (typeof value === "string") return value.includes("\u0000");
  if (Array.isArray(value)) return value.some((item) => hasUnsafeContent(item, depth + 1));
  if (isPlainObject(value)) {
    return Object.entries(value).some(([key, item]) => key.includes("\u0000") || hasUnsafeContent(item, depth + 1));
  }
  return false;
}

function validateNode(schema: Schema, value: unknown, path: string, issues: SchemaIssue[], depth: number): unknown {
  if (depth > MAX_SCHEMA_DEPTH) {
    issues.push({ path, problem: "too_deep" });
    return value;
  }
  const type = schema.type;
  const enumValues = Array.isArray(schema.enum) ? schema.enum : null;

  if (type === "string") {
    if (typeof value !== "string") {
      issues.push({ path, problem: "type_string" });
      return value;
    }
    if (value.includes("\u0000")) issues.push({ path, problem: "invalid_char" });
    const length = countCodePoints(value);
    if (typeof schema.minLength === "number" && length < schema.minLength) issues.push({ path, problem: "min_length" });
    if (typeof schema.maxLength === "number" && length > schema.maxLength) issues.push({ path, problem: "max_length" });
    if (typeof schema.pattern === "string" && !compilePattern(schema.pattern).test(value)) {
      issues.push({ path, problem: "pattern" });
    }
    if (enumValues !== null && !enumValues.includes(value)) issues.push({ path, problem: "enum" });
    return value;
  }

  if (type === "integer" || type === "number") {
    const numeric = typeof value === "number" && Number.isFinite(value);
    if (!numeric || (type === "integer" && !Number.isInteger(value))) {
      issues.push({ path, problem: type === "integer" ? "type_integer" : "type_number" });
      return value;
    }
    if (typeof schema.minimum === "number" && value < schema.minimum) issues.push({ path, problem: "minimum" });
    if (typeof schema.maximum === "number" && value > schema.maximum) issues.push({ path, problem: "maximum" });
    if (enumValues !== null && !enumValues.includes(value)) issues.push({ path, problem: "enum" });
    return value;
  }

  if (type === "boolean") {
    if (typeof value !== "boolean") issues.push({ path, problem: "type_boolean" });
    return value;
  }

  if (type === "array") {
    if (!Array.isArray(value)) {
      issues.push({ path, problem: "type_array" });
      return value;
    }
    if (typeof schema.minItems === "number" && value.length < schema.minItems) issues.push({ path, problem: "min_items" });
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) issues.push({ path, problem: "max_items" });
    const itemSchema = isPlainObject(schema.items) ? schema.items : null;
    if (itemSchema === null) {
      if (hasUnsafeContent(value)) issues.push({ path, problem: "invalid_content" });
      return value;
    }
    return value.map((item, index) => validateNode(itemSchema, item, childPath(path, index), issues, depth + 1));
  }

  if (type === "object") {
    if (!isPlainObject(value)) {
      issues.push({ path, problem: "type_object" });
      return value;
    }
    const properties = isPlainObject(schema.properties) ? schema.properties : null;
    if (properties === null) {
      // Свободный объект (например, metrics): форму проверяет база, здесь — только безопасность содержимого.
      if (hasUnsafeContent(value)) issues.push({ path, problem: "invalid_content" });
      return value;
    }
    const required = Array.isArray(schema.required) ? (schema.required as readonly unknown[]) : [];
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const raw = value[key];
      if (Object.hasOwn(properties, key)) {
        // Необязательное поле со значением null считается отсутствующим (модели часто так присылают).
        if (raw === null && !required.includes(key)) continue;
        const propertySchema = properties[key];
        Object.defineProperty(output, key, {
          value: isPlainObject(propertySchema)
            ? validateNode(propertySchema, raw, childPath(path, key), issues, depth + 1)
            : raw,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      } else if (schema.additionalProperties === false) {
        issues.push({ path: childPath(path, key), problem: "unknown_property" });
      } else {
        if (hasUnsafeContent(raw)) issues.push({ path: childPath(path, key), problem: "invalid_content" });
        Object.defineProperty(output, key, { value: raw, enumerable: true, writable: true, configurable: true });
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (Object.hasOwn(output, key)) continue;
      if (required.includes(key)) {
        issues.push({ path: childPath(path, key), problem: "required" });
      } else if (isPlainObject(propertySchema) && "default" in propertySchema) {
        output[key] = propertySchema.default;
      }
    }
    return output;
  }

  // Схема без типа: принимаем как есть, но следим за безопасностью содержимого.
  if (hasUnsafeContent(value)) issues.push({ path, problem: "invalid_content" });
  if (enumValues !== null && !enumValues.includes(value)) issues.push({ path, problem: "enum" });
  return value;
}

/**
 * Проверка аргументов по подмножеству JSON Schema из contract.ts: type, properties,
 * required, additionalProperties, enum, minLength, maxLength, minimum, maximum,
 * pattern, items, minItems, maxItems, default. Не описанные ключи при
 * `additionalProperties:false` — ошибка. В ошибках только пути и вид проблемы,
 * без значений.
 */
export function validateToolArguments(
  schema: AiAgentJsonSchema,
  rawArguments: unknown,
): Readonly<{ ok: true; value: Record<string, unknown> }> | Readonly<{ ok: false; issues: readonly SchemaIssue[] }> {
  const candidate = rawArguments === undefined || rawArguments === null ? {} : rawArguments;
  if (!isPlainObject(candidate)) return { ok: false, issues: [{ path: "", problem: "type_object" }] };
  const issues: SchemaIssue[] = [];
  const value = validateNode(schema, candidate, "", issues, 0);
  if (issues.length > 0) return { ok: false, issues: issues.slice(0, 20) };
  return { ok: true, value: value as Record<string, unknown> };
}

/* ------------------------------------------------------------------- ошибки */

const ERROR_MESSAGES: Readonly<Record<AiAgentToolErrorCode, string>> = {
  invalid_arguments: "Неверные аргументы инструмента: исправьте перечисленные поля и повторите вызов.",
  not_found: "Не найдено: проверьте идентификатор.",
  forbidden: "Недостаточно прав для этого действия.",
  agent_disabled: "Агент выключен в CRM: остановите работу и сообщите об этом сотруднику.",
  rate_limited: "Слишком много вызовов: подождите минуту и повторите.",
  conflict: "Конфликт состояния: действие сейчас невозможно.",
  whatsapp_unavailable: "WhatsApp сейчас не подключён: сообщение не отправлено.",
  conversation_moved_on: "Клиент написал новое сообщение: перечитайте чат и подготовьте ответ заново.",
  conversation_closed: "Диалог закрыт: отвечать нельзя.",
  target_not_found: "Адресат не найден.",
  text_invalid: "Текст сообщения не подходит: пустой, слишком длинный или с недопустимыми символами.",
  no_inbound_message: "В диалоге нет входящих сообщений: отвечать некому.",
  too_large: "Данные слишком большие: сузьте запрос.",
  unavailable: "Сервис временно недоступен: повторите позже.",
  internal_error: "Внутренняя ошибка: повторите позже или сообщите сотруднику.",
};

const ERROR_CODE_SET: ReadonlySet<string> = new Set(AI_AGENT_TOOL_ERROR_CODES);
const SAFE_DETAIL = /^[a-z][a-z0-9_]{2,63}$/;

export type ClassifiedRpcError = Readonly<{
  code: AiAgentToolErrorCode;
  /** Код из текста исключения базы, если он не входит в список инструментов (безопасная форма). */
  detail: string | null;
}>;

/** Таблица §B.4: исключение базы или PostgREST → код инструмента. */
export function classifyRpcError(error: unknown): ClassifiedRpcError {
  const record = isPlainObject(error) ? error : {};
  const message = typeof record.message === "string" ? record.message.trim() : "";
  const sqlState = typeof record.code === "string" ? record.code : "";

  if (ERROR_CODE_SET.has(message)) return { code: message as AiAgentToolErrorCode, detail: null };
  const detail = SAFE_DETAIL.test(message) ? message : null;

  if (sqlState === "22023") return { code: "invalid_arguments", detail };
  if (sqlState === "42501") return { code: "forbidden", detail };
  if (sqlState === "P0002") return { code: "not_found", detail };
  if (sqlState === "55000") return { code: "conflict", detail };
  if (sqlState === "54000") return { code: "rate_limited", detail };
  if (sqlState === "54001") return { code: "too_large", detail };
  if (
    sqlState === "40001" ||
    sqlState === "40P01" ||
    sqlState === "57014" ||
    sqlState === "" ||
    sqlState.startsWith("08") ||
    sqlState.startsWith("53") ||
    sqlState.startsWith("PGRST00")
  ) {
    return { code: "unavailable", detail: null };
  }
  return { code: "internal_error", detail: null };
}

function jsonText(value: unknown): string {
  return JSON.stringify(value);
}

export function toolErrorResult(code: AiAgentToolErrorCode, extra: Readonly<Record<string, unknown>> = {}): McpToolResult {
  return {
    content: [{ type: "text", text: jsonText({ error_code: code, message: ERROR_MESSAGES[code], ...extra }) }],
    isError: true,
  };
}

function statusForError(code: AiAgentToolErrorCode): McpToolLogStatus {
  return code === "forbidden" || code === "agent_disabled" || code === "rate_limited" ? "denied" : "error";
}

/* ---------------------------------------------------------- размер ответа */

const TRUNCATION_HINT_RU =
  "Ответ урезан по размеру: сузьте фильтры или уменьшите limit. Курсор отброшен, чтобы не пропустить урезанные строки.";

/**
 * Укладывает ответ в предел символов, не режа строки: выбирает самый длинный
 * массив в корне (items, messages, results, rows…) и отбрасывает его хвост.
 * null — уложить нельзя.
 */
export function fitToolOutput(value: unknown, maxChars: number): Readonly<{ text: string; truncated: boolean }> | null {
  const full = jsonText(value);
  if (full.length <= maxChars) return { text: full, truncated: false };

  let base: Record<string, unknown>;
  let key: string;
  if (Array.isArray(value)) {
    base = { items: value };
    key = "items";
  } else if (isPlainObject(value)) {
    let best: string | null = null;
    let bestLength = -1;
    for (const [candidate, item] of Object.entries(value)) {
      if (!Array.isArray(item)) continue;
      const length = jsonText(item).length;
      if (length > bestLength) {
        best = candidate;
        bestLength = length;
      }
    }
    if (best === null) return null;
    base = value;
    key = best;
  } else {
    return null;
  }

  const items = base[key] as readonly unknown[];
  const build = (kept: number): string => {
    const shaped: Record<string, unknown> = { ...base, [key]: items.slice(0, kept) };
    if ("next_cursor" in shaped) shaped.next_cursor = null;
    shaped.truncated = true;
    shaped.returned_items = kept;
    shaped.dropped_items = items.length - kept;
    shaped.hint = TRUNCATION_HINT_RU;
    return jsonText(shaped);
  };

  if (build(0).length > maxChars) return null;
  let low = 0;
  let high = items.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (build(middle).length <= maxChars) low = middle;
    else high = middle - 1;
  }
  return { text: build(low), truncated: true };
}

/* ------------------------------------------------------------ send_message */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Детерминированный UUID (версия 5) от строки: повтор вызова даёт тот же id запроса. */
export function deterministicRequestId(name: string): string {
  const bytes = Buffer.from(createHash("sha256").update(`evo-ai-agent-whatsapp-send-v1:${name}`, "utf8").digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const DRAFT_HINTS: Readonly<Record<string, string>> = {
  whatsapp_unavailable: "WhatsApp сейчас не подключён: сообщение сохранено черновиком и ждёт сотрудника в CRM.",
  rate_limited: "Достигнут лимит отправки: сообщение сохранено черновиком и ждёт сотрудника в CRM.",
  staff_active: "В этом чате только что отвечал сотрудник: сообщение сохранено черновиком и ждёт его решения в CRM.",
};

type Orchestration =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false; code: AiAgentToolErrorCode }>;

/** §B.5: `needs_dispatch` → отправка WhatsApp → итог для модели. */
async function orchestrateSendMessage(
  runtime: McpToolRuntime,
  ctx: McpToolContext,
  data: Record<string, unknown>,
): Promise<Orchestration> {
  if (data.status !== "needs_dispatch") return { ok: true, value: data };
  const draftId = data.draft_id;
  const senderMembershipId = data.sender_membership_id;
  if (
    typeof draftId !== "string" ||
    !UUID_PATTERN.test(draftId) ||
    typeof senderMembershipId !== "string" ||
    !UUID_PATTERN.test(senderMembershipId)
  ) {
    return { ok: false, code: "internal_error" };
  }

  let sent: AiAgentWhatsAppSendResult;
  try {
    sent = await runtime.sendWhatsAppDraft({
      organizationId: ctx.organizationId,
      draftId,
      senderMembershipId,
      requestId: deterministicRequestId(`${ctx.organizationId}:${draftId}`),
    });
  } catch {
    return { ok: false, code: "unavailable" };
  }

  if (sent.status === "sent") return { ok: true, value: { status: "sent", mode: "direct", draft_id: draftId } };
  if (sent.status === "unknown") {
    return {
      ok: true,
      value: { status: "queued_unknown", draft_id: draftId, hint: "Итог отправки неизвестен — сотрудник проверит чат" },
    };
  }
  const failure = sent.failureCode;
  if (failure === "whatsapp_unavailable" || failure === "rate_limited" || failure === "staff_active") {
    return {
      ok: true,
      value: { status: "draft_created", mode: "draft", draft_id: draftId, failure_code: failure, hint: DRAFT_HINTS[failure] },
    };
  }
  if (failure === "conversation_moved_on" || failure === "conversation_closed") return { ok: false, code: failure };
  return { ok: false, code: "unavailable" };
}

/* --------------------------------------------------------- get_document_file */

type FileLink = Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false; code: AiAgentToolErrorCode }>;

/** §B.6: из `{token, …}` собирается ссылка на одноразовый маршрут; байты файла в ответ не кладутся. */
function buildDocumentFileLink(runtime: McpToolRuntime, data: Record<string, unknown>): FileLink {
  const token = data.token;
  if (typeof token !== "string" || !MCP_TOKEN_PATTERN.test(token)) return { ok: false, code: "internal_error" };
  let origin: string;
  try {
    origin = runtime.mcpOrigin();
  } catch {
    return { ok: false, code: "unavailable" };
  }
  const url = `${origin}${AI_AGENTS_MCP_FILE_PATH_PREFIX}${token}`;
  return {
    ok: true,
    value: {
      url,
      file_name: data.file_name ?? null,
      mime_type: data.mime_type ?? null,
      byte_size: data.byte_size ?? null,
      expires_in_seconds: data.expires_in_seconds ?? AI_AGENT_LIMITS.fileGrantTtlSeconds,
      how: `curl -sS -o file '${url}' в песочнице, затем читайте файл`,
    },
  };
}

/* ------------------------------------------------------------------ вызов */

/** Из сырых аргументов — только ключи (для журнала, когда значениям доверять рано). */
export function keysOnly(rawArguments: unknown): Record<string, unknown> {
  if (!isPlainObject(rawArguments)) return {};
  return Object.fromEntries(Object.keys(rawArguments).slice(0, 30).map((key) => [key, null]));
}

/** Результат отказа до вызова базы: агент выключен, лимит вызовов. */
export function refuseToolCall(
  code: "agent_disabled" | "rate_limited",
  rawArguments: unknown,
): McpToolOutcome {
  return {
    result: toolErrorResult(code),
    status: "denied",
    errorCode: code,
    durationMs: 0,
    logArgs: keysOnly(rawArguments),
  };
}

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;

/** Один вызов инструмента: проверка аргументов → функция базы → разбор ответа. Не бросает. */
export async function executeAiAgentTool(
  runtime: McpToolRuntime,
  ctx: McpToolContext,
  def: AiAgentToolDefinition,
  rawArguments: unknown,
): Promise<McpToolOutcome> {
  const started = runtime.now();
  const elapsed = (): number => Math.max(0, Math.round(runtime.now() - started));
  const fail = (
    code: AiAgentToolErrorCode,
    logArgs: Readonly<Record<string, unknown>>,
    extra: Readonly<Record<string, unknown>> = {},
  ): McpToolOutcome => ({
    result: toolErrorResult(code, extra),
    status: statusForError(code),
    errorCode: code,
    durationMs: elapsed(),
    logArgs,
  });

  const checked = validateToolArguments(def.inputSchema, rawArguments);
  if (!checked.ok) return fail("invalid_arguments", keysOnly(rawArguments), { fields: checked.issues });
  const args = checked.value;

  let response: RpcResponse;
  try {
    response = (await withDeadline(
      runtime.client.schema("platform").rpc(def.rpc, {
        p_organization_id: ctx.organizationId,
        p_agent_key: ctx.agentKey,
        p_args: args,
      }),
      runtime.rpcDeadlineMs,
    )) as RpcResponse;
  } catch {
    return fail("unavailable", args);
  }
  if (response.error) {
    const classified = classifyRpcError(response.error);
    return fail(classified.code, args, classified.detail === null ? {} : { reason_code: classified.detail });
  }
  const data = response.data;
  if (data === null || data === undefined) return fail("internal_error", args);

  let value: unknown = data;
  if (def.name === "get_document_file" || def.name === "send_message") {
    if (!isPlainObject(data)) return fail("internal_error", args);
    if (def.name === "get_document_file") {
      const link = buildDocumentFileLink(runtime, data);
      if (!link.ok) return fail(link.code, args);
      value = link.value;
    } else {
      const orchestrated = await orchestrateSendMessage(runtime, ctx, data);
      if (!orchestrated.ok) return fail(orchestrated.code, args);
      value = orchestrated.value;
    }
  }

  const fitted = fitToolOutput(value, runtime.maxOutputChars);
  if (fitted === null) return fail("too_large", args);
  return {
    result: { content: [{ type: "text", text: fitted.text }], isError: false },
    status: "ok",
    errorCode: null,
    durationMs: elapsed(),
    logArgs: args,
  };
}

const LOGGED_SECRET_KEYS: ReadonlySet<string> = new Set(["authority_code"]);

function redactForLog(args: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    copy[key] = LOGGED_SECRET_KEYS.has(key) ? "<redacted>" : value;
  }
  return copy;
}

/**
 * Строка журнала действий агента (`ai_agent_mcp_log_v1`). Сбой журнала не
 * меняет ответ инструмента: только строка в журнале приложения без данных.
 */
export async function logAiAgentToolCall(
  runtime: McpToolRuntime,
  ctx: McpToolContext,
  tool: string,
  outcome: McpToolOutcome,
): Promise<void> {
  const warn = (): void => {
    try {
      runtime.log({ event: "ai_agents_mcp", reason: "action_log_failed", tool, agent: ctx.agentKey });
    } catch {
      // Журнал приложения тоже не должен менять ответ.
    }
  };
  try {
    const response = (await withDeadline(
      runtime.client.schema("platform").rpc(AI_AGENT_MCP_RPC.log, {
        p_organization_id: ctx.organizationId,
        p_agent_key: ctx.agentKey,
        p_tool: tool,
        p_args: redactForLog(outcome.logArgs),
        p_status: outcome.status,
        p_error_code: outcome.errorCode,
        p_duration_ms: Math.min(outcome.durationMs, 2_000_000_000),
      }),
      runtime.rpcDeadlineMs,
    )) as RpcResponse;
    if (response.error) warn();
  } catch {
    warn();
  }
}
