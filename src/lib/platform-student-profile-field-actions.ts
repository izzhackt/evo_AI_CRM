"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { isStaffPreview, staffHasPermission } from "./platform-access.ts";
import { requirePlatformStaffActor } from "./platform-guards";
import {
  normalizePlatformStudentProfileFieldReviewReceipt,
  normalizePlatformStudentProfileStartReceipt,
  parsePlatformReviewStudentProfileFieldCommand,
  parsePlatformStartStudentProfileCommand,
  platformStudentProfileFieldErrorOutcome,
  type PlatformStudentProfileFieldActionState,
  type PlatformStudentProfileFieldOutcome,
} from "./platform-student-profile-fields.ts";
import { createSupabaseServerClient } from "./supabase/server.ts";

function failure(status: PlatformStudentProfileFieldOutcome, requestId: string): PlatformStudentProfileFieldActionState {
  // Preserve a retry identity when the result may already have committed.
  return { status, requestId: status === "request_conflict" ? randomUUID() : requestId, studentProfileId: null, profileRevision: null };
}

function refreshProfile(): void {
  revalidatePath("/v3/profile");
  revalidatePath("/v3/main");
  revalidatePath("/portal");
}

export async function startPlatformStudentProfileAction(
  _previous: PlatformStudentProfileFieldActionState,
  form: FormData,
): Promise<PlatformStudentProfileFieldActionState> {
  const actor = await requirePlatformStaffActor();
  const command = parsePlatformStartStudentProfileCommand(form);
  const requestId = command?.requestId ?? randomUUID();
  if (isStaffPreview(actor) || !staffHasPermission(actor, "profile.manage")) return failure("forbidden", requestId);
  if (!command) return failure("invalid", requestId);
  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc("start_student_profile", {
      p_organization_id: actor.organizationId,
      p_student_case_id: command.studentCaseId,
      p_expected_profile_revision: command.expectedRevision,
      p_reason: command.reason,
      p_request_id: command.requestId,
    });
    if (response.error) return failure(platformStudentProfileFieldErrorOutcome(response.error), requestId);
    const receipt = normalizePlatformStudentProfileStartReceipt(response.data, actor.organizationId, command);
    if (!receipt) return failure("unavailable", requestId);
    refreshProfile();
    return { status: "saved", requestId: randomUUID(), ...receipt };
  } catch { return failure("unavailable", requestId); }
}

export async function reviewPlatformStudentProfileFieldAction(
  _previous: PlatformStudentProfileFieldActionState,
  form: FormData,
): Promise<PlatformStudentProfileFieldActionState> {
  const actor = await requirePlatformStaffActor();
  const command = parsePlatformReviewStudentProfileFieldCommand(form);
  const requestId = command?.requestId ?? randomUUID();
  if (isStaffPreview(actor) || !staffHasPermission(actor, "profile.manage")) return failure("forbidden", requestId);
  if (!command) return failure("invalid", requestId);
  try {
    const client = await createSupabaseServerClient();
    // No pre-read revision check: SQL checks authority, locks, replay and source
    // identity atomically, including an already-committed request retried later.
    const response = await client.schema("platform").rpc("review_student_profile_field", {
      p_organization_id: actor.organizationId,
      p_student_case_id: command.studentCaseId,
      p_field_key: command.fieldKey,
      p_decision: command.decision,
      p_value: command.value,
      p_proposal_id: command.proposalId,
      p_source_version_id: command.sourceVersionId,
      p_source_page: command.sourcePage,
      p_expected_revision: command.expectedRevision,
      p_reason: command.reason,
      p_request_id: command.requestId,
    });
    if (response.error) return failure(platformStudentProfileFieldErrorOutcome(response.error), requestId);
    const receipt = normalizePlatformStudentProfileFieldReviewReceipt(response.data, actor.organizationId, command);
    if (!receipt) return failure("unavailable", requestId);
    refreshProfile();
    return { status: "saved", requestId: randomUUID(), ...receipt };
  } catch { return failure("unavailable", requestId); }
}
