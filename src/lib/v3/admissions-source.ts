import { staffPresentationCan } from "../platform-access.ts";
import "server-only";
import type { ActivePlatformActor } from "../platform-auth";
import { ADMISSIONS_DIRECTIONS, type AdmissionsSummary } from "../platform-admissions-playbook-contract.ts";
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
function choice<T extends string>(value: unknown, values: readonly T[]): T { return typeof value === "string" && values.includes(value as T) ? value as T : invalid(); }
function count(value: unknown): number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : invalid(); }

export function normalizeAdmissionsSummary(input: unknown): AdmissionsSummary {
  const row = record(input);
  const stock = list(row.stock, 6).map((value) => {
    const item = record(value);
    return { direction: choice(item.direction, [...ADMISSIONS_DIRECTIONS, "unknown"]), active: count(item.active), overdue: count(item.overdue), awaiting_ack: count(item.awaiting_ack), needs_curator: count(item.needs_curator) };
  });
  if (new Set(stock.map((item) => item.direction)).size !== stock.length) return invalid();
  return { stock };
}

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
export async function readAdmissionsSummary(actor: ActivePlatformActor, params: { direction?: string; curatorMembershipId?: string }): Promise<AdmissionsSummary> {
  staff(actor);
  return normalizeAdmissionsSummary(await admissionsRpc("admissions_direction_summary_v1", { p_direction: params.direction ?? null, p_curator_membership_id: params.curatorMembershipId ?? null }));
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
