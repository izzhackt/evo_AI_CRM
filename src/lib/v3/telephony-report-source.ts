import "server-only";

import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";
import { telephonyReportState, type TelephonyReportState } from "./telephony-report.ts";

/** Право читать блок «Звонки» «Отчёта продаж»: «все» — вся команда, «свои» — одна строка сотрудника. */
export function canReadTelephonyReport(actor: ActivePlatformActor): boolean {
  return !isStaffPreview(actor)
    && (staffHasPermission(actor, "telephony.report.read.all") || staffHasPermission(actor, "telephony.report.read.own"));
}

/**
 * Блок «Звонки» «Отчёта продаж» («Телефония Beeline KG», срез T10; миграция 299,
 * `platform.telephony_report_v1`). Читает база под сессией сотрудника: права `telephony.report.read.*`
 * и включатель `ui_enabled` (по умолчанию выключен — тогда ответ «выключено» и блок не рисуется) решает
 * она, не страница. Номер клиента приходит только маской.
 *
 * Просмотр роли блока не показывает: чтение шло бы от имени настоящего администратора и показало бы
 * числа, которых у показываемой роли нет. Отказ базы по праву (42501) — тоже «выключено», а не сбой:
 * сессия могла устареть. Прочий отказ и сбой чтения, как и чужая форма ответа, — `unavailable`: блок
 * говорит, что звонки не загрузились, а не угадывает «звонков нет». Остальные разделы отчёта от этого
 * чтения не зависят.
 */
export async function readTelephonyReport(
  actor: ActivePlatformActor,
  period: Readonly<{ from: string; to: string }>,
  /** Клиент базы под сессией сотрудника; тесты подставляют свой. */
  open: () => Promise<Awaited<ReturnType<typeof createSupabaseServerClient>>> = createSupabaseServerClient,
): Promise<TelephonyReportState> {
  if (!canReadTelephonyReport(actor)) return { status: "off" };
  try {
    const { data, error } = await (await open())
      .schema("platform")
      .rpc("telephony_report_v1", {
        p_organization_id: actor.organizationId,
        p_from: period.from,
        p_to: period.to,
      });
    if (error) return error.code === "42501" ? { status: "off" } : { status: "unavailable" };
    return telephonyReportState(data, period);
  } catch {
    return { status: "unavailable" };
  }
}
