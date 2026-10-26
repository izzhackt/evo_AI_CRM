"use server";
import { revalidatePath } from "next/cache";

import {
  AI_AGENT_LIMITS,
  AI_AGENT_STAFF_RPC,
  isAiAgentKey,
  isAiAgentModelId,
  type AiAgentKey,
  type AiAgentRunPoll,
  type AiAgentUiEvent,
} from "./ai-agents/contract.ts";
import { AI_AGENT_DEFAULTS, effectiveAiAgentInstructions } from "../content/ai-agents/index.ts";
import { isStaffPreview, staffCanAccessRoute } from "./platform-access.ts";
import { resolvePlatformActor, type ActivePlatformActor } from "./platform-auth";
import { exactActionStringFields } from "./server/action-form-fields";
import {
  aiAgentsRuntimeAvailability,
  decideAiAgentDraft,
  followUpAiAgentRun,
  interruptAiAgentRun,
  loadAiAgentRunTranscript,
  pollAiAgentRun,
  startAiAgentRun,
  syncAiAgent,
  type AiAgentsStaffContext,
} from "./server/ai-agents/runtime.ts";
import { createSupabaseServerClient } from "./supabase/server";
import {
  AI_AGENTS_DRAFT_FAILURE_WORDS,
  aiAgentsErrorCopy,
  isAiAgentUuid,
  isValidCron,
  mapAiAgentsDbError,
  type AiAgentsActionState,
} from "./v3/ai-agents-view.ts";
import { readAiAgent } from "./v3/ai-agents-source.ts";

/**
 * Серверные действия раздела «ИИ-агенты» (контракт §D.2): тонкие обёртки.
 * Каждое начинает с проверки сотрудника (`resolvePlatformActor`): не вошёл —
 * `forbidden`, просмотр роли администратора — `preview_read_only`; права и
 * состояние решает база (RPC сотрудника) и рантайм. Service-клиент в UI не
 * открывается: Claude, синхронизация и отправка — только через
 * `server/ai-agents/runtime.ts`.
 *
 * Запись — с id запроса, замороженным при повторе: на `unavailable` действие
 * возвращает тот же id, и форма повторяет им, а база отвечает прежней
 * квитанцией (как `postCaseChatMessageAction`).
 */

const SECTION = "/v3/ai-agents";
const NUL = /\u0000/u;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const CLAUDE_AGENT_ID = /^agent_[A-Za-z0-9]{8,64}$/u;
const TIMEZONE = /^[A-Za-z0-9_+/-]{1,64}$/u;
/** Поля, после которых настройки Claude устаревают и агента надо синхронизировать. */
const SYNC_FIELDS: ReadonlySet<string> = new Set([
  "enabled", "model", "instructionsOverride", "scheduleCron", "scheduleTz", "schedulePromptOverride", "claudeAgentId",
]);

type Authorized =
  | Readonly<{ ok: true; actor: ActivePlatformActor; ctx: AiAgentsStaffContext }>
  | Readonly<{ ok: false; code: "forbidden" | "preview_read_only" }>;

async function authorize(): Promise<Authorized> {
  const result = await resolvePlatformActor();
  if (result.status !== "authenticated") return { ok: false, code: "forbidden" };
  const actor = result.actor;
  if (isStaffPreview(actor)) return { ok: false, code: "preview_read_only" };
  if (!staffCanAccessRoute(actor, SECTION)) return { ok: false, code: "forbidden" };
  return { ok: true, actor, ctx: { staffClient: await createSupabaseServerClient(), actor } };
}

const failed = (code: string, requestId: string | null, extra: Partial<AiAgentsActionState> = {}): AiAgentsActionState =>
  ({ status: "failed", code, message: aiAgentsErrorCopy(code), requestId, ...extra });

/**
 * Сессия создана, но запуск не записан: слова зависят от того, остановилась ли она, и сотрудник не должен
 * повторять вслепую — поэтому текст приложения доходит до экрана как есть (остальные коды говорят общей фразой).
 */
const startFailed = (result: Readonly<{ code: string; message: string }>, requestId: string | null): AiAgentsActionState =>
  failed(result.code, requestId, result.code === "session_unlinked" ? { message: result.message } : {});

const textOf = (value: string) => value.replace(/\r\n?/gu, "\n");

function refresh(key?: AiAgentKey) {
  revalidatePath(SECTION);
  if (key) revalidatePath(`${SECTION}/${key}`);
}

/* ------------------------------------------------------------------ настройки */

type Patch = Record<string, unknown>;

/** Строгая проверка патча: только известные поля и значения; иначе `null`. */
function parsePatch(raw: string): Patch | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const patch: Patch = {};
  for (const [name, item] of Object.entries(input)) {
    switch (name) {
      case "enabled": case "autoSend": case "triggerWebsiteLead": case "triggerWhatsappInbound":
        if (typeof item !== "boolean") return null;
        break;
      case "model":
        if (!isAiAgentModelId(item)) return null;
        break;
      case "instructionsOverride":
        if (item !== null && (typeof item !== "string" || item.length > AI_AGENT_LIMITS.instructionsMaxChars || NUL.test(item))) return null;
        break;
      case "schedulePromptOverride":
        if (item !== null && (typeof item !== "string" || item.length > 8000 || NUL.test(item))) return null;
        break;
      case "scheduleCron":
        if (item !== null && (typeof item !== "string" || !isValidCron(item))) return null;
        break;
      case "scheduleTz":
        if (typeof item !== "string" || !TIMEZONE.test(item)) return null;
        break;
      case "runBudgetUsd":
        if (typeof item !== "number" || !Number.isFinite(item) || item < 0 || item > 100) return null;
        break;
      case "claudeAgentId":
        if (item !== null && (typeof item !== "string" || !CLAUDE_AGENT_ID.test(item))) return null;
        break;
      default:
        return null;
    }
    patch[name] = item;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Общий путь записи настроек и инструкции: админ → «Инструкции пока нет» до
 * базы → `ai_agents_update_v1` → при изменении того, что видит Claude, —
 * синхронизация (если ключ Claude задан и агент уже в Claude либо включается).
 */
async function applyUpdate(
  access: Extract<Authorized, { ok: true }>,
  input: Readonly<{ key: AiAgentKey; expectedVersion: number; requestId: string; patch: Patch }>,
): Promise<AiAgentsActionState> {
  const { actor, ctx } = access;
  const { key, requestId, patch } = input;
  if (actor.systemRole !== "admin") return failed("forbidden", requestId);

  if (patch.enabled === true) {
    let override: string | null | undefined = patch.instructionsOverride as string | null | undefined;
    if (override === undefined) {
      const current = await readAiAgent(actor, key);
      if (current.status !== "available") return failed(current.status === "not_ready" ? "not_ready" : "unavailable", requestId);
      override = current.data.instructionsOverride;
    }
    if (!effectiveAiAgentInstructions(key, override ?? null).trim()) return failed("instructions_empty", requestId);
  }

  const { data, error } = await ctx.staffClient.schema("platform").rpc(AI_AGENT_STAFF_RPC.update, {
    p_organization_id: actor.organizationId,
    p_key: key,
    p_expected_version: input.expectedVersion,
    p_patch: patch,
    p_request_id: requestId,
  });
  if (error) return failed(mapAiAgentsDbError(error as { code?: string; message?: string }), requestId);
  const row = data !== null && typeof data === "object" ? data as Record<string, unknown> : null;
  const changed = Array.isArray(row?.changed) ? row.changed.filter((name): name is string => typeof name === "string") : null;
  if (!row || row.key !== key || changed === null) return failed("unavailable", requestId);
  refresh(key);

  const needsSync = changed.some((name) => SYNC_FIELDS.has(name));
  if (!needsSync || !aiAgentsRuntimeAvailability().configured) return { status: "saved", code: null, message: "Сохранено.", requestId };
  const after = await readAiAgent(actor, key);
  const hasClaudeAgent = after.status === "available" && after.data.sync.claudeAgentId !== null;
  if (!hasClaudeAgent && patch.enabled !== true) return { status: "saved", code: null, message: "Сохранено.", requestId };

  const sync = await syncAiAgent(ctx, { key, requestId: crypto.randomUUID() });
  refresh(key);
  if (sync.ok) {
    return { status: "saved", code: null, message: "Сохранено и отправлено в Claude.", requestId, warnings: sync.warnings };
  }
  return {
    status: "saved", code: sync.code,
    message: `Сохранено, но в Claude пока не отправлено: ${aiAgentsErrorCopy(sync.code).replace(/\.$/u, "")}. Повторите в «Настройках → Синхронизация».`,
    requestId,
  };
}

export async function updateAiAgentAction(_previous: AiAgentsActionState, form: FormData): Promise<AiAgentsActionState> {
  let requestId: string | null = null;
  try {
    const fields = exactActionStringFields(form, ["request_id", "key", "expected_version", "patch"]);
    const rawRequest = fields?.get("request_id") ?? "";
    const key = fields?.get("key");
    const expected = fields?.get("expected_version") ?? "";
    if (!fields || !isAiAgentUuid(rawRequest)) return failed("invalid_input", null);
    requestId = rawRequest;
    const patch = parsePatch(fields.get("patch") ?? "");
    if (!isAiAgentKey(key) || !/^[1-9]\d{0,14}$/u.test(expected) || !patch) return failed("invalid_patch", requestId);
    const access = await authorize();
    if (!access.ok) return failed(access.code, requestId);
    return await applyUpdate(access, { key, expectedVersion: Number(expected), requestId, patch });
  } catch {
    return failed("unavailable", requestId);
  }
}

/** «Сохранить» / «Сбросить на стандартные» во вкладке «Правила агента»: тот же `update`, одно поле. */
export async function saveAiAgentInstructionsAction(_previous: AiAgentsActionState, form: FormData): Promise<AiAgentsActionState> {
  let requestId: string | null = null;
  try {
    const fields = exactActionStringFields(form, ["request_id", "key", "expected_version", "mode", "text"]);
    const rawRequest = fields?.get("request_id") ?? "";
    const key = fields?.get("key");
    const mode = fields?.get("mode");
    const expected = fields?.get("expected_version") ?? "";
    if (!fields || !isAiAgentUuid(rawRequest)) return failed("invalid_input", null);
    requestId = rawRequest;
    if (!isAiAgentKey(key) || (mode !== "save" && mode !== "reset") || !/^[1-9]\d{0,14}$/u.test(expected)) return failed("invalid_input", requestId);
    const text = textOf(fields.get("text") ?? "");
    if (text.length > AI_AGENT_LIMITS.instructionsMaxChars || NUL.test(text)) return failed("invalid_input", requestId);
    const access = await authorize();
    if (!access.ok) return failed(access.code, requestId);
    // Пустой текст и текст, равный стандартному, — «стандартная инструкция»: своя запись не нужна.
    const standard = AI_AGENT_DEFAULTS[key].instructions.trim();
    const override = mode === "reset" || !text.trim() || text.trim() === standard ? null : text;
    return await applyUpdate(access, { key, expectedVersion: Number(expected), requestId, patch: { instructionsOverride: override } });
  } catch {
    return failed("unavailable", requestId);
  }
}

/* ----------------------------------------------------------- синхронизация */

export async function syncAiAgentAction(_previous: AiAgentsActionState, form: FormData): Promise<AiAgentsActionState> {
  let requestId: string | null = null;
  try {
    const fields = exactActionStringFields(form, ["request_id", "key", "rotate_token"]);
    const rawRequest = fields?.get("request_id") ?? "";
    const key = fields?.get("key");
    const rotate = fields?.get("rotate_token");
    if (!fields || !isAiAgentUuid(rawRequest)) return failed("invalid_input", null);
    requestId = rawRequest;
    if (!isAiAgentKey(key) || (rotate !== "0" && rotate !== "1")) return failed("invalid_input", requestId);
    const access = await authorize();
    if (!access.ok) return failed(access.code, requestId);
    if (access.actor.systemRole !== "admin") return failed("forbidden", requestId);
    const result = await syncAiAgent(access.ctx, { key, rotateToken: rotate === "1", requestId });
    refresh(key);
    if (!result.ok) return failed(result.code, requestId);
    const parts = [rotate === "1" ? "Токен доступа обновлён, агент синхронизирован с Claude." : "Агент синхронизирован с Claude."];
    return { status: "saved", code: null, message: parts[0], requestId, warnings: result.warnings };
  } catch {
    return failed("unavailable", requestId);
  }
}

/* --------------------------------------------------------------- поручения */

export async function startAiAgentRunAction(_previous: AiAgentsActionState, form: FormData): Promise<AiAgentsActionState> {
  let requestId: string | null = null;
  try {
    const fields = exactActionStringFields(form, ["request_id", "key", "text", "send_authority"]);
    const rawRequest = fields?.get("request_id") ?? "";
    const key = fields?.get("key");
    const authority = fields?.get("send_authority");
    if (!fields || !isAiAgentUuid(rawRequest)) return failed("invalid_input", null);
    requestId = rawRequest;
    const text = textOf(fields.get("text") ?? "").trim();
    if (!isAiAgentKey(key) || (authority !== "0" && authority !== "1") || !text
      || Array.from(text).length > AI_AGENT_LIMITS.commandTextMaxChars || CONTROL.test(text.replace(/[\n\t]/gu, ""))) {
      return failed("invalid_input", requestId);
    }
    const access = await authorize();
    if (!access.ok) return failed(access.code, requestId);
    const result = await startAiAgentRun(access.ctx, { key, text, sendAuthority: authority === "1", requestId });
    if (!result.ok) return startFailed(result, requestId);
    return { status: "saved", code: null, message: null, requestId, runId: result.runId };
  } catch {
    return failed("unavailable", requestId);
  }
}

export async function followUpAiAgentRunAction(_previous: AiAgentsActionState, form: FormData): Promise<AiAgentsActionState> {
  let requestId: string | null = null;
  try {
    const fields = exactActionStringFields(form, ["request_id", "run_id", "text"]);
    const rawRequest = fields?.get("request_id") ?? "";
    const runId = fields?.get("run_id") ?? "";
    if (!fields || !isAiAgentUuid(rawRequest)) return failed("invalid_input", null);
    requestId = rawRequest;
    const text = textOf(fields.get("text") ?? "").trim();
    if (!isAiAgentUuid(runId) || !text || Array.from(text).length > AI_AGENT_LIMITS.commandTextMaxChars
      || CONTROL.test(text.replace(/[\n\t]/gu, ""))) return failed("invalid_input", requestId);
    const access = await authorize();
    if (!access.ok) return failed(access.code, requestId);
    const result = await followUpAiAgentRun(access.ctx, { runId, text, requestId });
    if (!result.ok) return failed(result.code, requestId);
    return { status: "saved", code: null, message: null, requestId, runId };
  } catch {
    return failed("unavailable", requestId);
  }
}

export type AiAgentPollActionResult =
  | Readonly<{ ok: true; poll: AiAgentRunPoll }>
  | Readonly<{ ok: false; code: string }>;

/** Опрос хроники: раз в `pollIntervalMs`, пока вкладка видна. Чтение — в просмотре роли тоже можно. */
export async function pollAiAgentRunAction(runId: string, cursor: string | null): Promise<AiAgentPollActionResult> {
  try {
    if (!isAiAgentUuid(runId) || (cursor !== null && (typeof cursor !== "string" || cursor.length > 2000))) return { ok: false, code: "invalid_input" };
    const result = await resolvePlatformActor();
    if (result.status !== "authenticated" || !staffCanAccessRoute(result.actor, SECTION)) return { ok: false, code: "forbidden" };
    const ctx = { staffClient: await createSupabaseServerClient(), actor: result.actor };
    const polled = await pollAiAgentRun(ctx, { runId, cursor });
    return polled.ok ? { ok: true, poll: polled.poll } : { ok: false, code: polled.code };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export async function interruptAiAgentRunAction(runId: string): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; code: string; message: string }>> {
  try {
    if (!isAiAgentUuid(runId)) return { ok: false, code: "invalid_input", message: aiAgentsErrorCopy("invalid_input") };
    const access = await authorize();
    if (!access.ok) return { ok: false, code: access.code, message: aiAgentsErrorCopy(access.code) };
    const result = await interruptAiAgentRun(access.ctx, { runId });
    return result.ok ? { ok: true } : { ok: false, code: result.code, message: aiAgentsErrorCopy(result.code) };
  } catch {
    return { ok: false, code: "unavailable", message: aiAgentsErrorCopy("unavailable") };
  }
}

export type AiAgentTranscriptActionResult =
  | Readonly<{ ok: true; events: readonly AiAgentUiEvent[]; truncated: boolean }>
  | Readonly<{ ok: false; code: string }>;

/** Полная хроника запуска для вкладки «Запуски»: до 400 событий, чтение. */
export async function loadAiAgentRunTranscriptAction(runId: string): Promise<AiAgentTranscriptActionResult> {
  try {
    if (!isAiAgentUuid(runId)) return { ok: false, code: "invalid_input" };
    const result = await resolvePlatformActor();
    if (result.status !== "authenticated" || !staffCanAccessRoute(result.actor, SECTION)) return { ok: false, code: "forbidden" };
    const ctx = { staffClient: await createSupabaseServerClient(), actor: result.actor };
    const loaded = await loadAiAgentRunTranscript(ctx, { runId });
    return loaded.ok ? { ok: true, events: loaded.events, truncated: loaded.truncated } : { ok: false, code: loaded.code };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

/* --------------------------------------------------------------- черновики */

export async function decideAiAgentDraftAction(_previous: AiAgentsActionState, form: FormData): Promise<AiAgentsActionState> {
  let requestId: string | null = null;
  try {
    const fields = exactActionStringFields(form, ["request_id", "draft_id", "decision", "edited_text"]);
    const rawRequest = fields?.get("request_id") ?? "";
    const draftId = fields?.get("draft_id") ?? "";
    const decision = fields?.get("decision");
    if (!fields || !isAiAgentUuid(rawRequest)) return failed("invalid_input", null);
    requestId = rawRequest;
    const edited = textOf(fields.get("edited_text") ?? "");
    if (!isAiAgentUuid(draftId) || (decision !== "approve" && decision !== "discard")
      || Array.from(edited).length > AI_AGENT_LIMITS.portalTextMaxChars || CONTROL.test(edited.replace(/[\n\t]/gu, ""))) {
      return failed("invalid_input", requestId);
    }
    const access = await authorize();
    if (!access.ok) return failed(access.code, requestId);
    const result = await decideAiAgentDraft(access.ctx, {
      draftId, decision, editedText: decision === "approve" && edited.trim() ? edited : null, requestId,
    });
    refresh();
    if (!result.ok) return failed(result.code, requestId);
    const reason = result.failureCode ? (AI_AGENTS_DRAFT_FAILURE_WORDS[result.failureCode] ?? null) : null;
    const message = result.status === "sent" ? "Отправлено."
      : result.status === "discarded" ? "Черновик отклонён."
        : result.status === "pending" ? `Не отправлено${reason ? `: ${reason}` : ""}. Черновик остаётся в очереди.`
          : result.status === "failed" ? `Не отправлено${reason ? `: ${reason}` : ""}.`
            : "Принято в отправку.";
    return {
      status: result.status === "failed" ? "failed" : "saved", code: result.failureCode, message, requestId,
      draftStatus: result.status, failureCode: result.failureCode,
    };
  } catch {
    return failed("unavailable", requestId);
  }
}
