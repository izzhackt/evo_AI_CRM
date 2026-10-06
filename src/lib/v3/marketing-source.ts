import "server-only";

import { staffCanAccessRoute } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import {
  parseMarketingLeads, parseMarketingOverview, parseSpendCancelled, parseSpendSaved,
  type MarketingCursor, type MarketingLeadFilters, type MarketingLeadsRead, type MarketingOverviewRead,
  type SpendWriteResult,
} from "../marketing-contract.ts";
import { parseSalesUuid } from "../platform-sales-register-contract.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";

export const MARKETING_PAGE_SIZE = 50;

export class MarketingForbiddenError extends Error {
  constructor() { super("marketing_forbidden"); }
}

/**
 * «Маркетинг» — только настоящий администратор, не просмотр роли (как «База знаний»,
 * `requireKnowledgeAdmin`): каждый RPC раздела ещё раз проверяет `platform_role = 'admin'` в базе,
 * но режим просмотра для базы неотличим от admin, поэтому его отказ — условие маршрута и действий.
 */
export function canUseMarketing(actor: ActivePlatformActor): boolean {
  return staffCanAccessRoute(actor, "/v3/marketing");
}
export function requireMarketingAdmin(actor: ActivePlatformActor): void {
  if (!canUseMarketing(actor)) throw new MarketingForbiddenError();
}

type Period = Readonly<{ from: string; to: string }>;
type RpcError = Readonly<{ code?: string; message?: string }>;

const denied = (error: RpcError) => error.code === "42501";

/**
 * Обзор периода (`marketing_overview_v1`, 265): когорта заявок и продажи периода — два блока, ручной
 * расход. Сбой чтения — `unavailable`, отказ роли — `denied`; нуля наугад нет.
 */
export async function readMarketingOverview(actor: ActivePlatformActor, period: Period): Promise<MarketingOverviewRead> {
  if (!canUseMarketing(actor)) return { status: "denied" };
  try {
    const { data, error } = await (await createSupabaseServerClient())
      .schema("platform").rpc("marketing_overview_v1", { p_from: period.from, p_to: period.to });
    if (error) return denied(error) ? { status: "denied" } : { status: "unavailable" };
    const overview = parseMarketingOverview(data, { organizationId: actor.organizationId, from: period.from, to: period.to });
    return overview ? { status: "available", overview } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/** Одна страница списка «Заявки» (`marketing_leads_v1`, 265): ≤ 50 строк, курсор `(created_at, id)`. */
export async function readMarketingLeads(
  actor: ActivePlatformActor,
  period: Period,
  filters: MarketingLeadFilters,
  cursor: MarketingCursor | null,
): Promise<MarketingLeadsRead> {
  if (!canUseMarketing(actor)) return { status: "denied" };
  try {
    const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc("marketing_leads_v1", {
      p_from: period.from, p_to: period.to, p_channel: filters.channel, p_campaign: filters.campaign, p_stage: filters.stage,
      p_has_contract: filters.hasContract, p_unknown_only: filters.unknownOnly, p_no_owner: filters.noOwner,
      p_cursor_created_at: cursor?.createdAt ?? null, p_cursor_id: cursor?.id ?? null, p_limit: MARKETING_PAGE_SIZE,
    });
    if (error) return denied(error) ? { status: "denied" } : { status: "unavailable" };
    const page = parseMarketingLeads(data, { organizationId: actor.organizationId, ...period, limit: MARKETING_PAGE_SIZE });
    return page ? { status: "available", page } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Узкий период для строки сигналов («расход есть, заявок нет») — тот же обзор, не отдельное определение.
 * null — прочитать не удалось: сигнала нет, и это не «заявок нет».
 */
export async function readMarketingRecent(
  actor: ActivePlatformActor,
  period: Period,
): Promise<Readonly<{ leads: number; spendRows: number }> | null> {
  const read = await readMarketingOverview(actor, period);
  if (read.status !== "available") return null;
  const { overview } = read;
  return { leads: overview.cohort.total, spendRows: overview.spend.insidePeriod.length + overview.spend.partiallyOverlapping.length };
}

export type MarketingSpendInput = Readonly<{
  requestId: string; periodStart: string; periodEnd: string; amountMinor: number; currency: string;
  campaign: string | null; note: string | null;
}>;

function writeError(error: RpcError): SpendWriteResult {
  if (error.code === "42501") return { status: "forbidden" };
  if (error.code === "22023") return { status: error.message?.includes("request_conflict") ? "request_conflict" : "invalid" };
  if (error.code === "P0002") return { status: "not_found" };
  if (error.code === "PT409") return { status: "already_cancelled" };
  return { status: "unavailable" };
}

/** Ручной расход (`marketing_spend_add_v1`): валюты не конвертируются, отмена — строкой-ссылкой. */
export async function addMarketingSpend(actor: ActivePlatformActor, input: MarketingSpendInput): Promise<SpendWriteResult> {
  if (!canUseMarketing(actor)) return { status: "forbidden" };
  const requestId = parseSalesUuid(input.requestId);
  if (!requestId) return { status: "invalid" };
  try {
    const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc("marketing_spend_add_v1", {
      p_request_id: requestId, p_period_start: input.periodStart, p_period_end: input.periodEnd,
      p_amount_minor: input.amountMinor, p_currency: input.currency, p_campaign: input.campaign, p_note: input.note,
    });
    if (error) return writeError(error);
    const spend = parseSpendSaved(data, requestId);
    return spend ? { status: "saved", spend } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

export async function cancelMarketingSpend(
  actor: ActivePlatformActor,
  input: Readonly<{ requestId: string; spendId: string }>,
): Promise<Readonly<{ status: "cancelled" }> | Readonly<{ status: Exclude<SpendWriteResult["status"], "saved"> }>> {
  if (!canUseMarketing(actor)) return { status: "forbidden" };
  const requestId = parseSalesUuid(input.requestId), spendId = parseSalesUuid(input.spendId);
  if (!requestId || !spendId) return { status: "invalid" };
  try {
    const { data, error } = await (await createSupabaseServerClient()).schema("platform")
      .rpc("marketing_spend_cancel_v1", { p_request_id: requestId, p_spend_id: spendId });
    if (error) {
      const result = writeError(error);
      return result.status === "saved" ? { status: "unavailable" } : result;
    }
    return parseSpendCancelled(data, requestId, spendId) ? { status: "cancelled" } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
