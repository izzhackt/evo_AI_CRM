"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePlatformStaffActor } from "./platform-guards";
import { exactActionStringFields } from "./server/action-form-fields";
import {
  HandoffResponseError, parseHandoffResponseInput, respondToHandoff,
  type HandoffResponseErrorReason,
} from "./platform-handoff-acknowledgement";

export type HandoffResponseActionState = Readonly<{
  status: "idle" | "saved" | HandoffResponseErrorReason;
  requestId: string;
  acknowledgementId: string | null;
  submittedContext: string | null;
}>;
const FIELDS = ["student_case_id", "assignment_event_id", "expected_acknowledgement_id",
  "decision", "clarification", "agreed_contact_date", "request_id"] as const;

export async function respondToHandoffAction(
  previous: HandoffResponseActionState, form: FormData,
): Promise<HandoffResponseActionState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, FIELDS);
  const input = fields ? parseHandoffResponseInput({
    studentCaseId: fields.get("student_case_id"), assignmentEventId: fields.get("assignment_event_id"),
    expectedAcknowledgementId: fields.get("expected_acknowledgement_id") || null,
    decision: fields.get("decision"), clarification: fields.get("clarification") || null,
    agreedContactDate: fields.get("agreed_contact_date") || null, requestId: fields.get("request_id"),
  }) : null;
  if (!input) return { status: "invalid", requestId: previous.requestId, acknowledgementId: null, submittedContext: null };
  const submittedContext = `${input.assignmentEventId}:${input.expectedAcknowledgementId ?? ""}`;
  try {
    const saved = await respondToHandoff(actor, input);
    revalidatePath("/v3/profile");
    return { status: "saved", requestId: randomUUID(), acknowledgementId: saved.acknowledgementId, submittedContext };
  } catch (error) {
    const status = error instanceof HandoffResponseError ? error.reason : "unavailable";
    return { status, requestId: status === "request_conflict" ? randomUUID() : input.requestId,
      acknowledgementId: null, submittedContext };
  }
}
