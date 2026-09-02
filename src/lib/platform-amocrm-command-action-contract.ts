import "server-only";

import { exactActionStringFields } from "./server/action-form-fields.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEXT_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_NOTE_BYTES = 1_000;
const MAX_TASK_BYTES = 1_000;

const SALES_FIELDS = [
  "lead_id",
  "note_text",
  "request_id",
  "task_text",
  "task_complete_till",
] as const;
const ADMISSIONS_FIELDS = [
  "student_case_id",
  "note_text",
  "request_id",
  "task_text",
  "task_complete_till",
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
  taskText: string;
  taskCompleteTill: number;
}>;

export type PlatformAmoCrmAdmissionsSyncForm = Readonly<{
  studentCaseId: string;
  noteText: string;
  requestId: string;
  taskText: string;
  taskCompleteTill: number;
}>;

export type PlatformAmoCrmReconcileForm = Readonly<{
  attemptId: string;
  leadId: string;
  studentCaseId: string | null;
  workflowScope: PlatformAmoCrmWorkflowScope;
}>;

export type PlatformAmoCrmFormParseOptions = Readonly<{
  now?: number | Date;
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
    TEXT_CONTROL_CHARACTER_PATTERN.test(noteText)
  ) {
    return null;
  }
  return noteText;
}

function normalizedTaskText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const taskText = value.trim();
  const byteLength = new TextEncoder().encode(taskText).byteLength;
  if (
    taskText.length < 1 ||
    byteLength < 1 ||
    byteLength > MAX_TASK_BYTES ||
    TEXT_CONTROL_CHARACTER_PATTERN.test(taskText)
  ) {
    return null;
  }
  return taskText;
}

function parseNowSeconds(options: PlatformAmoCrmFormParseOptions | undefined): number {
  const source = options?.now;
  const milliseconds =
    source === undefined
      ? Date.now()
      : typeof source === "number"
        ? source
        : source instanceof Date
          ? source.getTime()
          : Number.NaN;
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1_000) : Number.NaN;
}

function normalizedFutureUnix(
  value: string | undefined,
  options: PlatformAmoCrmFormParseOptions | undefined,
): number | null {
  if (value === undefined || !/^[1-9][0-9]{0,15}$/u.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return null;
  const nowSeconds = parseNowSeconds(options);
  if (!Number.isSafeInteger(nowSeconds)) return null;
  return parsed > nowSeconds ? parsed : null;
}

export function parsePlatformAmoCrmSalesSyncForm(
  form: FormData,
  options?: PlatformAmoCrmFormParseOptions,
): PlatformAmoCrmSalesSyncForm | null {
  const fields = exactActionStringFields(form, SALES_FIELDS);
  if (fields === null) return null;
  const leadId = normalizedUuid(fields.get("lead_id"));
  const noteText = normalizedNote(fields.get("note_text"));
  const requestId = normalizedUuid(fields.get("request_id"));
  const taskText = normalizedTaskText(fields.get("task_text"));
  const taskCompleteTill = normalizedFutureUnix(
    fields.get("task_complete_till"),
    options,
  );
  if (
    leadId === null ||
    noteText === null ||
    requestId === null ||
    taskText === null ||
    taskCompleteTill === null
  ) {
    return null;
  }
  return Object.freeze({
    leadId,
    noteText,
    requestId,
    taskText,
    taskCompleteTill,
  });
}

export function parsePlatformAmoCrmAdmissionsSyncForm(
  form: FormData,
  options?: PlatformAmoCrmFormParseOptions,
): PlatformAmoCrmAdmissionsSyncForm | null {
  const fields = exactActionStringFields(form, ADMISSIONS_FIELDS);
  if (fields === null) return null;
  const studentCaseId = normalizedUuid(fields.get("student_case_id"));
  const noteText = normalizedNote(fields.get("note_text"));
  const requestId = normalizedUuid(fields.get("request_id"));
  const taskText = normalizedTaskText(fields.get("task_text"));
  const taskCompleteTill = normalizedFutureUnix(
    fields.get("task_complete_till"),
    options,
  );
  if (
    studentCaseId === null ||
    noteText === null ||
    requestId === null ||
    taskText === null ||
    taskCompleteTill === null
  ) {
    return null;
  }
  return Object.freeze({
    studentCaseId,
    noteText,
    requestId,
    taskText,
    taskCompleteTill,
  });
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
