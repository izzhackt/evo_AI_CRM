"use server";

import { revalidatePath } from "next/cache";
import { requireStudentPortalActor } from "../student-portal-guards";
import { resolveStudentPortalActor } from "../student-portal-auth.ts";
import { requirePlatformStaffActor } from "../platform-guards";
import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import { createSupabaseServerClient } from "../supabase/server";
import { universityIntakeId as uuid } from "../platform-university-catalog.ts";
import {
  parseApplicationDocumentTarget, parseApplicationDocumentCursor,
  type ApplicationDocumentOwner, type ApplicationDocumentScope, type ApplicationDocumentCursor,
} from "./application-documents.ts";
import {
  applicationPackageFailure, parseApplicationPackageSelections,
  parseApplicationPackageSubmitIntent, parseApplicationPackageReviewIntent,
  parseApplicationPackageSubmitReceipt, parseApplicationPackageReviewReceipt,
  parseApplicationPackageRecovery, parseApplicationPackageReadiness,
  parseApplicationPackageDetail, parseApplicationPackageHistory, parseApplicationPackageReviewHistory,
  parseApplicationPackageQueue, parseApplicationPackageNotification,
  type ApplicationPackageTarget, type ApplicationPackageFailureResult,
  type ApplicationPackageSubmitReceipt, type ApplicationPackageReviewReceipt,
  type ApplicationPackageRecovery, type ApplicationPackageReadiness, type ApplicationPackageDetail,
  type ApplicationPackageHistory, type ApplicationPackageReviewHistory, type ApplicationPackageQueue,
  type ApplicationPackageNotification,
} from "./application-packages.ts";

type Audience = "student" | "staff";
type Operation = "submit" | "review";
type Result<K extends string, T> = Readonly<{ ok: true } & Record<K, T>> | ApplicationPackageFailureResult;
const failure = (reason: "invalid" | "forbidden" | "unavailable"): ApplicationPackageFailureResult => ({ ok: false, reason, resolution: "retain" });

function sameOwner(owner: ApplicationDocumentOwner, actor: ApplicationDocumentOwner) {
  return !!owner && !!uuid(owner.organizationId) && !!uuid(owner.membershipId)
    && owner.organizationId === actor.organizationId && owner.membershipId === actor.membershipId;
}
async function studentScope(scope: ApplicationDocumentScope, target: ApplicationPackageTarget) {
  const actor = await requireStudentPortalActor();
  return sameOwner(scope, actor) && scope.studentCaseId === actor.studentCaseId
    && target.studentCaseId === actor.studentCaseId && scope.applicationId === target.applicationId;
}
async function staffScope(owner: ApplicationDocumentOwner, permission: "document.read.full" | "document.upload" | "document.review") {
  const actor = await requirePlatformStaffActor();
  return sameOwner(owner, actor) && !isStaffPreview(actor) && staffHasPermission(actor, permission);
}
async function scopedRead(scope: ApplicationDocumentScope, target: ApplicationPackageTarget) {
  if (!scope || scope.studentCaseId !== target.studentCaseId || scope.applicationId !== target.applicationId) return false;
  const student = await resolveStudentPortalActor();
  if (student.status === "authenticated") return sameOwner(scope, student.actor) && student.actor.studentCaseId === target.studentCaseId;
  return staffScope(scope, "document.read.full");
}
async function refresh(target: ApplicationPackageTarget) {
  try {
    revalidatePath("/portal"); revalidatePath("/portal/notifications");
    revalidatePath(`/portal/preparations/${target.applicationId}`);
    revalidatePath("/v3/profile"); revalidatePath("/v3/admissions-pipeline");
  } catch { /* Cache refresh cannot change a validated command receipt. */ }
}

async function readiness(owner: ApplicationDocumentOwner | ApplicationDocumentScope, input: unknown, selectionsInput: unknown, audience: Audience): Promise<Result<"readiness", ApplicationPackageReadiness>> {
  try {
    const target = parseApplicationDocumentTarget(input), selections = parseApplicationPackageSelections(selectionsInput);
    if (!target || !selections) return failure("invalid");
    if (!(audience === "student" ? await studentScope(owner as ApplicationDocumentScope, target) : await staffScope(owner, "document.read.full"))) return failure("forbidden");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("application_package_readiness_v1", {
      p_student_case_id: target.studentCaseId, p_application_id: target.applicationId, p_selections: selections,
    });
    if (error) return applicationPackageFailure(error);
    const value = parseApplicationPackageReadiness(data, target);
    if (!value || value.selections.length !== selections.length || value.selections.some((item, index) => {
      const expected = selections[index];
      return item.requirementItemId !== expected.requirementItemId
        || item.expectedPreviousSubmissionId !== expected.expectedPreviousSubmissionId
        || item.selection.kind !== expected.selection.kind
        || item.selection.documentVersionId !== expected.selection.documentVersionId
        || (item.selection.kind === "program_upload" && expected.selection.kind === "program_upload"
          && item.selection.uploadContextId !== expected.selection.uploadContextId);
    })) return failure("unavailable");
    return { ok: true, readiness: value };
  } catch { return failure("unavailable"); }
}
export async function readStudentApplicationPackageReadinessAction(scope: ApplicationDocumentScope, target: unknown, selections: unknown = []) {
  return readiness(scope, target, selections, "student");
}
export async function readStaffApplicationPackageReadinessAction(owner: ApplicationDocumentOwner, target: unknown, selections: unknown = []) {
  return readiness(owner, target, selections, "staff");
}

async function submit(owner: ApplicationDocumentOwner | ApplicationDocumentScope, input: unknown, audience: Audience): Promise<Result<"receipt", ApplicationPackageSubmitReceipt>> {
  try {
    const intent = parseApplicationPackageSubmitIntent(input);
    if (!intent) return failure("invalid");
    if (!(audience === "student" ? await studentScope(owner as ApplicationDocumentScope, intent) : await staffScope(owner, "document.upload"))) return failure("forbidden");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("application_package_submit_v1", { p_intent: intent });
    if (error) return applicationPackageFailure(error);
    const receipt = parseApplicationPackageSubmitReceipt(data, intent);
    if (!receipt) return failure("unavailable");
    await refresh(intent);
    return { ok: true, receipt };
  } catch { return failure("unavailable"); }
}
export async function submitStudentApplicationPackageAction(scope: ApplicationDocumentScope, input: unknown) { return submit(scope, input, "student"); }
export async function submitStaffApplicationPackageAction(owner: ApplicationDocumentOwner, input: unknown) { return submit(owner, input, "staff"); }
export async function reviewApplicationPackageAction(owner: ApplicationDocumentOwner, input: unknown): Promise<Result<"receipt", ApplicationPackageReviewReceipt>> {
  try {
    const intent = parseApplicationPackageReviewIntent(input);
    if (!intent) return failure("invalid");
    if (!await staffScope(owner, "document.review")) return failure("forbidden");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("application_package_review_v1", { p_intent: intent });
    if (error) return applicationPackageFailure(error);
    const receipt = parseApplicationPackageReviewReceipt(data, intent);
    if (!receipt) return failure("unavailable");
    await refresh(intent);
    return { ok: true, receipt };
  } catch { return failure("unavailable"); }
}

async function recover(owner: ApplicationDocumentOwner | ApplicationDocumentScope, operation: Operation, input: unknown, audience: Audience): Promise<Result<"recovery", ApplicationPackageRecovery>> {
  try {
    if (operation !== "submit" && operation !== "review") return failure("invalid");
    const intent = operation === "submit" ? parseApplicationPackageSubmitIntent(input) : parseApplicationPackageReviewIntent(input);
    if (!intent) return failure("invalid");
    if (audience === "student" ? operation !== "submit" || !await studentScope(owner as ApplicationDocumentScope, intent)
      : !await staffScope(owner, operation === "submit" ? "document.upload" : "document.review")) return failure("forbidden");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("application_package_recover_v1", { p_operation: operation, p_intent: intent });
    if (error) return applicationPackageFailure(error);
    const recovery = parseApplicationPackageRecovery(data, operation, intent);
    if (!recovery) return failure("unavailable");
    if (recovery.status === "committed") await refresh(intent);
    return { ok: true, recovery };
  } catch { return failure("unavailable"); }
}
export async function recoverStudentApplicationPackageAction(scope: ApplicationDocumentScope, operation: Operation, input: unknown) { return recover(scope, operation, input, "student"); }
export async function recoverStaffApplicationPackageAction(owner: ApplicationDocumentOwner, operation: Operation, input: unknown) { return recover(owner, operation, input, "staff"); }

export async function readApplicationPackageDetailAction(scope: ApplicationDocumentScope, input: unknown, packageId: string): Promise<Result<"detail", ApplicationPackageDetail>> {
  try {
    const target = parseApplicationDocumentTarget(input);
    if (!target || !uuid(packageId)) return failure("invalid");
    if (!await scopedRead(scope, target)) return failure("forbidden");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("application_package_detail_v1", {
      p_student_case_id: target.studentCaseId, p_application_id: target.applicationId, p_package_id: packageId,
    });
    if (error) return applicationPackageFailure(error);
    const detail = parseApplicationPackageDetail(data, target, packageId);
    return detail ? { ok: true, detail } : failure("unavailable");
  } catch { return failure("unavailable"); }
}
export async function readApplicationPackageHistoryAction(scope: ApplicationDocumentScope, input: unknown, cursor: ApplicationDocumentCursor | null = null): Promise<Result<"history", ApplicationPackageHistory>> {
  try {
    const target = parseApplicationDocumentTarget(input);
    if (!target || (cursor !== null && !parseApplicationDocumentCursor(cursor))) return failure("invalid");
    if (!await scopedRead(scope, target)) return failure("forbidden");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("application_package_history_v1", {
      p_student_case_id: target.studentCaseId, p_application_id: target.applicationId, p_cursor: cursor, p_limit: 20,
    });
    if (error) return applicationPackageFailure(error);
    const history = parseApplicationPackageHistory(data, target);
    return history ? { ok: true, history } : failure("unavailable");
  } catch { return failure("unavailable"); }
}
export async function readApplicationPackageReviewHistoryAction(scope: ApplicationDocumentScope, input: unknown, packageId: string, cursor: ApplicationDocumentCursor | null = null): Promise<Result<"history", ApplicationPackageReviewHistory>> {
  try {
    const target = parseApplicationDocumentTarget(input);
    if (!target || !uuid(packageId) || (cursor !== null && !parseApplicationDocumentCursor(cursor))) return failure("invalid");
    if (!await scopedRead(scope, target)) return failure("forbidden");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("application_package_review_history_v1", {
      p_student_case_id: target.studentCaseId, p_application_id: target.applicationId, p_package_id: packageId, p_cursor: cursor, p_limit: 20,
    });
    if (error) return applicationPackageFailure(error);
    const history = parseApplicationPackageReviewHistory(data, target, packageId);
    return history ? { ok: true, history } : failure("unavailable");
  } catch { return failure("unavailable"); }
}
export async function readStaffApplicationPackageQueueAction(owner: ApplicationDocumentOwner, cursor: ApplicationDocumentCursor | null = null): Promise<Result<"queue", ApplicationPackageQueue>> {
  try {
    if (cursor !== null && !parseApplicationDocumentCursor(cursor)) return failure("invalid");
    if (!await staffScope(owner, "document.read.full")) return failure("forbidden");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("application_package_queue_v1", { p_cursor: cursor, p_limit: 20 });
    if (error) return applicationPackageFailure(error);
    const queue = parseApplicationPackageQueue(data);
    return queue ? { ok: true, queue } : failure("unavailable");
  } catch { return failure("unavailable"); }
}
export async function readStudentApplicationPackageNotificationAction(owner: ApplicationDocumentOwner, notificationId: string): Promise<Result<"notification", ApplicationPackageNotification>> {
  try {
    if (!uuid(notificationId)) return failure("invalid");
    const actor = await requireStudentPortalActor();
    if (!sameOwner(owner, actor)) return failure("forbidden");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("application_package_notification_v1", { p_notification_id: notificationId });
    if (error) return applicationPackageFailure(error);
    const notification = parseApplicationPackageNotification(data, notificationId, actor.studentCaseId);
    return notification ? { ok: true, notification } : failure("unavailable");
  } catch { return failure("unavailable"); }
}
