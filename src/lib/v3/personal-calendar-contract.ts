import type { CalendarTask } from "../../components/v3/calendar/types.ts";
import { isStaffPreview, staffHasPermission, staffPresentationCan } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import { PLATFORM_CASE_TASK_PRIORITIES, PLATFORM_CASE_TASK_STATUSES } from "../platform-admissions-task-contract.ts";
import { normalizePlatformAdmissionsTaskTarget } from "../platform-admissions-workspace.ts";
import { staffTaskTimestamp, staffTaskUuid, staffTaskVersion } from "../platform-staff-task-contract.ts";
import { platformTaskDeadlineSortTime, projectPlatformTaskDeadline } from "../platform-task-deadline.ts";
import type { CalendarRpcClient } from "./calendar-contract.ts";

export type PersonalCalendarKind = "case" | "staff";
export type PersonalCalendarCursor = Readonly<{ sortAt: string; kind: PersonalCalendarKind; taskId: string }>;
export type PersonalCalendarPageOptions = Readonly<{
  mode: "dated" | "undated";
  from?: string;
  to?: string;
  pageSize?: number;
  cursor?: PersonalCalendarCursor | null;
}>;

export class PersonalCalendarReadError extends Error {
  readonly unavailable: boolean;
  constructor(unavailable = false) {
    super("Personal calendar data is unavailable.");
    this.name = "PersonalCalendarReadError";
    this.unavailable = unavailable;
  }
}
function invalid(): never { throw new PersonalCalendarReadError(); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: readonly string[]) {
  const row = record(value);
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) return invalid();
  return row;
}
function required<T>(value: T | null | undefined): T {
  return value === null || value === undefined ? invalid() : value;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return invalid();
  return value;
}
function kind(value: unknown): PersonalCalendarKind {
  return value === "case" || value === "staff" ? value : invalid();
}

// Preserve PostgreSQL's sub-millisecond ordering; Date alone truncates it.
function timestampKey(value: string): bigint {
  const parsed = required(staffTaskTimestamp(value));
  const microseconds = (parsed.match(/\.(\d{1,6})/)?.[1] ?? "").padEnd(6, "0");
  return BigInt(Date.parse(parsed)) * BigInt(1000) + BigInt(microseconds.slice(3) || "0");
}
export function comparePersonalCalendarCursor(left: PersonalCalendarCursor, right: PersonalCalendarCursor): number {
  const a = timestampKey(left.sortAt), b = timestampKey(right.sortAt);
  if (a !== b) return a < b ? -1 : 1;
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
  return left.taskId === right.taskId ? 0 : left.taskId < right.taskId ? -1 : 1;
}
export function parsePersonalCalendarCursor(sortAt: unknown, taskKind: unknown, taskId: unknown, undated = false): PersonalCalendarCursor | null {
  try {
    const cursor = { sortAt: required(staffTaskTimestamp(sortAt)), kind: kind(taskKind), taskId: required(staffTaskUuid(taskId)) };
    if (undated && timestampKey(cursor.sortAt) !== BigInt(platformTaskDeadlineSortTime(null, null)) * BigInt(1000)) return null;
    return Object.freeze(cursor);
  } catch { return null; }
}

export function personalCalendarAccess(actor: ActivePlatformActor) {
  const caseTasks = staffHasPermission(actor, "task.manage") && (!isStaffPreview(actor) || staffPresentationCan(actor, "admissions.read"));
  const staffTasks = staffHasPermission(actor, "staff.task.read");
  return Object.freeze({ caseTasks, staffTasks, tasks: caseTasks || staffTasks, applicationDeadlines: false });
}

const COMMON_FIELDS = ["kind", "task_id", "organization_id", "version", "title", "details", "status", "priority", "due_on", "due_at", "sort_at", "assignee_membership_id", "assignee_display_name", "created_at", "updated_at"] as const;
const CASE_FIELDS = ["student_case_id", "student_display_name", "case_state", "task_type", "student_visible"] as const;

function parseRow(value: unknown, actor: ActivePlatformActor, now: Date): Readonly<{ task: CalendarTask; cursor: PersonalCalendarCursor }> {
  const taskKind = kind(record(value).kind);
  const row = exact(value, taskKind === "case" ? [...COMMON_FIELDS, ...CASE_FIELDS] : COMMON_FIELDS);
  const access = personalCalendarAccess(actor);
  if (row.organization_id !== actor.organizationId || row.assignee_membership_id !== actor.membershipId
    || (taskKind === "case" ? !access.caseTasks : !access.staffTasks)) return invalid();
  const id = required(staffTaskUuid(row.task_id));
  const dueOn = row.due_on === null ? null : text(row.due_on, 10);
  const dueAt = row.due_at === null ? null : required(staffTaskTimestamp(row.due_at));
  const deadline = projectPlatformTaskDeadline(dueOn, dueAt, now);
  const cursor = required(parsePersonalCalendarCursor(row.sort_at, taskKind, id));
  if (dueAt !== null ? timestampKey(cursor.sortAt) !== timestampKey(dueAt)
    : timestampKey(cursor.sortAt) !== BigInt(platformTaskDeadlineSortTime(dueOn, dueAt)) * BigInt(1000)) return invalid();
  required(staffTaskTimestamp(row.created_at));
  required(staffTaskTimestamp(row.updated_at));
  const common = {
    id, key: `${taskKind}:${id}`, title: text(row.title, 1000), details: row.details === null ? null : text(row.details, 10000),
    dueOn, dueAt, day: deadline.day, minutes: deadline.minutes, overdue: deadline.overdue,
    state: required(PLATFORM_CASE_TASK_STATUSES.find(value => value === row.status)),
    priority: required(PLATFORM_CASE_TASK_PRIORITIES.find(value => value === row.priority)),
    assigneeMembershipId: required(staffTaskUuid(row.assignee_membership_id)), assigneeDisplayName: text(row.assignee_display_name, 1000),
    cancelReason: null, version: required(staffTaskVersion(row.version)),
  };
  if (taskKind === "staff") return { task: Object.freeze({ ...common, kind: "staff", person: null }), cursor };
  if ((row.case_state !== "active" && row.case_state !== "closed") || typeof row.student_visible !== "boolean") return invalid();
  return { task: Object.freeze({ ...common, kind: "case", studentCaseId: required(staffTaskUuid(row.student_case_id)),
    taskType: text(row.task_type, 200), person: text(row.student_display_name, 1000),
    caseState: row.case_state, studentVisible: row.student_visible }), cursor };
}

export function parsePersonalCalendarPage(value: unknown, actor: ActivePlatformActor, options: PersonalCalendarPageOptions, now = new Date()) {
  const row = exact(value, ["rows", "total_count", "next_cursor"]);
  const limit = options.pageSize ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Array.isArray(row.rows) || row.rows.length > limit
    || typeof row.total_count !== "number" || !Number.isSafeInteger(row.total_count) || row.total_count < row.rows.length) return invalid();
  let previous = options.cursor ?? null;
  const tasks = row.rows.map(value => {
    const parsed = parseRow(value, actor, now);
    if (previous && comparePersonalCalendarCursor(previous, parsed.cursor) >= 0) return invalid();
    if (options.mode === "undated" ? parsed.task.day !== null
      : parsed.task.day === null || !options.from || !options.to || parsed.task.day < options.from || parsed.task.day > options.to) return invalid();
    previous = parsed.cursor;
    return parsed.task;
  });
  let nextCursor: PersonalCalendarCursor | null = null;
  if (row.next_cursor !== null) {
    const next = exact(row.next_cursor, ["sort_at", "kind", "task_id"]);
    nextCursor = required(parsePersonalCalendarCursor(next.sort_at, next.kind, next.task_id, options.mode === "undated"));
    if (!previous || tasks.length !== limit || row.total_count <= tasks.length || comparePersonalCalendarCursor(previous, nextCursor) !== 0) return invalid();
  }
  return Object.freeze({ tasks: Object.freeze(tasks), totalCount: row.total_count, nextCursor });
}

async function client(): Promise<CalendarRpcClient> {
  const { createSupabaseServerClient } = await import("../supabase/server.ts");
  return createSupabaseServerClient() as unknown as CalendarRpcClient;
}
function rpcFailure(error: unknown): never {
  throw new PersonalCalendarReadError(record(error).code === "42501");
}
// PostgREST GET encodes explicit null as the string "null". Omit optional
// arguments so PostgreSQL applies their declared NULL defaults instead.
export function personalCalendarPageArgs(options: PersonalCalendarPageOptions) {
  return {
    p_mode: options.mode, p_limit: options.pageSize ?? 100,
    ...(options.from != null ? { p_due_from: options.from } : {}),
    ...(options.to != null ? { p_due_to: options.to } : {}),
    ...(options.cursor ? { p_after_sort_at: options.cursor.sortAt, p_after_kind: options.cursor.kind, p_after_task_id: options.cursor.taskId } : {}),
  };
}
type PersonalCalendarTarget = Readonly<{ kind: PersonalCalendarKind; taskId: string; studentCaseId: string | null }>;
export function personalCalendarTargetArgs(target: PersonalCalendarTarget) {
  return {
    p_kind: target.kind, p_task_id: target.taskId,
    ...(target.studentCaseId !== null ? { p_student_case_id: target.studentCaseId } : {}),
  };
}
export async function readPersonalCalendarPage(actor: ActivePlatformActor, options: PersonalCalendarPageOptions) {
  if (!personalCalendarAccess(actor).tasks) throw new PersonalCalendarReadError(true);
  const response = await (await client()).schema("platform").rpc("staff_personal_calendar_page_v1", personalCalendarPageArgs(options), { get: true });
  if (response.error) return rpcFailure(response.error);
  return parsePersonalCalendarPage(response.data, actor, options);
}

export async function readPersonalCalendarTarget(actor: ActivePlatformActor, target: PersonalCalendarTarget) {
  const access = personalCalendarAccess(actor);
  if (target.kind === "case" ? !access.caseTasks : !access.staffTasks) throw new PersonalCalendarReadError(true);
  const response = await (await client()).schema("platform").rpc("staff_personal_calendar_target_v1", personalCalendarTargetArgs(target), { get: true });
  if (response.error) return rpcFailure(response.error);
  const result = exact(response.data, ["task", "case_target"]);
  const { task } = parseRow(result.task, actor, new Date());
  if (task.kind !== target.kind || task.id !== target.taskId || (task.kind === "case" && task.studentCaseId !== target.studentCaseId)) return invalid();
  if (task.kind === "staff") {
    if (result.case_target !== null) return invalid();
    return { task, assignees: [], capabilities: null };
  }
  const canonical = normalizePlatformAdmissionsTaskTarget(result.case_target, actor.organizationId, task.studentCaseId, task.id);
  if (canonical.task.version !== task.version || canonical.task.assigneeMembershipId !== actor.membershipId) return invalid();
  return { task, assignees: canonical.assignees.map(item => ({ membershipId: item.membershipId, displayName: item.displayName })),
    capabilities: { taskId: task.id, studentCaseId: task.studentCaseId, ...canonical.capabilities } };
}
