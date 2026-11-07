import { staffHasPermission } from "../platform-access.ts";
import "server-only";
import { createHash } from "node:crypto";
import type { PlatformActor } from "../platform-auth";
import { LEAD_DIRECTIONS, type ManualLeadInput, type ManualLeadState } from "../platform-manual-lead-contract";
import { getPlatformSalesLead, mutatePlatformSalesLeadWorkflow } from "../platform-sales";
import { parseSalesUuid } from "../platform-sales-register-contract";
import { createSupabaseServerClient } from "../supabase/server";

export async function readLeadInterest(actor: PlatformActor, leadId: string): Promise<string | null> {
  if (!parseSalesUuid(leadId)) throw new Error("Lead interest is unavailable.");
  const client = await createSupabaseServerClient();
  // The existing column grants + canonical lead RLS apply, including live authority.
  const { data, error } = await client.schema("platform").from("leads").select("interest_direction")
    .eq("id", leadId).eq("organization_id", actor.organizationId).single();
  if (error || !data) throw new Error("Lead interest is unavailable.");
  if (data.interest_direction === null) return null;
  if (typeof data.interest_direction !== "string" || !Object.hasOwn(LEAD_DIRECTIONS, data.interest_direction)) throw new Error("Lead interest is unavailable.");
  return LEAD_DIRECTIONS[data.interest_direction as keyof typeof LEAD_DIRECTIONS];
}

export async function createManualLead(actor: PlatformActor, input: ManualLeadInput): Promise<ManualLeadState> {
  const result = (status: ManualLeadState["status"], leadId: string | null = null): ManualLeadState => ({ status, leadId, requestId: input.requestId });
  if (!staffHasPermission(actor, "lead.sales.workflow.manage")) return result("forbidden");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("create_manual_sales_lead", {
    p_organization_id: actor.organizationId, p_request_id: input.requestId, p_display_name: input.name,
    p_phone: input.phone, p_email: input.email, p_source_key: input.source, p_owner_membership_id: input.ownerId,
    // The next step is written below by the workflow command, never here (see recordFirstStep).
    p_interest_direction: input.direction, p_next_action: null, p_next_action_due_date: null,
  });
  if (error) return result(error.code === "42501" ? "forbidden" : error.code === "22023"
    ? error.message.includes("request_conflict") ? "request_conflict" : "invalid" : "unavailable");
  if (!data || typeof data !== "object" || Array.isArray(data) || data.request_id !== input.requestId
    || !["saved", "duplicate"].includes(data.status) || (data.lead_id !== null && !parseSalesUuid(data.lead_id))
    || (data.status === "saved" && data.lead_id === null)) return result("unavailable");
  if (data.status !== "saved" || input.nextAction === null || input.dueDate === null) return result(data.status, data.lead_id);
  return await recordFirstStep(actor, data.lead_id, input)
    ? result("saved", data.lead_id)
    : { ...result("saved", data.lead_id), step: "failed" };
}

/** Тот же запрос формы — тот же запрос шага: повтор после обрыва не пишет шаг второй раз. Вид v4 требует команда «Воронки». */
function firstStepRequestId(formRequestId: string): string {
  const hex = createHash("sha256").update(`evo:manual-lead-step:${formRequestId.toLowerCase()}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * 07.11.2026: «Следующее действие» нового лида пишет обычная команда «Воронки» (квитанция и журнал), а не
 * create_manual_sales_lead: лид с шагом без квитанции проверка доски (staff_sales_lead_page) считала порчей, и
 * «Воронка продаж» и «Заявки» не открывались ни у кого. Не вышло — лид без шага, форма просит задать его в карточке.
 */
async function recordFirstStep(actor: PlatformActor, leadId: string, input: ManualLeadInput): Promise<boolean> {
  try {
    const lead = await getPlatformSalesLead(actor, leadId);
    if (!lead) return false;
    // A replayed form request: the step is already there.
    if (lead.nextActionText !== null) return lead.nextActionText === input.nextAction && lead.nextActionDueDate === input.dueDate;
    await mutatePlatformSalesLeadWorkflow(actor, {
      leadId, expectedWorkflowVersion: lead.workflowVersion, requestId: firstStepRequestId(input.requestId),
      stageKey: lead.stageKey, ownerMembershipId: lead.currentOwnerMembershipId,
      nextActionText: input.nextAction, nextActionDueDate: input.dueDate, clearNextAction: false, reason: null,
    });
    return true;
  } catch {
    return false;
  }
}
