"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  PLATFORM_CASE_TASK_PRIORITIES,
  PLATFORM_CASE_TASK_STATUSES,
  type PlatformCaseTaskPriority,
  type PlatformCaseTaskStatus,
} from "./platform-admissions-task-contract.ts";
import { fixedRoleCan } from "./fixed-role-policy";
import { requirePlatformStaffActor } from "./platform-guards";
import { exactActionStringFields } from "./server/action-form-fields";
import { createSupabaseServerClient } from "./supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const LOCAL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const POSTGRES_BIGINT_MAX = "9223372036854775807";
const CREATE_TASK_FIELDS = [
  "student_case_id",
  "task_type",
  "title",
  "assignee_membership_id",
  "priority",
  "due_at",
  "status",
  "student_visible",
  "request_id",
  "expected_version",
] as const;
const CHANGE_TASK_FIELDS = [
  "student_case_id",
  "case_task_id",
  "status",
  "assignee_membership_id",
  "priority",
  "due_at",
  "student_visible",
  "request_id",
  "expected_version",
] as const;

export type PlatformAdmissionsActionStatus =
  | "idle"
  | "saved"
  | "invalid"
  | "forbidden"
  | "stale"
  | "request_conflict"
  | "unavailable";

export type PlatformAdmissionsTaskActionState = Readonly<{
  status: PlatformAdmissionsActionStatus;
  requestId: string;
  caseTaskId: string | null;
  version: string | null;
  changedAt: string | null;
}>;

type StringFields = ReadonlyMap<string, string>;

function field(fields: StringFields, key: string): string {
  return fields.get(key)?.trim() ?? "";
}

function uuid(value: string): string | null {
  return UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function text(value: string, maximum: number): string | null {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function oneOf<const T extends readonly string[]>(
  value: string,
  allowed: T,
): T[number] | null {
  return allowed.includes(value) ? value as T[number] : null;
}

function timestamp(value: string): string | null | undefined {
  if (!value) return null;
  const candidate = TIMESTAMPTZ_PATTERN.test(value)
    ? value
    : LOCAL_DATETIME_PATTERN.test(value)
      ? `${value}:00+06:00`
      : null;
  if (!candidate || !Number.isFinite(Date.parse(candidate))) return undefined;
  return new Date(candidate).toISOString();
}

function booleanValue(value: string): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function version(value: string, allowZero: boolean): string | null {
  if (!/^\d+$/.test(value)) return null;
  const normalized = value.replace(/^0+(?=\d)/, "");
  if (
    (!allowZero && normalized === "0") ||
    normalized.length > POSTGRES_BIGINT_MAX.length ||
    (normalized.length === POSTGRES_BIGINT_MAX.length &&
      normalized > POSTGRES_BIGINT_MAX)
  ) {
    return null;
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const normalizedExpected = [...expected].sort();
  return actual.length === normalizedExpected.length &&
    actual.every((key, index) => key === normalizedExpected[index]);
}

function sameTimestamp(value: unknown, expected: string | null): boolean {
  if (expected === null) return value === null;
  return typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    Date.parse(value) === Date.parse(expected);
}

function submittedRequestId(form: FormData): string | null {
  const direct = form.getAll("request_id");
  const enveloped = form.getAll("_1_request_id");
  const values = direct.length > 0 ? direct : enveloped;
  const candidate = values.length === 1 ? values[0] : null;
  return typeof candidate === "string" ? uuid(candidate.trim()) : null;
}

function errorStatus(error: unknown): Exclude<
  PlatformAdmissionsActionStatus,
  "idle" | "saved"
> {
  if (!isRecord(error)) return "unavailable";
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string"
    ? error.message.trim()
    : "";
  if (code === "42501") return "forbidden";
  if (code === "PT409" && message === "case_task_version_conflict") {
    return "stale";
  }
  if ((code === "22023" || code === "23505") && /request_id/i.test(message)) {
    return "request_conflict";
  }
  if (code === "22023") return "invalid";
  return "unavailable";
}

function failureState(
  form: FormData,
  status: Exclude<PlatformAdmissionsActionStatus, "idle" | "saved">,
  caseTaskId: string | null = null,
  verifiedRequestId?: string | null,
): PlatformAdmissionsTaskActionState {
  const requestId = verifiedRequestId ?? submittedRequestId(form);
  return Object.freeze({
    status,
    requestId: status === "request_conflict"
      ? randomUUID()
      : (requestId ?? randomUUID()),
    caseTaskId,
    version: null,
    changedAt: null,
  });
}

function revalidateAdmissions(studentCaseId: string): void {
  revalidatePath("/tasks");
  revalidatePath(`/clients/${studentCaseId}`);
  revalidatePath("/v3/calendar");
  revalidatePath("/v3/profile");
}

export async function createPlatformAdmissionsTaskAction(
  _previous: PlatformAdmissionsTaskActionState,
  form: FormData,
): Promise<PlatformAdmissionsTaskActionState> {
  const actor = await requirePlatformStaffActor();
  if (!fixedRoleCan(actor.authorityRole, "admissions.write")) {
    return failureState(form, "forbidden");
  }
  const fields = exactActionStringFields(form, CREATE_TASK_FIELDS);
  if (!fields) return failureState(form, "invalid");

  const studentCaseId = uuid(field(fields, "student_case_id"));
  const requestId = uuid(field(fields, "request_id"));
  const expectedVersion = version(field(fields, "expected_version"), true);
  const taskType = text(field(fields, "task_type"), 200);
  const title = text(field(fields, "title"), 1_000);
  const assigneeMembershipId = uuid(field(fields, "assignee_membership_id"));
  const priority = oneOf(
    field(fields, "priority"),
    PLATFORM_CASE_TASK_PRIORITIES,
  ) as PlatformCaseTaskPriority | null;
  const dueAt = timestamp(field(fields, "due_at"));
  const status = oneOf(
    field(fields, "status"),
    PLATFORM_CASE_TASK_STATUSES,
  ) as PlatformCaseTaskStatus | null;
  const studentVisible = booleanValue(field(fields, "student_visible"));
  if (
    !studentCaseId || !requestId || expectedVersion !== "0" || !taskType ||
    !title || !assigneeMembershipId || !priority || dueAt === undefined ||
    !status || status === "cancelled" || studentVisible === null
  ) {
    return failureState(form, "invalid", null, requestId);
  }

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc("create_case_task", {
      p_organization_id: actor.organizationId,
      p_student_case_id: studentCaseId,
      p_task_type: taskType,
      p_title: title,
      p_assignee_membership_id: assigneeMembershipId,
      p_priority: priority,
      p_due_at: dueAt,
      p_status: status,
      p_student_visible: studentVisible,
      p_request_id: requestId,
      p_expected_version: expectedVersion,
    });
    if (response.error) {
      return failureState(form, errorStatus(response.error), null, requestId);
    }
    const data = response.data;
    const caseTaskId = isRecord(data)
      ? uuid(String(data.case_task_id ?? ""))
      : null;
    const changedAt = isRecord(data) && typeof data.changed_at === "string" &&
        Number.isFinite(Date.parse(data.changed_at))
      ? new Date(data.changed_at).toISOString()
      : null;
    if (
      !isRecord(data) || !caseTaskId ||
      !hasExactKeys(data, [
        "organization_id", "case_task_id", "student_case_id", "task_type",
        "title", "assignee_membership_id", "priority", "due_at", "status",
        "student_visible", "expected_version", "version", "changed_at",
      ]) ||
      data.organization_id !== actor.organizationId ||
      data.student_case_id !== studentCaseId ||
      data.task_type !== taskType || data.title !== title ||
      data.assignee_membership_id !== assigneeMembershipId ||
      data.priority !== priority || !sameTimestamp(data.due_at, dueAt) ||
      data.status !== status || data.student_visible !== studentVisible ||
      data.expected_version !== "0" ||
      typeof data.version !== "string" ||
      version(data.version, false) !== "1" || !changedAt
    ) {
      return failureState(form, "unavailable", caseTaskId, requestId);
    }
    revalidateAdmissions(studentCaseId);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      caseTaskId,
      version: "1",
      changedAt,
    });
  } catch {
    return failureState(form, "unavailable", null, requestId);
  }
}

export async function changePlatformAdmissionsTaskAction(
  _previous: PlatformAdmissionsTaskActionState,
  form: FormData,
): Promise<PlatformAdmissionsTaskActionState> {
  const actor = await requirePlatformStaffActor();
  if (!fixedRoleCan(actor.authorityRole, "admissions.write")) {
    return failureState(form, "forbidden");
  }
  const fields = exactActionStringFields(form, CHANGE_TASK_FIELDS);
  if (!fields) return failureState(form, "invalid");

  const studentCaseId = uuid(field(fields, "student_case_id"));
  const caseTaskId = uuid(field(fields, "case_task_id"));
  const requestId = uuid(field(fields, "request_id"));
  const expectedVersion = version(field(fields, "expected_version"), false);
  const status = oneOf(
    field(fields, "status"),
    PLATFORM_CASE_TASK_STATUSES,
  ) as PlatformCaseTaskStatus | null;
  const assigneeMembershipId = uuid(field(fields, "assignee_membership_id"));
  const priority = oneOf(
    field(fields, "priority"),
    PLATFORM_CASE_TASK_PRIORITIES,
  ) as PlatformCaseTaskPriority | null;
  const dueAt = timestamp(field(fields, "due_at"));
  const studentVisible = booleanValue(field(fields, "student_visible"));
  if (
    !studentCaseId || !caseTaskId || !requestId || !expectedVersion || !status ||
    !assigneeMembershipId || !priority ||
    dueAt === undefined || studentVisible === null
  ) {
    return failureState(form, "invalid", caseTaskId, requestId);
  }

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc("change_case_task", {
      p_organization_id: actor.organizationId,
      p_case_task_id: caseTaskId,
      p_new_status: status,
      p_new_assignee_membership_id: assigneeMembershipId,
      p_priority: priority,
      p_due_at: dueAt,
      p_student_visible: studentVisible,
      p_expected_version: expectedVersion,
      p_request_id: requestId,
    });
    if (response.error) {
      return failureState(
        form,
        errorStatus(response.error),
        caseTaskId,
        requestId,
      );
    }
    const data = response.data;
    const nextVersion = isRecord(data) && typeof data.version === "string"
      ? version(data.version, false)
      : null;
    const changedAt = isRecord(data) && typeof data.changed_at === "string" &&
        Number.isFinite(Date.parse(data.changed_at))
      ? new Date(data.changed_at).toISOString()
      : null;
    if (
      !isRecord(data) ||
      !hasExactKeys(data, [
        "organization_id", "case_task_id", "student_case_id", "status",
        "assignee_membership_id", "priority", "due_at", "student_visible",
        "expected_version", "version", "changed_at",
      ]) ||
      data.organization_id !== actor.organizationId ||
      data.case_task_id !== caseTaskId || data.student_case_id !== studentCaseId ||
      data.status !== status || data.assignee_membership_id !== assigneeMembershipId ||
      data.priority !== priority || !sameTimestamp(data.due_at, dueAt) ||
      data.student_visible !== studentVisible || !nextVersion || !changedAt ||
      data.expected_version !== expectedVersion ||
      BigInt(nextVersion) !== BigInt(expectedVersion) + BigInt(1)
    ) {
      return failureState(form, "unavailable", caseTaskId, requestId);
    }
    revalidateAdmissions(studentCaseId);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      caseTaskId,
      version: nextVersion,
      changedAt,
    });
  } catch {
    return failureState(form, "unavailable", caseTaskId, requestId);
  }
}
