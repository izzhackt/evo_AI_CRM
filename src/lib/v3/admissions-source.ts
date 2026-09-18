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
 * Партнёр и решение по заявке — read-only (unified workflow S4, plan §11).
 *
 * A narrow projection of the SAME `staff_case_admissions_workspace_v1` RPC
 * the retired playbook editor used, scoped to just four `admissions_details`
 * keys (partnerContact, packageReference, decisionReference,
 * offerConditions). This is NOT a resurrection of the deleted
 * `AdmissionsWorkspace` type — stages, gates, case facts, playbook and visa
 * are ignored entirely here.
 *
 * Read-only by deliberate decision, not by omission: the only write RPC for
 * this JSONB column (`update_application_admissions_details_v1`, migration
 * 137) hard-requires `admissions_playbook_version_id IS NOT NULL` on the
 * case (`admissions_related_command`'s own check — "Configure a country
 * playbook first"). That configuration path (`configure_case_admissions_v1`,
 * reachable only through the now-deleted `AdmissionsRoutePanel` "Выбрать
 * маршрут" editor, and CN/MY-only even when it existed) has no UI left after
 * this slice, so the write RPC would fail closed for every case going
 * forward — building an editable form on it would silently fail for the
 * whole product, not a narrow edge case. Making it genuinely usable would
 * need a new SQL RPC without that gate, which the task explicitly forbids
 * ("do NOT widen SQL"). Showing the historical facts read-only is the
 * honest option: real data, no invented success, no fabricated capability.
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
    // admissions_details is NULL for an application that never had the old
    // playbook editor touch it — the common case going forward. A missing or
    // non-object value means "nothing recorded", not a malformed read.
    const raw = app.details;
    const details = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    return {
      applicationId: uuid(app.id),
      partnerContact: detailText(details.partnerContact),
      packageReference: detailText(details.packageReference),
      decisionReference: detailText(details.decisionReference),
      offerConditions: detailText(details.offerConditions),
    };
  });
}
