/**
 * Поручение агенту-куратору по кнопкам карточки дела («Предложить шаг», «Собрать передачу») — ядро без Next и без входа
 * сотрудника, чтобы его можно было проверять с подставными RPC и подставным Claude (`platform-agent-suggestions-actions.ts`
 * лишь проверяет сотрудника и зовёт его). Запуск — существующий путь «Поручить» (`startAiAgentRun`): право `ai.agent.use`,
 * «агент включён», «синхронизирован» и ключ Claude проверяют база и рантайм. Отказ — слово из `wording.ts`, не падение.
 */
import { randomUUID } from "node:crypto";

import { curatorAgentKey, handoffCommandText, nextStepCommandText } from "./agent-suggestions-contract.ts";
import { readAgentSuggestion } from "./platform-agent-suggestions.ts";
import { startAiAgentRun, type AiAgentsStaffContext } from "./server/ai-agents/runtime.ts";
import type { AiAgentsRuntimeDeps } from "./server/ai-agents/deps.ts";
import { agentRunStartOutcome } from "./v3/wording.ts";

export type AgentWorkKind = "next_step" | "handoff";

export type AgentWorkActionState = Readonly<{
  status: "idle" | "started" | "failed";
  /** Новый id запроса для следующего нажатия; прежний остаётся только при неизвестном исходе (запуск не задвоится). */
  requestId: string;
  message: string | null;
  runId: string | null;
}>;

export function agentWorkFailed(code: string, requestId: string | null): AgentWorkActionState {
  // Новый id после отказа: запуск под прежним id уже записан как неудавшийся; прежний — только при `unavailable`.
  const keep = code === "unavailable" && requestId !== null;
  return { status: "failed", requestId: keep ? requestId : randomUUID(), message: agentRunStartOutcome(code), runId: null };
}

export async function runAgentWork(
  ctx: AiAgentsStaffContext,
  input: Readonly<{ kind: AgentWorkKind; studentCaseId: string; direction: string | null; country: string | null; requestId: string }>,
  deps?: Partial<AiAgentsRuntimeDeps>,
): Promise<AgentWorkActionState> {
  // Дело читается сотрудником: без права на дело агента по нему не запускаем (отказ базы 42501).
  const visible = await readAgentSuggestion(ctx.actor, input.studentCaseId, ctx.staffClient as never);
  if (visible.kind === "forbidden") return agentWorkFailed("forbidden", input.requestId);
  if (visible.kind === "unavailable") return agentWorkFailed("unavailable", input.requestId);
  const key = curatorAgentKey({ direction: input.direction, country: input.country });
  if (!key) return agentWorkFailed("no_agent", input.requestId);
  const result = await startAiAgentRun(ctx, {
    key,
    text: input.kind === "next_step" ? nextStepCommandText(input.studentCaseId) : handoffCommandText(input.studentCaseId),
    sendAuthority: false,
    requestId: input.requestId,
  }, deps);
  if (!result.ok) {
    // Сессия могла начаться: повторять вслепую нельзя, id запроса — новый (прежний уже записан как неудавшийся).
    return agentWorkFailed(result.code, result.code === "unavailable" ? input.requestId : null);
  }
  return { status: "started", requestId: randomUUID(), message: null, runId: result.runId };
}
