import "server-only";

import type { AiAgentKey, AiAgentModelId } from "../../ai-agents/contract.ts";

/*
 * ЗАГЛУШКА АРХИТЕКТОРА (контракт §C.3): файл принадлежит строителю C. Чистые
 * функции без сети. D сравнивает `computeAiAgentConfigHash(...)` с
 * `sync.configHash` ответа `ai_agents_get_v1`: разница — плашка «Изменения не
 * отправлены в Claude».
 */

export type AiAgentEffectiveConfigInput = Readonly<{
  key: AiAgentKey;
  title: string;
  model: AiAgentModelId;
  instructionsOverride: string | null;
  scheduleCron: string | null;
  scheduleTz: string;
  schedulePromptOverride: string | null;
  enabled: boolean;
  mcpUrl: string;
}>;

/** MCP-адрес из EVO_AI_AGENTS_MCP_URL или `AI_AGENTS_DEFAULT_MCP_URL`; нормализован так, как его сравнивает Claude (без завершающего «/»). */
export function resolveAiAgentsMcpUrl(_env: Readonly<Record<string, string | undefined>> = process.env): string {
  throw new Error("ai_agents_config_hash_not_implemented");
}

/** SHA-256 hex от канонического JSON «что отправляется в Claude»: имя, модель, system (преамбула + инструкция), mcp-адрес, версия набора инструментов, расписание и поручение расписания, включён ли агент. */
export function computeAiAgentConfigHash(_input: AiAgentEffectiveConfigInput): string {
  throw new Error("ai_agents_config_hash_not_implemented");
}
