import "server-only";

import {
  COMPANY_FACT_LIMITS,
  COMPANY_FACT_RPC,
  mapCompanyFactError,
  parseCompanyFactSaved,
  parseCompanyFacts,
  type CompanyFactFailure,
  type CompanyFactSaveStatus,
  type CompanyFactsRead,
} from "../ai-agents/company-facts.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";

/**
 * «Настройки → Факты» («мозг компании», миграция 381): чтение и запись фактов прямо в RPC сотрудника
 * `platform.ai_company_facts_*_v1` от его имени (клиент вошедшего сотрудника, не service). Права (`ai.agent.use` на чтение,
 * `ai.agent.manage` на запись) решает база; здесь дешёвый отказ до обращения к ней и строгий разбор ответа: кривая форма —
 * «не удалось прочитать», а не падение страницы. Функции нет в базе (миграция ещё не применена) — `not_ready`: страница
 * говорит «Раздел готовится».
 */

/** Все факты организации сразу (действующие, черновики, снятые): фильтры и поиск — на странице. */
export async function readCompanyFacts(actor: ActivePlatformActor): Promise<CompanyFactsRead> {
  try {
    const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc(COMPANY_FACT_RPC.list, {
      p_organization_id: actor.organizationId, p_topic_prefix: null, p_status: "all", p_audience: null, p_limit: COMPANY_FACT_LIMITS.listMax,
    });
    if (error) {
      const failure = mapCompanyFactError(error as { code?: string; message?: string });
      return failure === "forbidden" ? { status: "denied" } : failure === "not_ready" ? { status: "not_ready" } : { status: "unavailable" };
    }
    const parsed = parseCompanyFacts(data);
    return parsed ? { status: "available", data: parsed } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

export type CompanyFactSaveInput = Readonly<{
  /** `null` — добавить факт. */
  factId: string | null;
  /** Патч базы (camelCase, см. `ai_company_facts_save_v1`); правка текста идёт только с `markVerified: true`. */
  patch: Readonly<Record<string, unknown>>;
  requestId: string;
}>;

export type CompanyFactCommandResult =
  | Readonly<{ status: CompanyFactSaveStatus }>
  | Readonly<{ status: CompanyFactFailure }>;

export async function saveCompanyFact(actor: ActivePlatformActor, input: CompanyFactSaveInput): Promise<CompanyFactCommandResult> {
  try {
    const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc(COMPANY_FACT_RPC.save, {
      p_organization_id: actor.organizationId, p_fact_id: input.factId, p_patch: input.patch, p_request_id: input.requestId,
    });
    if (error) return { status: mapCompanyFactError(error as { code?: string; message?: string }) };
    const parsed = parseCompanyFactSaved(data);
    return parsed && parsed.status !== "retired" ? { status: parsed.status } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

export async function retireCompanyFact(actor: ActivePlatformActor, factId: string, requestId: string): Promise<CompanyFactCommandResult> {
  try {
    const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc(COMPANY_FACT_RPC.retire, {
      p_organization_id: actor.organizationId, p_fact_id: factId, p_request_id: requestId,
    });
    if (error) return { status: mapCompanyFactError(error as { code?: string; message?: string }) };
    const parsed = parseCompanyFactSaved(data);
    return parsed?.status === "retired" ? { status: "retired" } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
