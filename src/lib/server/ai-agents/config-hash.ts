import "server-only";

import { createHash } from "node:crypto";

import {
  AI_AGENT_DEFAULTS,
  buildAiAgentSystemPrompt,
} from "../../../content/ai-agents/index.ts";
import {
  AI_AGENT_DISABLED_BUILTIN_TOOLS,
  AI_AGENTS_DEFAULT_MCP_URL,
  AI_AGENTS_ENV,
  ANTHROPIC_API,
  type AiAgentKey,
  type AiAgentModelId,
} from "../../ai-agents/contract.ts";

/*
 * Контракт §C.3: чистые функции без сети. D сравнивает
 * `computeAiAgentConfigHash(...)` с `sync.configHash` ответа `ai_agents_get_v1`:
 * разница — плашка «Изменения не отправлены в Claude».
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
export function resolveAiAgentsMcpUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const raw = env[AI_AGENTS_ENV.mcpUrl]?.trim() || AI_AGENTS_DEFAULT_MCP_URL;
  if (raw.includes("?") || raw.includes("#")) throw new Error("ai_agents_mcp_url_invalid");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("ai_agents_mcp_url_invalid");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error("ai_agents_mcp_url_invalid");
  }
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/u, "");
  return `${url.origin}${path}`;
}

/** Поручение запуска по расписанию: своё (если задано) или из репозитория; null — поручения нет. */
export function effectiveAiAgentSchedulePrompt(key: AiAgentKey, schedulePromptOverride: string | null): string | null {
  const own = schedulePromptOverride?.trim();
  if (own) return own;
  const fallback = AI_AGENT_DEFAULTS[key].schedulePrompt?.trim();
  return fallback ? fallback : null;
}

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((name) => `${JSON.stringify(name)}:${canonicalJson(record[name])}`).join(",")}}`;
}

/** SHA-256 hex от канонического JSON «что отправляется в Claude»: имя, модель, system (преамбула + инструкция), mcp-адрес, версия набора инструментов и выключенные встроенные инструменты (web_search, web_fetch), расписание и поручение расписания, включён ли агент. */
export function computeAiAgentConfigHash(input: AiAgentEffectiveConfigInput): string {
  const cron = input.scheduleCron?.trim() || null;
  const schedule = input.enabled && cron
    ? { cron, tz: input.scheduleTz, prompt: effectiveAiAgentSchedulePrompt(input.key, input.schedulePromptOverride) }
    : null;
  const canonical = canonicalJson({
    key: input.key,
    title: input.title,
    model: input.model,
    system: buildAiAgentSystemPrompt(input.key, input.instructionsOverride),
    mcpUrl: input.mcpUrl,
    toolsetVersion: ANTHROPIC_API.agentToolset,
    // Выключенные инструменты входят в хеш: уже синхронизированные агенты покажут «нужна синхронизация».
    disabledBuiltinTools: [...AI_AGENT_DISABLED_BUILTIN_TOOLS],
    schedule,
    enabled: input.enabled,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
