import "server-only";

import { createHash } from "node:crypto";

import {
  AI_AGENT_AUTHORITY_NOTE_MARKER,
  AI_AGENT_LIMITS,
  AI_AGENT_RUNTIME_RPC,
  AI_AGENT_RUN_STATUSES,
  AI_AGENT_STAFF_RPC,
  AI_AGENT_TRIGGER_KINDS,
  isAiAgentKey,
  type AiAgentKey,
  type AiAgentRunErrorCode,
  type AiAgentRunPoll,
  type AiAgentRunRow,
  type AiAgentRunStatus,
  type AiAgentStartRunResult,
  type AiAgentTriggerKind,
  type AiAgentUiEvent,
} from "../../ai-agents/contract.ts";
import { isStaffPreview } from "../../platform-access.ts";
import { AnthropicApiError, type AnthropicClient, type AnthropicJson } from "./anthropic.ts";
import {
  callRpc,
  failureHas,
  isRecord,
  numberOr,
  resolveDeps,
  stringOrNull,
  truncate,
  UUID_PATTERN,
  type AiAgentsRuntimeDeps,
  type AiAgentsStaffContext,
  type RpcOutcome,
  type ServiceClient,
} from "./deps.ts";
import { readDefaultRunBudgetUsd, sessionBudget } from "./env.ts";
import {
  advanceCursor,
  convertSessionEvents,
  decodeEventCursor,
  deriveRunState,
  encodeEventCursor,
  eventText,
  isTerminalRunStatus,
  readUsage,
  unseenEvents,
  type ToolNameMap,
} from "./events.ts";

/*
 * Запуски агентов (контракт §C.2.2–C.2.5): поручение сотрудника, продолжение
 * разговора, остановка, опрос событий, хроника, ленивая сверка. События читаются
 * по запросу из Claude и в БД не копируются; в БД лежат строка запуска и расход.
 * Журнал приложения — только счётчики, без текстов поручений и ответов.
 */

const RUN_STATUSES: readonly string[] = AI_AGENT_RUN_STATUSES;
const TRIGGER_KINDS: readonly string[] = AI_AGENT_TRIGGER_KINDS;

export const RUN_ERROR_MESSAGES: Readonly<Record<AiAgentRunErrorCode, string>> = Object.freeze({
  api_key_missing: "Ключ Claude API не задан — обратитесь к администратору",
  agent_disabled: "Агент выключен. Включите его в настройках",
  agent_not_synced: "Агент ещё не синхронизирован с Claude. Нажмите «Синхронизировать с Claude» в настройках",
  forbidden: "Недостаточно прав для этого действия",
  preview_read_only: "В режиме просмотра роли действия недоступны",
  invalid_input: "Проверьте текст поручения",
  run_in_progress: "У агента уже идёт запуск. Дождитесь окончания или остановите его",
  duplicate: "Это поручение уже отправлено",
  anthropic_error: "Claude не принял запрос. Повторите позже",
  rate_limited: "Слишком много запросов к Claude. Повторите через минуту",
  unavailable: "Сервис временно недоступен. Повторите позже",
});

const fail = (code: AiAgentRunErrorCode, message?: string): { ok: false; code: AiAgentRunErrorCode; message: string } =>
  ({ ok: false, code, message: message ?? RUN_ERROR_MESSAGES[code] });

/* ------------------------------------------------------------------ общие помощники */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 без выравнивания; 12 байт → 20 символов A–Z2–7. */
export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** Записка о праве отправлять без черновика (контракт §C.2.4): интерфейс вырезает всё с маркера. */
export function withAuthorityNote(text: string, code: string): string {
  return `${text}\n\n${AI_AGENT_AUTHORITY_NOTE_MARKER}${code}]] Staff granted immediate-send authority for this conversation. `
    + `When you call send_message pass authority_code="${code}" to send directly instead of creating a draft. `
    + "Use it only for messages the staff member asked for.";
}

export const userMessageEvent = (text: string): AnthropicJson => ({ type: "user.message", content: [{ type: "text", text }] });

function plainTitle(title: string, text: string): string {
  return truncate(`${title} · ${text.replace(/\s+/gu, " ").trim().slice(0, 60)}`, 120);
}

export type NewSessionInput = Readonly<{
  agentId: string;
  agentVersion: number | null;
  environmentId: string;
  vaultId: string;
  title: string;
  text: string;
  budgetUsd: number;
}>;

/** Создаёт сессию Claude с первым сообщением (`initial_events` сразу запускают работу). Возвращает id сессии. */
export async function createAgentSession(client: AnthropicClient, input: NewSessionInput): Promise<string> {
  const budget = sessionBudget(input.budgetUsd);
  const body: AnthropicJson = {
    agent: input.agentVersion !== null && input.agentVersion > 0
      ? { type: "agent", id: input.agentId, version: input.agentVersion }
      : input.agentId,
    environment_id: input.environmentId,
    vault_ids: [input.vaultId],
    title: input.title,
    initial_events: [userMessageEvent(input.text)],
    ...(budget ? { budget } : {}),
  };
  const session = await client.sessions.create(body);
  const id = stringOrNull(session.id);
  if (!id) throw new AnthropicApiError(502, "invalid_response", "Claude API не вернул id сессии");
  return id;
}

/** Ошибка Claude → код запуска для интерфейса. */
export function anthropicFailure(error: unknown): { code: "rate_limited" | "anthropic_error"; status: number | null } {
  if (error instanceof AnthropicApiError) return { code: error.status === 429 ? "rate_limited" : "anthropic_error", status: error.status };
  return { code: "anthropic_error", status: null };
}

/** Ответ `ai_agents_run_authorize_v1`: нужные поля или null. */
export type RunAuthorization = Readonly<{
  title: string;
  model: string;
  runBudgetUsd: number;
  membershipId: string | null;
  agentId: string;
  agentVersion: number | null;
  environmentId: string;
  vaultId: string;
}>;

export function parseRunAuthorization(data: unknown, defaultBudgetUsd: number): RunAuthorization | null {
  if (!isRecord(data) || !isRecord(data.claude)) return null;
  const claude = data.claude;
  const agentId = stringOrNull(claude.agentId);
  const environmentId = stringOrNull(claude.environmentId);
  const vaultId = stringOrNull(claude.vaultId);
  if (!agentId || !environmentId || !vaultId) return null;
  const version = numberOr(claude.agentVersion, 0);
  return {
    title: stringOrNull(data.title) ?? "ИИ-агент",
    model: stringOrNull(data.model) ?? "",
    runBudgetUsd: numberOr(data.runBudgetUsd, defaultBudgetUsd),
    membershipId: stringOrNull(data.membershipId),
    agentId,
    agentVersion: version > 0 ? Math.floor(version) : null,
    environmentId,
    vaultId,
  };
}

/** Отказ `ai_agents_run_authorize_v1` → код интерфейса. */
export function authorizeFailure(outcome: Extract<RpcOutcome, { ok: false }>): { ok: false; code: AiAgentRunErrorCode; message: string } {
  if (outcome.code === "42501") return fail("forbidden");
  if (failureHas(outcome, "agent_disabled")) return fail("agent_disabled");
  if (failureHas(outcome, "agent_not_synced")) return fail("agent_not_synced");
  if (failureHas(outcome, "run_in_progress")) return fail("run_in_progress");
  return fail("unavailable");
}

function validText(text: unknown): text is string {
  return typeof text === "string" && text.trim().length > 0 && text.length <= AI_AGENT_LIMITS.commandTextMaxChars && !text.includes("\u0000");
}

async function updateRun(client: ServiceClient, organizationId: string, runId: string, patch: Record<string, unknown>): Promise<RpcOutcome> {
  return callRpc(client, AI_AGENT_RUNTIME_RPC.runUpdate, { p_organization_id: organizationId, p_run_id: runId, p_patch: patch });
}

/** Обновление запуска с двумя повторами при сбое сети/базы (сессия уже создана — терять её нельзя). */
async function updateRunWithRetry(
  client: ServiceClient, organizationId: string, runId: string, patch: Record<string, unknown>, deps: AiAgentsRuntimeDeps,
): Promise<RpcOutcome> {
  let last: RpcOutcome = await updateRun(client, organizationId, runId, patch);
  for (const delay of [300, 900]) {
    if (last.ok || last.code === "55000" || last.code === "22023" || last.code === "P0002") break;
    await deps.sleep(delay);
    last = await updateRun(client, organizationId, runId, patch);
  }
  return last;
}

/* ------------------------------------------------------------------- чтение запуска */

const asRunStatus = (value: unknown): AiAgentRunStatus | null =>
  typeof value === "string" && RUN_STATUSES.includes(value) ? (value as AiAgentRunStatus) : null;

/** Строка запуска из ответа БД (camelCase) с безопасными значениями по умолчанию. */
export function toRunRow(value: unknown): AiAgentRunRow | null {
  if (!isRecord(value)) return null;
  const id = stringOrNull(value.id);
  const status = asRunStatus(value.status);
  const key = value.agentKey;
  if (!id || !status || !isAiAgentKey(key)) return null;
  const trigger = typeof value.triggerKind === "string" && TRIGGER_KINDS.includes(value.triggerKind)
    ? (value.triggerKind as AiAgentTriggerKind) : "command";
  const duration = numberOr(value.durationSeconds, NaN);
  return {
    id,
    agentKey: key,
    status,
    triggerKind: trigger,
    startedAt: stringOrNull(value.startedAt) ?? new Date(0).toISOString(),
    endedAt: stringOrNull(value.endedAt),
    durationSeconds: Number.isFinite(duration) ? duration : null,
    promptPreview: stringOrNull(value.promptPreview),
    summary: stringOrNull(value.summary),
    errorCode: stringOrNull(value.errorCode),
    errorMessage: stringOrNull(value.errorMessage),
    model: stringOrNull(value.model),
    agentVersion: Number.isFinite(numberOr(value.agentVersion, NaN)) ? numberOr(value.agentVersion, 0) : null,
    sessionId: stringOrNull(value.sessionId),
    inputTokens: numberOr(value.inputTokens, 0),
    outputTokens: numberOr(value.outputTokens, 0),
    cacheReadTokens: numberOr(value.cacheReadTokens, 0),
    costCents: numberOr(value.costCents, 0),
    sendAuthority: value.sendAuthority === true,
    startedByName: stringOrNull(value.startedByName),
    actionsCount: numberOr(value.actionsCount, 0),
    draftsCount: numberOr(value.draftsCount, 0),
  };
}

type LoadedRun = Readonly<{ ok: true; run: AiAgentRunRow }> | Readonly<{ ok: false; code: "not_found" | "forbidden" | "unavailable" }>;

/** Запуск глазами сотрудника: право `ai.agent.use` проверяет `ai_agents_run_get_v1`. */
async function loadRunForStaff(ctx: AiAgentsStaffContext, runId: string): Promise<LoadedRun> {
  if (!UUID_PATTERN.test(runId)) return { ok: false, code: "not_found" };
  const outcome = await callRpc(ctx.staffClient, AI_AGENT_STAFF_RPC.runGet, {
    p_organization_id: ctx.actor.organizationId,
    p_run_id: runId,
  });
  if (!outcome.ok) {
    if (outcome.code === "42501") return { ok: false, code: "forbidden" };
    if (outcome.code === "P0002") return { ok: false, code: "not_found" };
    return { ok: false, code: "unavailable" };
  }
  const row = toRunRow(isRecord(outcome.data) ? outcome.data.run : null);
  return row ? { ok: true, run: row } : { ok: false, code: "unavailable" };
}

/* ------------------------------------------------------------------------- старт */

export async function startAiAgentRunImpl(
  ctx: AiAgentsStaffContext,
  input: Readonly<{ key: AiAgentKey; text: string; sendAuthority: boolean; requestId: string }>,
  overrides?: Partial<AiAgentsRuntimeDeps>,
): Promise<AiAgentStartRunResult> {
  if (isStaffPreview(ctx.actor)) return fail("preview_read_only");
  if (!isAiAgentKey(input.key) || !validText(input.text) || !UUID_PATTERN.test(input.requestId)) return fail("invalid_input");
  const deps = resolveDeps(overrides);
  const anthropic = deps.anthropic();
  if (!anthropic) return fail("api_key_missing");
  const organizationId = ctx.actor.organizationId;

  // 1. Право, включён ли агент, синхронизирован ли — решает база.
  const authorized = await callRpc(ctx.staffClient, AI_AGENT_STAFF_RPC.runAuthorize, {
    p_organization_id: organizationId,
    p_key: input.key,
    p_send_authority: input.sendAuthority,
  });
  if (!authorized.ok) return authorizeFailure(authorized);
  const auth = parseRunAuthorization(authorized.data, readDefaultRunBudgetUsd(deps.env()));
  if (!auth) return fail("agent_not_synced");

  // 2. Код полномочия отправки: в БД только SHA-256, открытый текст — в сообщении агенту.
  const authorityCode = input.sendAuthority ? base32(deps.randomBytes(12)) : null;

  // 3. Резерв строки запуска (повтор по requestId возвращает прежний запуск).
  const client = await deps.serviceClient();
  const reserved = await callRpc(client, AI_AGENT_RUNTIME_RPC.runReserve, {
    p_organization_id: organizationId,
    p_key: input.key,
    p_trigger_kind: "command",
    p_dedupe_key: `cmd:${input.requestId}`,
    p_started_by_membership_id: auth.membershipId ?? ctx.actor.membershipId,
    p_send_authority_sha256: authorityCode ? sha256Hex(authorityCode) : null,
    p_prompt_preview: input.text.slice(0, 500),
    p_model: auth.model || null,
    p_agent_version: auth.agentVersion,
  });
  if (!reserved.ok) return authorizeFailure(reserved);
  const reservation = isRecord(reserved.data) ? reserved.data : {};
  if (reservation.reserved !== true) {
    const existing = stringOrNull(reservation.existingRunId);
    if (reservation.reason === "duplicate" && existing) return { ok: true, runId: existing };
    return reservation.reason === "run_in_progress" ? fail("run_in_progress") : fail("unavailable");
  }
  const runId = stringOrNull(reservation.runId);
  if (!runId) return fail("unavailable");

  // 4. Сессия Claude с первым сообщением.
  let sessionId: string;
  try {
    sessionId = await createAgentSession(anthropic, {
      agentId: auth.agentId,
      agentVersion: auth.agentVersion,
      environmentId: auth.environmentId,
      vaultId: auth.vaultId,
      title: plainTitle(auth.title, input.text),
      text: authorityCode ? withAuthorityNote(input.text, authorityCode) : input.text,
      budgetUsd: auth.runBudgetUsd,
    });
  } catch (error) {
    const failure = anthropicFailure(error);
    deps.log({ op: "run_start", status: "error", agent: input.key, code: failure.code, http: failure.status });
    await updateRun(client, organizationId, runId, {
      status: "failed",
      errorCode: failure.code,
      errorMessage: truncate(error instanceof AnthropicApiError ? error.message : "Сессия Claude не создана", 500),
    });
    return fail(failure.code);
  }

  // 5. Запуск работает.
  const updated = await updateRunWithRetry(client, organizationId, runId, { sessionId, status: "running" }, deps);
  deps.log({ op: "run_start", status: updated.ok ? "ok" : "error", agent: input.key });
  return { ok: true, runId };
}

/* ------------------------------------------------------------- продолжение и стоп */

export async function followUpAiAgentRunImpl(
  ctx: AiAgentsStaffContext,
  input: Readonly<{ runId: string; text: string; requestId: string }>,
  overrides?: Partial<AiAgentsRuntimeDeps>,
): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; code: AiAgentRunErrorCode; message: string }>> {
  if (isStaffPreview(ctx.actor)) return fail("preview_read_only");
  if (!validText(input.text) || !UUID_PATTERN.test(input.runId) || !UUID_PATTERN.test(input.requestId)) return fail("invalid_input");
  const deps = resolveDeps(overrides);
  const anthropic = deps.anthropic();
  if (!anthropic) return fail("api_key_missing");

  const loaded = await loadRunForStaff(ctx, input.runId);
  if (!loaded.ok) return loaded.code === "forbidden" ? fail("forbidden") : fail("unavailable");
  const run = loaded.run;
  if (!run.sessionId) return fail("unavailable", "У запуска нет сессии Claude");
  if (run.status === "budget_reached") {
    return fail("anthropic_error", "Запуск остановлен по лимиту расхода. Начните новое поручение");
  }

  const authorized = await callRpc(ctx.staffClient, AI_AGENT_STAFF_RPC.runAuthorize, {
    p_organization_id: ctx.actor.organizationId,
    p_key: run.agentKey,
    p_send_authority: false,
  });
  if (!authorized.ok) return authorizeFailure(authorized);

  try {
    const session = await anthropic.sessions.get(run.sessionId);
    if (session.status === "running" || session.status === "rescheduling") return fail("run_in_progress");
    if (session.status === "terminated") return fail("unavailable", "Сессия Claude уже закрыта. Начните новое поручение");
    await anthropic.sessions.sendEvents(run.sessionId, [userMessageEvent(input.text)]);
  } catch (error) {
    const failure = anthropicFailure(error);
    deps.log({ op: "run_follow_up", status: "error", agent: run.agentKey, code: failure.code, http: failure.status });
    return fail(failure.code);
  }
  const client = await deps.serviceClient();
  await updateRunWithRetry(client, ctx.actor.organizationId, run.id, { status: "running" }, deps);
  deps.log({ op: "run_follow_up", status: "ok", agent: run.agentKey });
  return { ok: true };
}

export async function interruptAiAgentRunImpl(
  ctx: AiAgentsStaffContext,
  input: Readonly<{ runId: string }>,
  overrides?: Partial<AiAgentsRuntimeDeps>,
): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; code: AiAgentRunErrorCode | "not_found"; message: string }>> {
  if (isStaffPreview(ctx.actor)) return fail("preview_read_only");
  const deps = resolveDeps(overrides);
  const anthropic = deps.anthropic();
  if (!anthropic) return fail("api_key_missing");
  const loaded = await loadRunForStaff(ctx, input.runId);
  if (!loaded.ok) {
    return loaded.code === "not_found" ? { ok: false, code: "not_found", message: "Запуск не найден" }
      : loaded.code === "forbidden" ? fail("forbidden") : fail("unavailable");
  }
  const { run } = loaded;
  if (!run.sessionId) return fail("unavailable", "У запуска нет сессии Claude");
  try {
    await anthropic.sessions.sendEvents(run.sessionId, [{ type: "user.interrupt" }]);
  } catch (error) {
    const failure = anthropicFailure(error);
    deps.log({ op: "run_interrupt", status: "error", agent: run.agentKey, code: failure.code, http: failure.status });
    return fail(failure.code);
  }
  deps.log({ op: "run_interrupt", status: "ok", agent: run.agentKey });
  return { ok: true };
}

/* -------------------------------------------------------------------------- опрос */

/** Поля `p_patch` окончательного статуса: расход и токены берутся из `GET /v1/sessions/{id}`. */
function terminalPatch(
  status: AiAgentRunStatus,
  session: AnthropicJson,
  nowIso: string,
  extra: Readonly<{ summary?: string | null; errorCode?: string | null; errorMessage?: string | null; eventCount?: number | null }>,
): Record<string, unknown> {
  const usage = readUsage(session);
  const patch: Record<string, unknown> = {
    status,
    endedAt: nowIso,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    costCents: usage.costCents,
  };
  if (usage.activeSeconds !== null) patch.activeSeconds = usage.activeSeconds;
  if (extra.summary) patch.summary = truncate(extra.summary.trim(), 4_000);
  if (extra.errorCode) patch.errorCode = truncate(extra.errorCode, 64);
  if (extra.errorMessage) patch.errorMessage = truncate(extra.errorMessage, 500);
  if (extra.eventCount !== null && extra.eventCount !== undefined) patch.eventCount = extra.eventCount;
  return patch;
}

/** Ответ строки запуска после патча — без повторного чтения из БД. */
function applyPatch(run: AiAgentRunRow, patch: Record<string, unknown>): AiAgentRunRow {
  const endedAt = typeof patch.endedAt === "string" ? patch.endedAt : run.endedAt;
  const startedMs = Date.parse(run.startedAt);
  const endedMs = endedAt ? Date.parse(endedAt) : NaN;
  return {
    ...run,
    status: (patch.status as AiAgentRunStatus | undefined) ?? run.status,
    endedAt,
    durationSeconds: Number.isFinite(startedMs) && Number.isFinite(endedMs) ? Math.max(0, Math.round((endedMs - startedMs) / 1000)) : run.durationSeconds,
    summary: typeof patch.summary === "string" ? patch.summary : run.summary,
    errorCode: typeof patch.errorCode === "string" ? patch.errorCode : run.errorCode,
    errorMessage: typeof patch.errorMessage === "string" ? patch.errorMessage : run.errorMessage,
    inputTokens: typeof patch.inputTokens === "number" ? patch.inputTokens : run.inputTokens,
    outputTokens: typeof patch.outputTokens === "number" ? patch.outputTokens : run.outputTokens,
    cacheReadTokens: typeof patch.cacheReadTokens === "number" ? patch.cacheReadTokens : run.cacheReadTokens,
    costCents: typeof patch.costCents === "number" ? patch.costCents : run.costCents,
  };
}

async function lastAgentMessage(anthropic: AnthropicClient, sessionId: string): Promise<string | null> {
  const page = await anthropic.sessions.listEvents(sessionId, { order: "desc", limit: 1, types: ["agent.message"] });
  const first = page.data[0];
  const text = first ? eventText(first.content) : "";
  return text.trim() ? text : null;
}

type PollResult =
  | Readonly<{ ok: true; poll: AiAgentRunPoll }>
  | Readonly<{ ok: false; code: "not_found" | "forbidden" | "unavailable" }>;

export async function pollAiAgentRunImpl(
  ctx: AiAgentsStaffContext,
  input: Readonly<{ runId: string; cursor: string | null }>,
  overrides?: Partial<AiAgentsRuntimeDeps>,
): Promise<PollResult> {
  const deps = resolveDeps(overrides);
  const loaded = await loadRunForStaff(ctx, input.runId);
  if (!loaded.ok) return loaded;
  let run = loaded.run;
  const settled = (current: AiAgentRunRow): AiAgentRunPoll => {
    const done = isTerminalRunStatus(current.status);
    return { run: current, events: [], cursor: done ? null : input.cursor, done, pollAfterMs: done ? 0 : AI_AGENT_LIMITS.pollIntervalMs };
  };
  const anthropic = deps.anthropic();
  const sessionId = run.sessionId;
  if (!anthropic || !sessionId) return { ok: true, poll: settled(run) };

  try {
    const cursor = decodeEventCursor(input.cursor);
    const raw: AnthropicJson[] = [];
    let page: string | undefined;
    for (let index = 0; index < 3; index += 1) {
      const response = await anthropic.sessions.listEvents(sessionId, {
        order: "asc",
        limit: 100,
        ...(cursor?.t ? { createdAtGte: cursor.t } : {}),
        ...(page ? { page } : {}),
      });
      raw.push(...response.data);
      if (!response.nextPage) break;
      page = response.nextPage;
    }
    const fresh = unseenEvents(raw, cursor);
    const nowIso = new Date(deps.now()).toISOString();
    const names: ToolNameMap = new Map(Object.entries(cursor?.u ?? {}));
    const events = convertSessionEvents(fresh, names, nowIso);
    const nextCursor = advanceCursor(cursor, fresh, names);

    const derived = deriveRunState(fresh, run.status);
    if (derived.changed) {
      const client = await deps.serviceClient();
      let patch: Record<string, unknown>;
      if (isTerminalRunStatus(derived.status)) {
        // Недоступность Claude здесь — исключение: пачка не засчитывается, повтор прочитает её заново.
        const session = await anthropic.sessions.get(sessionId);
        const summary = derived.lastAgentText ?? await lastAgentMessage(anthropic, sessionId).catch(() => null);
        const errorEvent = [...events].reverse().find((event): event is Extract<AiAgentUiEvent, { kind: "error" }> => event.kind === "error");
        patch = terminalPatch(derived.status, session, nowIso, {
          summary,
          errorCode: derived.errorCode,
          errorMessage: derived.status === "failed" ? errorEvent?.message ?? "Сессия Claude завершилась с ошибкой" : null,
          eventCount: nextCursor.n,
        });
      } else {
        patch = { status: derived.status };
      }
      const updated = await updateRun(client, ctx.actor.organizationId, run.id, patch);
      if (!updated.ok && updated.code !== "55000" && updated.code !== "22023") throw new Error("run_update_failed");
      if (updated.ok) run = applyPatch(run, patch);
      deps.log({ op: "run_poll", status: updated.ok ? "ok" : "error", agent: run.agentKey, run_status: derived.status });
    }

    const done = isTerminalRunStatus(run.status) && fresh.length === 0;
    return {
      ok: true,
      poll: {
        run,
        events,
        cursor: done ? null : encodeEventCursor(nextCursor),
        done,
        pollAfterMs: done ? 0 : AI_AGENT_LIMITS.pollIntervalMs,
      },
    };
  } catch {
    // Недоступность Claude или базы — не ошибка запуска: прежний статус, пустая пачка, курсор не сдвинут.
    deps.log({ op: "run_poll", status: "error", agent: run.agentKey, reason: "unavailable" });
    return { ok: true, poll: settled(run) };
  }
}

export async function loadAiAgentRunTranscriptImpl(
  ctx: AiAgentsStaffContext,
  input: Readonly<{ runId: string }>,
  overrides?: Partial<AiAgentsRuntimeDeps>,
): Promise<Readonly<{ ok: true; events: readonly AiAgentUiEvent[]; truncated: boolean }> | Readonly<{ ok: false; code: "not_found" | "forbidden" | "unavailable" }>> {
  const deps = resolveDeps(overrides);
  const loaded = await loadRunForStaff(ctx, input.runId);
  if (!loaded.ok) return loaded;
  const sessionId = loaded.run.sessionId;
  if (!sessionId) return { ok: true, events: [], truncated: false };
  const anthropic = deps.anthropic();
  if (!anthropic) return { ok: false, code: "unavailable" };
  try {
    const raw: AnthropicJson[] = [];
    let page: string | undefined;
    let more = false;
    for (let index = 0; index < 4; index += 1) {
      const response = await anthropic.sessions.listEvents(sessionId, { order: "asc", limit: 100, ...(page ? { page } : {}) });
      raw.push(...response.data);
      more = response.nextPage !== null;
      if (!response.nextPage) break;
      page = response.nextPage;
    }
    const names: ToolNameMap = new Map();
    const events = convertSessionEvents(raw.slice(0, 400), names, new Date(deps.now()).toISOString());
    return { ok: true, events, truncated: more || raw.length > 400 };
  } catch {
    deps.log({ op: "run_transcript", status: "error", agent: loaded.run.agentKey });
    return { ok: false, code: "unavailable" };
  }
}

/* ----------------------------------------------------------------------- сверка */

const RECONCILE_INTERVAL_MS = 60_000;
const START_LOST_AFTER_MS = 3 * 60_000;
const reconcileLastRun = new Map<string, number>();
const seenDeploymentRuns = new Set<string>();

/** Для тестов: сбросить память процесса (ограничитель 60 с и уже разобранные запуски расписания). */
export function resetAiAgentReconcileMemory(): void {
  reconcileLastRun.clear();
  seenDeploymentRuns.clear();
}

type OpenRun = Readonly<{
  runId: string;
  agentKey: string;
  sessionId: string | null;
  status: string;
  startedAt: string | null;
  lastReconciledAt: string | null;
}>;

function toOpenRuns(data: unknown): OpenRun[] {
  const list = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.runs) ? data.runs : [];
  const result: OpenRun[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const runId = stringOrNull(item.runId);
    if (!runId) continue;
    result.push({
      runId,
      agentKey: stringOrNull(item.agentKey) ?? "",
      sessionId: stringOrNull(item.sessionId),
      status: stringOrNull(item.status) ?? "running",
      startedAt: stringOrNull(item.startedAt),
      lastReconciledAt: stringOrNull(item.lastReconciledAt),
    });
  }
  return result;
}

async function closeOpenRun(
  anthropic: AnthropicClient, client: ServiceClient, organizationId: string, entry: OpenRun, deps: AiAgentsRuntimeDeps,
): Promise<void> {
  const now = deps.now();
  const nowIso = new Date(now).toISOString();
  if (!entry.sessionId) {
    const started = entry.startedAt ? Date.parse(entry.startedAt) : NaN;
    if (entry.status === "starting" && Number.isFinite(started) && now - started > START_LOST_AFTER_MS) {
      await updateRun(client, organizationId, entry.runId, {
        status: "failed", endedAt: nowIso, errorCode: "start_lost", errorMessage: "Сессия Claude не была создана",
      });
    }
    return;
  }
  const last = entry.lastReconciledAt ? Date.parse(entry.lastReconciledAt) : NaN;
  if (Number.isFinite(last) && now - last < RECONCILE_INTERVAL_MS) return;
  let session: AnthropicJson;
  try {
    session = await anthropic.sessions.get(entry.sessionId);
  } catch (error) {
    if (error instanceof AnthropicApiError && error.status === 404) {
      await updateRun(client, organizationId, entry.runId, {
        status: "failed", endedAt: nowIso, errorCode: "session_missing", errorMessage: "Сессия Claude удалена",
      });
    }
    return;
  }
  if (session.status === "idle") {
    let status: AiAgentRunStatus = "completed";
    let summary: string | null = null;
    try {
      const idle = await anthropic.sessions.listEvents(entry.sessionId, { order: "desc", limit: 1, types: ["session.status_idle"] });
      const stop = isRecord(idle.data[0]?.stop_reason) ? stringOrNull((idle.data[0]!.stop_reason as Record<string, unknown>).type) : null;
      if (stop === "budget_reached") status = "budget_reached";
      else if (stop === "requires_action") status = "needs_attention";
      summary = await lastAgentMessage(anthropic, entry.sessionId);
    } catch {
      // без причины остановки — «Готово»: сессия отработала
    }
    await updateRun(client, organizationId, entry.runId, { ...terminalPatch(status, session, nowIso, { summary }), lastReconciledAt: nowIso });
  } else if (session.status === "terminated") {
    await updateRun(client, organizationId, entry.runId, {
      ...terminalPatch("failed", session, nowIso, { errorCode: "terminated", errorMessage: "Сессия Claude завершена" }),
      lastReconciledAt: nowIso,
    });
  } else {
    await updateRun(client, organizationId, entry.runId, { ...(entry.status === "starting" ? { status: "running" } : {}), lastReconciledAt: nowIso });
  }
}

/**
 * Закрывает по состоянию сессии открытые запуски (всех агентов или одного). Зовётся сверкой страниц и
 * приёмом событий (`dispatch.ts`): без неё запуск по событию, который закончился, пока никто не открывал
 * раздел, оставался бы `running` и блокировал следующие события. Не бросает; `false` — список не прочитан.
 */
export async function closeOpenAiAgentRuns(
  anthropic: AnthropicClient, client: ServiceClient, organizationId: string, key: string | null, deps: AiAgentsRuntimeDeps,
): Promise<boolean> {
  try {
    const open = await callRpc(client, AI_AGENT_RUNTIME_RPC.runsOpen, {
      p_organization_id: organizationId,
      p_key: key,
      p_limit: 20,
    });
    if (!open.ok) return false;
    for (const entry of toOpenRuns(open.data)) {
      try {
        await closeOpenRun(anthropic, client, organizationId, entry, deps);
      } catch {
        deps.log({ op: "reconcile_run", status: "error" });
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function reconcileDeployments(
  ctx: AiAgentsStaffContext, anthropic: AnthropicClient, client: ServiceClient, key: AiAgentKey | undefined, deps: AiAgentsRuntimeDeps,
): Promise<void> {
  const listed = await callRpc(ctx.staffClient, AI_AGENT_STAFF_RPC.list, { p_organization_id: ctx.actor.organizationId });
  if (!listed.ok || !isRecord(listed.data) || !Array.isArray(listed.data.agents)) return;
  for (const agent of listed.data.agents) {
    if (!isRecord(agent) || !isAiAgentKey(agent.key) || (key && agent.key !== key)) continue;
    const sync = isRecord(agent.sync) ? agent.sync : {};
    const deploymentId = stringOrNull(sync.deploymentId);
    if (!deploymentId) continue;
    try {
      const runs = await anthropic.deploymentRuns.list(deploymentId, 20);
      for (const run of runs) {
        const runId = stringOrNull(run.id);
        if (!runId || seenDeploymentRuns.has(runId)) continue;
        const sessionId = stringOrNull(run.session_id);
        const startedAt = stringOrNull(run.created_at) ?? new Date(deps.now()).toISOString();
        if (sessionId) {
          const upsert = await callRpc(client, AI_AGENT_RUNTIME_RPC.scheduledRunUpsert, {
            p_organization_id: ctx.actor.organizationId,
            p_key: agent.key,
            p_session_id: sessionId,
            p_started_at: startedAt,
            p_status: "running",
          });
          if (upsert.ok) seenDeploymentRuns.add(runId);
        } else if (isRecord(run.error)) {
          // Запуск по расписанию не создался в Claude: одна строка `failed` на запись (dedupe_key = drun:<id>).
          const reserved = await callRpc(client, AI_AGENT_RUNTIME_RPC.runReserve, {
            p_organization_id: ctx.actor.organizationId,
            p_key: agent.key,
            p_trigger_kind: "schedule",
            p_dedupe_key: `drun:${runId}`,
            p_started_by_membership_id: null,
            p_send_authority_sha256: null,
            p_prompt_preview: "Запуск по расписанию не создан",
            p_model: stringOrNull(agent.model),
            p_agent_version: numberOr(sync.agentVersion, NaN) > 0 ? numberOr(sync.agentVersion, 0) : null,
          });
          if (reserved.ok) {
            const data = isRecord(reserved.data) ? reserved.data : {};
            const newRunId = data.reserved === true ? stringOrNull(data.runId) : null;
            if (newRunId) {
              await updateRun(client, ctx.actor.organizationId, newRunId, {
                status: "failed",
                endedAt: startedAt,
                errorCode: truncate(stringOrNull(run.error.type) ?? "deployment_run_error", 64),
                errorMessage: truncate(stringOrNull(run.error.message) ?? "Запуск по расписанию не удался", 500),
              });
            }
            seenDeploymentRuns.add(runId);
          }
        }
      }
    } catch {
      deps.log({ op: "reconcile_deployment", status: "error", agent: agent.key });
    }
  }
}

/** Ленивая сверка (контракт §C.2.5): не чаще раза в 60 с на процесс и область. Не бросает. */
export async function reconcileAiAgentRunsImpl(
  ctx: AiAgentsStaffContext,
  input: Readonly<{ key?: AiAgentKey }>,
  overrides?: Partial<AiAgentsRuntimeDeps>,
): Promise<void> {
  try {
    const deps = resolveDeps(overrides);
    const anthropic = deps.anthropic();
    if (!anthropic) return;
    const scope = `${ctx.actor.organizationId}:${input.key ?? "*"}`;
    const now = deps.now();
    const last = reconcileLastRun.get(scope);
    if (last !== undefined && now - last < RECONCILE_INTERVAL_MS) return;
    reconcileLastRun.set(scope, now);
    const client = await deps.serviceClient();

    // 1. Запуски по расписанию из deployment_runs.
    await reconcileDeployments(ctx, anthropic, client, input.key, deps);

    // 2. Открытые запуски: закрыть по состоянию сессии.
    if (await closeOpenAiAgentRuns(anthropic, client, ctx.actor.organizationId, input.key ?? null, deps)) {
      deps.log({ op: "reconcile", status: "ok" });
    }
  } catch {
    // сверка вторична: страница откроется и без неё
  }
}
