"use server";

/**
 * «Следующий шаг / Срок» — the one write of the «Студенты» queue backend
 * (migration 241, platform.set_case_next_action_v1). Form-action shape of
 * platform-case-coverage-actions.ts: exact fields, a request id the form
 * round-trips, Admin role preview never writes, and only the confirmed
 * receipt produces «сохранено». An unknown outcome keeps the same request id
 * so the retry replays the original write instead of making a second one.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { isStaffPreview, staffCan } from "./platform-access.ts";
import { requirePlatformStaffActor } from "./platform-guards";
import {
  PlatformCaseNextActionError,
  parseCaseNextActionInput,
  parseExpectedAdmissionsVersion,
  parseQueueUuid,
  setCaseNextAction,
  type CaseNextActionReceipt,
  type CaseNextActionStatus,
} from "./platform-student-case-queue";
import { exactActionStringFields } from "./server/action-form-fields";
import { caseNextActionOutcome } from "./v3/wording";

export type CaseNextActionActionState = Readonly<{
  status: "idle" | CaseNextActionStatus;
  requestId: string;
  /** Honest Russian outcome for the form; null while idle. */
  message: string | null;
  receipt: CaseNextActionReceipt | null;
}>;

const CASE_NEXT_ACTION_FIELDS = [
  "student_case_id",
  "expected_version",
  "next_action",
  "next_action_due_on",
  "request_id",
] as const;

function outcome(
  status: Exclude<CaseNextActionStatus, "saved">,
  requestId: string | null,
): CaseNextActionActionState {
  // A request id is bound only by a committed write; after a refusal the same
  // id is still unused, except when the RPC reports it was used differently.
  const next = status === "request_conflict" || requestId === null ? randomUUID() : requestId;
  return { status, requestId: next, message: caseNextActionOutcome(status), receipt: null };
}

export async function saveCaseNextActionAction(
  _previous: CaseNextActionActionState,
  form: FormData,
): Promise<CaseNextActionActionState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, CASE_NEXT_ACTION_FIELDS);
  const requestId = parseQueueUuid(fields?.get("request_id"));
  if (isStaffPreview(actor)) return outcome("preview", requestId);
  if (!staffCan(actor, "admissions.write")) return outcome("forbidden", requestId);
  const studentCaseId = parseQueueUuid(fields?.get("student_case_id"));
  const expectedVersion = parseExpectedAdmissionsVersion(fields?.get("expected_version"));
  const input = parseCaseNextActionInput(fields?.get("next_action"), fields?.get("next_action_due_on"));
  if (!fields || !requestId || !studentCaseId || expectedVersion === null || !input) {
    return outcome("invalid", requestId);
  }
  try {
    const receipt = await setCaseNextAction(actor, { ...input, studentCaseId, expectedVersion, requestId });
    revalidatePath("/v3/profile");
    return {
      status: "saved",
      requestId: randomUUID(),
      message: caseNextActionOutcome("saved", receipt.cleared),
      receipt,
    };
  } catch (error) {
    return outcome(error instanceof PlatformCaseNextActionError ? error.status : "unavailable", requestId);
  }
}
