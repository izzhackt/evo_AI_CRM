"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parsePlatformAdmissionsUuid } from "./platform-admissions.ts";
import { isCurrentSubmittedPlatformDocumentVersion } from "./platform-document-review.ts";
import { requirePlatformClientsActor } from "./platform-guards.ts";
import { listPlatformStudentCaseDocuments } from "./platform-student-profile.ts";
import { createSupabaseServerClient } from "./supabase/server.ts";

const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const TASK_STATUSES = [
  "open",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
] as const;
const DOCUMENT_REVIEW_DECISIONS = ["correction_required", "rejected"] as const;

type TaskPriority = (typeof TASK_PRIORITIES)[number];
type TaskStatus = (typeof TASK_STATUSES)[number];
type DocumentReviewDecision = (typeof DOCUMENT_REVIEW_DECISIONS)[number];

type CreateTaskInput = Readonly<{
  studentCaseId: string;
  taskType: string;
  title: string;
  assigneeMembershipId: string;
  priority: TaskPriority;
  dueAt: string | null;
  status: TaskStatus;
  studentVisible: boolean;
  requestId: string;
}>;

type ChangeTaskInput = Readonly<{
  studentCaseId: string;
  caseTaskId: string;
  assigneeMembershipId: string;
  priority: TaskPriority;
  dueAt: string | null;
  status: TaskStatus;
  studentVisible: boolean;
  requestId: string;
}>;

type AppendUpdateInput = Readonly<{
  studentCaseId: string;
  body: string;
  source: string;
  studentVisible: boolean;
  occurredAt: string;
  requestId: string;
}>;

type ReviewDocumentInput = Readonly<{
  studentCaseId: string;
  documentVersionId: string;
  decision: DocumentReviewDecision;
  reason: string;
  requestId: string;
}>;

function value(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function singleString(form: FormData, key: string): string | null {
  const values = form.getAll(key);
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  return values[0].trim();
}

function requiredUuid(form: FormData, key: string): string | null {
  return parsePlatformAdmissionsUuid(singleString(form, key));
}

function boundedText(
  form: FormData,
  key: string,
  minimum: number,
  maximum: number,
): string | null {
  const candidate = singleString(form, key);
  if (
    candidate === null ||
    candidate.length < minimum ||
    candidate.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

function optionalDate(form: FormData, key: string): string | null | undefined {
  const candidate = singleString(form, key);
  if (candidate === null) return undefined;
  if (!candidate) return null;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(candidate) ||
    Number.isNaN(new Date(`${candidate}T00:00:00Z`).getTime())
  ) {
    return undefined;
  }
  return candidate;
}

function requiredTimestamp(form: FormData, key: string): string | null {
  const candidate = singleString(form, key);
  if (
    candidate === null ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(candidate) ||
    !Number.isFinite(Date.parse(candidate))
  ) {
    return null;
  }
  return candidate;
}

function requiredBoolean(form: FormData, key: string): boolean | null {
  const candidate = singleString(form, key);
  if (candidate === "true") return true;
  if (candidate === "false") return false;
  return null;
}

function oneOf<const T extends readonly string[]>(
  value: string | null,
  allowed: T,
): T[number] | null {
  if (value === null || !allowed.includes(value)) return null;
  return value as T[number];
}

function redirectWithResult(
  studentCaseId: string | null,
  outcome: "saved" | "invalid" | "unavailable",
  anchor: "tasks" | "updates" | "documents",
  retryRequestId?: string | null,
): never {
  const path = studentCaseId ? `/clients/${studentCaseId}` : "/clients";
  const params = new URLSearchParams({ result: outcome });
  if (retryRequestId && outcome !== "saved") {
    params.set("retry_request_id", retryRequestId);
  }
  redirect(`${path}?${params.toString()}#${anchor}`);
}

function parseCreateTaskForm(form: FormData): CreateTaskInput | null {
  const studentCaseId = requiredUuid(form, "student_case_id");
  const taskType = boundedText(form, "task_type", 1, 100);
  const title = boundedText(form, "title", 1, 500);
  const assigneeMembershipId = requiredUuid(form, "assignee_membership_id");
  const priority = oneOf(singleString(form, "priority"), TASK_PRIORITIES);
  const dueAt = optionalDate(form, "due_at");
  const status = oneOf(singleString(form, "status"), TASK_STATUSES);
  const studentVisible = requiredBoolean(form, "student_visible");
  const requestId = requiredUuid(form, "request_id");
  if (
    !studentCaseId ||
    !taskType ||
    !title ||
    !assigneeMembershipId ||
    !priority ||
    dueAt === undefined ||
    !status ||
    studentVisible === null ||
    !requestId
  ) {
    return null;
  }
  return {
    studentCaseId,
    taskType,
    title,
    assigneeMembershipId,
    priority,
    dueAt,
    status,
    studentVisible,
    requestId,
  };
}

function parseChangeTaskForm(form: FormData): ChangeTaskInput | null {
  const studentCaseId = requiredUuid(form, "student_case_id");
  const caseTaskId = requiredUuid(form, "case_task_id");
  const assigneeMembershipId = requiredUuid(form, "assignee_membership_id");
  const priority = oneOf(singleString(form, "priority"), TASK_PRIORITIES);
  const dueAt = optionalDate(form, "due_at");
  const status = oneOf(singleString(form, "status"), TASK_STATUSES);
  const studentVisible = requiredBoolean(form, "student_visible");
  const requestId = requiredUuid(form, "request_id");
  if (
    !studentCaseId ||
    !caseTaskId ||
    !assigneeMembershipId ||
    !priority ||
    dueAt === undefined ||
    !status ||
    studentVisible === null ||
    !requestId
  ) {
    return null;
  }
  return {
    studentCaseId,
    caseTaskId,
    assigneeMembershipId,
    priority,
    dueAt,
    status,
    studentVisible,
    requestId,
  };
}

function parseAppendUpdateForm(form: FormData): AppendUpdateInput | null {
  const studentCaseId = requiredUuid(form, "student_case_id");
  const body = boundedText(form, "body", 1, 4_000);
  const source = boundedText(form, "source", 1, 100);
  const studentVisible = requiredBoolean(form, "student_visible");
  const occurredAt = requiredTimestamp(form, "occurred_at");
  const requestId = requiredUuid(form, "request_id");
  if (
    !studentCaseId ||
    !body ||
    !source ||
    studentVisible === null ||
    !occurredAt ||
    !requestId
  ) {
    return null;
  }
  return {
    studentCaseId,
    body,
    source,
    studentVisible,
    occurredAt,
    requestId,
  };
}

function parseReviewDocumentForm(form: FormData): ReviewDocumentInput | null {
  const studentCaseId = requiredUuid(form, "student_case_id");
  const documentVersionId = requiredUuid(form, "document_version_id");
  const decision = oneOf(singleString(form, "decision"), DOCUMENT_REVIEW_DECISIONS);
  const reason = boundedText(form, "reason", 1, 2_000);
  const requestId = requiredUuid(form, "request_id");
  if (
    !studentCaseId ||
    !documentVersionId ||
    !decision ||
    !reason ||
    !requestId
  ) {
    return null;
  }
  return {
    studentCaseId,
    documentVersionId,
    decision,
    reason,
    requestId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function createPlatformCaseTaskAction(form: FormData): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const input = parseCreateTaskForm(form);
  const retryRequestId = requiredUuid(form, "request_id") ?? randomUUID();
  if (!input) redirectWithResult(null, "invalid", "tasks", retryRequestId);

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc("create_case_task", {
      p_organization_id: actor.organizationId,
      p_student_case_id: input.studentCaseId,
      p_task_type: input.taskType,
      p_title: input.title,
      p_assignee_membership_id: input.assigneeMembershipId,
      p_priority: input.priority,
      p_due_at: input.dueAt ? `${input.dueAt}T00:00:00Z` : null,
      p_status: input.status,
      p_student_visible: input.studentVisible,
      p_request_id: input.requestId,
    });
    if (
      response.error ||
      !isRecord(response.data) ||
      parsePlatformAdmissionsUuid(response.data.organization_id) !== actor.organizationId ||
      parsePlatformAdmissionsUuid(response.data.student_case_id) !== input.studentCaseId ||
      !parsePlatformAdmissionsUuid(response.data.case_task_id) ||
      response.data.task_type !== input.taskType ||
      response.data.title !== input.title ||
      parsePlatformAdmissionsUuid(response.data.assignee_membership_id) !==
        input.assigneeMembershipId ||
      response.data.priority !== input.priority ||
      response.data.status !== input.status ||
      response.data.student_visible !== input.studentVisible
    ) {
      redirectWithResult(input.studentCaseId, "unavailable", "tasks", input.requestId);
    }
  } catch {
    redirectWithResult(input.studentCaseId, "unavailable", "tasks", input.requestId);
  }

  revalidatePath("/clients");
  revalidatePath(`/clients/${input.studentCaseId}`);
  redirectWithResult(input.studentCaseId, "saved", "tasks");
}

export async function changePlatformCaseTaskAction(form: FormData): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const input = parseChangeTaskForm(form);
  const retryRequestId = requiredUuid(form, "request_id") ?? randomUUID();
  if (!input) redirectWithResult(null, "invalid", "tasks", retryRequestId);

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc("change_case_task", {
      p_organization_id: actor.organizationId,
      p_case_task_id: input.caseTaskId,
      p_new_status: input.status,
      p_new_assignee_membership_id: input.assigneeMembershipId,
      p_priority: input.priority,
      p_due_at: input.dueAt ? `${input.dueAt}T00:00:00Z` : null,
      p_student_visible: input.studentVisible,
      p_request_id: input.requestId,
    });
    if (
      response.error ||
      !isRecord(response.data) ||
      parsePlatformAdmissionsUuid(response.data.organization_id) !== actor.organizationId ||
      parsePlatformAdmissionsUuid(response.data.student_case_id) !== input.studentCaseId ||
      parsePlatformAdmissionsUuid(response.data.case_task_id) !== input.caseTaskId ||
      parsePlatformAdmissionsUuid(response.data.assignee_membership_id) !==
        input.assigneeMembershipId ||
      response.data.priority !== input.priority ||
      response.data.status !== input.status ||
      response.data.student_visible !== input.studentVisible
    ) {
      redirectWithResult(input.studentCaseId, "unavailable", "tasks", input.requestId);
    }
  } catch {
    redirectWithResult(input.studentCaseId, "unavailable", "tasks", input.requestId);
  }

  revalidatePath("/clients");
  revalidatePath(`/clients/${input.studentCaseId}`);
  redirectWithResult(input.studentCaseId, "saved", "tasks");
}

export async function appendPlatformCaseUpdateAction(form: FormData): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const input = parseAppendUpdateForm(form);
  const retryRequestId = requiredUuid(form, "request_id") ?? randomUUID();
  if (!input) redirectWithResult(null, "invalid", "updates", retryRequestId);

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc("append_student_case_update", {
      p_organization_id: actor.organizationId,
      p_student_case_id: input.studentCaseId,
      p_body: input.body,
      p_source: input.source,
      p_student_visible: input.studentVisible,
      p_occurred_at: input.occurredAt,
      p_request_id: input.requestId,
    });
    if (
      response.error ||
      !isRecord(response.data) ||
      parsePlatformAdmissionsUuid(response.data.organization_id) !== actor.organizationId ||
      parsePlatformAdmissionsUuid(response.data.student_case_id) !== input.studentCaseId ||
      !parsePlatformAdmissionsUuid(response.data.student_case_update_id) ||
      response.data.body !== input.body ||
      response.data.source !== input.source ||
      response.data.student_visible !== input.studentVisible ||
      response.data.occurred_at !== input.occurredAt ||
      !parsePlatformAdmissionsUuid(response.data.author_membership_id)
    ) {
      redirectWithResult(input.studentCaseId, "unavailable", "updates", input.requestId);
    }
  } catch {
    redirectWithResult(input.studentCaseId, "unavailable", "updates", input.requestId);
  }

  revalidatePath("/clients");
  revalidatePath(`/clients/${input.studentCaseId}`);
  redirectWithResult(input.studentCaseId, "saved", "updates");
}

export async function reviewPlatformCaseDocumentVersionAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const input = parseReviewDocumentForm(form);
  const retryRequestId = requiredUuid(form, "request_id") ?? randomUUID();
  if (!input) redirectWithResult(null, "invalid", "documents", retryRequestId);

  let caseDocuments;
  try {
    caseDocuments = await listPlatformStudentCaseDocuments(actor, input.studentCaseId);
  } catch {
    redirectWithResult(
      input.studentCaseId,
      "unavailable",
      "documents",
      input.requestId,
    );
  }
  if (
    !caseDocuments.some((document) =>
      isCurrentSubmittedPlatformDocumentVersion(document, input.documentVersionId)
    )
  ) {
    redirectWithResult(input.studentCaseId, "invalid", "documents", input.requestId);
  }

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc("review_document_version", {
      p_organization_id: actor.organizationId,
      p_document_version_id: input.documentVersionId,
      p_decision: input.decision,
      p_reason: input.reason,
      p_request_id: input.requestId,
    });
    if (
      response.error ||
      !isRecord(response.data) ||
      parsePlatformAdmissionsUuid(response.data.organization_id) !== actor.organizationId ||
      parsePlatformAdmissionsUuid(response.data.student_case_id) !== input.studentCaseId ||
      parsePlatformAdmissionsUuid(response.data.document_version_id) !==
        input.documentVersionId ||
      !parsePlatformAdmissionsUuid(response.data.document_slot_id) ||
      response.data.decision !== input.decision ||
      response.data.reason !== input.reason ||
      response.data.slot_status !== input.decision
    ) {
      redirectWithResult(
        input.studentCaseId,
        "unavailable",
        "documents",
        input.requestId,
      );
    }
  } catch {
    redirectWithResult(input.studentCaseId, "unavailable", "documents", input.requestId);
  }

  revalidatePath("/clients");
  revalidatePath(`/clients/${input.studentCaseId}`);
  redirectWithResult(input.studentCaseId, "saved", "documents", null);
}
