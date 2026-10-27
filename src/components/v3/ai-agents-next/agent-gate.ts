import type { AiAgentDetail } from "@/lib/ai-agents/contract";
import { aiAgentIsRunnable, aiAgentNextStep, aiAgentSyncProblemText, type AiAgentSetupStep } from "@/lib/v3/ai-agents-view";

/**
 * Что мешает запуску агента и что с этим делать. Те же условия и те же слова, что в `AgentBody` прежнего вида
 * (ничего не добавлено и не убрано): «Новый вид» меняет только вёрстку. Чистая функция, без React.
 */
export type AgentGate = Readonly<{
  hasInstructions: boolean;
  synced: boolean;
  syncProblem: string | null;
  canRun: boolean;
  step: AiAgentSetupStep | null;
  /** Почему писать агенту нельзя; null — можно. */
  blockedNote: string | null;
}>;

export function agentGate(input: Readonly<{
  detail: Pick<AiAgentDetail, "key" | "enabled" | "hasInstructionsOverride" | "sync">;
  canEdit: boolean;
  preview: boolean;
  runtimeConfigured: boolean;
  /** Есть ли у агента инструкция по умолчанию: каталог текстов на сервере (`NextAgentDefaults`), здесь только ответ. */
  defaultHasInstructions: boolean;
}>): AgentGate {
  const { detail, canEdit, preview, runtimeConfigured, defaultHasInstructions } = input;
  const hasInstructions = detail.hasInstructionsOverride || defaultHasInstructions;
  const synced = aiAgentIsRunnable(detail.sync);
  const syncProblem = detail.enabled ? aiAgentSyncProblemText(detail.sync) : null;
  // Директору поручает только системный администратор (его инструменты читают данные организации целиком).
  const directorLocked = detail.key === "director" && !canEdit;
  const canRun = !preview && !directorLocked && runtimeConfigured && hasInstructions && detail.enabled && synced;
  const step = aiAgentNextStep({ canEdit, runtimeConfigured, preview, hasInstructions, enabled: detail.enabled, synced });
  const blockedNote = preview ? "В просмотре роли писать агенту нельзя."
    : directorLocked ? "Директору поручает только системный администратор: он читает данные организации целиком."
      : !runtimeConfigured ? "Ключ Claude API не задан в CRM — его добавляет администратор."
        : !hasInstructions ? (canEdit ? "У агента нет правил. Без них его не включить." : "У агента нет правил — их пишет системный администратор.")
          : !detail.enabled ? (canEdit ? "Агент выключен." : "Агент выключен — включает системный администратор.")
            : !synced ? (canEdit ? "Агент ещё не синхронизирован с Claude." : "Агент ещё не синхронизирован с Claude — синхронизирует системный администратор.")
              : null;
  return { hasInstructions, synced, syncProblem, canRun, step, blockedNote };
}
