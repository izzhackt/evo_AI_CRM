import type { PlatformActor } from "./platform-auth";
import { parsePlatformAdmissionsUuid } from "./platform-admissions";
import {
  PLATFORM_CASE_TASK_PRIORITIES,
  PLATFORM_CASE_TASK_STATUSES,
  type PlatformAdmissionsTask,
  type PlatformAdmissionsTaskAssignee,
  type PlatformAdmissionsTaskQueue,
  type PlatformAdmissionsTaskQueueRow,
  type PlatformAdmissionsTaskWorkspace,
  type PlatformCaseTaskPriority,
  type PlatformCaseTaskStatus,
} from "./platform-admissions-task-contract.ts";
import {
  PLATFORM_VISA_STATUSES,
  type PlatformVisaStatus,
} from "./platform-case-operations-contract.ts";
import {
  DATABASE_STAFF_ROLES,
  databaseRoleToInterfaceRole,
  type DatabaseStaffRole,
} from "./supabase/platform-authority";

const SAFE_REPOSITORY_ERROR_MESSAGE =
  "Platform Admissions workspace data is unavailable.";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_CASE_TASKS = 1_000;
const MAX_ASSIGNEES = 100;
const DEFAULT_QUEUE_PAGE_SIZE = 50;
const MAX_QUEUE_PAGE_SIZE = 100;
const POSTGRES_BIGINT_MAX = "9223372036854775807";

export type PlatformAdmissionsVisaQueueRow = Readonly<{
  sortAt: string;
  organizationId: string;
  visaCaseId: string;
  version: string;
  studentCaseId: string;
  studentDisplayName: string;
  caseState: "active" | "closed";
  status: PlatformVisaStatus;
  latestEvidenceReference: string | null;
  createdByMembershipId: string;
  createdByDisplayName: string;
  createdAt: string;
  updatedAt: string;
}>;

export type PlatformAdmissionsVisaQueue = Readonly<{
  rows: readonly PlatformAdmissionsVisaQueueRow[];
  hasNext: boolean;
}>;

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;

export type PlatformAdmissionsWorkspaceRpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (
      functionName: string,
      args?: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ) => PromiseLike<RpcResponse>;
  }>;
}>;

export type PlatformAdmissionsWorkspaceDependencies = Readonly<{
  client?: PlatformAdmissionsWorkspaceRpcClient;
}>;

export class PlatformAdmissionsWorkspaceRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformAdmissionsWorkspaceRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformAdmissionsWorkspaceRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformAdmissionsWorkspaceRepositoryError) throw error;
  return invalidShape();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) return invalidShape();
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    return invalidShape();
  }
  return value;
}

function requiredUuid(value: unknown): string {
  return parsePlatformAdmissionsUuid(value) ?? invalidShape();
}

function requiredText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > maximum
  ) {
    return invalidShape();
  }
  return value;
}

function optionalText(value: unknown, maximum: number): string | null {
  return value === null ? null : requiredText(value, maximum);
}

function requiredTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return invalidShape();
  }
  return value;
}

function optionalTimestamp(value: unknown): string | null {
  return value === null ? null : requiredTimestamp(value);
}

function positiveBigint(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value) ||
    value.length > POSTGRES_BIGINT_MAX.length ||
    (value.length === POSTGRES_BIGINT_MAX.length &&
      value > POSTGRES_BIGINT_MAX)
  ) {
    return invalidShape();
  }
  return value;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    return invalidShape();
  }
  return value as T[number];
}

function databaseRole(value: unknown): DatabaseStaffRole {
  return oneOf(value, DATABASE_STAFF_ROLES);
}

function requireAdmissionsActor(actor: PlatformActor): string {
  if (actor.platformRole !== "admin" && actor.platformRole !== "admissions") {
    return invalidShape();
  }
  return requiredUuid(actor.organizationId);
}

function normalizedPageSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_QUEUE_PAGE_SIZE;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_QUEUE_PAGE_SIZE
  ) {
    return invalidShape();
  }
  return value;
}

async function getPlatformClient(): Promise<PlatformAdmissionsWorkspaceRpcClient> {
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient();
}

function normalizeTaskFields(
  row: Record<string, unknown>,
): Readonly<{
  caseTaskId: string;
  version: string;
  taskType: string;
  title: string;
  status: PlatformCaseTaskStatus;
  priority: PlatformCaseTaskPriority;
  dueAt: string | null;
  studentVisible: boolean;
  assigneeMembershipId: string;
  assigneeDisplayName: string;
  createdAt: string;
  updatedAt: string;
}> {
  if (typeof row.student_visible !== "boolean") return invalidShape();
  return Object.freeze({
    caseTaskId: requiredUuid(row.case_task_id),
    version: positiveBigint(row.version),
    taskType: requiredText(row.task_type, 200),
    title: requiredText(row.title, 1_000),
    status: oneOf(row.status, PLATFORM_CASE_TASK_STATUSES),
    priority: oneOf(row.priority, PLATFORM_CASE_TASK_PRIORITIES),
    dueAt: optionalTimestamp(row.due_at),
    studentVisible: row.student_visible,
    assigneeMembershipId: requiredUuid(row.assignee_membership_id),
    assigneeDisplayName: requiredText(row.assignee_display_name, 200),
    createdAt: requiredTimestamp(row.created_at),
    updatedAt: requiredTimestamp(row.updated_at),
  });
}

export function normalizePlatformAdmissionsTaskQueueRow(
  value: unknown,
  expectedOrganizationId: string,
): PlatformAdmissionsTaskQueueRow {
  const row = exactRecord(value, [
    "sort_at",
    "organization_id",
    "case_task_id",
    "version",
    "student_case_id",
    "student_display_name",
    "case_state",
    "task_type",
    "title",
    "status",
    "priority",
    "due_at",
    "student_visible",
    "assignee_membership_id",
    "assignee_display_name",
    "created_at",
    "updated_at",
  ]);
  const organizationId = requiredUuid(row.organization_id);
  const normalizedExpectedOrganizationId = requiredUuid(expectedOrganizationId);
  const task = normalizeTaskFields(row);
  const sortAt = requiredTimestamp(row.sort_at);
  if (
    organizationId !== normalizedExpectedOrganizationId ||
    Date.parse(sortAt) !== Date.parse(task.updatedAt)
  ) {
    return invalidShape();
  }
  return Object.freeze({
    sortAt,
    organizationId,
    caseTaskId: task.caseTaskId,
    version: task.version,
    studentCaseId: requiredUuid(row.student_case_id),
    studentDisplayName: requiredText(row.student_display_name, 200),
    caseState: oneOf(row.case_state, ["active", "closed"] as const),
    taskType: task.taskType,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt,
    studentVisible: task.studentVisible,
    assigneeMembershipId: task.assigneeMembershipId,
    assigneeDisplayName: task.assigneeDisplayName,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  });
}

function normalizeWorkspaceTask(
  value: unknown,
  organizationId: string,
  studentCaseId: string,
): PlatformAdmissionsTask {
  const row = exactRecord(value, [
    "case_task_id",
    "version",
    "task_type",
    "title",
    "status",
    "priority",
    "due_at",
    "student_visible",
    "assignee_membership_id",
    "assignee_display_name",
    "creator_membership_id",
    "creator_display_name",
    "created_at",
    "updated_at",
  ]);
  const task = normalizeTaskFields(row);
  return Object.freeze({
    organizationId,
    caseTaskId: task.caseTaskId,
    version: task.version,
    studentCaseId,
    taskType: task.taskType,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt,
    studentVisible: task.studentVisible,
    assigneeMembershipId: task.assigneeMembershipId,
    assigneeDisplayName: task.assigneeDisplayName,
    creatorMembershipId: requiredUuid(row.creator_membership_id),
    creatorDisplayName: requiredText(row.creator_display_name, 200),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  });
}

function normalizeAssignee(value: unknown): PlatformAdmissionsTaskAssignee {
  const row = exactRecord(value, ["membership_id", "display_name", "role"]);
  return Object.freeze({
    membershipId: requiredUuid(row.membership_id),
    displayName: requiredText(row.display_name, 200),
    role: databaseRoleToInterfaceRole(databaseRole(row.role)),
  });
}

export function normalizePlatformAdmissionsTaskWorkspace(
  value: unknown,
  expectedOrganizationId: string,
  expectedStudentCaseId: string,
): PlatformAdmissionsTaskWorkspace {
  const row = exactRecord(value, [
    "organization_id",
    "student_case_id",
    "tasks",
    "assignees",
  ]);
  const organizationId = requiredUuid(row.organization_id);
  const studentCaseId = requiredUuid(row.student_case_id);
  if (
    organizationId !== requiredUuid(expectedOrganizationId) ||
    studentCaseId !== requiredUuid(expectedStudentCaseId) ||
    !Array.isArray(row.tasks) ||
    row.tasks.length > MAX_CASE_TASKS ||
    !Array.isArray(row.assignees) ||
    row.assignees.length > MAX_ASSIGNEES
  ) {
    return invalidShape();
  }

  const taskIds = new Set<string>();
  const tasks = row.tasks.map((item) => {
    const task = normalizeWorkspaceTask(item, organizationId, studentCaseId);
    if (taskIds.has(task.caseTaskId)) return invalidShape();
    taskIds.add(task.caseTaskId);
    return task;
  });
  const assigneeIds = new Set<string>();
  const assignees = row.assignees.map((item) => {
    const assignee = normalizeAssignee(item);
    if (assigneeIds.has(assignee.membershipId)) return invalidShape();
    assigneeIds.add(assignee.membershipId);
    return assignee;
  });

  return Object.freeze({
    organizationId,
    studentCaseId,
    tasks: Object.freeze(tasks),
    assignees: Object.freeze(assignees),
  });
}

export function normalizePlatformAdmissionsVisaQueueRow(
  value: unknown,
  expectedOrganizationId: string,
): PlatformAdmissionsVisaQueueRow {
  const row = exactRecord(value, [
    "sort_at",
    "organization_id",
    "visa_case_id",
    "version",
    "student_case_id",
    "student_display_name",
    "case_state",
    "status",
    "latest_evidence_reference",
    "created_by_membership_id",
    "created_by_display_name",
    "created_at",
    "updated_at",
  ]);
  const organizationId = requiredUuid(row.organization_id);
  const sortAt = requiredTimestamp(row.sort_at);
  const updatedAt = requiredTimestamp(row.updated_at);
  if (
    organizationId !== requiredUuid(expectedOrganizationId) ||
    Date.parse(sortAt) !== Date.parse(updatedAt)
  ) {
    return invalidShape();
  }
  return Object.freeze({
    sortAt,
    organizationId,
    visaCaseId: requiredUuid(row.visa_case_id),
    version: positiveBigint(row.version),
    studentCaseId: requiredUuid(row.student_case_id),
    studentDisplayName: requiredText(row.student_display_name, 200),
    caseState: oneOf(row.case_state, ["active", "closed"] as const),
    status: oneOf(row.status, PLATFORM_VISA_STATUSES),
    latestEvidenceReference: optionalText(
      row.latest_evidence_reference,
      1_000,
    ),
    createdByMembershipId: requiredUuid(row.created_by_membership_id),
    createdByDisplayName: requiredText(row.created_by_display_name, 200),
    createdAt: requiredTimestamp(row.created_at),
    updatedAt,
  });
}

export async function getPlatformAdmissionsTaskWorkspace(
  actor: PlatformActor,
  studentCaseId: string,
  dependencies: PlatformAdmissionsWorkspaceDependencies = {},
): Promise<PlatformAdmissionsTaskWorkspace> {
  try {
    const organizationId = requireAdmissionsActor(actor);
    const normalizedStudentCaseId = requiredUuid(studentCaseId);
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_student_case_task_workspace",
      { p_student_case_id: normalizedStudentCaseId },
      { get: true },
    );
    if (response.error) return invalidShape();
    return normalizePlatformAdmissionsTaskWorkspace(
      response.data,
      organizationId,
      normalizedStudentCaseId,
    );
  } catch (error) {
    return failClosed(error);
  }
}

export async function listPlatformAdmissionsTaskQueue(
  actor: PlatformActor,
  options: Readonly<{ pageSize?: number }> = {},
  dependencies: PlatformAdmissionsWorkspaceDependencies = {},
): Promise<PlatformAdmissionsTaskQueue> {
  try {
    const organizationId = requireAdmissionsActor(actor);
    const pageSize = normalizedPageSize(options.pageSize);
    const requestedLimit = pageSize + 1;
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_case_task_queue",
      { p_limit: requestedLimit },
      { get: true },
    );
    if (
      response.error ||
      !Array.isArray(response.data) ||
      response.data.length > requestedLimit
    ) {
      return invalidShape();
    }
    const seen = new Set<string>();
    const rows = response.data.map((item) => {
      const row = normalizePlatformAdmissionsTaskQueueRow(
        item,
        organizationId,
      );
      if (seen.has(row.caseTaskId)) return invalidShape();
      seen.add(row.caseTaskId);
      return row;
    });
    return Object.freeze({
      rows: Object.freeze(rows.slice(0, pageSize)),
      hasNext: rows.length > pageSize,
    });
  } catch (error) {
    return failClosed(error);
  }
}

export async function listPlatformAdmissionsVisaQueue(
  actor: PlatformActor,
  options: Readonly<{ pageSize?: number }> = {},
  dependencies: PlatformAdmissionsWorkspaceDependencies = {},
): Promise<PlatformAdmissionsVisaQueue> {
  try {
    const organizationId = requireAdmissionsActor(actor);
    const pageSize = normalizedPageSize(options.pageSize);
    const requestedLimit = pageSize + 1;
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_visa_queue",
      { p_limit: requestedLimit },
      { get: true },
    );
    if (
      response.error ||
      !Array.isArray(response.data) ||
      response.data.length > requestedLimit
    ) {
      return invalidShape();
    }
    const seenVisaCases = new Set<string>();
    const seenStudentCases = new Set<string>();
    const rows = response.data.map((item) => {
      const row = normalizePlatformAdmissionsVisaQueueRow(
        item,
        organizationId,
      );
      if (
        seenVisaCases.has(row.visaCaseId) ||
        seenStudentCases.has(row.studentCaseId)
      ) {
        return invalidShape();
      }
      seenVisaCases.add(row.visaCaseId);
      seenStudentCases.add(row.studentCaseId);
      return row;
    });
    return Object.freeze({
      rows: Object.freeze(rows.slice(0, pageSize)),
      hasNext: rows.length > pageSize,
    });
  } catch (error) {
    return failClosed(error);
  }
}
