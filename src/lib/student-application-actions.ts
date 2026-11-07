"use server";

import { revalidatePath } from "next/cache";
import type { ActivePlatformActor } from "./platform-auth";
import { isStaffPreview } from "./platform-access";
import { requirePlatformStaffActor } from "./platform-guards";
import { exactActionStringFields } from "./server/action-form-fields";
import { isStudentApplicationUuid, type StudentApplicationActionState } from "./student-application-contract";
import { findPossibleDuplicates, type PossibleDuplicate } from "./v3/possible-duplicates";
import { decideStudentApplication, loadStudentApplicationQueue, StudentApplicationSourceError } from "./v3/student-application-source";
import { STUDENT_SEARCH_READERS } from "./v3/student-search-readers";

const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/;

function failure(error: unknown, requestId?: string): StudentApplicationActionState {
  return { status: error instanceof StudentApplicationSourceError ? error.code : error instanceof SyntaxError ? "invalid" : "unavailable", requestId };
}

/**
 * Одобрение заводит нового человека (07.11.2026): студент, который уже есть, становился вторым лидом и вторым делом.
 * Похожих ищет по имени из анкеты; свои лид и дело анкеты — не дубли. Не прочиталось — без предупреждения.
 */
async function possibleDuplicatesOf(actor: ActivePlatformActor, applicationId: string): Promise<readonly PossibleDuplicate[]> {
  try {
    const application = (await loadStudentApplicationQueue()).applications.find((row) => row.id === applicationId);
    if (!application) return [];
    return await findPossibleDuplicates(actor, application.questionnaire, STUDENT_SEARCH_READERS,
      { leadId: application.canonicalLeadId, studentCaseId: application.studentCaseId });
  } catch {
    return [];
  }
}
/**
 * Access-only decision (unified workflow S1): no direction/curator fields —
 * approving only opens the portal cabinet; Admissions assignment happens
 * later, after a Sales report handoff (S2). Reused by both the Продажи
 * «Заявки» queue and the lead-card «Доступ к платформе» block.
 */
export async function decideStudentApplicationAction(_previous: StudentApplicationActionState, form: FormData): Promise<StudentApplicationActionState> {
  const fields = exactActionStringFields(form, ["application_id", "expected_revision", "decision", "reason", "request_id", "confirm_duplicate"]);
  if (!fields) return { status: "invalid" };
  const applicationId = fields.get("application_id"); const requestId = fields.get("request_id");
  const responseRequestId = isStudentApplicationUuid(requestId) ? requestId : undefined;
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor)) return { status: "forbidden", requestId: responseRequestId };
  const expectedRevision = Number(fields.get("expected_revision")); const decision = fields.get("decision");
  const suppliedReason = (fields.get("reason") ?? "").replace(/\s+/g, " ").trim();
  const reason = decision === "approve" && !suppliedReason ? "Доступ одобрен" : suppliedReason;
  if (!isStudentApplicationUuid(applicationId) || !isStudentApplicationUuid(requestId)
    || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !["approve", "reject"].includes(decision ?? "")
    || reason.length < 1 || reason.length > 1000 || CONTROL_CHAR_PATTERN.test(reason)) return { status: "invalid", requestId: responseRequestId };
  if (decision === "approve" && fields.get("confirm_duplicate") !== "1") {
    const matches = await possibleDuplicatesOf(actor, applicationId);
    if (matches.length > 0) return { status: "possible_duplicate", requestId, matches };
  }
  try {
    await decideStudentApplication({ applicationId, requestId, expectedRevision, decision: decision as "approve" | "reject", reason });
    revalidatePath("/requests"); revalidatePath("/admissions-requests"); revalidatePath("/profile");
    revalidatePath("/apply/status"); revalidatePath("/auth/account-pending");
    return { status: "saved", requestId };
  } catch (error) { return failure(error, responseRequestId); }
}
