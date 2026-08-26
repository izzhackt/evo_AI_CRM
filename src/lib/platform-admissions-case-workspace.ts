import type { PlatformActor } from "./platform-auth.ts";

import { parsePlatformAdmissionsUuid } from "./platform-admissions.ts";

const SAFE_REPOSITORY_ERROR_MESSAGE =
  "Platform Admissions case workspace is unavailable.";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const PLATFORM_CASE_TASK_STATUSES = [
  "open",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
] as const;
const PLATFORM_CASE_TASK_PRIORITIES = [
  "low",
  "normal",
  "high",
  "urgent",
] as const;
const PLATFORM_CASE_ASSIGNEE_ROLES = ["admin", "sales", "curator"] as const;
const PLATFORM_CASE_AUDIT_ACTIONS = [
  "application.create",
  "application.status.change",
  "case.create",
  "case.curator.set",
  "case.handoff.create",
  "case.lifecycle.change",
  "case.route.change",
  "case.update.append",
  "document.version.review",
  "task.change",
  "task.create",
  "visa.status.change",
] as const;
const PLATFORM_CASE_AUDIT_RESOURCE_KINDS = [
  "student_case",
  "case_task",
  "student_case_update",
  "document_version",
  "document_slot",
  "university_application",
  "visa_case",
  "audit_event",
] as const;

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;
type RpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (
      functionName: string,
      args?: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ) => PromiseLike<RpcResponse>;
  }>;
}>;

export type PlatformAdmissionsCaseWorkspaceTaskStatus =
  (typeof PLATFORM_CASE_TASK_STATUSES)[number];
export type PlatformAdmissionsCaseWorkspaceTaskPriority =
  (typeof PLATFORM_CASE_TASK_PRIORITIES)[number];
export type PlatformAdmissionsCaseWorkspaceAssigneeRole =
  (typeof PLATFORM_CASE_ASSIGNEE_ROLES)[number];
export type PlatformAdmissionsCaseWorkspaceAuditAction =
  (typeof PLATFORM_CASE_AUDIT_ACTIONS)[number];
export type PlatformAdmissionsCaseWorkspaceAuditResourceKind =
  (typeof PLATFORM_CASE_AUDIT_RESOURCE_KINDS)[number];

export type PlatformAdmissionsCaseWorkspaceTask = Readonly<{
  caseTaskId: string;
  studentCaseId: string;
  taskType: string;
  title: string;
  assigneeMembershipId: string;
  assigneeDisplayName: string | null;
  priority: PlatformAdmissionsCaseWorkspaceTaskPriority;
  dueAt: string | null;
  status: PlatformAdmissionsCaseWorkspaceTaskStatus;
  studentVisible: boolean;
}>;

export type PlatformAdmissionsCaseWorkspaceAssignee = Readonly<{
  membershipId: string;
  displayName: string;
  role: PlatformAdmissionsCaseWorkspaceAssigneeRole;
}>;

export type PlatformAdmissionsCaseWorkspaceUpdate = Readonly<{
  studentCaseUpdateId: string;
  studentCaseId: string;
  body: string;
  source: string;
  occurredAt: string;
  authorDisplayName: string | null;
  studentVisible: boolean;
}>;

export type PlatformAdmissionsCaseWorkspaceAuditEntry = Readonly<{
  auditEventId: string;
  studentCaseId: string;
  action: PlatformAdmissionsCaseWorkspaceAuditAction;
  resourceKind: PlatformAdmissionsCaseWorkspaceAuditResourceKind;
  actorDisplayName: string | null;
  eventAt: string;
  reason: string | null;
  changeSummary: string | null;
}>;

export type PlatformAdmissionsCaseWorkspace = Readonly<{
  organizationId: string;
  studentCaseId: string;
  tasks: readonly PlatformAdmissionsCaseWorkspaceTask[];
  taskAssignees: readonly PlatformAdmissionsCaseWorkspaceAssignee[];
  updates: readonly PlatformAdmissionsCaseWorkspaceUpdate[];
  audit: readonly PlatformAdmissionsCaseWorkspaceAuditEntry[];
}>;

export type PlatformAdmissionsCaseWorkspaceDependencies = Readonly<{
  actor?: PlatformActor;
  client?: RpcClient;
}>;

export type PlatformAdmissionsCaseWorkspaceInput = Readonly<{
  studentCaseId: string;
  limit?: number;
}>;

export class PlatformAdmissionsCaseWorkspaceRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformAdmissionsCaseWorkspaceRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformAdmissionsCaseWorkspaceRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformAdmissionsCaseWorkspaceRepositoryError) {
    throw error;
  }
  throw new PlatformAdmissionsCaseWorkspaceRepositoryError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredUuid(value: unknown): string {
  return parsePlatformAdmissionsUuid(value) ?? invalidShape();
}

function requiredText(value: unknown, maximum = 2_000): string {
  if (typeof value !== "string") return invalidShape();
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return invalidShape();
  }
  return normalized;
}

function optionalText(value: unknown, maximum = 2_000): string | null {
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

function optionalDate(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !DATE_PATTERN.test(value) ||
    Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
  ) {
    return invalidShape();
  }
  return value;
}

function requiredBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : invalidShape();
}

function positiveInteger(value: unknown): number {
  const numeric =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (
    typeof numeric !== "number" ||
    !Number.isSafeInteger(numeric) ||
    numeric < 1
  ) {
    return invalidShape();
  }
  return numeric;
}

function normalizedLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  return positiveInteger(value);
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

function unwrapSingleObject(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (Array.isArray(value) && value.length === 1 && isRecord(value[0])) {
    return value[0];
  }
  return invalidShape();
}

function assertCaseScope(value: unknown, expectedCaseId: string): void {
  if (requiredUuid(value) !== expectedCaseId) invalidShape();
}

function normalizeTask(
  value: unknown,
  organizationId: string,
  studentCaseId: string,
): PlatformAdmissionsCaseWorkspaceTask {
  if (!isRecord(value)) return invalidShape();
  if (requiredUuid(value.organization_id) !== organizationId) invalidShape();
  assertCaseScope(value.student_case_id, studentCaseId);
  return Object.freeze({
    caseTaskId: requiredUuid(value.case_task_id),
    studentCaseId,
    taskType: requiredText(value.task_type, 100),
    title: requiredText(value.title, 500),
    assigneeMembershipId: requiredUuid(value.assignee_membership_id),
    assigneeDisplayName: optionalText(value.assignee_display_name, 200),
    priority: oneOf(value.priority, PLATFORM_CASE_TASK_PRIORITIES),
    dueAt: optionalDate(value.due_at),
    status: oneOf(value.status, PLATFORM_CASE_TASK_STATUSES),
    studentVisible: requiredBoolean(value.student_visible),
  });
}

function normalizeAssignee(
  value: unknown,
  organizationId: string,
): PlatformAdmissionsCaseWorkspaceAssignee {
  if (!isRecord(value)) return invalidShape();
  if (requiredUuid(value.organization_id) !== organizationId) invalidShape();
  return Object.freeze({
    membershipId: requiredUuid(value.membership_id),
    displayName: requiredText(value.display_name, 200),
    role: oneOf(value.role, PLATFORM_CASE_ASSIGNEE_ROLES),
  });
}

function normalizeUpdate(
  value: unknown,
  organizationId: string,
  studentCaseId: string,
): PlatformAdmissionsCaseWorkspaceUpdate {
  if (!isRecord(value)) return invalidShape();
  if (requiredUuid(value.organization_id) !== organizationId) invalidShape();
  assertCaseScope(value.student_case_id, studentCaseId);
  return Object.freeze({
    studentCaseUpdateId: requiredUuid(value.student_case_update_id),
    studentCaseId,
    body: requiredText(value.body, 4_000),
    source: requiredText(value.source, 100),
    occurredAt: requiredTimestamp(value.occurred_at),
    authorDisplayName: optionalText(value.author_display_name, 200),
    studentVisible: requiredBoolean(value.student_visible),
  });
}

function normalizeAuditEntry(
  value: unknown,
  organizationId: string,
  studentCaseId: string,
): PlatformAdmissionsCaseWorkspaceAuditEntry {
  if (!isRecord(value)) return invalidShape();
  if (requiredUuid(value.organization_id) !== organizationId) invalidShape();
  assertCaseScope(value.student_case_id, studentCaseId);
  return Object.freeze({
    auditEventId: requiredUuid(value.audit_event_id),
    studentCaseId,
    action: oneOf(value.action, PLATFORM_CASE_AUDIT_ACTIONS),
    resourceKind: oneOf(value.resource_kind, PLATFORM_CASE_AUDIT_RESOURCE_KINDS),
    actorDisplayName: optionalText(value.actor_display_name, 200),
    eventAt: requiredTimestamp(value.event_at),
    reason: optionalText(value.reason, 1_000),
    changeSummary: optionalText(value.change_summary, 2_000),
  });
}

function normalizeUniqueArray<T extends Readonly<{ [key: string]: unknown }>>(
  value: unknown,
  mapper: (row: unknown) => T,
  key: keyof T,
): readonly T[] {
  if (!Array.isArray(value)) return invalidShape();
  const seen = new Set<string>();
  return Object.freeze(value.map((row) => {
    const normalized = mapper(row);
    const id = normalized[key];
    if (typeof id !== "string" || seen.has(id)) return invalidShape();
    seen.add(id);
    return normalized;
  }));
}

export function normalizePlatformAdmissionsCaseWorkspacePayload(
  value: unknown,
  expectedOrganizationId: string,
  expectedStudentCaseId: string,
): Readonly<{
  organizationId: string;
  studentCaseId: string;
  tasks: readonly PlatformAdmissionsCaseWorkspaceTask[];
  taskAssignees: readonly PlatformAdmissionsCaseWorkspaceAssignee[];
}> {
  const payload = unwrapSingleObject(value);
  const organizationId = requiredUuid(payload.organization_id);
  const studentCaseId = requiredUuid(payload.student_case_id);
  if (
    organizationId !== expectedOrganizationId ||
    studentCaseId !== expectedStudentCaseId
  ) {
    return invalidShape();
  }
  return Object.freeze({
    organizationId,
    studentCaseId,
    tasks: normalizeUniqueArray(
      payload.tasks,
      (row) => normalizeTask(row, organizationId, studentCaseId),
      "caseTaskId",
    ),
    taskAssignees: normalizeUniqueArray(
      payload.assignees,
      (row) => normalizeAssignee(row, organizationId),
      "membershipId",
    ),
  });
}

export function normalizePlatformAdmissionsCaseActivityPayload(
  value: unknown,
  expectedOrganizationId: string,
  expectedStudentCaseId: string,
): Readonly<{
  organizationId: string;
  studentCaseId: string;
  updates: readonly PlatformAdmissionsCaseWorkspaceUpdate[];
  audit: readonly PlatformAdmissionsCaseWorkspaceAuditEntry[];
}> {
  const payload = unwrapSingleObject(value);
  const organizationId = requiredUuid(payload.organization_id);
  const studentCaseId = requiredUuid(payload.student_case_id);
  if (
    organizationId !== expectedOrganizationId ||
    studentCaseId !== expectedStudentCaseId
  ) {
    return invalidShape();
  }
  return Object.freeze({
    organizationId,
    studentCaseId,
    updates: normalizeUniqueArray(
      payload.updates,
      (row) => normalizeUpdate(row, organizationId, studentCaseId),
      "studentCaseUpdateId",
    ),
    audit: normalizeUniqueArray(
      payload.audit,
      (row) => normalizeAuditEntry(row, organizationId, studentCaseId),
      "auditEventId",
    ),
  });
}

async function getPlatformClient(): Promise<RpcClient> {
  const { createSupabaseServerClient } = await import("./supabase/server.ts");
  return createSupabaseServerClient() as unknown as RpcClient;
}

function requireActor(actor: PlatformActor): Readonly<{
  organizationId: string;
}> {
  if (!actor.organizationId) return invalidShape();
  if (
    actor.platformRole !== "admin" &&
    actor.platformRole !== "curator"
  ) {
    return invalidShape();
  }
  return Object.freeze({ organizationId: actor.organizationId });
}

export async function getPlatformAdmissionsCaseWorkspaceForActor(
  actor: PlatformActor,
  input: PlatformAdmissionsCaseWorkspaceInput,
  dependencies: Omit<PlatformAdmissionsCaseWorkspaceDependencies, "actor"> = {},
): Promise<PlatformAdmissionsCaseWorkspace | null> {
  try {
    const authority = requireActor(actor);
    const studentCaseId = parsePlatformAdmissionsUuid(input.studentCaseId);
    if (studentCaseId === null) return null;
    const limit = normalizedLimit(input.limit);
    const client = dependencies.client ?? await getPlatformClient();
    const [workspaceResponse, activityResponse] = await Promise.all([
      client.schema("platform").rpc(
        "staff_student_case_task_workspace",
        { p_student_case_id: studentCaseId },
        { get: true },
      ),
      client.schema("platform").rpc(
        "staff_student_case_activity",
        { p_student_case_id: studentCaseId, p_limit: limit },
        { get: true },
      ),
    ]);
    if (workspaceResponse.error || activityResponse.error) return invalidShape();
    const workspace = normalizePlatformAdmissionsCaseWorkspacePayload(
      workspaceResponse.data,
      authority.organizationId,
      studentCaseId,
    );
    const activity = normalizePlatformAdmissionsCaseActivityPayload(
      activityResponse.data,
      authority.organizationId,
      studentCaseId,
    );
    if (
      workspace.organizationId !== activity.organizationId ||
      workspace.studentCaseId !== activity.studentCaseId
    ) {
      return invalidShape();
    }
    return Object.freeze({
      organizationId: workspace.organizationId,
      studentCaseId: workspace.studentCaseId,
      tasks: workspace.tasks,
      taskAssignees: workspace.taskAssignees,
      updates: activity.updates,
      audit: activity.audit,
    });
  } catch (error) {
    return failClosed(error);
  }
}

export async function getPlatformAdmissionsCaseWorkspace(
  input: PlatformAdmissionsCaseWorkspaceInput,
  dependencies: PlatformAdmissionsCaseWorkspaceDependencies = {},
): Promise<PlatformAdmissionsCaseWorkspace | null> {
  const actor = dependencies.actor ?? await import("./platform-guards.ts").then(
    ({ requirePlatformClientsActor }) => requirePlatformClientsActor(),
  );
  return getPlatformAdmissionsCaseWorkspaceForActor(actor, input, dependencies);
}
