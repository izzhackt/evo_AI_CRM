import type { FixedRole } from "./fixed-role-policy";

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

export type PlatformCaseTaskStatus =
  (typeof PLATFORM_CASE_TASK_STATUSES)[number];
export type PlatformCaseTaskPriority =
  (typeof PLATFORM_CASE_TASK_PRIORITIES)[number];

export type PlatformAdmissionsTask = Readonly<{
  organizationId: string;
  caseTaskId: string;
  version: string;
  studentCaseId: string;
  taskType: string;
  title: string;
  status: PlatformCaseTaskStatus;
  priority: PlatformCaseTaskPriority;
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
