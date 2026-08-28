"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requirePlatformCapability } from "@/lib/platform-guards";

import { exactActionStringFields } from "./action-form-fields";
import {
  CanonicalCrmRepositoryError,
  assertCanonicalFinanceStop,
  createCanonicalUniversityApplication,
  releaseCanonicalFinanceStop,
  transitionCanonicalUniversityApplication,
  transitionCanonicalVisaMilestone,
  updateCanonicalUniversityApplication,
  type CanonicalUniversityApplicationStatus,
  type CanonicalVisaMilestoneStatus,
} from "./canonical-crm-repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

const CREATE_APPLICATION_FORM_KEYS = [
  "institution_name",
  "next_action",
  "next_action_at",
  "program_name",
  "request_id",
  "student_case_id",
  "target_intake",
] as const;
const UPDATE_APPLICATION_FORM_KEYS = [
  "application_id",
  "expected_version",
  "next_action",
  "next_action_at",
  "request_id",
] as const;
const TRANSITION_APPLICATION_FORM_KEYS = [
  "application_id",
  "expected_version",
  "reason",
  "request_id",
  "to_status",
] as const;
const TRANSITION_VISA_FORM_KEYS = [
  "due_at",
  "expected_version",
  "next_action",
  "next_action_at",
  "reason",
  "request_id",
  "to_status",
  "visa_milestone_id",
] as const;
const ASSERT_FINANCE_STOP_FORM_KEYS = [
  "expected_version",
  "reason",
  "request_id",
  "student_case_id",
] as const;
const RELEASE_FINANCE_STOP_FORM_KEYS = [
  "expected_version",
  "finance_stop_id",
  "reason",
  "request_id",
] as const;

export type CanonicalAdmissionsOperationsActionStatus =
  | "idle"
  | "saved"
  | "invalid"
  | "forbidden"
  | "stale"
  | "request_conflict"
  | "blocked"
  | "unavailable";

export type CanonicalAdmissionsOperationsActionState = Readonly<{
  status: CanonicalAdmissionsOperationsActionStatus;
  requestId: string;
  objectId: string | null;
  studentCaseId: string | null;
  objectStatus:
    | CanonicalUniversityApplicationStatus
    | CanonicalVisaMilestoneStatus
    | "stopped"
    | "released"
    | null;
  version: number | null;
  changedAt: string | null;
}>;

function normalizedText(
  value: string | undefined,
  maxLength: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (CONTROL_CHARACTER_PATTERN.test(value)) return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) return null;
  if (normalized.length > maxLength) return undefined;
  return normalized;
}

function normalizedUuid(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function parsedVersion(
  value: string | undefined,
  allowZero = false,
): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const version = Number(value);
  if (
    !Number.isSafeInteger(version) ||
    version < (allowZero ? 0 : 1)
  ) {
    return null;
  }
  return version;
}

function normalizedTimestamp(
  value: string | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === "") return null;
  if (value.length > 40) return undefined;
  const match = TIMESTAMP_PATTERN.exec(value);
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
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime())
    ? timestamp.toISOString()
    : undefined;
}

function submittedRequestId(form: FormData): string | null {
  const candidates = [
    ...form.getAll("request_id"),
    ...form.getAll("_1_request_id"),
  ];
  if (candidates.length !== 1 || typeof candidates[0] !== "string") return null;
  return normalizedUuid(candidates[0]);
}

function failureState(
  form: FormData,
  status: Exclude<CanonicalAdmissionsOperationsActionStatus, "idle" | "saved">,
): CanonicalAdmissionsOperationsActionState {
  const requestId = submittedRequestId(form) ?? randomUUID();
  return Object.freeze({
    status,
    requestId: status === "request_conflict" ? randomUUID() : requestId,
    objectId: null,
    studentCaseId: null,
    objectStatus: null,
    version: null,
    changedAt: null,
  });
}

function repositoryFailureState(
  form: FormData,
  error: unknown,
): CanonicalAdmissionsOperationsActionState {
  if (!(error instanceof CanonicalCrmRepositoryError)) {
    return failureState(form, "unavailable");
  }
  const status: Exclude<
    CanonicalAdmissionsOperationsActionStatus,
    "idle" | "saved"
  > = {
    invalid_input: "invalid",
    forbidden: "forbidden",
    not_found: "unavailable",
    conflict: "stale",
    idempotency_conflict: "request_conflict",
    gate_unsatisfied: "blocked",
    unavailable: "unavailable",
  }[error.code] as Exclude<
    CanonicalAdmissionsOperationsActionStatus,
    "idle" | "saved"
  >;
  return failureState(form, status);
}

function successState(input: Readonly<{
  objectId: string;
  studentCaseId: string;
  objectStatus: NonNullable<
    CanonicalAdmissionsOperationsActionState["objectStatus"]
  >;
  version: number;
}>): CanonicalAdmissionsOperationsActionState {
  return Object.freeze({
    status: "saved" as const,
    requestId: randomUUID(),
    objectId: input.objectId,
    studentCaseId: input.studentCaseId,
    objectStatus: input.objectStatus,
    version: input.version,
    changedAt: new Date().toISOString(),
  });
}

function revalidateApplication(studentCaseId: string): void {
  revalidatePath("/applications");
  revalidatePath("/clients");
  revalidatePath(`/clients/${studentCaseId}`);
}

function revalidateVisa(studentCaseId: string): void {
  revalidatePath("/visa");
  revalidatePath("/clients");
  revalidatePath(`/clients/${studentCaseId}`);
}

function revalidateFinance(studentCaseId: string): void {
  revalidatePath("/finance");
  revalidatePath("/applications");
  revalidatePath("/visa");
  revalidatePath("/clients");
  revalidatePath(`/clients/${studentCaseId}`);
}

export async function createCanonicalUniversityApplicationAction(
  _previous: CanonicalAdmissionsOperationsActionState,
  form: FormData,
): Promise<CanonicalAdmissionsOperationsActionState> {
  const actor = await requirePlatformCapability("admissions.write", "/clients");
  const fields = exactActionStringFields(form, CREATE_APPLICATION_FORM_KEYS);
  const requestId = normalizedUuid(fields?.get("request_id"));
  const studentCaseId = normalizedUuid(fields?.get("student_case_id"));
  const institutionName = normalizedText(fields?.get("institution_name"), 200);
  const programName = normalizedText(fields?.get("program_name"), 200);
  const targetIntake = normalizedText(fields?.get("target_intake"), 100);
  const nextAction = normalizedText(fields?.get("next_action"), 500);
  const nextActionAt = normalizedTimestamp(fields?.get("next_action_at"));
  if (
    !requestId ||
    !studentCaseId ||
    !institutionName ||
    !programName ||
    !targetIntake ||
    !nextAction ||
    !nextActionAt
  ) {
    return failureState(form, "invalid");
  }

  try {
    const result = await createCanonicalUniversityApplication({
      actorRole: actor.platformRole,
      idempotencyKey: requestId,
      correlationId: requestId,
      studentCaseId,
      institutionName,
      programName,
      targetIntake,
      nextAction,
      nextActionAt,
    });
    revalidateApplication(result.studentCaseId);
    return successState({
      objectId: result.applicationId,
      studentCaseId: result.studentCaseId,
      objectStatus: result.status,
      version: result.version,
    });
  } catch (error: unknown) {
    return repositoryFailureState(form, error);
  }
}

export async function updateCanonicalUniversityApplicationAction(
  _previous: CanonicalAdmissionsOperationsActionState,
  form: FormData,
): Promise<CanonicalAdmissionsOperationsActionState> {
  const actor = await requirePlatformCapability("admissions.write", "/clients");
  const fields = exactActionStringFields(form, UPDATE_APPLICATION_FORM_KEYS);
  const requestId = normalizedUuid(fields?.get("request_id"));
  const applicationId = normalizedUuid(fields?.get("application_id"));
  const expectedVersion = parsedVersion(fields?.get("expected_version"));
  const nextAction = normalizedText(fields?.get("next_action"), 500);
  const nextActionAt = normalizedTimestamp(fields?.get("next_action_at"));
  if (
    !requestId ||
    !applicationId ||
    expectedVersion === null ||
    !nextAction ||
    !nextActionAt
  ) {
    return failureState(form, "invalid");
  }

  try {
    const result = await updateCanonicalUniversityApplication({
      actorRole: actor.platformRole,
      idempotencyKey: requestId,
      correlationId: requestId,
      applicationId,
      expectedVersion,
      nextAction,
      nextActionAt,
    });
    revalidateApplication(result.studentCaseId);
    return successState({
      objectId: result.applicationId,
      studentCaseId: result.studentCaseId,
      objectStatus: result.status,
      version: result.version,
    });
  } catch (error: unknown) {
    return repositoryFailureState(form, error);
  }
}

export async function transitionCanonicalUniversityApplicationAction(
  _previous: CanonicalAdmissionsOperationsActionState,
  form: FormData,
): Promise<CanonicalAdmissionsOperationsActionState> {
  const actor = await requirePlatformCapability("admissions.write", "/clients");
  const fields = exactActionStringFields(form, TRANSITION_APPLICATION_FORM_KEYS);
  const requestId = normalizedUuid(fields?.get("request_id"));
  const applicationId = normalizedUuid(fields?.get("application_id"));
  const expectedVersion = parsedVersion(fields?.get("expected_version"));
  const toStatusValue = fields?.get("to_status");
  const toStatus =
    toStatusValue === "submitted" ||
    toStatusValue === "accepted" ||
    toStatusValue === "rejected" ||
    toStatusValue === "withdrawn"
      ? toStatusValue
      : null;
  const reason = normalizedText(fields?.get("reason"), 2_000);
  const needsReason = toStatus === "rejected" || toStatus === "withdrawn";
  if (
    !requestId ||
    !applicationId ||
    expectedVersion === null ||
    !toStatus ||
    reason === undefined ||
    (needsReason && reason === null) ||
    (!needsReason && reason !== null)
  ) {
    return failureState(form, "invalid");
  }

  try {
    const result = await transitionCanonicalUniversityApplication({
      actorRole: actor.platformRole,
      idempotencyKey: requestId,
      correlationId: requestId,
      applicationId,
      expectedVersion,
      toStatus,
      reason,
    });
    revalidateApplication(result.studentCaseId);
    return successState({
      objectId: result.applicationId,
      studentCaseId: result.studentCaseId,
      objectStatus: result.status,
      version: result.version,
    });
  } catch (error: unknown) {
    return repositoryFailureState(form, error);
  }
}

export async function transitionCanonicalVisaMilestoneAction(
  _previous: CanonicalAdmissionsOperationsActionState,
  form: FormData,
): Promise<CanonicalAdmissionsOperationsActionState> {
  const actor = await requirePlatformCapability("admissions.write", "/clients");
  const fields = exactActionStringFields(form, TRANSITION_VISA_FORM_KEYS);
  const requestId = normalizedUuid(fields?.get("request_id"));
  const visaMilestoneId = normalizedUuid(fields?.get("visa_milestone_id"));
  const expectedVersion = parsedVersion(fields?.get("expected_version"));
  const toStatusValue = fields?.get("to_status");
  const toStatus =
    toStatusValue === "in_progress" ||
    toStatusValue === "completed" ||
    toStatusValue === "blocked"
      ? toStatusValue
      : null;
  const reason = normalizedText(fields?.get("reason"), 2_000);
  const nextAction = normalizedText(fields?.get("next_action"), 500);
  const nextActionAt = normalizedTimestamp(fields?.get("next_action_at"));
  const dueAt = normalizedTimestamp(fields?.get("due_at"));
  if (
    !requestId ||
    !visaMilestoneId ||
    expectedVersion === null ||
    !toStatus ||
    reason === undefined ||
    nextAction === undefined ||
    nextActionAt === undefined ||
    dueAt === undefined ||
    (toStatus === "blocked" && reason === null) ||
    (toStatus !== "blocked" && reason !== null) ||
    (nextActionAt !== null && nextAction === null) ||
    (toStatus === "completed" &&
      (nextAction !== null || nextActionAt !== null))
  ) {
    return failureState(form, "invalid");
  }

  try {
    const result = await transitionCanonicalVisaMilestone({
      actorRole: actor.platformRole,
      idempotencyKey: requestId,
      correlationId: requestId,
      visaMilestoneId,
      expectedVersion,
      toStatus,
      reason,
      nextAction,
      nextActionAt,
      dueAt,
    });
    revalidateVisa(result.studentCaseId);
    return successState({
      objectId: result.visaMilestoneId,
      studentCaseId: result.studentCaseId,
      objectStatus: result.status,
      version: result.version,
    });
  } catch (error: unknown) {
    return repositoryFailureState(form, error);
  }
}

export async function assertCanonicalFinanceStopAction(
  _previous: CanonicalAdmissionsOperationsActionState,
  form: FormData,
): Promise<CanonicalAdmissionsOperationsActionState> {
  const actor = await requirePlatformCapability("admissions.write", "/clients");
  const fields = exactActionStringFields(form, ASSERT_FINANCE_STOP_FORM_KEYS);
  const requestId = normalizedUuid(fields?.get("request_id"));
  const studentCaseId = normalizedUuid(fields?.get("student_case_id"));
  const expectedVersion = parsedVersion(fields?.get("expected_version"), true);
  const reason = normalizedText(fields?.get("reason"), 2_000);
  if (
    !requestId ||
    !studentCaseId ||
    expectedVersion === null ||
    !reason
  ) {
    return failureState(form, "invalid");
  }

  try {
    const result = await assertCanonicalFinanceStop({
      actorRole: actor.platformRole,
      idempotencyKey: requestId,
      correlationId: requestId,
      studentCaseId,
      expectedVersion,
      reason,
    });
    revalidateFinance(result.studentCaseId);
    return successState({
      objectId: result.financeStopId,
      studentCaseId: result.studentCaseId,
      objectStatus: "stopped",
      version: result.version,
    });
  } catch (error: unknown) {
    return repositoryFailureState(form, error);
  }
}

export async function releaseCanonicalFinanceStopAction(
  _previous: CanonicalAdmissionsOperationsActionState,
  form: FormData,
): Promise<CanonicalAdmissionsOperationsActionState> {
  const actor = await requirePlatformCapability("admissions.write", "/clients");
  const fields = exactActionStringFields(form, RELEASE_FINANCE_STOP_FORM_KEYS);
  const requestId = normalizedUuid(fields?.get("request_id"));
  const financeStopId = normalizedUuid(fields?.get("finance_stop_id"));
  const expectedVersion = parsedVersion(fields?.get("expected_version"));
  const reason = normalizedText(fields?.get("reason"), 2_000);
  if (
    !requestId ||
    !financeStopId ||
    expectedVersion === null ||
    !reason
  ) {
    return failureState(form, "invalid");
  }

  try {
    const result = await releaseCanonicalFinanceStop({
      actorRole: actor.platformRole,
      idempotencyKey: requestId,
      correlationId: requestId,
      financeStopId,
      expectedVersion,
      reason,
    });
    revalidateFinance(result.studentCaseId);
    return successState({
      objectId: result.financeStopId,
      studentCaseId: result.studentCaseId,
      objectStatus: "released",
      version: result.version,
    });
  } catch (error: unknown) {
    return repositoryFailureState(form, error);
  }
}
