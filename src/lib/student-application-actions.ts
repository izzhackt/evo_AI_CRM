"use server";

import { revalidatePath } from "next/cache";
import { isStaffPreview } from "./platform-access";
import { requirePlatformStaffActor } from "./platform-guards";
import { exactActionStringFields } from "./server/action-form-fields";
import { isStudentApplicationUuid, STUDENT_APPLICATION_DIRECTIONS,
  type AdmissionsDirection, type StudentApplicationActionState } from "./student-application-contract";
import { decideStudentApplication, StudentApplicationSourceError } from "./v3/student-application-source";

function failure(error: unknown, requestId?: string): StudentApplicationActionState {
  return { status: error instanceof StudentApplicationSourceError ? error.code : error instanceof SyntaxError ? "invalid" : "unavailable", requestId };
}
export async function decideStudentApplicationAction(_previous: StudentApplicationActionState, form: FormData): Promise<StudentApplicationActionState> {
  const fields = exactActionStringFields(form, ["application_id", "expected_revision", "decision", "admissions_direction", "curator_membership_id", "reason", "request_id"]);
  if (!fields) return { status: "invalid" };
  const applicationId = fields.get("application_id"); const requestId = fields.get("request_id");
  const responseRequestId = isStudentApplicationUuid(requestId) ? requestId : undefined;
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor)) return { status: "forbidden", requestId: responseRequestId };
  const expectedRevision = Number(fields.get("expected_revision")); const decision = fields.get("decision");
  const admissionsDirection = fields.get("admissions_direction") || null;
  const curatorMembershipId = fields.get("curator_membership_id") || null;
  const suppliedReason = (fields.get("reason") ?? "").replace(/\s+/g, " ").trim();
  const reason = decision === "approve" && !suppliedReason ? "Заявка одобрена Admissions" : suppliedReason;
  if (!isStudentApplicationUuid(applicationId) || !isStudentApplicationUuid(requestId)
    || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !["approve", "reject"].includes(decision ?? "")
    || reason.length < 1 || reason.length > 1000 || /[\u0000-\u001f\u007f]/.test(reason)
    || (decision === "approve" && (!isStudentApplicationUuid(curatorMembershipId) || !(STUDENT_APPLICATION_DIRECTIONS as readonly string[]).includes(admissionsDirection ?? "")))
    || (decision === "reject" && (curatorMembershipId !== null || admissionsDirection !== null))) return { status: "invalid", requestId: responseRequestId };
  try {
    await decideStudentApplication({ applicationId, requestId, expectedRevision, decision: decision as "approve" | "reject",
      admissionsDirection: admissionsDirection as AdmissionsDirection | null, curatorMembershipId, reason });
    revalidatePath("/v3/admissions-requests"); revalidatePath("/v3/profile"); revalidatePath("/apply/status"); revalidatePath("/auth/account-pending");
    return { status: "saved", requestId };
  } catch (error) { return failure(error, responseRequestId); }
}
