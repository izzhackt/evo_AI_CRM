import "server-only";
import { staffPresentationCan } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth";
import { createSupabaseServerClient } from "../supabase/server";
import { parseLeadSaleConditions, type LeadSaleConditions } from "../lead-sale-conditions-contract";

/**
 * «Условия продажи» read. Used both by the lead card block (Overview) and,
 * through the report's own preview action, by «Отчёт продаж → Добавить
 * продажу» once a lead is chosen — the exact same shape, never a second form.
 */
export async function readLeadSaleConditions(actor: ActivePlatformActor, leadId: string): Promise<LeadSaleConditions> {
  if (!staffPresentationCan(actor, "sales.read")) throw new Error("Sale conditions unavailable.");
  const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc("staff_lead_sale_conditions_v1", {
    p_organization_id: actor.organizationId, p_lead_id: leadId,
  });
  if (error) throw new Error("Sale conditions unavailable.");
  return parseLeadSaleConditions(data, actor.organizationId);
}
