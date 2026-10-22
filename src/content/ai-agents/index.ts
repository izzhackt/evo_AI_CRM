import { AI_AGENT_KEYS, type AiAgentKey } from "../../lib/ai-agents/contract.ts";

/*
 * ЗАГЛУШКА АРХИТЕКТОРА (контракт §E): файл принадлежит строителю E («контент»).
 * Он заменяет пустые строки текстами из src/content/ai-agents/*.md (через
 * генератор и сгенерированный модуль) и сохраняет экспорты как есть. Читают
 * его C (синхронизация), D (редактор инструкции).
 */

export type AiAgentDefault = Readonly<{
  key: AiAgentKey;
  /** Инструкция по умолчанию (без общей преамбулы). Пусто — инструкции ещё нет. */
  instructions: string;
  /** Текст поручения для запуска по расписанию и кнопки «Запустить по расписанию сейчас»; null — расписания нет. */
  schedulePrompt: string | null;
  hasInstructions: boolean;
}>;

/** Общая преамбула EVO: добавляется ко всем агентам перед их инструкцией. */
export const AI_AGENT_PREAMBLE = "";

export const AI_AGENT_DEFAULTS: Readonly<Record<AiAgentKey, AiAgentDefault>> = Object.freeze(
  Object.fromEntries(
    AI_AGENT_KEYS.map((key) => [key, { key, instructions: "", schedulePrompt: null, hasInstructions: false }]),
  ) as Record<AiAgentKey, AiAgentDefault>,
);

/** Инструкция, действующая сейчас: своя (если задана и не пуста) или из репозитория. */
export function effectiveAiAgentInstructions(key: AiAgentKey, instructionsOverride: string | null): string {
  const own = instructionsOverride?.trim();
  return own ? own : AI_AGENT_DEFAULTS[key].instructions;
}

/** Полный system-промпт агента Claude: преамбула + разделитель + действующая инструкция. */
export function buildAiAgentSystemPrompt(key: AiAgentKey, instructionsOverride: string | null): string {
  const instructions = effectiveAiAgentInstructions(key, instructionsOverride);
  return AI_AGENT_PREAMBLE ? `${AI_AGENT_PREAMBLE}\n\n---\n\n${instructions}` : instructions;
}
