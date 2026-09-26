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
export type LeadCabinetCase = Readonly<{
  studentCaseId: string;
  state: "pending" | "active" | "closed";
  /**
   * Решение владельца C (миграция 248): ожидающий кабинет, приглашение в
   * который этот сотрудник может отправить с карточки лида (Sales с правом на
   * лид кабинета). Читает `readStudentCaseCabinetOrigin`; нет чтения — нет
   * приглашения.
   */
  cabinetInvite?: boolean;
}>;

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

/**
 * Unified workflow S8 (plan §4): whether a student_case's OWN origin is a
 * genuine 184 lead-cabinet case (source_key LIKE 'lead-cabinet:%',
 * canonical_lead_id set) — independent of case state, and NOT derivable from
 * caseState alone (a pre-pivot legacy_pending case is ALSO 'pending' with no
 * curator; a curator-declined case reverts to 'pending' too, per 182). No
 * existing case read model exposes source_key to this layer (the read RPCs
 * traced through 078/110/137/149/176/177/182 select neither source_key nor
 * canonical_lead_id), so StudentPortalAccessCard's three-way discriminator
 * is driven by this dedicated, migration-185 companion read instead —
 * fails closed to `false` (renders as if not a cabinet case; the SQL layer
 * stays the authoritative gate regardless of what the UI shows).
 */
export async function readStudentCaseCabinetOrigin(
  actor: ActivePlatformActor,
  studentCaseId: string,
): Promise<boolean> {
  const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc(
    "staff_student_case_cabinet_origin_v1",
    { p_organization_id: actor.organizationId, p_student_case_id: studentCaseId },
  );
  if (error || typeof data !== "boolean") return false;
  return data;
}
