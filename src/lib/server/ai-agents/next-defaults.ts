import "server-only";

import { AI_AGENT_DEFAULTS, AI_AGENT_PREAMBLE } from "@/content/ai-agents";
import type { NextAgentDefaults, NextAgentsHasDefault } from "@/components/v3/ai-agents-next/agent-defaults";
import { AI_AGENT_KEYS, type AiAgentKey } from "@/lib/ai-agents/contract";
import type { AiAgentTab } from "@/lib/v3/ai-agents-view";

/**
 * Что страница агента отдаёт «Новому виду» из каталога текстов: булево всегда, текст — только вкладке, которой он нужен
 * («Инструкция» — инструкцию и преамбулу, «Настройки» — поручение по расписанию). Модуль серверный (`server-only`): клиентский
 * модуль, который его импортирует, не соберётся, и каталог не попадёт в файлы для браузера.
 */
export function nextAgentDefaults(key: AiAgentKey, tab: AiAgentTab): NextAgentDefaults {
  const defaults = AI_AGENT_DEFAULTS[key];
  return {
    hasInstructions: defaults.hasInstructions,
    ...(tab === "instructions" ? { instructions: defaults.instructions, preamble: AI_AGENT_PREAMBLE } : {}),
    ...(tab === "settings" ? { schedulePrompt: defaults.schedulePrompt } : {}),
  };
}

/** Хаб: есть ли у каждого агента инструкция по умолчанию. */
export function nextAgentsHasDefault(): NextAgentsHasDefault {
  return Object.fromEntries(AI_AGENT_KEYS.map((key) => [key, AI_AGENT_DEFAULTS[key].hasInstructions])) as NextAgentsHasDefault;
}
