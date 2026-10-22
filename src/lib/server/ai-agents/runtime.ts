import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AiAgentDraftDecisionResult,
  AiAgentKey,
  AiAgentRunErrorCode,
  AiAgentRunPoll,
  AiAgentStartRunResult,
  AiAgentSyncResult,
  AiAgentUiEvent,
} from "../../ai-agents/contract.ts";
import type { ActivePlatformActor } from "../../platform-auth.ts";

/*
 * ЗАГЛУШКА АРХИТЕКТОРА: подписи — замороженный контракт между строителями
 * (docs/design/ai-agents/contract.md §C.2). Файл принадлежит строителю C
 * («рантайм Managed Agents»): он заменяет тела, подписи не меняет. Строитель D
 * (интерфейс) вызывает только эти функции и никогда не открывает service-клиент.
 */

/** Контекст сотрудника: его серверный клиент Supabase и проверенный актор. Каждая функция ниже начинает с RPC сотрудника (`ai_agents_run_authorize_v1` / `ai_agents_draft_decide_v1`). */
export type AiAgentsStaffContext = Readonly<{ staffClient: SupabaseClient; actor: ActivePlatformActor }>;

export type AiAgentsRuntimeAvailability = Readonly<{ configured: boolean; reason: "api_key_missing" | null }>;

const NOT_IMPLEMENTED = "ai_agents_runtime_not_implemented";

/** Без обращения к сети: задан ли EVO_ANTHROPIC_API_KEY. UI показывает по нему «ключ Claude API не задан». */
export function aiAgentsRuntimeAvailability(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AiAgentsRuntimeAvailability {
  const key = env.EVO_ANTHROPIC_API_KEY;
  return key !== undefined && key.trim() !== "" ? { configured: true, reason: null } : { configured: false, reason: "api_key_missing" };
}

/** Создаёт или обновляет агента, среду, хранилище, расписание в Claude; `rotateToken` выпускает новый токен MCP. Только системный администратор. */
export async function syncAiAgent(
  _ctx: AiAgentsStaffContext,
  _input: Readonly<{ key: AiAgentKey; rotateToken?: boolean; requestId: string }>,
): Promise<AiAgentSyncResult> {
  throw new Error(NOT_IMPLEMENTED);
}

/** Новый разговор с агентом: создаёт сессию Claude и первое сообщение. */
export async function startAiAgentRun(
  _ctx: AiAgentsStaffContext,
  _input: Readonly<{ key: AiAgentKey; text: string; sendAuthority: boolean; requestId: string }>,
): Promise<AiAgentStartRunResult> {
  throw new Error(NOT_IMPLEMENTED);
}

/** Следующее сообщение в уже созданной сессии (разговор «Поручить»). */
export async function followUpAiAgentRun(
  _ctx: AiAgentsStaffContext,
  _input: Readonly<{ runId: string; text: string; requestId: string }>,
): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; code: AiAgentRunErrorCode; message: string }>> {
  throw new Error(NOT_IMPLEMENTED);
}

/** Опрос: новые события сессии с курсора, обновление запуска (статус, токены, расход). */
export async function pollAiAgentRun(
  _ctx: AiAgentsStaffContext,
  _input: Readonly<{ runId: string; cursor: string | null }>,
): Promise<Readonly<{ ok: true; poll: AiAgentRunPoll }> | Readonly<{ ok: false; code: "not_found" | "forbidden" | "unavailable" }>> {
  throw new Error(NOT_IMPLEMENTED);
}

/** Остановить работающую сессию (`user.interrupt`). */
export async function interruptAiAgentRun(
  _ctx: AiAgentsStaffContext,
  _input: Readonly<{ runId: string }>,
): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; code: AiAgentRunErrorCode | "not_found"; message: string }>> {
  throw new Error(NOT_IMPLEMENTED);
}

/** Полная хроника запуска для вкладки «Запуски» (до 400 событий). */
export async function loadAiAgentRunTranscript(
  _ctx: AiAgentsStaffContext,
  _input: Readonly<{ runId: string }>,
): Promise<Readonly<{ ok: true; events: readonly AiAgentUiEvent[]; truncated: boolean }> | Readonly<{ ok: false; code: "not_found" | "forbidden" | "unavailable" }>> {
  throw new Error(NOT_IMPLEMENTED);
}

/** Ленивая сверка: закрывает зависшие запуски, подтягивает запуски по расписанию из deployment_runs. Не бросает. */
export async function reconcileAiAgentRuns(
  _ctx: AiAgentsStaffContext,
  _input: Readonly<{ key?: AiAgentKey }>,
): Promise<void> {
  throw new Error(NOT_IMPLEMENTED);
}

/** «Одобрить» (с правкой текста) или «Отклонить» черновик; одобренный WhatsApp/кабинет отправляется сразу. */
export async function decideAiAgentDraft(
  _ctx: AiAgentsStaffContext,
  _input: Readonly<{ draftId: string; decision: "approve" | "discard"; editedText?: string | null; requestId: string }>,
): Promise<AiAgentDraftDecisionResult> {
  throw new Error(NOT_IMPLEMENTED);
}
