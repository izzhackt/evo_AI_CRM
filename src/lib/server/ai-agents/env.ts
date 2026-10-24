import "server-only";

import { AI_AGENT_LIMITS, AI_AGENTS_ENV, ANTHROPIC_API } from "../../ai-agents/contract.ts";

/*
 * Конфигурация рантайма ИИ-агентов из окружения (контракт §C.1). Значения —
 * только в env приложения: ключ Claude API не попадает ни в журнал, ни в ответы.
 */
export type Env = Readonly<Record<string, string | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Ключ Claude API или null (пусто/пробелы). */
export function readAnthropicApiKey(env: Env): string | null {
  const value = env[AI_AGENTS_ENV.anthropic]?.trim();
  return value ? value : null;
}

/** Базовый адрес Claude API: `EVO_ANTHROPIC_API_BASE_URL` (https, без пути) или адрес по умолчанию. */
export function readAnthropicBaseUrl(env: Env): string {
  const raw = env[AI_AGENTS_ENV.apiBaseUrl]?.trim();
  if (!raw) return ANTHROPIC_API.baseUrl;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || raw.includes("?") || raw.includes("#")) return ANTHROPIC_API.baseUrl;
    return `${url.origin}${url.pathname === "/" ? "" : url.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return ANTHROPIC_API.baseUrl;
  }
}

/** Потолок расхода на запуск по умолчанию, USD (0 — без потолка). */
export function readDefaultRunBudgetUsd(env: Env): number {
  const raw = env[AI_AGENTS_ENV.runBudgetUsd]?.trim();
  if (!raw) return AI_AGENT_LIMITS.defaultRunBudgetUsd;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : AI_AGENT_LIMITS.defaultRunBudgetUsd;
}

/** Организация CRM (`EVO_PLATFORM_ORGANIZATION_ID`) или null. */
export function readOrganizationId(env: Env): string | null {
  const value = env[AI_AGENTS_ENV.organizationId]?.trim().toLowerCase() ?? "";
  return UUID.test(value) && value !== "00000000-0000-0000-0000-000000000000" ? value : null;
}

/** Бюджет сессии Claude: целые центы строкой; 0 или меньше — без потолка (null). */
export function sessionBudget(usd: number): Readonly<{
  type: "limit";
  max_list_cost: Readonly<{ amount: string; currency: "USD" }>;
}> | null {
  if (!Number.isFinite(usd) || usd <= 0) return null;
  const cents = Math.max(1, Math.round(usd * 100));
  return { type: "limit", max_list_cost: { amount: String(cents), currency: "USD" } };
}

/** Хост адреса MCP (для `allowed_hosts` среды). */
export function mcpHost(mcpUrl: string): string {
  return new URL(mcpUrl).hostname;
}
