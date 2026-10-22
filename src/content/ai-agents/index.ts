import { AI_AGENT_KEYS, type AiAgentKey } from "../../lib/ai-agents/contract.ts";
import { AI_AGENT_PREAMBLE_TEXT, AI_AGENT_PROMPT_SOURCES } from "./prompts.generated.ts";

/*
 * Тексты агентов «ИИ-агенты» (контракт §E). Источник правды — src/content/ai-agents/*.md;
 * prompts.generated.ts собирает scripts/build-ai-agent-prompts.mjs (проверка: --check).
 * Модуль чистый: без server-only и fs — его читают и сервер (синхронизация с Claude),
 * и страницы (редактор инструкции).
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
export const AI_AGENT_PREAMBLE: string = AI_AGENT_PREAMBLE_TEXT;

export const AI_AGENT_DEFAULTS: Readonly<Record<AiAgentKey, AiAgentDefault>> = Object.freeze(
  Object.fromEntries(
    AI_AGENT_KEYS.map((key) => {
      const source = AI_AGENT_PROMPT_SOURCES[key];
      const instructions = source.instructions;
      return [
        key,
        Object.freeze({
          key,
          instructions,
          schedulePrompt: source.schedulePrompt,
          hasInstructions: instructions.trim() !== "",
        }),
      ];
    }),
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
