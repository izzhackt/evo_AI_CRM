"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePlatformCapability } from "./platform-guards";
import {
  PLATFORM_DOCUMENT_REVIEW_DECISIONS,
  type PlatformDocumentReviewDecision,
} from "./platform-private-documents";
import { createSupabaseServerClient } from "./supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function field(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function uuid(value: string): string | null {
  if (!UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === "00000000-0000-0000-0000-000000000000"
    ? null
    : normalized;
}

function exactForm(form: FormData, expected: readonly string[]): boolean {
  const keys = [...form.keys()]
    .filter((key) => !key.startsWith("$ACTION_"))
    .sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index]);
}

function boundedReason(value: string): string | null | undefined {
  if (!value) return null;
  return value.length <= 2000 && !CONTROL_CHARACTER_PATTERN.test(value)
    ? value
    : undefined;
}

function decision(value: string): PlatformDocumentReviewDecision | null {
  return (PLATFORM_DOCUMENT_REVIEW_DECISIONS as readonly string[]).includes(value)
    ? value as PlatformDocumentReviewDecision
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redirectToDocuments(
  studentCaseId: string | null,
  result: "saved" | "invalid" | "unavailable",
  requestId?: string | null,
  documentVersionId?: string | null,
): never {
  const path = studentCaseId ? `/clients/${studentCaseId}` : "/documents";
  const query = new URLSearchParams({ document_result: result });
  if (requestId && result !== "saved") {
    query.set("document_retry_request_id", requestId);
    if (documentVersionId) {
      query.set("document_retry_subject_id", documentVersionId);
    }
  }
  redirect(`${path}?${query.toString()}#case-documents`);
}

export async function reviewPlatformDocumentVersionAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformCapability(
    "documents.write",
    "/documents",
  );
  const studentCaseId = uuid(field(form, "student_case_id"));
  const documentVersionId = uuid(field(form, "document_version_id"));
  const reviewDecision = decision(field(form, "decision"));
  const reason = boundedReason(field(form, "reason"));
  const requestId = uuid(field(form, "request_id"));

  if (
    !exactForm(form, [
      "student_case_id",
      "document_version_id",
      "decision",
      "reason",
      "request_id",
    ])
    || !studentCaseId
    || !documentVersionId
    || !reviewDecision
    || reason === undefined
    || ((reviewDecision === "correction_required" || reviewDecision === "rejected")
      && !reason)
    || !requestId
  ) {
    redirectToDocuments(
      studentCaseId,
      "invalid",
      requestId,
      documentVersionId,
    );
  }

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "review_document_version",
      {
        p_organization_id: actor.organizationId,
        p_document_version_id: documentVersionId,
        p_decision: reviewDecision,
        p_reason: reason,
        p_request_id: requestId,
      },
    );
    const result = response.data;
    if (
      response.error
      || !isRecord(result)
      || Object.keys(result).sort().join("\n") !== [
        "decision",
        "document_slot_id",
        "document_version_id",
        "organization_id",
        "reason",
        "slot_status",
        "student_case_id",
      ].sort().join("\n")
      || result.organization_id !== actor.organizationId
      || result.student_case_id !== studentCaseId
      || result.document_version_id !== documentVersionId
      || result.decision !== reviewDecision
      || result.reason !== reason
      || result.slot_status !== reviewDecision
      || !uuid(String(result.document_slot_id ?? ""))
    ) {
      redirectToDocuments(
        studentCaseId,
        "unavailable",
        requestId,
        documentVersionId,
      );
    }
  } catch {
    redirectToDocuments(
      studentCaseId,
      "unavailable",
      requestId,
      documentVersionId,
    );
  }

  revalidatePath(`/clients/${studentCaseId}`);
  revalidatePath("/documents");
  redirectToDocuments(studentCaseId, "saved");
}
