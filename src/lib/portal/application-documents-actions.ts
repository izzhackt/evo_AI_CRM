"use server";

import { revalidatePath } from "next/cache";
import { requireStudentPortalActor } from "../student-portal-guards";
import { resolveStudentPortalActor } from "../student-portal-auth.ts";
import { requirePlatformStaffActor } from "../platform-guards";
import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import { createSupabaseServerClient } from "../supabase/server";
import { universityIntakeId as uuid } from "../platform-university-catalog.ts";
import {
  applicationDocumentFailure, parseApplicationDocuments, parseApplicationDocumentTarget, parseApplicationDocumentSubmitIntent, parseApplicationDocumentSubmitReceipt,
  parseApplicationDocumentReviewIntent, parseApplicationDocumentReviewReceipt, parseApplicationDocumentHistoryPage, parseApplicationDocumentReusableVersionsPage,
  parseApplicationDocumentQueuePage, parseApplicationDocumentCursor, parseApplicationDocumentVersionCursor,
  type ApplicationDocumentOwner, type ApplicationDocumentScope, type ApplicationDocumentTarget, type ApplicationDocuments,
  type ApplicationDocumentFailureResult, type ApplicationDocumentSubmitResult, type ApplicationDocumentReviewResult,
  type ApplicationDocumentHistoryPage, type ApplicationDocumentReusableVersionsPage, type ApplicationDocumentQueuePage,
  type ApplicationDocumentCursor, type ApplicationDocumentVersionCursor,
} from "./application-documents.ts";

const failure = (reason: "invalid" | "forbidden" | "unavailable"): ApplicationDocumentFailureResult => ({ ok: false, reason, resolution: "retain" });
function sameOwner(owner: ApplicationDocumentOwner, actor: ApplicationDocumentOwner) {
  return owner && uuid(owner.organizationId) && uuid(owner.membershipId) && owner.organizationId === actor.organizationId && owner.membershipId === actor.membershipId;
}
async function studentScope(scope: ApplicationDocumentScope, target: ApplicationDocumentTarget) {
  const actor = await requireStudentPortalActor();
  return sameOwner(scope, actor) && scope.studentCaseId === actor.studentCaseId && target.studentCaseId === actor.studentCaseId && scope.applicationId === target.applicationId;
}
async function staffScope(owner: ApplicationDocumentOwner, permission: "document.read.full" | "document.upload" | "document.review") {
  const actor = await requirePlatformStaffActor();
  return sameOwner(owner, actor) && !isStaffPreview(actor) && staffHasPermission(actor, permission);
}
async function scopedRead(scope: ApplicationDocumentScope, target: ApplicationDocumentTarget) {
  if (!scope || scope.studentCaseId !== target.studentCaseId || scope.applicationId !== target.applicationId) return false;
  const student = await resolveStudentPortalActor();
  if (student.status === "authenticated") return sameOwner(scope, student.actor) && student.actor.studentCaseId === target.studentCaseId;
  return staffScope(scope, "document.read.full");
}
async function refresh(target?: ApplicationDocumentTarget) {
  try { revalidatePath("/portal"); revalidatePath("/portal/documents"); revalidatePath("/v3/profile");
    if (target) revalidatePath(`/portal/preparations/${target.applicationId}`);
  } catch { /* A valid command receipt remains known success. */ }
}
async function readAction(owner: ApplicationDocumentOwner | ApplicationDocumentScope, input: unknown, audience: "student" | "staff"): Promise<Readonly<{ ok: true; documents: ApplicationDocuments }> | ApplicationDocumentFailureResult> {
  try {
    const target = parseApplicationDocumentTarget(input);
    if (!target) return failure("invalid");
    if (!(audience === "student" ? await studentScope(owner as ApplicationDocumentScope, target) : await staffScope(owner, "document.read.full"))) return failure("forbidden");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc(`${audience}_application_documents_v1`, { p_student_case_id: target.studentCaseId, p_application_id: target.applicationId });
    if (error) return applicationDocumentFailure(error);
    const documents = parseApplicationDocuments(data, target);
    return documents ? { ok: true, documents } : failure("unavailable");
  } catch { return failure("unavailable"); }
}
export async function readStudentApplicationDocumentsAction(scope: ApplicationDocumentScope, target: unknown) { return readAction(scope, target, "student"); }
export async function readStaffApplicationDocumentsAction(owner: ApplicationDocumentOwner, target: unknown) { return readAction(owner, target, "staff"); }
async function submit(owner: ApplicationDocumentOwner | ApplicationDocumentScope, input: unknown, audience: "student" | "staff"): Promise<ApplicationDocumentSubmitResult> {
  try {
    const intent = parseApplicationDocumentSubmitIntent(input);
    if (!intent) return failure("invalid");
    if (!(audience === "student" ? await studentScope(owner as ApplicationDocumentScope, intent) : await staffScope(owner, "document.upload"))) return failure("forbidden");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("submit_application_document_v1", {
      p_student_case_id: intent.studentCaseId, p_application_id: intent.applicationId, p_requirements_revision_id: intent.requirementsRevisionId,
      p_requirement_item_id: intent.requirementItemId, p_selection: intent.selection, p_expected_previous_submission_id: intent.expectedPreviousSubmissionId, p_request_id: intent.requestId,
    });
    if (error) return applicationDocumentFailure(error, "submit");
    const receipt = parseApplicationDocumentSubmitReceipt(data, intent);
    if (!receipt) return failure("unavailable");
    await refresh(intent);
    return { ok: true, receipt };
  } catch { return failure("unavailable"); }
}
export async function submitStudentApplicationDocumentAction(scope: ApplicationDocumentScope, input: unknown) { return submit(scope, input, "student"); }
export async function submitStaffApplicationDocumentAction(owner: ApplicationDocumentOwner, input: unknown) { return submit(owner, input, "staff"); }
export async function reviewApplicationDocumentSubmissionAction(owner: ApplicationDocumentOwner, input: unknown): Promise<ApplicationDocumentReviewResult> {
  try {
    const intent = parseApplicationDocumentReviewIntent(input);
    if (!intent) return failure("invalid");
    if (!await staffScope(owner, "document.review")) return failure("forbidden");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("review_application_document_submission_v1", {
      p_submission_id: intent.submissionId, p_expected_previous_review_id: intent.expectedPreviousReviewId,
      p_decision: intent.decision, p_reason: intent.reason, p_request_id: intent.requestId,
    });
    if (error) return applicationDocumentFailure(error, "review");
    const receipt = parseApplicationDocumentReviewReceipt(data, intent);
    if (!receipt) return failure("unavailable");
    await refresh();
    return { ok: true, receipt };
  } catch { return failure("unavailable"); }
}
export async function readApplicationDocumentHistoryAction(scope: ApplicationDocumentScope, target: ApplicationDocumentTarget & Readonly<{ requirementItemId?: string | null }>, cursor: ApplicationDocumentCursor | null = null): Promise<Readonly<{ ok: true; page: ApplicationDocumentHistoryPage }> | ApplicationDocumentFailureResult> {
  try {
    const parsed = parseApplicationDocumentTarget({ studentCaseId: target?.studentCaseId, applicationId: target?.applicationId }), item = target?.requirementItemId ?? null;
    if (!parsed || (item !== null && !uuid(item)) || (cursor !== null && !parseApplicationDocumentCursor(cursor))) return failure("invalid");
    if (!await scopedRead(scope, parsed)) return failure("forbidden");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("application_document_history_v1", { p_student_case_id: parsed.studentCaseId, p_application_id: parsed.applicationId, p_requirement_item_id: item, p_cursor: cursor, p_limit: 20 });
    if (error) return applicationDocumentFailure(error);
    const page = parseApplicationDocumentHistoryPage(data, parsed, item);
    return page ? { ok: true, page } : failure("unavailable");
  } catch { return failure("unavailable"); }
}
export async function readApplicationDocumentReusableVersionsAction(scope: ApplicationDocumentScope, target: ApplicationDocumentTarget & Readonly<{ requirementItemId: string }>, cursor: ApplicationDocumentVersionCursor | null = null): Promise<Readonly<{ ok: true; page: ApplicationDocumentReusableVersionsPage }> | ApplicationDocumentFailureResult> {
  try {
    const parsed = parseApplicationDocumentTarget({ studentCaseId: target?.studentCaseId, applicationId: target?.applicationId });
    if (!parsed || !uuid(target.requirementItemId) || (cursor !== null && !parseApplicationDocumentVersionCursor(cursor))) return failure("invalid");
    if (!await scopedRead(scope, parsed)) return failure("forbidden");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("application_document_reusable_versions_v1", { p_student_case_id: parsed.studentCaseId, p_application_id: parsed.applicationId, p_requirement_item_id: target.requirementItemId, p_cursor: cursor, p_limit: 20 });
    if (error) return applicationDocumentFailure(error);
    const page = parseApplicationDocumentReusableVersionsPage(data, parsed, target.requirementItemId);
    return page ? { ok: true, page } : failure("unavailable");
  } catch { return failure("unavailable"); }
}
export async function readStaffApplicationDocumentSubmissionQueueAction(owner: ApplicationDocumentOwner, cursor: ApplicationDocumentCursor | null = null): Promise<Readonly<{ ok: true; page: ApplicationDocumentQueuePage }> | ApplicationDocumentFailureResult> {
  try {
    if (cursor !== null && !parseApplicationDocumentCursor(cursor)) return failure("invalid");
    if (!await staffScope(owner, "document.read.full")) return failure("forbidden");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("staff_application_document_submission_queue_v1", { p_cursor: cursor, p_limit: 20 });
    if (error) return applicationDocumentFailure(error);
    const page = parseApplicationDocumentQueuePage(data);
    return page ? { ok: true, page } : failure("unavailable");
  } catch { return failure("unavailable"); }
}
