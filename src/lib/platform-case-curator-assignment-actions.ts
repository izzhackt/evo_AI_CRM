"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { isStaffPreview, staffHasPermission } from "./platform-access.ts";
import { requirePlatformStaffActor } from "./platform-guards";
import { exactActionStringFields } from "./server/action-form-fields";
import { parsePlatformAdmissionsUuid } from "./platform-admissions.ts";

/**
 * S3 (plan §7 "Admin выбирает другого куратора внутри того же дела"):
 * `platform.assign_case_curator_v1` (182) for the CaseHeader "Назначить
 * куратора" inline form on a needs-curator case. Gate mirrors
 * `manageCaseCoverageAction`'s own established `case.curator.assign` check —
 * the same real RBAC permission, not the coarser page-level
 * `FixedRoleCapability` gate `requirePlatformMutationCapability` takes.
 */
export type AssignCaseCuratorActionState = Readonly<{
  status:
    | "idle"
    | "saved"
    | "invalid"
    | "forbidden"
    | "stale"
    | "request_conflict"
    | "unavailable";
  requestId: string;
}>;

const FIELDS = [
  "student_case_id",
  "curator_membership_id",
  "reason",
  "request_id",
] as const;
const REQUEST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function outcome(
  status: AssignCaseCuratorActionState["status"],
  fallbackRequestId: string,
): AssignCaseCuratorActionState {
  return {
    status,
    requestId:
      status === "saved" || status === "request_conflict"
        ? randomUUID()
        : fallbackRequestId,
  };
}

export async function assignCaseCuratorAction(
  previous: AssignCaseCuratorActionState,
  form: FormData,
): Promise<AssignCaseCuratorActionState> {
  const actor = await requirePlatformStaffActor();
  if (
    actor.systemRole !== "admin" ||
    isStaffPreview(actor) ||
    !staffHasPermission(actor, "case.curator.assign")
  ) {
    return outcome("forbidden", previous.requestId);
  }
  const fields = exactActionStringFields(form, FIELDS);
  const studentCaseId = fields
    ? parsePlatformAdmissionsUuid(fields.get("student_case_id"))
    : null;
  const curatorMembershipId = fields
    ? parsePlatformAdmissionsUuid(fields.get("curator_membership_id"))
    : null;
  const reason = (fields?.get("reason") ?? "").trim();
  const requestIdValue = fields?.get("request_id") ?? "";
  const requestId = REQUEST_UUID.test(requestIdValue)
    ? requestIdValue.toLowerCase()
    : null;
  if (
    !studentCaseId ||
    !curatorMembershipId ||
    !requestId ||
    reason.length < 1 ||
    reason.length > 1000
  ) {
    return outcome("invalid", previous.requestId);
  }

  try {
    const { createSupabaseServerClient } = await import("./supabase/server");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("assign_case_curator_v1", {
      p_organization_id: actor.organizationId,
      p_request_id: requestId,
      p_student_case_id: studentCaseId,
      p_curator_membership_id: curatorMembershipId,
      p_reason: reason,
    });
    if (error) {
      if (error.code === "42501") return outcome("forbidden", previous.requestId);
      if (error.code === "40001" || error.code === "PT409") return outcome("stale", previous.requestId);
      if (error.code === "22023" && /already used/i.test(error.message)) {
        return outcome("request_conflict", previous.requestId);
      }
      // 55000 = the case is no longer awaiting a curator (someone assigned
      // one concurrently, or the state changed) — that is staleness, not a
      // form-input problem.
      if (error.code === "55000") return outcome("stale", previous.requestId);
      return outcome(
        error.code === "22023" ? "invalid" : "unavailable",
        previous.requestId,
      );
    }
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      (data as Record<string, unknown>).student_case_id !== studentCaseId ||
      (data as Record<string, unknown>).curator_membership_id !== curatorMembershipId
    ) {
      return outcome("unavailable", previous.requestId);
    }
    revalidatePath("/v3/profile");
    return outcome("saved", previous.requestId);
  } catch {
    return outcome("unavailable", previous.requestId);
  }
}
