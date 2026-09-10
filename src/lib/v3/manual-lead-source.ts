import "server-only";
import type { PlatformActor } from "../platform-auth";
import { LEAD_DIRECTIONS, type ManualLeadInput, type ManualLeadState } from "../platform-manual-lead-contract";
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
  if (actor.authorityRole !== "admin" && actor.authorityRole !== "sales") return result("forbidden");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("create_manual_sales_lead", {
    p_organization_id: actor.organizationId, p_request_id: input.requestId, p_display_name: input.name,
    p_phone: input.phone, p_email: input.email, p_source_key: input.source, p_owner_membership_id: input.ownerId,
    p_interest_direction: input.direction, p_next_action: input.nextAction, p_next_action_due_date: input.dueDate,
  });
  if (error) return result(error.code === "42501" ? "forbidden" : error.code === "22023"
    ? error.message.includes("request_conflict") ? "request_conflict" : "invalid" : "unavailable");
  if (!data || typeof data !== "object" || Array.isArray(data) || data.request_id !== input.requestId
    || !["saved", "duplicate"].includes(data.status) || (data.lead_id !== null && !parseSalesUuid(data.lead_id))
    || (data.status === "saved" && data.lead_id === null)) return result("unavailable");
  return result(data.status, data.lead_id);
}
