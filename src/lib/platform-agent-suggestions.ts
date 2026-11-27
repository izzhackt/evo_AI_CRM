/**
 * Чтение и решение по предложениям агента, чтение страницы передачи (миграция 383). Только RPC сотрудника
 * (`authenticated`): права проверяет база — те же, что у записи шага дела; экранные подсказки лишь прячут кнопки.
 * Разбор ответов — `agent-suggestions-contract.ts`. Чтение отвечает «не прочитано» (а не «нет предложения»), пока база не
 * ответила, поэтому сбой не выглядит пустым местом.
 */
import type { ActivePlatformActor } from "./platform-auth";
import {
  agentSuggestionStatusFromRpcError,
  parseAgentCaseTarget,
  parseAgentSuggestion,
  parseAgentSuggestionDecided,
  parseHandoffNote,
  type AgentCaseTarget,
  type AgentSuggestion,
  type AgentSuggestionDecided,
  type AgentSuggestionDecision,
  type AgentSuggestionStatus,
  type HandoffNote,
} from "./agent-suggestions-contract.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type RpcClient = Readonly<{
  schema(name: "platform"): { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
}>;

async function defaultClient(): Promise<RpcClient> {
  if (typeof window !== "undefined") throw new Error("Agent suggestions are server-only.");
  const { createSupabaseServerClient } = await import("./supabase/server");
  return (await createSupabaseServerClient()) as unknown as RpcClient;
}

export type AgentSuggestionRead<T> =
  | Readonly<{ kind: "ready"; value: T | null }>
  | Readonly<{ kind: "forbidden" }>
  | Readonly<{ kind: "unavailable" }>;

async function readOne<T>(
  actor: Pick<ActivePlatformActor, "organizationId">,
  name: string,
  studentCaseId: string,
  parse: (data: unknown) => T | null,
  client?: RpcClient,
): Promise<AgentSuggestionRead<T>> {
  if (!UUID.test(studentCaseId) || !UUID.test(actor.organizationId)) return { kind: "unavailable" };
  try {
    const response = await (client ?? await defaultClient()).schema("platform").rpc(name, {
      p_organization_id: actor.organizationId,
      p_student_case_id: studentCaseId,
    });
    const error = response.error as { code?: unknown } | null;
    if (error?.code === "42501") return { kind: "forbidden" };
    if (error) return { kind: "unavailable" };
    if (response.data === null || response.data === undefined) return { kind: "ready", value: null };
    const value = parse(response.data);
    // Ответ непонятной формы — не «нет предложения»: экран скажет «не прочитано», а не промолчит.
    return value === null ? { kind: "unavailable" } : { kind: "ready", value };
  } catch {
    return { kind: "unavailable" };
  }
}

/** Дело для запуска агента, прочитанное сервером с правом записи шага — `agent_case_target_v1`. */
export function readAgentCaseTarget(
  actor: Pick<ActivePlatformActor, "organizationId">,
  studentCaseId: string,
  client?: RpcClient,
): Promise<AgentSuggestionRead<AgentCaseTarget>> {
  return readOne(actor, "agent_case_target_v1", studentCaseId, (data) => parseAgentCaseTarget(data, studentCaseId), client);
}

/** Текущее предложение шага по делу (pending и не просрочено) — `agent_suggestion_read_v1`. */
export function readAgentSuggestion(
  actor: Pick<ActivePlatformActor, "organizationId">,
  studentCaseId: string,
  client?: RpcClient,
): Promise<AgentSuggestionRead<AgentSuggestion>> {
  return readOne(actor, "agent_suggestion_read_v1", studentCaseId, (data) => parseAgentSuggestion(data, studentCaseId), client);
}

/** Последняя заметка дела «Передача дела» — `case_handoff_note_v1`. */
export function readCaseHandoffNote(
  actor: Pick<ActivePlatformActor, "organizationId">,
  studentCaseId: string,
  client?: RpcClient,
): Promise<AgentSuggestionRead<HandoffNote>> {
  return readOne(actor, "case_handoff_note_v1", studentCaseId, parseHandoffNote, client);
}

export class AgentSuggestionError extends Error {
  readonly status: Exclude<AgentSuggestionStatus, "accepted" | "dismissed" | "preview">;

  constructor(status: Exclude<AgentSuggestionStatus, "accepted" | "dismissed" | "preview">) {
    super("Agent suggestion decision failed.");
    this.name = "AgentSuggestionError";
    this.status = status;
  }
}

export type DecideAgentSuggestionCommand = Readonly<{
  suggestionId: string;
  decision: AgentSuggestionDecision;
  /** Версия дела (`admissions_version`) из той же строки, что видит сотрудник; нужна только для «Принять». */
  expectedVersion: string | null;
  dismissReason: string | null;
  requestId: string;
}>;

/**
 * «Принять» / «Не то» — `agent_suggestion_decide_v1`. «Принять» пишет шаг существующим `set_case_next_action_v1` от
 * имени сотрудника в той же транзакции: устаревшая версия — `stale`, предложение остаётся. Неизвестный исход
 * (`unavailable`) повторяется тем же request id: база отдаст прежнюю квитанцию, а не запишет шаг второй раз.
 */
export async function decideAgentSuggestion(
  actor: Pick<ActivePlatformActor, "organizationId">,
  command: DecideAgentSuggestionCommand,
  client?: RpcClient,
): Promise<AgentSuggestionDecided> {
  if (!UUID.test(actor.organizationId) || !UUID.test(command.suggestionId) || !UUID.test(command.requestId)
    || (command.decision === "accept" && !(command.expectedVersion !== null && /^\d{1,19}$/u.test(command.expectedVersion)))) {
    throw new AgentSuggestionError("invalid");
  }
  let response: { data: unknown; error: unknown };
  try {
    response = await (client ?? await defaultClient()).schema("platform").rpc("agent_suggestion_decide_v1", {
      p_organization_id: actor.organizationId,
      p_suggestion_id: command.suggestionId,
      p_decision: command.decision,
      p_expected_version: command.decision === "accept" ? command.expectedVersion : null,
      p_dismiss_reason: command.decision === "dismiss" ? command.dismissReason : null,
      p_request_id: command.requestId,
    });
  } catch {
    throw new AgentSuggestionError("unavailable");
  }
  if (response.error) throw new AgentSuggestionError(agentSuggestionStatusFromRpcError(response.error));
  // Ответ непонятной формы может идти после записанного решения: исход неизвестен, а не «не вышло».
  const decided = parseAgentSuggestionDecided(response.data);
  if (!decided) throw new AgentSuggestionError("unavailable");
  return decided;
}
