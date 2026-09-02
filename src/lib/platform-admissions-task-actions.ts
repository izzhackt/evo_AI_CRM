"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  PLATFORM_CASE_TASK_PRIORITIES,
  PLATFORM_CASE_TASK_STATUSES,
  type PlatformCaseTaskPriority,
  type PlatformCaseTaskStatus,
} from "./platform-admissions-task-contract.ts";
import { requirePlatformCapability } from "./platform-guards";
import { createSupabaseServerClient } from "./supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const LOCAL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

type TaskMutationOutcome = "saved" | "invalid" | "unavailable";
type TaskMutationOperation = "create" | "change";

function field(form: FormData, key: string): string {
  const raw = form.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function hasExactFields(form: FormData, expected: readonly string[]): boolean {
  const actual = [...form.keys()]
    .filter((key) => !key.startsWith("$ACTION_"))
    .sort();
  const normalizedExpected = [...expected].sort();
  return actual.length === normalizedExpected.length &&
    actual.every((key, index) => key === normalizedExpected[index]);
}

function uuid(value: string): string | null {
  return UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function boundedText(
  form: FormData,
  key: string,
  maximum: number,
): string | null {
  const candidate = field(form, key);
  if (
    candidate.length < 1 ||
    candidate.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

function oneOf<const T extends readonly string[]>(
  value: string,
  allowed: T,
): T[number] | null {
  return allowed.includes(value) ? value as T[number] : null;
}

function optionalTimestamp(value: string): string | null | undefined {
  if (!value) return null;
  const timestamp = TIMESTAMPTZ_PATTERN.test(value)
    ? value
    : LOCAL_DATETIME_PATTERN.test(value)
      ? `${value}:00.000Z`
      : null;
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return undefined;
  return new Date(timestamp).toISOString();
}

function booleanValue(value: string): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
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

function taskRedirect(
  studentCaseId: string | null,
  returnToCase: boolean,
  outcome: TaskMutationOutcome,
  operation: TaskMutationOperation,
  requestId?: string | null,
  subjectId?: string | null,
): never {
  const path = returnToCase && studentCaseId
    ? `/clients/${studentCaseId}`
    : "/tasks";
  const params = new URLSearchParams({ task_result: outcome });
  if (outcome !== "saved" && requestId) {
    params.set("task_retry_request_id", requestId);
    params.set("task_retry_operation", operation);
    if (subjectId) params.set("task_subject_id", subjectId);
  }
  redirect(
    `${path}?${params.toString()}${returnToCase ? "#case-tasks" : ""}`,
  );
}

export async function createPlatformAdmissionsTaskAction(
  form: FormData,
): Promise<void> {
  const studentCaseId = uuid(field(form, "student_case_id"));
  const requestId = uuid(field(form, "request_id"));
  const returnToCaseValue = field(form, "return_to_case");
  const returnToCase = returnToCaseValue === "1";
  const actor = await requirePlatformCapability(
    "admissions.write",
    returnToCase ? "/clients" : "/tasks",
  );
  const taskType = boundedText(form, "task_type", 200);
  const title = boundedText(form, "title", 1_000);
  const assigneeMembershipId = uuid(field(form, "assignee_membership_id"));
  const priority = oneOf(
    field(form, "priority"),
    PLATFORM_CASE_TASK_PRIORITIES,
  ) as PlatformCaseTaskPriority | null;
  const dueAt = optionalTimestamp(field(form, "due_at"));
  const status = oneOf(
    field(form, "status"),
    PLATFORM_CASE_TASK_STATUSES,
  ) as PlatformCaseTaskStatus | null;
  const studentVisible = booleanValue(field(form, "student_visible"));

  if (
    !hasExactFields(form, [
      "student_case_id",
      "task_type",
      "title",
      "assignee_membership_id",
      "priority",
      "due_at",
      "status",
      "student_visible",
      "request_id",
      "return_to_case",
    ]) ||
    (returnToCaseValue !== "0" && returnToCaseValue !== "1") ||
    (actor.platformRole !== "admin" && actor.platformRole !== "admissions") ||
    !studentCaseId ||
    !requestId ||
    !taskType ||
    !title ||
    !assigneeMembershipId ||
    !priority ||
    dueAt === undefined ||
    !status ||
    studentVisible === null
  ) {
    taskRedirect(
      studentCaseId,
      returnToCase,
      "invalid",
      "create",
      requestId,
      studentCaseId,
    );
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
    });
    const data = response.data;
    if (
      response.error ||
      !isRecord(data) ||
      !hasExactKeys(data, [
        "organization_id",
        "case_task_id",
        "student_case_id",
        "task_type",
        "title",
        "assignee_membership_id",
        "priority",
        "due_at",
        "status",
        "student_visible",
      ]) ||
      data.organization_id !== actor.organizationId ||
      data.student_case_id !== studentCaseId ||
      typeof data.case_task_id !== "string" ||
      !uuid(data.case_task_id) ||
      data.task_type !== taskType ||
      data.title !== title ||
      data.assignee_membership_id !== assigneeMembershipId ||
      data.priority !== priority ||
      !sameTimestamp(data.due_at, dueAt) ||
      data.status !== status ||
      data.student_visible !== studentVisible
    ) {
      taskRedirect(
        studentCaseId,
        returnToCase,
        "unavailable",
        "create",
        requestId,
        studentCaseId,
      );
    }
  } catch {
    taskRedirect(
      studentCaseId,
      returnToCase,
      "unavailable",
      "create",
      requestId,
      studentCaseId,
    );
  }

  revalidatePath("/tasks");
  revalidatePath(`/clients/${studentCaseId}`);
  taskRedirect(studentCaseId, returnToCase, "saved", "create");
}

export async function changePlatformAdmissionsTaskAction(
  form: FormData,
): Promise<void> {
  const studentCaseId = uuid(field(form, "student_case_id"));
  const caseTaskId = uuid(field(form, "case_task_id"));
  const requestId = uuid(field(form, "request_id"));
  const returnToCaseValue = field(form, "return_to_case");
  const returnToCase = returnToCaseValue === "1";
  const actor = await requirePlatformCapability(
    "admissions.write",
    returnToCase ? "/clients" : "/tasks",
  );
  const status = oneOf(
    field(form, "status"),
    PLATFORM_CASE_TASK_STATUSES,
  ) as PlatformCaseTaskStatus | null;
  const assigneeMembershipId = uuid(field(form, "assignee_membership_id"));
  const priority = oneOf(
    field(form, "priority"),
    PLATFORM_CASE_TASK_PRIORITIES,
  ) as PlatformCaseTaskPriority | null;
  const dueAt = optionalTimestamp(field(form, "due_at"));
  const studentVisible = booleanValue(field(form, "student_visible"));

  if (
    !hasExactFields(form, [
      "student_case_id",
      "case_task_id",
      "status",
      "assignee_membership_id",
      "priority",
      "due_at",
      "student_visible",
      "request_id",
      "return_to_case",
    ]) ||
    (returnToCaseValue !== "0" && returnToCaseValue !== "1") ||
    (actor.platformRole !== "admin" && actor.platformRole !== "admissions") ||
    !studentCaseId ||
    !caseTaskId ||
    !requestId ||
    !status ||
    !assigneeMembershipId ||
    !priority ||
    dueAt === undefined ||
    studentVisible === null
  ) {
    taskRedirect(
      studentCaseId,
      returnToCase,
      "invalid",
      "change",
      requestId,
      caseTaskId,
    );
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
      p_request_id: requestId,
    });
    const data = response.data;
    if (
      response.error ||
      !isRecord(data) ||
      !hasExactKeys(data, [
        "organization_id",
        "case_task_id",
        "student_case_id",
        "status",
        "assignee_membership_id",
        "priority",
        "due_at",
        "student_visible",
      ]) ||
      data.organization_id !== actor.organizationId ||
      data.case_task_id !== caseTaskId ||
      data.student_case_id !== studentCaseId ||
      data.status !== status ||
      data.assignee_membership_id !== assigneeMembershipId ||
      data.priority !== priority ||
      !sameTimestamp(data.due_at, dueAt) ||
      data.student_visible !== studentVisible
    ) {
      taskRedirect(
        studentCaseId,
        returnToCase,
        "unavailable",
        "change",
        requestId,
        caseTaskId,
      );
    }
  } catch {
    taskRedirect(
      studentCaseId,
      returnToCase,
      "unavailable",
      "change",
      requestId,
      caseTaskId,
    );
  }

  revalidatePath("/tasks");
  revalidatePath(`/clients/${studentCaseId}`);
  taskRedirect(studentCaseId, returnToCase, "saved", "change");
}
