import "server-only";

import { exactActionStringFields } from "./server/action-form-fields.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTE_CONTROL_CHARACTER_PATTERN = /[\u0000-\u0009\u000b-\u001f\u007f]/;
const MAX_NOTE_BYTES = 1_000;

const SALES_FIELDS = ["lead_id", "note_text", "request_id"] as const;
const ADMISSIONS_FIELDS = [
  "student_case_id",
  "note_text",
  "request_id",
] as const;
const RECONCILE_FIELDS = [
  "attempt_id",
  "lead_id",
  "student_case_id",
  "workflow_scope",
] as const;

export type PlatformAmoCrmWorkflowScope =
  | "sales_pre_handoff"
  | "admissions_post_handoff";

export type PlatformAmoCrmSalesSyncForm = Readonly<{
  leadId: string;
  noteText: string;
  requestId: string;
}>;

export type PlatformAmoCrmAdmissionsSyncForm = Readonly<{
  studentCaseId: string;
  noteText: string;
  requestId: string;
}>;

export type PlatformAmoCrmReconcileForm = Readonly<{
  attemptId: string;
  leadId: string;
  studentCaseId: string | null;
  workflowScope: PlatformAmoCrmWorkflowScope;
}>;

function normalizedUuid(value: string | undefined): string | null {
  if (value === undefined || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function normalizedNote(value: string | undefined): string | null {
  if (value === undefined) return null;
  const noteText = value.trim();
  const byteLength = new TextEncoder().encode(noteText).byteLength;
  if (
    noteText.length < 1 ||
    byteLength < 1 ||
    byteLength > MAX_NOTE_BYTES ||
    NOTE_CONTROL_CHARACTER_PATTERN.test(noteText)
  ) {
    return null;
  }
  return noteText;
}

export function parsePlatformAmoCrmSalesSyncForm(
  form: FormData,
): PlatformAmoCrmSalesSyncForm | null {
  const fields = exactActionStringFields(form, SALES_FIELDS);
  if (fields === null) return null;
  const leadId = normalizedUuid(fields.get("lead_id"));
  const noteText = normalizedNote(fields.get("note_text"));
  const requestId = normalizedUuid(fields.get("request_id"));
  if (leadId === null || noteText === null || requestId === null) return null;
  return Object.freeze({ leadId, noteText, requestId });
}

export function parsePlatformAmoCrmAdmissionsSyncForm(
  form: FormData,
): PlatformAmoCrmAdmissionsSyncForm | null {
  const fields = exactActionStringFields(form, ADMISSIONS_FIELDS);
  if (fields === null) return null;
  const studentCaseId = normalizedUuid(fields.get("student_case_id"));
  const noteText = normalizedNote(fields.get("note_text"));
  const requestId = normalizedUuid(fields.get("request_id"));
  if (
    studentCaseId === null ||
    noteText === null ||
    requestId === null
  ) {
    return null;
  }
  return Object.freeze({ studentCaseId, noteText, requestId });
}

export function parsePlatformAmoCrmReconcileForm(
  form: FormData,
): PlatformAmoCrmReconcileForm | null {
  const fields = exactActionStringFields(form, RECONCILE_FIELDS);
  if (fields === null) return null;
  const attemptId = normalizedUuid(fields.get("attempt_id"));
  const leadId = normalizedUuid(fields.get("lead_id"));
  const workflowScope = fields.get("workflow_scope");
  const studentCaseId = normalizedUuid(fields.get("student_case_id"));
  if (
    attemptId === null ||
    leadId === null ||
    (workflowScope !== "sales_pre_handoff" &&
      workflowScope !== "admissions_post_handoff")
  ) {
    return null;
  }
  if (
    (workflowScope === "sales_pre_handoff" && studentCaseId !== null) ||
    (workflowScope === "admissions_post_handoff" && studentCaseId === null)
  ) {
    return null;
  }
  return Object.freeze({
    attemptId,
    leadId,
    studentCaseId,
    workflowScope,
  });
}
