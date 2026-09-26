import "server-only";

import { isStaffPreview, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import {
  parseLeadHandoffStrip,
  parseSalesCount,
  type LeadHandoffStripRead,
  type SalesCountRead,
} from "@/lib/sales-numbers-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * «Продажи» за период — одно определение для каждого числа «Продажи»
 * (Э2, решение владельца 26.09.2026): записи отчёта не в архиве с датой
 * продажи в периоде (`staff_sales_count_v1`, миграция 247). Те же права и та
 * же видимость записей, что у самого «Отчёта продаж», в том числе при
 * просмотре роли. Сбой — `unavailable`, отказ роли — `denied`; нуля наугад нет.
 */
export async function readSalesCount(
  actor: ActivePlatformActor,
  period: Readonly<{ from: string; to: string }>,
): Promise<SalesCountRead> {
  if (!staffHasPermission(actor, "sales.register.read")) return { status: "denied" };
  try {
    const { data, error } = await (await createSupabaseServerClient())
      .schema("platform").rpc("staff_sales_count_v1", {
        p_organization_id: actor.organizationId,
        p_from: period.from,
        p_to: period.to,
      });
    if (error) return { status: "unavailable" };
    const count = parseSalesCount(data, { organizationId: actor.organizationId, from: period.from, to: period.to });
    return count ? { status: "available", count } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Полоса «Передача» в Lead 360 (`staff_lead_handoff_strip_v1`, миграция 247):
 * этап по правилу доски, дата передачи и чем она доказана, договор, первый
 * платёж, запись в отчёте, куратор и его ответ — всё из настоящих строк.
 * При просмотре роли запись отчёта показывается, только если показываемая
 * роль читает продажи — как сам «Отчёт продаж».
 */
export async function readLeadHandoffStrip(
  actor: ActivePlatformActor,
  leadId: string,
): Promise<LeadHandoffStripRead> {
  if (!staffHasPermission(actor, "lead.read")) return { status: "unavailable" };
  try {
    const { data, error } = await (await createSupabaseServerClient())
      .schema("platform").rpc("staff_lead_handoff_strip_v1", {
        p_organization_id: actor.organizationId,
        p_lead_id: leadId,
      });
    if (error) return { status: "unavailable" };
    const strip = parseLeadHandoffStrip(data, { organizationId: actor.organizationId, leadId });
    if (!strip) return { status: "unavailable" };
    const hideReport = isStaffPreview(actor) && !staffPresentationCan(actor, "sales.read");
    return {
      status: "available",
      strip: hideReport ? Object.freeze({ ...strip, report: Object.freeze({ status: "denied" as const }) }) : strip,
    };
  } catch {
    return { status: "unavailable" };
  }
}
