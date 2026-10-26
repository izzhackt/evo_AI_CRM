import "server-only";

import type {
  AiAgentDraftDecisionResult,
  AiAgentKey,
  AiAgentRunErrorCode,
  AiAgentRunPoll,
  AiAgentStartRunResult,
  AiAgentSyncResult,
  AiAgentUiEvent,
} from "../../ai-agents/contract.ts";
import { readWhatsappDailyBudgetCents } from "../../ai-agents/daily-cap.ts";
import { type AiAgentsRuntimeDeps, type AiAgentsStaffContext } from "./deps.ts";
import { decideAiAgentDraftImpl, type DecideDraftExtras } from "./drafts.ts";
import { readAnthropicApiKey } from "./env.ts";
import {
  followUpAiAgentRunImpl,
  interruptAiAgentRunImpl,
  loadAiAgentRunTranscriptImpl,
  pollAiAgentRunImpl,
  reconcileAiAgentRunsImpl,
  startAiAgentRunImpl,
} from "./runs.ts";
import { syncAiAgentImpl } from "./sync.ts";

/*
 * Публичные функции рантайма Managed Agents (контракт §C.2). Подписи заморожены:
 * D (интерфейс) вызывает только их и никогда не открывает service-клиент. Каждая
 * принимает необязательный последний аргумент с зависимостями — его используют
 * тесты; интерфейс его не передаёт. Правила: просмотр роли администратором →
 * `preview_read_only`; право, включён ли агент и синхронизирован ли — решает база.
 */

/** Контекст сотрудника: его серверный клиент Supabase и проверенный актор. Каждая функция начинает с RPC сотрудника. */
export type { AiAgentsStaffContext } from "./deps.ts";

export type AiAgentsRuntimeAvailability = Readonly<{ configured: boolean; reason: "api_key_missing" | null }>;

/** Без обращения к сети: задан ли EVO_ANTHROPIC_API_KEY. UI показывает по нему «ключ Claude API не задан». */
export function aiAgentsRuntimeAvailability(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AiAgentsRuntimeAvailability {
  return readAnthropicApiKey(env) !== null
    ? { configured: true, reason: null }
    : { configured: false, reason: "api_key_missing" };
}

/** Дневной лимит запусков агента по входящему WhatsApp, центы: `EVO_AI_AGENT_WHATSAPP_DAILY_BUDGET_USD` или $10. Только для строки в «Настройках». */
export function aiAgentsWhatsappDailyCapCents(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  return readWhatsappDailyBudgetCents(env);
}

/** Создаёт или обновляет агента, среду, хранилище, расписание в Claude; `rotateToken` выпускает новый токен MCP. Только системный администратор. */
export async function syncAiAgent(
  ctx: AiAgentsStaffContext,
  input: Readonly<{ key: AiAgentKey; rotateToken?: boolean; requestId: string }>,
  deps?: Partial<AiAgentsRuntimeDeps>,
): Promise<AiAgentSyncResult> {
  return syncAiAgentImpl(ctx, input, deps);
}

/** Новый разговор с агентом: создаёт сессию Claude и первое сообщение. */
export async function startAiAgentRun(
  ctx: AiAgentsStaffContext,
  input: Readonly<{ key: AiAgentKey; text: string; sendAuthority: boolean; requestId: string }>,
  deps?: Partial<AiAgentsRuntimeDeps>,
): Promise<AiAgentStartRunResult> {
  return startAiAgentRunImpl(ctx, input, deps);
}

/** Следующее сообщение в уже созданной сессии (разговор «Поручить»). */
export async function followUpAiAgentRun(
  ctx: AiAgentsStaffContext,
  input: Readonly<{ runId: string; text: string; requestId: string }>,
  deps?: Partial<AiAgentsRuntimeDeps>,
): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; code: AiAgentRunErrorCode; message: string }>> {
  return followUpAiAgentRunImpl(ctx, input, deps);
}

/** Опрос: новые события сессии с курсора, обновление запуска (статус, токены, расход). */
export async function pollAiAgentRun(
  ctx: AiAgentsStaffContext,
  input: Readonly<{ runId: string; cursor: string | null }>,
  deps?: Partial<AiAgentsRuntimeDeps>,
): Promise<Readonly<{ ok: true; poll: AiAgentRunPoll }> | Readonly<{ ok: false; code: "not_found" | "forbidden" | "unavailable" }>> {
  return pollAiAgentRunImpl(ctx, input, deps);
}

/** Остановить работающую сессию (`user.interrupt`). */
export async function interruptAiAgentRun(
  ctx: AiAgentsStaffContext,
  input: Readonly<{ runId: string }>,
  deps?: Partial<AiAgentsRuntimeDeps>,
): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; code: AiAgentRunErrorCode | "not_found"; message: string }>> {
  return interruptAiAgentRunImpl(ctx, input, deps);
}

/** Полная хроника запуска для вкладки «Запуски» (до 400 событий). */
export async function loadAiAgentRunTranscript(
  ctx: AiAgentsStaffContext,
  input: Readonly<{ runId: string }>,
  deps?: Partial<AiAgentsRuntimeDeps>,
): Promise<Readonly<{ ok: true; events: readonly AiAgentUiEvent[]; truncated: boolean }> | Readonly<{ ok: false; code: "not_found" | "forbidden" | "unavailable" }>> {
  return loadAiAgentRunTranscriptImpl(ctx, input, deps);
}

/** Ленивая сверка: закрывает зависшие запуски, подтягивает запуски по расписанию из deployment_runs. Не бросает. */
export async function reconcileAiAgentRuns(
  ctx: AiAgentsStaffContext,
  input: Readonly<{ key?: AiAgentKey }>,
  deps?: Partial<AiAgentsRuntimeDeps>,
): Promise<void> {
  return reconcileAiAgentRunsImpl(ctx, input, deps);
}

/** «Одобрить» (с правкой текста) или «Отклонить» черновик; одобренный WhatsApp/кабинет отправляется сразу. */
export async function decideAiAgentDraft(
  ctx: AiAgentsStaffContext,
  input: Readonly<{ draftId: string; decision: "approve" | "discard"; editedText?: string | null; requestId: string }>,
  deps?: Partial<AiAgentsRuntimeDeps>,
  extras?: DecideDraftExtras,
): Promise<AiAgentDraftDecisionResult> {
  return decideAiAgentDraftImpl(ctx, input, deps, extras);
}
