import type { FixedRole } from "./fixed-role-policy";
import { PLATFORM_ORGANIZATION_UTC_OFFSET } from "./platform-organization-time.ts";

export const PLATFORM_CASE_TASK_STATUSES = [
  "open",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
] as const;

export const PLATFORM_CASE_TASK_PRIORITIES = [
  "low",
  "normal",
  "high",
  "urgent",
] as const;

export const PLATFORM_CASE_TASK_DEADLINE_KINDS = [
  "none",
  "all_day",
  "timed",
] as const;

export type PlatformCaseTaskStatus =
  (typeof PLATFORM_CASE_TASK_STATUSES)[number];
export type PlatformCaseTaskPriority =
  (typeof PLATFORM_CASE_TASK_PRIORITIES)[number];
export type PlatformCaseTaskDeadlineKind =
  (typeof PLATFORM_CASE_TASK_DEADLINE_KINDS)[number];

export type PlatformCaseTaskDeadline = Readonly<{
  kind: PlatformCaseTaskDeadlineKind;
  dueOn: string | null;
  dueAt: string | null;
}>;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const LOCAL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function validIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

/**
 * Parses the exact staff form contract. Local timed values are interpreted in
 * the EVO organization timezone (Asia/Bishkek, UTC+06:00).
 */
export function parsePlatformCaseTaskDeadline(
  kind: string,
  dueOnInput: string,
  dueAtInput: string,
): PlatformCaseTaskDeadline | null {
  const dueOn = dueOnInput.trim();
  const dueAt = dueAtInput.trim();
  if (kind === "none") {
    return dueOn === "" && dueAt === ""
      ? Object.freeze({ kind, dueOn: null, dueAt: null })
      : null;
  }
  if (kind === "all_day") {
    return validIsoDate(dueOn) && dueAt === ""
      ? Object.freeze({ kind, dueOn, dueAt: null })
      : null;
  }
  if (kind !== "timed" || dueOn !== "") return null;

  const canonicalTimestamp = TIMESTAMPTZ_PATTERN.test(dueAt);
  const candidate = canonicalTimestamp
    ? dueAt
    : LOCAL_DATETIME_PATTERN.test(dueAt)
      ? `${dueAt}:00${PLATFORM_ORGANIZATION_UTC_OFFSET}`
      : null;
  if (!candidate || !Number.isFinite(Date.parse(candidate))) return null;
  return Object.freeze({
    kind,
    dueOn: null,
    // Keep an existing canonical database value byte-for-byte. Re-serializing
    // through JavaScript Date would silently truncate PostgreSQL microseconds.
    dueAt: canonicalTimestamp ? candidate : new Date(candidate).toISOString(),
  });
}

export function platformCaseTaskDeadlineMatchesRow(
  rowDueOn: unknown,
  rowDueAt: unknown,
  expected: PlatformCaseTaskDeadline,
): boolean {
  if (rowDueOn !== expected.dueOn) return false;
  if (expected.dueAt === null) return rowDueAt === null;
  return typeof rowDueAt === "string" &&
    Number.isFinite(Date.parse(rowDueAt)) &&
    Date.parse(rowDueAt) === Date.parse(expected.dueAt);
}

export type PlatformAdmissionsTask = Readonly<{
  organizationId: string;
  caseTaskId: string;
  version: string;
  studentCaseId: string;
  taskType: string;
  title: string;
  status: PlatformCaseTaskStatus;
  priority: PlatformCaseTaskPriority;
  dueOn: string | null;
  dueAt: string | null;
  studentVisible: boolean;
  assigneeMembershipId: string;
  assigneeDisplayName: string;
  creatorMembershipId: string;
  creatorDisplayName: string;
  createdAt: string;
  updatedAt: string;
}>;

export type PlatformAdmissionsTaskQueueRow = Readonly<{
  sortAt: string;
  organizationId: string;
  caseTaskId: string;
  version: string;
  studentCaseId: string;
  studentDisplayName: string;
  caseState: "active" | "closed";
  taskType: string;
  title: string;
  status: PlatformCaseTaskStatus;
  priority: PlatformCaseTaskPriority;
  dueOn: string | null;
  dueAt: string | null;
  studentVisible: boolean;
  assigneeMembershipId: string;
  assigneeDisplayName: string;
  createdAt: string;
  updatedAt: string;
}>;

export type PlatformAdmissionsTaskAssignee = Readonly<{
  membershipId: string;
  displayName: string;
  role: FixedRole;
}>;

export type PlatformAdmissionsTaskWorkspace = Readonly<{
  organizationId: string;
  studentCaseId: string;
  tasks: readonly PlatformAdmissionsTask[];
  assignees: readonly PlatformAdmissionsTaskAssignee[];
}>;

export type PlatformAdmissionsTaskQueue = Readonly<{
  rows: readonly PlatformAdmissionsTaskQueueRow[];
  hasNext: boolean;
}>;
