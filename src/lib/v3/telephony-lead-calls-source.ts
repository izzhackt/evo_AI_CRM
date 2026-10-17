import "server-only";

import type { PlatformActor } from "../platform-auth.ts";
import { parseSalesUuid } from "../platform-sales-register-contract.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";
import {
  LEAD_CALLS_LIMIT,
  leadCallsState,
  leadRecordingsState,
  type LeadCallsState,
  type LeadRecordings,
} from "./telephony-lead-calls.ts";

/**
 * Строки звонков для «Ленты» лида («Телефония Beeline KG», срез T5; миграция 295,
 * `platform.telephony_lead_calls_v1`). Читает база под сессией сотрудника: видимость
 * строки следует `lead.read` по лиду, телефония в интерфейсе открывается флагом
 * `ui_enabled` (по умолчанию выключен — тогда ответ «выключено», и лента ничего
 * не рисует). Номер клиента приходит только маской, ссылки на запись нет.
 *
 * Записи (срез T6; миграция 297, `platform.telephony_lead_recordings_v1`): если у звонков есть
 * записи, вторым чтением приходят их ноги (идентификатор и состояние) и право ЭТОГО сотрудника
 * слушать; ссылки нет и там. Не удалось прочитать — звонки остаются, а записи — словами
 * состояния без плеера (`recordings: null`); звонки от этого чтения не зависят.
 *
 * Отказ и сбой чтения звонков, как и чужая форма ответа, — `unavailable`: лента говорит,
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
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .schema("platform")
      .rpc("telephony_lead_calls_v1", {
        p_organization_id: actor.organizationId,
        p_lead_id: leadId,
        p_limit: LEAD_CALLS_LIMIT,
        p_since: window.since,
        p_until: window.until,
      });
    if (error) return { status: "unavailable" };
    const state = leadCallsState(data);
    if (state.status !== "ready") return state;
    const withRecording = state.calls.filter((call) => call.recording !== "none").map((call) => call.callId);
    if (withRecording.length === 0) return Object.freeze({ ...state, recordings: Object.freeze({}) });
    let recordings: LeadRecordings | null = null;
    try {
      const read = await client.schema("platform").rpc("telephony_lead_recordings_v1", {
        p_organization_id: actor.organizationId,
        p_lead_id: leadId,
        p_call_ids: withRecording,
      });
      recordings = read.error ? null : leadRecordingsState(read.data, withRecording);
    } catch {
      recordings = null;
    }
    return Object.freeze({ ...state, recordings });
  } catch {
    return { status: "unavailable" };
  }
}
