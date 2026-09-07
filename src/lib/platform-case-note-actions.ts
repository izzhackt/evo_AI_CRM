"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  createCaseNote,
  parsePlatformCaseNoteBody,
  parsePlatformCaseNoteSubject,
  parsePlatformCaseNoteUuid,
  PlatformCaseNoteMutationError,
  type PlatformCaseNoteCreateInput,
} from "./platform-case-notes";
import { requirePlatformStaffActor } from "./platform-guards";
import { exactActionStringFields } from "./server/action-form-fields";

const REQUEST_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CASE_NOTE_FORM_FIELDS = [
  "lead_id",
  "student_case_id",
  "body",
  "request_id",
] as const;

export type PlatformCaseNoteActionStatus =
  | "idle"
  | "saved"
  | "invalid"
  | "forbidden"
  | "request_conflict"
  | "unavailable";

export type PlatformCaseNoteActionState = Readonly<{
  status: PlatformCaseNoteActionStatus;
  requestId: string;
  caseNoteId: string | null;
  createdAt: string | null;
}>;

function parseInput(form: FormData): PlatformCaseNoteCreateInput | null {
  const fields = exactActionStringFields(form, CASE_NOTE_FORM_FIELDS);
  if (!fields) return null;

  const leadValue = fields.get("lead_id")?.trim() ?? "";
  const studentCaseValue = fields.get("student_case_id")?.trim() ?? "";
  const leadId = leadValue === "" ? null : parsePlatformCaseNoteUuid(leadValue);
  const studentCaseId = studentCaseValue === ""
    ? null
    : parsePlatformCaseNoteUuid(studentCaseValue);
  const subject = parsePlatformCaseNoteSubject({ leadId, studentCaseId });
  const body = parsePlatformCaseNoteBody(fields.get("body"));
  const requestIdValue = fields.get("request_id");
  const requestId =
    requestIdValue && REQUEST_UUID_PATTERN.test(requestIdValue)
      ? requestIdValue.toLowerCase()
      : null;

  if (
    (leadValue !== "" && leadId === null) ||
    (studentCaseValue !== "" && studentCaseId === null) ||
    !subject ||
    !body ||
    !requestId
  ) {
    return null;
  }

  return Object.freeze({ subject, body, requestId });
}

function submittedRequestId(form: FormData): string | null {
  const directValues = form.getAll("request_id");
  const envelopeValues = form.getAll("_1_request_id");
  const values = directValues.length > 0 ? directValues : envelopeValues;
  const value = values.length === 1 ? values[0] : null;
  return typeof value === "string" && REQUEST_UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function failureState(
  form: FormData,
  status: Exclude<PlatformCaseNoteActionStatus, "idle" | "saved">,
  verifiedRequestId?: string,
): PlatformCaseNoteActionState {
  const requestId = verifiedRequestId ?? submittedRequestId(form);
  return Object.freeze({
    status,
    requestId:
      status === "request_conflict" ? randomUUID() : (requestId ?? randomUUID()),
    caseNoteId: null,
    createdAt: null,
  });
}

export async function createCaseNoteAction(
  _previous: PlatformCaseNoteActionState,
  form: FormData,
): Promise<PlatformCaseNoteActionState> {
  const actor = await requirePlatformStaffActor();
  const input = parseInput(form);
  if (!input) return failureState(form, "invalid");

  try {
    const receipt = await createCaseNote(actor, input);
    revalidatePath("/v3/profile");
    if (receipt.leadId) {
      revalidatePath("/v3/pipeline");
      revalidatePath(`/v3/profile?id=${receipt.leadId}`);
    }
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      caseNoteId: receipt.caseNoteId,
      createdAt: receipt.createdAt,
    });
  } catch (error) {
    if (error instanceof PlatformCaseNoteMutationError) {
      return failureState(form, error.reason, input.requestId);
    }
    return failureState(form, "unavailable", input.requestId);
  }
}
