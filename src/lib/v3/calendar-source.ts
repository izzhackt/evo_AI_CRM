import "server-only";

import type {
  CalendarApplicationDeadline,
  CalendarAssigneeOption,
  CalendarCaseOption,
  CalendarTask,
  Day,
} from "@/components/v3/calendar/types";
import { listPlatformStudentCases } from "@/lib/platform-admissions";
import type {
  PlatformAdmissionsTaskQueueCursor,
  PlatformAdmissionsTaskQueueRow,
} from "@/lib/platform-admissions-task-contract";
import {
  getPlatformAdmissionsTaskWorkspace,
  listPlatformAdmissionsTaskQueue,
} from "@/lib/platform-admissions-workspace";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { PLATFORM_ORGANIZATION_TIMEZONE } from "@/lib/platform-organization-time";
import {
  dayInOrganizationTimezone,
  projectPlatformTaskDeadline,
} from "@/lib/platform-task-deadline";
import {
  assertCalendarDatedTaskPageOrder,
  listCalendarApplicationDeadlinePage,
  listCalendarUndatedTaskPage,
  readNearestCalendarApplicationDeadline,
  type CalendarApplicationDeadlineCursor,
  type CalendarApplicationDeadlineRow,
  type CalendarUndatedTaskCursor,
} from "@/lib/v3/calendar-contract";

const QUEUE_PAGE_SIZE = 100;
const CASE_PAGE_SIZE = 100;

/** Today in the same Bishkek calendar used to place canonical task deadlines. */
export async function readToday(): Promise<Day> {
  return dayInOrganizationTimezone(new Date());
}

const CLOCK_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: PLATFORM_ORGANIZATION_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Minutes since local midnight on the same Bishkek clock as task deadlines. */
export async function readNowMinutes(): Promise<number> {
  const parts = CLOCK_PARTS.formatToParts(new Date());
  const read = (type: "hour" | "minute") =>
    Number(parts.find((part) => part.type === type)?.value);
  const minutes = read("hour") * 60 + read("minute");
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) {
    throw new Error("V3 calendar cannot read the organization clock.");
  }
  return minutes;
}

export type CalendarTasksRead = Readonly<{
  tasks: readonly CalendarTask[];
  undatedNextCursor: CalendarUndatedTaskCursor | null;
}>;

function calendarTaskFromRow(
  row: Omit<PlatformAdmissionsTaskQueueRow, "sortAt">,
  now: Date,
): CalendarTask {
  const deadline = projectPlatformTaskDeadline(row.dueOn, row.dueAt, now);
  return Object.freeze({
    id: row.caseTaskId,
    studentCaseId: row.studentCaseId,
    taskType: row.taskType,
    title: row.title,
    details: null,
    dueOn: row.dueOn,
    dueAt: row.dueAt,
    day: deadline.day,
    minutes: deadline.minutes,
    overdue: deadline.overdue,
    state: row.status,
    cancelReason: null,
    person: row.studentDisplayName,
    priority: row.priority,
    studentVisible: row.studentVisible,
    assigneeMembershipId: row.assigneeMembershipId,
    assigneeDisplayName: row.assigneeDisplayName,
    caseState: row.caseState,
    version: row.version,
  });
}

/**
 * Exhaust the selected dated task range and read one bounded page from the
 * dedicated undated projection. The adapter never scans dated history to
 * discover NULL deadlines and never materializes the full undated history.
 */
export async function readCalendarTasks(
  actor: ActivePlatformActor,
  from: Day,
  to: Day,
  undatedCursor: CalendarUndatedTaskCursor | null = null,
): Promise<CalendarTasksRead> {
  const now = new Date();
  const tasks: CalendarTask[] = [];
  const seenTaskIds = new Set<string>();

  let datedCursor: PlatformAdmissionsTaskQueueCursor | null = null;
  do {
    const page = await listPlatformAdmissionsTaskQueue(actor, {
      pageSize: QUEUE_PAGE_SIZE,
      cursor: datedCursor,
      dueFrom: from,
      dueTo: to,
    });
    assertCalendarDatedTaskPageOrder(page.rows, datedCursor);
    for (const row of page.rows) {
      const task = calendarTaskFromRow(row, now);
      if (
        task.day === null ||
        task.day < from ||
        task.day > to ||
        seenTaskIds.has(task.id)
      ) {
        throw new Error("V3 calendar received an invalid dated task page.");
      }
      seenTaskIds.add(task.id);
      tasks.push(task);
    }
    datedCursor = page.nextCursor;
  } while (datedCursor !== null);

  const undatedPage = await listCalendarUndatedTaskPage(actor, {
    pageSize: QUEUE_PAGE_SIZE,
    cursor: undatedCursor,
  });
  for (const row of undatedPage.rows) {
    const task = calendarTaskFromRow(row, now);
    if (task.day !== null || seenTaskIds.has(task.id)) {
      throw new Error("V3 calendar received an invalid undated task page.");
    }
    seenTaskIds.add(task.id);
    tasks.push(task);
  }

  return Object.freeze({
    tasks: Object.freeze(tasks),
    undatedNextCursor: undatedPage.nextCursor,
  });
}

function calendarDeadlineFromRow(
  row: CalendarApplicationDeadlineRow,
): CalendarApplicationDeadline {
  return Object.freeze({
    kind: "application_deadline",
    id: row.sourceKey,
    deadlineKind: row.deadlineKind,
    studentCaseId: row.studentCaseId,
    studentDisplayName: row.studentDisplayName,
    universityName: row.universityName,
    programName: row.programName,
    status: row.status,
    day: row.deadline,
  });
}

async function readCalendarApplicationDeadlines(
  actor: ActivePlatformActor,
  from: Day,
  to: Day,
): Promise<readonly CalendarApplicationDeadline[]> {
  const deadlines: CalendarApplicationDeadline[] = [];
  const seenApplicationIds = new Set<string>();
  let cursor: CalendarApplicationDeadlineCursor | null = null;
  do {
    const page = await listCalendarApplicationDeadlinePage(actor, {
      pageSize: QUEUE_PAGE_SIZE,
      cursor,
      from,
      to,
    });
    for (const row of page.rows) {
      if (seenApplicationIds.has(row.sourceKey)) {
        throw new Error("V3 calendar received a duplicate application deadline.");
      }
      seenApplicationIds.add(row.sourceKey);
      deadlines.push(calendarDeadlineFromRow(row));
    }
    cursor = page.nextCursor;
  } while (cursor !== null);
  return Object.freeze(deadlines);
}

async function readActiveCases(
  actor: ActivePlatformActor,
): Promise<Readonly<{
  rows: readonly CalendarCaseOption[];
  hasNext: boolean;
}>> {
  const cases: CalendarCaseOption[] = [];
  const caseIds = new Set<string>();
  const page = await listPlatformStudentCases(actor, {
    pageSize: CASE_PAGE_SIZE,
    state: "active",
  });

  for (const entry of page.rows) {
    if (entry.access !== "full" || entry.studentCase.state !== "active") {
      throw new Error("V3 calendar received an unauthorized case projection.");
    }
    if (caseIds.has(entry.studentCase.studentCaseId)) {
      throw new Error("V3 calendar received a duplicate canonical case.");
    }
    caseIds.add(entry.studentCase.studentCaseId);
    cases.push({
      id: entry.studentCase.studentCaseId,
      name: entry.studentCase.studentDisplayName,
    });
  }

  return Object.freeze({
    rows: Object.freeze(cases),
    hasNext: page.hasNext,
  });
}

export type CalendarWorkspace = Readonly<{
  tasks: readonly CalendarTask[];
  undatedNextCursor: CalendarUndatedTaskCursor | null;
  applicationDeadlines: readonly CalendarApplicationDeadline[];
  nearestApplicationDeadline: CalendarApplicationDeadline | null;
  cases: readonly CalendarCaseOption[];
  casesHaveMore: boolean;
  assignees: readonly CalendarAssigneeOption[];
}>;

export type CalendarTaskTarget = Readonly<{
  task: CalendarTask;
  assignees: readonly CalendarAssigneeOption[];
}>;

/** A case-bound link reads the real guarded workspace, never a paged task guess. */
export async function readCalendarTaskTarget(
  actor: ActivePlatformActor,
  studentCaseId: string,
  caseTaskId: string,
): Promise<CalendarTaskTarget | null> {
  const page = await listPlatformStudentCases(actor, { studentCaseId, pageSize: 1 });
  const entry = page.rows[0];
  if (!entry || entry.access !== "full" ||
    entry.studentCase.studentCaseId !== studentCaseId ||
    entry.studentCase.state === "pending") return null;
  const workspace = await getPlatformAdmissionsTaskWorkspace(actor, studentCaseId);
  const task = workspace.tasks.find((row) => row.caseTaskId === caseTaskId);
  if (!task) return null;
  return Object.freeze({
    task: calendarTaskFromRow({
      ...task,
      studentDisplayName: entry.studentCase.studentDisplayName,
      caseState: entry.studentCase.state,
    }, new Date()),
    assignees: workspace.assignees.filter((row) => row.role !== "sales").map((row) => ({
      membershipId: row.membershipId,
      displayName: row.displayName,
    })),
  });
}

/**
 * One write-ready V3 calendar projection. Cases and assignees come from the
 * same authorized Supabase repositories as the task commands; there is no
 * browser-only picker data or an unbound task path.
 */
export async function readCalendarWorkspace(
  actor: ActivePlatformActor,
  from: Day,
  to: Day,
  undatedCursor: CalendarUndatedTaskCursor | null = null,
  target: CalendarTaskTarget | null = null,
): Promise<CalendarWorkspace> {
  const [read, applicationDeadlines, nearestDeadline, cases] = await Promise.all([
    readCalendarTasks(actor, from, to, undatedCursor),
    readCalendarApplicationDeadlines(actor, from, to),
    readNearestCalendarApplicationDeadline(actor),
    readActiveCases(actor),
  ]);
  const workspace = !target && cases.rows[0]
    ? await getPlatformAdmissionsTaskWorkspace(actor, cases.rows[0].id)
    : null;
  const assignees = target?.assignees ?? workspace?.assignees
    .filter((assignee) => assignee.role !== "sales")
    .map((assignee) => ({
      membershipId: assignee.membershipId,
      displayName: assignee.displayName,
    } satisfies CalendarAssigneeOption)) ?? [];

  return Object.freeze({
    tasks: target
      ? Object.freeze([target.task, ...read.tasks.filter((task) => task.id !== target.task.id)])
      : read.tasks,
    undatedNextCursor: read.undatedNextCursor,
    applicationDeadlines,
    nearestApplicationDeadline: nearestDeadline
      ? calendarDeadlineFromRow(nearestDeadline)
      : null,
    cases: cases.rows,
    casesHaveMore: cases.hasNext,
    assignees: Object.freeze(assignees),
  });
}
