"use server";

import { revalidatePath } from "next/cache";

import { fixedRoleCan } from "./fixed-role-policy";
import { parsePlatformAdmissionsUuid } from "./platform-admissions";
import { requirePlatformStaffActor } from "./platform-guards";
import {
  getPlatformCaseDocumentWorkspace,
  PLATFORM_DOCUMENT_REVIEW_DECISIONS,
} from "./platform-private-documents";
import { exactActionStringFields } from "./server/action-form-fields";
import { createSupabaseServerClient } from "./supabase/server";

export type DocumentReviewOutcome =
  | "saved" | "invalid" | "forbidden" | "stale" | "request_conflict"
  | "file_unavailable" | "notification_unavailable" | "unavailable";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorOutcome(error: unknown): DocumentReviewOutcome {
  if (!record(error)) return "unavailable";
  const message = typeof error.message === "string" ? error.message : "";
  if ((error.code === "22023" || error.code === "23505") && /request_id/.test(message)) {
    return "request_conflict";
  }
  if (message === "Only the current submitted document version can be reviewed"
    || message === "Removed document slots are immutable"
    || error.code === "PT409") return "stale";
  if (message === "Student Portal notification publication is disabled"
    || message === "Negative document review requires one live Student Portal recipient") {
    return "notification_unavailable";
  }
  if (message === "Approval requires verified integrity and clean malware state"
    || message === "A verified ClamAV proof is required for approval") return "file_unavailable";
  if (error.code === "42501") return "forbidden";
  if (error.code === "22023") return "invalid";
  return "unavailable";
}

export async function reviewPlatformDocumentAction(form: FormData): Promise<DocumentReviewOutcome> {
  const actor = await requirePlatformStaffActor();
  if (!fixedRoleCan(actor.authorityRole, "documents.write")
    || actor.presentationRole !== actor.authorityRole) return "forbidden";

  const fields = exactActionStringFields(form, [
    "student_case_id", "document_slot_id", "document_version_id", "decision", "reason", "request_id",
  ]);
  if (!fields) return "invalid";
  const uuid = (key: string) => parsePlatformAdmissionsUuid(fields.get(key)?.trim() ?? "");
  const studentCaseId = uuid("student_case_id");
  const documentSlotId = uuid("document_slot_id");
  const documentVersionId = uuid("document_version_id");
  const requestId = uuid("request_id");
  const decision = fields.get("decision")?.trim() ?? "";
  const submittedReason = fields.get("reason") ?? "";
  // The existing Portal notification contract stores a plain, control-free reason.
  const reason = decision === "approved" ? null : submittedReason.trim().replace(/[\r\n\t]+/g, " ");
  if (!studentCaseId || !documentSlotId || !documentVersionId || !requestId
    || !PLATFORM_DOCUMENT_REVIEW_DECISIONS.some(value => value === decision)
    || submittedReason.length > 2000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(submittedReason)
    || (decision !== "approved" && !reason)) return "invalid";

  try {
    const client = await createSupabaseServerClient();
    const workspace = await getPlatformCaseDocumentWorkspace(actor, studentCaseId, { client });
    if (workspace.caseState !== "active") return "forbidden";
    // Bind the submitted references to this case using the authenticated projection.
    // Do not reject a past/current-reviewed version here: a confirmed command can
    // be replayed after a lost response, even if another upload has since arrived.
    // The RPC atomically rejects every NEW command against a non-current version.
    const slot = [...workspace.slots, ...workspace.removedSlots]
      .find(item => item.documentSlotId === documentSlotId);
    const version = slot?.versions.find(item => item.documentVersionId === documentVersionId);
    if (!slot || !version) return "forbidden";
    if (!version.storageFinalized) return "file_unavailable";

    const response = await client.schema("platform").rpc(
      decision === "approved" ? "review_document_version" : "review_document_version_with_portal_notification_v1",
      {
        p_organization_id: actor.organizationId,
        p_document_version_id: documentVersionId,
        p_decision: decision,
        p_reason: reason,
        p_request_id: requestId,
      },
    );
    if (response.error) return errorOutcome(response.error);
    const receipt = response.data;
    // This established RPC returns seven fields, without request_id or slot version.
    // Audit replay verifies the command identity inside the same DB transaction.
    if (!record(receipt) || Object.keys(receipt).length !== 7
      || receipt.organization_id !== actor.organizationId
      || receipt.student_case_id !== studentCaseId
      || receipt.document_slot_id !== documentSlotId
      || receipt.document_version_id !== documentVersionId
      || receipt.decision !== decision || receipt.slot_status !== decision
      || receipt.reason !== reason) return "unavailable";

    revalidatePath("/v3/profile");
    revalidatePath("/v3/main");
    revalidatePath("/v3/knowledge");
    revalidatePath("/portal");
    revalidatePath("/portal/documents");
    revalidatePath("/portal/notifications");
    return "saved";
  } catch {
    return "unavailable";
  }
}
