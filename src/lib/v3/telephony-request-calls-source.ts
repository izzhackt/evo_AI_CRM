import "server-only";

import type { PlatformActor } from "../platform-auth.ts";
import { parseSalesUuid } from "../platform-sales-register-contract.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";
import type { RequestRow } from "../requests-queue-contract.ts";
import { callRequestOutcome, leadCallsState } from "./telephony-lead-calls.ts";

/** Сколько строк «Звонков» очереди получают исход звонка за раз: у остальных остаётся «Звонок». */
const REQUEST_CALLS_LIMIT = 20;

/**
 * Исход последнего звонка у строк «Заявки → Звонки» («Телефония Beeline KG», T9): «Пропущен», «Ответил Менеджер Первый ·
 * 1 мин 35 с». Читает те же строки, что «Лента» лида (`telephony_lead_calls_v1`), но одним вызовом на все строки
 * (`telephony_lead_calls_batch_v1`, миграция 368), под сессией сотрудника: строку очереди номера не знает, видимость
 * следует `lead.read`, лида без права в ответе нет. Сбой или «выключено» — у строки остаётся слово «Звонок»; очередь от
 * этого чтения не зависит.
 */
export async function readRequestCallLines(actor: PlatformActor, rows: readonly RequestRow[]): Promise<Readonly<Record<string, string>>> {
  const leads = rows
    .flatMap((row) => (row.kind === "lead" && row.source === "phone_call" && parseSalesUuid(row.leadId) ? [row.leadId] : []))
    .slice(0, REQUEST_CALLS_LIMIT);
  if (leads.length === 0) return Object.freeze({});
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("telephony_lead_calls_batch_v1", {
      p_organization_id: actor.organizationId,
      p_lead_ids: leads,
      p_limit_per_lead: 1,
    });
    if (error || typeof data !== "object" || data === null || Array.isArray(data)) return Object.freeze({});
    const byLead = data as Record<string, unknown>;
    const lines = leads.flatMap((leadId) => {
      if (!Object.hasOwn(byLead, leadId)) return [];
      const state = leadCallsState(byLead[leadId]);
      return state.status === "ready" && state.calls[0] ? [[leadId, callRequestOutcome(state.calls[0])] as const] : [];
    });
    return Object.freeze(Object.fromEntries(lines));
  } catch {
    return Object.freeze({});
  }
}
