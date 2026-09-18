import "server-only";
import { staffPresentationCan } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth";
import { createSupabaseServerClient } from "../supabase/server";

/**
 * «Подготовить кабинет» (unified workflow S7, plan §4): the lead-card «Доступ
 * к платформе» block's own discoverability read. A lead-cabinet case never
 * has a linked platform анкета (site/WhatsApp leads have no анкета at all),
 * so `loadStudentApplicationForLead` stays null forever for this population —
 * this is the separate read that lets the block show «Кабинет уже
 * подготовлен» instead of the button after a page reload, mirroring plan §4's
 * "для уже открытого доступа показываем «Доступ открыт», а не повторное
 * одобрение" for leads that never had an анкета in the first place.
 */
export type LeadCabinetCase = Readonly<{ studentCaseId: string; state: "pending" | "active" | "closed" }>;

const CASE_STATES = ["pending", "active", "closed"] as const;

function isCaseState(value: unknown): value is LeadCabinetCase["state"] {
  return typeof value === "string" && (CASE_STATES as readonly string[]).includes(value);
}
function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

export async function readLeadCabinetCase(actor: ActivePlatformActor, leadId: string): Promise<LeadCabinetCase | null> {
  if (!staffPresentationCan(actor, "sales.read")) throw new Error("Lead cabinet case unavailable.");
  const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc("staff_lead_cabinet_case_v1", {
    p_organization_id: actor.organizationId, p_lead_id: leadId,
  });
  if (error) throw new Error("Lead cabinet case unavailable.");
  if (data === null) return null;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Lead cabinet case unavailable.");
  const row = data as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "state,student_case_id" || !isUuid(row.student_case_id) || !isCaseState(row.state)) {
    throw new Error("Lead cabinet case unavailable.");
  }
  return { studentCaseId: row.student_case_id, state: row.state };
}
