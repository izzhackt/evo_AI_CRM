"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requirePlatformCapability } from "@/lib/platform-guards";

import { exactActionStringFields } from "./action-form-fields";
import {
  CanonicalCrmRepositoryError,
  createCanonicalAdmissionsTask,
  transitionCanonicalAdmissionsTask,
} from "./canonical-crm-repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_DUE_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const CREATE_TASK_FORM_KEYS = [
  "details",
  "due_at",
  "request_id",
  "student_case_id",
  "title",
] as const;
const TRANSITION_TASK_FORM_KEYS = [
  "expected_version",
  "reason",
  "request_id",
  "task_id",
  "to_status",
] as const;

export type CanonicalAdmissionsTaskActionStatus =
  | "idle"
  | "saved"
  | "invalid"
  | "forbidden"
  | "stale"
  | "request_conflict"
  | "unavailable";

export type CanonicalAdmissionsTaskActionState = Readonly<{
  status: CanonicalAdmissionsTaskActionStatus;
  requestId: string;
  taskId: string | null;
  studentCaseId: string | null;
  taskStatus: "open" | "completed" | "cancelled" | null;
  version: number | null;
  changedAt: string | null;
}>;

type CreateTaskForm = Readonly<{
  details: string | null;
  dueAt: string | null;
  requestId: string;
  studentCaseId: string;
  title: string;
}>;

type TransitionTaskForm = Readonly<{
  expectedVersion: number;
  reason: string | null;
  requestId: string;
  taskId: string;
  toStatus: "completed" | "cancelled";
}>;

function normalizedText(
  value: string | undefined,
  maxLength: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (
    normalized.length > maxLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function dueAtTimestamp(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === "") return null;
  if (value.length > 40) return undefined;
  const match = TASK_DUE_TIMESTAMP_PATTERN.exec(value);
  if (!match) return undefined;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const calendarProbe = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarProbe.getUTCFullYear() !== year ||
    calendarProbe.getUTCMonth() !== month - 1 ||
    calendarProbe.getUTCDate() !== day ||
    Number(hourText) > 23 ||
    Number(minuteText) > 59 ||
    Number(secondText) > 59 ||
    (match[7] !== undefined && Number(match[7]) > 23) ||
    (match[8] !== undefined && Number(match[8]) > 59)
  ) {
    return undefined;
  }

  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime())
  ) {
    return undefined;
  }
  return date.toISOString();
}

function parseCreateTaskForm(form: FormData): CreateTaskForm | null {
  const fields = exactActionStringFields(form, CREATE_TASK_FORM_KEYS);
  if (!fields) return null;

  const requestId = fields.get("request_id")?.toLowerCase();
  const studentCaseId = fields.get("student_case_id")?.toLowerCase();
  const title = normalizedText(fields.get("title"), 200);
  const details = normalizedText(fields.get("details"), 2_000);
  const dueAt = dueAtTimestamp(fields.get("due_at"));

  if (
    !requestId ||
    !UUID_PATTERN.test(requestId) ||
    !studentCaseId ||
    !UUID_PATTERN.test(studentCaseId) ||
    !title ||
    details === undefined ||
    dueAt === undefined
  ) {
    return null;
  }

  return Object.freeze({
    details,
    dueAt,
    requestId,
    studentCaseId,
    title,
  });
}

function parseTransitionTaskForm(form: FormData): TransitionTaskForm | null {
  const fields = exactActionStringFields(form, TRANSITION_TASK_FORM_KEYS);
  if (!fields) return null;

  const requestId = fields.get("request_id")?.toLowerCase();
  const taskId = fields.get("task_id")?.toLowerCase();
  const expectedVersionValue = fields.get("expected_version");
  const expectedVersion =
    expectedVersionValue && /^\d+$/.test(expectedVersionValue)
      ? Number(expectedVersionValue)
      : Number.NaN;
  const toStatusValue = fields.get("to_status");
  const toStatus =
    toStatusValue === "completed" || toStatusValue === "cancelled"
      ? toStatusValue
      : null;
  const reason = normalizedText(fields.get("reason"), 2_000);

  if (
    !requestId ||
    !UUID_PATTERN.test(requestId) ||
    !taskId ||
    !UUID_PATTERN.test(taskId) ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1 ||
    !toStatus ||
    reason === undefined ||
    (toStatus === "completed" && reason !== null) ||
    (toStatus === "cancelled" && reason === null)
  ) {
    return null;
  }

  return Object.freeze({
    expectedVersion,
    reason,
    requestId,
    taskId,
    toStatus,
  });
}

function submittedRequestId(form: FormData): string | null {
  const candidates = [...form.entries()]
    .filter(([key]) => key === "request_id" || key === "_1_request_id")
    .map(([, value]) => value);
  if (candidates.length !== 1 || typeof candidates[0] !== "string") return null;
  const requestId = candidates[0].toLowerCase();
  return UUID_PATTERN.test(requestId) ? requestId : null;
}

function failureState(
  form: FormData,
  status: Exclude<CanonicalAdmissionsTaskActionStatus, "idle" | "saved">,
): CanonicalAdmissionsTaskActionState {
  const requestId = submittedRequestId(form) ?? randomUUID();
  return Object.freeze({
    status,
    requestId: status === "request_conflict" ? randomUUID() : requestId,
    taskId: null,
    studentCaseId: null,
    taskStatus: null,
    version: null,
    changedAt: null,
  });
}

function repositoryFailureState(
  form: FormData,
  error: unknown,
): CanonicalAdmissionsTaskActionState {
  if (!(error instanceof CanonicalCrmRepositoryError)) {
    return failureState(form, "unavailable");
  }

  const status: Exclude<
    CanonicalAdmissionsTaskActionStatus,
    "idle" | "saved"
  > = {
    invalid_input: "invalid",
    forbidden: "forbidden",
    not_found: "unavailable",
    conflict: "stale",
    idempotency_conflict: "request_conflict",
    gate_unsatisfied: "invalid",
    unavailable: "unavailable",
  }[error.code] as Exclude<
    CanonicalAdmissionsTaskActionStatus,
    "idle" | "saved"
  >;
  return failureState(form, status);
}

export async function createCanonicalAdmissionsTaskAction(
  _previous: CanonicalAdmissionsTaskActionState,
  form: FormData,
): Promise<CanonicalAdmissionsTaskActionState> {
  const actor = await requirePlatformCapability("admissions.write", "/clients");
  const input = parseCreateTaskForm(form);
  if (!input) return failureState(form, "invalid");

  try {
    const receipt = await createCanonicalAdmissionsTask({
      actorRole: actor.platformRole,
      idempotencyKey: input.requestId,
      correlationId: input.requestId,
      studentCaseId: input.studentCaseId,
      title: input.title,
      details: input.details,
      dueAt: input.dueAt,
    });

    revalidatePath("/tasks");
    revalidatePath("/clients");
    revalidatePath(`/clients/${receipt.studentCaseId}`);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      taskId: receipt.taskId,
      studentCaseId: receipt.studentCaseId,
      taskStatus: receipt.status,
      version: receipt.version,
      changedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    return repositoryFailureState(form, error);
  }
}

export async function transitionCanonicalAdmissionsTaskAction(
  _previous: CanonicalAdmissionsTaskActionState,
  form: FormData,
): Promise<CanonicalAdmissionsTaskActionState> {
  const actor = await requirePlatformCapability("admissions.write", "/clients");
  const input = parseTransitionTaskForm(form);
  if (!input) return failureState(form, "invalid");

  try {
    const receipt = await transitionCanonicalAdmissionsTask({
      actorRole: actor.platformRole,
      idempotencyKey: input.requestId,
      correlationId: input.requestId,
      taskId: input.taskId,
      expectedVersion: input.expectedVersion,
      toStatus: input.toStatus,
      reason: input.reason,
    });

    revalidatePath("/tasks");
    revalidatePath("/clients");
    revalidatePath(`/clients/${receipt.studentCaseId}`);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      taskId: receipt.taskId,
      studentCaseId: receipt.studentCaseId,
      taskStatus: receipt.status,
      version: receipt.version,
      changedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    return repositoryFailureState(form, error);
  }
}
