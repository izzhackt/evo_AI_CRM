import {
  PLATFORM_CASE_TASK_PRIORITIES,
  PLATFORM_CASE_TASK_STATUSES,
  parsePlatformCaseTaskDeadline,
  type PlatformCaseTaskPriority,
  type PlatformCaseTaskStatus,
} from "./platform-admissions-task-contract.ts";
import { projectPlatformTaskDeadline } from "./platform-task-deadline.ts";

export const STAFF_TASK_VIEWS = ["mine", "created", "all"] as const;
export const STAFF_TASK_FILTERS = ["active", "overdue", "completed", "all"] as const;
export type StaffTaskView = (typeof STAFF_TASK_VIEWS)[number];
export type StaffTaskFilter = (typeof STAFF_TASK_FILTERS)[number];
export type StaffTaskCursor = Readonly<{ updatedAt: string; id: string }>;
export type StaffTask = Readonly<{
  id: string;
  organizationId: string;
  creatorMembershipId: string;
  creatorDisplayName: string;
  assigneeMembershipId: string;
  assigneeDisplayName: string;
  title: string;
  description: string | null;
  status: PlatformCaseTaskStatus;
  priority: PlatformCaseTaskPriority;
  dueOn: string | null;
  dueAt: string | null;
  version: string;
  /** Provenance never grants source-channel access. Bound in migration 142. */
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}>;
export type StaffParticipant = Readonly<{
  membershipId: string;
  displayName: string;
  role: "admin" | "sales" | "admissions";
}>;
export type StaffTaskActionState = Readonly<{
  status: "idle" | "saved" | "invalid" | "forbidden" | "stale" | "request_conflict" | "unavailable";
  requestId: string;
  taskId: string | null;
  version: string | null;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export function staffTaskUuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}
export function staffTaskTimestamp(value: unknown): string | null {
  return typeof value === "string" && TIMESTAMP.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}
export function staffTaskVersion(value: unknown, allowZero = false): string | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,18})$/.test(value)) return null;
  return (value.length < 19 || value <= "9223372036854775807") && (allowZero || value !== "0") ? value : null;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Staff task data is unavailable.");
  return value as Record<string, unknown>;
}
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Staff task data is unavailable.");
  return value;
}
function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !CONTROL.test(value) ? value : null;
}
export function parseStaffTask(value: unknown, organizationId: string): StaffTask {
  const row = record(value);
  if (row.organization_id !== organizationId) throw new Error("Staff task data is unavailable.");
  const dueOn = row.due_on === null ? null : required(text(row.due_on, 10));
  const dueAt = row.due_at === null ? null : required(staffTaskTimestamp(row.due_at));
  projectPlatformTaskDeadline(dueOn, dueAt, new Date());
  return Object.freeze({
    id: required(staffTaskUuid(row.id)), organizationId,
    creatorMembershipId: required(staffTaskUuid(row.creator_membership_id)),
    creatorDisplayName: required(text(row.creator_display_name, 1000)),
    assigneeMembershipId: required(staffTaskUuid(row.assignee_membership_id)),
    assigneeDisplayName: required(text(row.assignee_display_name, 1000)),
    title: required(text(row.title, 1000)),
    description: row.description === null ? null : required(text(row.description, 10000)),
    status: required(PLATFORM_CASE_TASK_STATUSES.find((status) => status === row.status)),
    priority: required(PLATFORM_CASE_TASK_PRIORITIES.find((priority) => priority === row.priority)),
    dueOn, dueAt, version: required(staffTaskVersion(row.version)),
    sourceMessageId: row.source_message_id === null ? null : required(staffTaskUuid(row.source_message_id)),
    createdAt: required(staffTaskTimestamp(row.created_at)), updatedAt: required(staffTaskTimestamp(row.updated_at)),
  });
}
export function parseStaffParticipant(value: unknown): StaffParticipant {
  const row = record(value);
  const role = row.platform_role === "curator" ? "admissions" : row.platform_role;
  if (role !== "admin" && role !== "sales" && role !== "admissions") throw new Error("Staff participant data is unavailable.");
  return Object.freeze({ membershipId: required(staffTaskUuid(row.membership_id)), displayName: required(text(row.display_name, 1000)), role });
}

export const STAFF_TASK_FORM_FIELDS = ["operation", "request_id", "expected_version", "task_id", "title", "assignee_membership_id", "description", "status", "priority", "deadline_kind", "due_on", "due_at", "source_message_id", "source_message_version", "source_lead_id", "source_lead_version", "completion_note"] as const;
export type StaffTaskCommand = Readonly<{
  p_operation: "create" | "edit" | "status"; p_request_id: string; p_expected_version: string;
  p_staff_task_id: string | null; p_status: PlatformCaseTaskStatus;
  p_source_message_id: string | null; p_source_message_version: string | null;
  p_source_lead_id: string | null; p_source_lead_version: string | null; p_completion_note: string | null;
  p_title: string | null; p_description: string | null; p_assignee_membership_id: string | null;
  p_priority: PlatformCaseTaskPriority | null; p_due_on: string | null; p_due_at: string | null;
}>;
export function parseStaffTaskCommand(fields: ReadonlyMap<string, string>): StaffTaskCommand | null {
  const get = (key: string) => fields.get(key)?.trim() ?? "";
  const operation = get("operation");
  const requestId = staffTaskUuid(get("request_id"));
  const version = staffTaskVersion(get("expected_version"), operation === "create");
  const taskId = staffTaskUuid(get("task_id"));
  const status = PLATFORM_CASE_TASK_STATUSES.find((status) => status === get("status"));
  if (!requestId || !version || !status || (operation !== "create" && operation !== "edit" && operation !== "status")) return null;
  if (operation === "create" ? get("task_id") !== "" || version !== "0" || status !== "open" : !taskId) return null;
  const sourceMessageId = staffTaskUuid(get("source_message_id"));
  const sourceMessageVersion = staffTaskVersion(get("source_message_version"));
  if ((get("source_message_id") !== "" || get("source_message_version") !== "") && (operation !== "create" || !sourceMessageId || !sourceMessageVersion)) return null;
  const sourceLeadId = staffTaskUuid(get("source_lead_id"));
  const sourceLeadVersion = staffTaskVersion(get("source_lead_version"));
  if ((get("source_lead_id") !== "" || get("source_lead_version") !== "") && (operation !== "create" || !sourceLeadId || !sourceLeadVersion || sourceMessageId)) return null;
  const completionNote = get("completion_note");
  if (completionNote && (operation !== "status" || status !== "done" || !text(completionNote, 4000))) return null;
  const base: StaffTaskCommand = { p_operation: operation, p_request_id: requestId, p_expected_version: version, p_staff_task_id: taskId, p_status: status, p_source_message_id: sourceMessageId, p_source_message_version: sourceMessageVersion,
    p_source_lead_id: sourceLeadId, p_source_lead_version: sourceLeadVersion, p_completion_note: completionNote || null,
    p_title: null, p_description: null, p_assignee_membership_id: null, p_priority: null, p_due_on: null, p_due_at: null };
  if (operation === "status") {
    if (["title", "assignee_membership_id", "description", "priority", "deadline_kind", "due_on", "due_at"].some((name) => get(name) !== "")) return null;
    return base;
  }
  const title = text(get("title"), 1000);
  const description = get("description");
  const assignee = staffTaskUuid(get("assignee_membership_id"));
  const priority = PLATFORM_CASE_TASK_PRIORITIES.find((priority) => priority === get("priority"));
  const deadline = parsePlatformCaseTaskDeadline(get("deadline_kind"), get("due_on"), get("due_at"));
  if (!title || !assignee || !priority || !deadline || (description !== "" && !text(description, 10000))) return null;
  return { ...base, p_title: title, p_description: description || null, p_assignee_membership_id: assignee, p_priority: priority, p_due_on: deadline.dueOn, p_due_at: deadline.dueAt };
}
