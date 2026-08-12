"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parsePlatformAdmissionsUuid } from "./platform-admissions";
import { isCurrentSubmittedPlatformDocumentVersion } from "./platform-document-review";
import { requirePlatformClientsActor } from "./platform-guards";
import { listPlatformStudentCaseDocuments } from "./platform-student-profile";
import { isPlatformP6BPortalNotificationsEnabled } from "./server/platform-p6b-portal-notifications";
import { createSupabaseServerClient } from "./supabase/server";

const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u001F\u007F]/;
const NEGATIVE_REVIEW_DECISIONS = ["correction_required", "rejected"] as const;
type NegativeReviewDecision = (typeof NEGATIVE_REVIEW_DECISIONS)[number];

function value(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function decisionFrom(form: FormData): NegativeReviewDecision | null {
  const candidate = value(form, "decision");
  return (NEGATIVE_REVIEW_DECISIONS as readonly string[]).includes(candidate)
    ? (candidate as NegativeReviewDecision)
    : null;
}

function reasonFrom(form: FormData): string | null {
  const candidate = value(form, "reason");
  return candidate.length >= 1 &&
    candidate.length <= 2000 &&
    !CONTROL_CHARACTER_PATTERN.test(candidate)
    ? candidate
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reviewRedirect(
  studentCaseId: string | null,
  outcome: "saved" | "invalid" | "unavailable",
): never {
  const path = studentCaseId ? `/clients/${studentCaseId}` : "/clients";
  redirect(`${path}?result=${outcome}#documents`);
}

export async function reviewPlatformDocumentVersionAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const studentCaseId = parsePlatformAdmissionsUuid(value(form, "student_case_id"));
  const documentVersionId = parsePlatformAdmissionsUuid(
    value(form, "document_version_id"),
  );
  const requestId = parsePlatformAdmissionsUuid(value(form, "request_id"));
  const decision = decisionFrom(form);
  const reason = reasonFrom(form);

  if (
    !isPlatformP6BPortalNotificationsEnabled() ||
    (actor.platformRole !== "admin" && actor.platformRole !== "curator") ||
    !studentCaseId ||
    !documentVersionId ||
    !requestId ||
    !decision ||
    !reason
  ) {
    reviewRedirect(studentCaseId, "invalid");
  }

  let caseDocuments;
  try {
    caseDocuments = await listPlatformStudentCaseDocuments(actor, studentCaseId);
  } catch {
    reviewRedirect(studentCaseId, "unavailable");
  }
  if (
    !isCurrentSubmittedPlatformDocumentVersion(
      caseDocuments,
      studentCaseId,
      documentVersionId,
    )
  ) {
    reviewRedirect(studentCaseId, "invalid");
  }

  let response: { data: unknown; error: unknown };
  try {
    const client = await createSupabaseServerClient();
    response = await client
      .schema("platform")
      .rpc("review_document_version_with_portal_notification_v1", {
        p_organization_id: actor.organizationId,
        p_document_version_id: documentVersionId,
        p_decision: decision,
        p_reason: reason,
        p_request_id: requestId,
      });
  } catch {
    reviewRedirect(studentCaseId, "unavailable");
  }

  if (
    response.error ||
    !isRecord(response.data) ||
    response.data.organization_id !== actor.organizationId ||
    response.data.student_case_id !== studentCaseId ||
    response.data.document_version_id !== documentVersionId ||
    !parsePlatformAdmissionsUuid(String(response.data.document_slot_id ?? "")) ||
    response.data.decision !== decision ||
    response.data.slot_status !== decision ||
    response.data.reason !== reason
  ) {
    reviewRedirect(studentCaseId, "unavailable");
  }

  revalidatePath(`/clients/${studentCaseId}`);
  revalidatePath("/portal", "layout");
  revalidatePath("/portal/notifications");
  reviewRedirect(studentCaseId, "saved");
}
