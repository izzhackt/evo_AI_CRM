import { staffPresentationCan } from "../platform-access.ts";
import "server-only";
import type { ActivePlatformActor } from "../platform-auth";
import type { ApplicationPartnerDetails } from "@/components/v3/profile/types";

export class AdmissionsSourceError extends Error {
  readonly code: "invalid" | "stale" | "denied" | "request_conflict" | "unavailable";
  constructor(code: AdmissionsSourceError["code"] = "unavailable") { super("Admissions data unavailable"); this.code = code; }
}
function invalid(): never { throw new AdmissionsSourceError(); }
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
}
function list(value: unknown, max = 500): unknown[] { return Array.isArray(value) && value.length <= max ? value : invalid(); }
function uuid(value: unknown): string { return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value : invalid(); }

export async function admissionsRpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const { createSupabaseServerClient } = await import("../supabase/server");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc(name, args);
  if (error) throw new AdmissionsSourceError(error.code === "42501" ? "denied" : error.code === "40001" || error.code === "PT409" ? "stale" : error.code === "23505" ? "request_conflict" : error.code === "22023" ? "invalid" : "unavailable");
  return data;
}
function staff(actor: ActivePlatformActor): void {
  if (!staffPresentationCan(actor, "admissions.read")) throw new AdmissionsSourceError("denied");
}

/**
 * Партнёр и решение по заявке — editable since unified workflow S7 (plan §8,
 * §11; docs/PLAN_CHANGES.md «unified workflow S7»).
 *
 * A narrow projection of the SAME `staff_case_admissions_workspace_v1` RPC
 * the retired playbook editor used (read path kept, per the S7 task's own
 * instruction) — `application.details` is the application's raw
 * `admissions_details` JSONB, returned whole, so a write through the NEW
 * migration-184 RPC below is visible here with no read-side change needed.
 * This is NOT a resurrection of the deleted `AdmissionsWorkspace` type —
 * stages, gates, case facts, playbook and visa are still ignored entirely.
 *
 * Deliberately NEW key names (partnerContact, externalLink,
 * decisionReference, decisionNote), not the legacy camelCase
 * partnerContact/packageReference/decisionReference/offerConditions the
 * retired playbook editor wrote: `platform.update_application_partner_details_v1`
 * (migration 184) owns its own four snake_case keys
 * (partner_contact/external_link/decision_reference/decision_note),
 * independent of and coexisting with any historical playbook-era data still
 * sitting in the same JSONB column. See migration 184's own header for why
 * the S4-identified `admissions_playbook_version_id` requirement is gone —
 * this RPC needs none — and for the one remaining known edge case (a rare,
 * still playbook-bound ACTIVE legacy case).
 */
function detailText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function readApplicationPartnerDetails(actor: ActivePlatformActor, caseId: string): Promise<readonly ApplicationPartnerDetails[]> {
  staff(actor);
  const row = record(await admissionsRpc("staff_case_admissions_workspace_v1", { p_student_case_id: uuid(caseId) }));
  const caseRow = record(row.case);
  if (caseRow.id !== caseId || caseRow.organizationId !== actor.organizationId) return invalid();
  return list(row.applications).map((value) => {
    const app = record(value);
    // admissions_details is NULL for an application no one has ever
    // annotated. A missing or non-object value means "nothing recorded",
    // not a malformed read.
    const raw = app.details;
    const details = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    return {
      applicationId: uuid(app.id),
      version: str(app.version),
      partnerContact: detailText(details.partner_contact),
      externalLink: detailText(details.external_link),
      decisionReference: detailText(details.decision_reference),
      decisionNote: detailText(details.decision_note),
    };
  });
}
function str(value: unknown): string {
  return typeof value === "string" && /^\d{1,19}$/.test(value) ? value : invalid();
}
