import "server-only";

import type { PlatformActor } from "../platform-auth.ts";
import { parseSalesUuid } from "../platform-sales-register-contract.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";
import type { RequestRow } from "../requests-queue-contract.ts";
import { callRequestOutcome, leadCallsState } from "./telephony-lead-calls.ts";

/** Сколько строк «Звонков» очереди получают исход звонка за раз: у остальных остаётся «Звонок». */
const REQUEST_CALLS_LIMIT = 20;

/**
 * Исход последнего звонка у строк «Заявки → Звонки» («Телефония Beeline KG», T9): «Пропущен»,
 * «Ответил Менеджер Первый · 1 мин 35 с». Читает тот же `telephony_lead_calls_v1`, что «Лента» лида, под сессией
 * сотрудника и по одному лиду (строка очереди номера не знает): видимость следует `lead.read`. Сбой или
 * «выключено» — у строки остаётся слово «Звонок»; очередь от этого чтения не зависит.
 */
export async function readRequestCallLines(actor: PlatformActor, rows: readonly RequestRow[]): Promise<Readonly<Record<string, string>>> {
  const leads = rows
    .flatMap((row) => (row.kind === "lead" && row.source === "phone_call" && parseSalesUuid(row.leadId) ? [row.leadId] : []))
    .slice(0, REQUEST_CALLS_LIMIT);
  if (leads.length === 0) return Object.freeze({});
  try {
    const client = await createSupabaseServerClient();
    const lines = await Promise.all(leads.map(async (leadId) => {
      try {
        const { data, error } = await client.schema("platform").rpc("telephony_lead_calls_v1", {
          p_organization_id: actor.organizationId,
          p_lead_id: leadId,
          p_limit: 1,
          p_since: null,
          p_until: null,
        });
        if (error) return null;
        const state = leadCallsState(data);
        return state.status === "ready" && state.calls[0] ? ([leadId, callRequestOutcome(state.calls[0])] as const) : null;
      } catch {
        return null;
      }
    }));
    return Object.freeze(Object.fromEntries(lines.filter((line): line is readonly [string, string] => line !== null)));
  } catch {
    return Object.freeze({});
  }
}
