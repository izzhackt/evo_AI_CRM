import "server-only";

import type { ActivePlatformActor } from "../platform-auth.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";
import {
  AI_AGENT_STAFF_RPC,
  type AiAgentDetail,
  type AiAgentDigestsListResult,
  type AiAgentDraftStatus,
  type AiAgentDraftsListResult,
  type AiAgentKey,
  type AiAgentRunGetResult,
  type AiAgentRunsListResult,
  type AiAgentsListResult,
} from "../ai-agents/contract.ts";
import {
  mapAiAgentsDbError,
  parseAiAgentDetail,
  parseAiAgentDigests,
  parseAiAgentDrafts,
  parseAiAgentRun,
  parseAiAgentRuns,
  parseAiAgentsList,
} from "./ai-agents-view.ts";

/**
 * Раздел «ИИ-агенты» (контракт §D.2): чтения прямо в RPC сотрудника
 * `platform.ai_agents_*_v1` от его имени (клиент вошедшего сотрудника, не
 * service). Права, видимость и счёт решает база; форма ответа проверяется
 * строго, кривой ответ — «данные недоступны», а не падение страницы.
 *
 *  - `not_ready` — функции нет в базе (миграция 317 ещё не применена): страница
 *    показывает «Раздел готовится», а не ошибку;
 *  - `denied` — база отказала сотруднику (42501);
 *  - `missing` — нет такого агента или запуска (P0002).
 */
export type AiAgentsRead<T> =
  | Readonly<{ status: "available"; data: T }>
  | Readonly<{ status: "not_ready" | "denied" | "missing" | "unavailable" }>;

async function read<T>(name: string, args: Record<string, unknown>, parse: (value: unknown) => T): Promise<AiAgentsRead<T>> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc(name, args);
    if (error) {
      const code = mapAiAgentsDbError(error as { code?: string; message?: string });
      return code === "not_ready" ? { status: "not_ready" }
        : code === "forbidden" ? { status: "denied" }
          : code === "not_found" ? { status: "missing" }
            : { status: "unavailable" };
    }
    return { status: "available", data: parse(data) };
  } catch {
    return { status: "unavailable" };
  }
}

export function readAiAgents(actor: ActivePlatformActor): Promise<AiAgentsRead<AiAgentsListResult>> {
  return read(AI_AGENT_STAFF_RPC.list, { p_organization_id: actor.organizationId }, parseAiAgentsList);
}

export function readAiAgent(actor: ActivePlatformActor, key: AiAgentKey): Promise<AiAgentsRead<AiAgentDetail>> {
  return read(AI_AGENT_STAFF_RPC.get, { p_organization_id: actor.organizationId, p_key: key }, parseAiAgentDetail);
}

export function readAiAgentRuns(
  actor: ActivePlatformActor,
  key: AiAgentKey,
  options: Readonly<{ limit: number; before?: string | null }>,
): Promise<AiAgentsRead<AiAgentRunsListResult>> {
  return read(AI_AGENT_STAFF_RPC.runsList, {
    p_organization_id: actor.organizationId, p_key: key, p_limit: options.limit, p_before: options.before ?? null,
  }, parseAiAgentRuns);
}

export function readAiAgentRun(actor: ActivePlatformActor, runId: string): Promise<AiAgentsRead<AiAgentRunGetResult>> {
  return read(AI_AGENT_STAFF_RPC.runGet, { p_organization_id: actor.organizationId, p_run_id: runId }, parseAiAgentRun);
}

export function readAiAgentDrafts(
  actor: ActivePlatformActor,
  options: Readonly<{ key: AiAgentKey | null; status: AiAgentDraftStatus | null; limit: number }>,
): Promise<AiAgentsRead<AiAgentDraftsListResult>> {
  return read(AI_AGENT_STAFF_RPC.draftsList, {
    p_organization_id: actor.organizationId, p_key: options.key, p_status: options.status, p_limit: options.limit,
  }, parseAiAgentDrafts);
}

export function readAiAgentDigests(
  actor: ActivePlatformActor,
  options: Readonly<{ key: AiAgentKey | null; limit: number }>,
): Promise<AiAgentsRead<AiAgentDigestsListResult>> {
  return read(AI_AGENT_STAFF_RPC.digestsList, {
    p_organization_id: actor.organizationId, p_key: options.key, p_limit: options.limit,
  }, parseAiAgentDigests);
}
