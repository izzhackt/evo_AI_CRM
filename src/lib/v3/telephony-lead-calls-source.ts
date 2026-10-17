import "server-only";

import type { PlatformActor } from "../platform-auth.ts";
import { parseSalesUuid } from "../platform-sales-register-contract.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";
import { LEAD_CALLS_LIMIT, leadCallsState, type LeadCallsState } from "./telephony-lead-calls.ts";

/**
 * Строки звонков для «Ленты» лида («Телефония Beeline KG», срез T5; миграция 292,
 * `platform.telephony_lead_calls_v1`). Читает база под сессией сотрудника: видимость
 * строки следует `lead.read` по лиду, телефония в интерфейсе открывается флагом
 * `ui_enabled` (по умолчанию выключен — тогда ответ «выключено», и лента ничего
 * не рисует). Номер клиента приходит только маской, ссылки на запись нет.
 *
 * Отказ и сбой чтения, как и чужая форма ответа, — `unavailable`: лента говорит,
 * что звонки не загрузились, а не угадывает «звонков нет». Заметки и события
 * ленты от этого чтения не зависят.
 */
export async function readLeadCalls(
  actor: PlatformActor,
  leadId: string,
  window: Readonly<{ since: string | null; until: string | null }>,
): Promise<LeadCallsState> {
  if (!parseSalesUuid(leadId)) return { status: "unavailable" };
  try {
    const { data, error } = await (await createSupabaseServerClient())
      .schema("platform")
      .rpc("telephony_lead_calls_v1", {
        p_organization_id: actor.organizationId,
        p_lead_id: leadId,
        p_limit: LEAD_CALLS_LIMIT,
        p_since: window.since,
        p_until: window.until,
      });
    if (error) return { status: "unavailable" };
    return leadCallsState(data);
  } catch {
    return { status: "unavailable" };
  }
}
