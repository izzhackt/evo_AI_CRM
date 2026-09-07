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
}>;

function calendarTaskFromRow(
  row: PlatformAdmissionsTaskQueueRow,
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
 * Exhaust the selected dated task range and the dedicated undated projection.
 * The adapter never scans dated history to discover NULL deadlines.
 */
export async function readCalendarTasks(
  actor: ActivePlatformActor,
  from: Day,
  to: Day,
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

  let undatedCursor: CalendarUndatedTaskCursor | null = null;
  do {
    const page = await listCalendarUndatedTaskPage(actor, {
      pageSize: QUEUE_PAGE_SIZE,
      cursor: undatedCursor,
    });
    for (const row of page.rows) {
      const task = calendarTaskFromRow(row, now);
      if (task.day !== null || seenTaskIds.has(task.id)) {
        throw new Error("V3 calendar received an invalid undated task page.");
      }
      seenTaskIds.add(task.id);
      tasks.push(task);
    }
    undatedCursor = page.nextCursor;
  } while (undatedCursor !== null);

  return Object.freeze({ tasks: Object.freeze(tasks) });
}

function calendarDeadlineFromRow(
  row: CalendarApplicationDeadlineRow,
): CalendarApplicationDeadline {
  return Object.freeze({
    kind: "application_deadline",
    id: row.applicationId,
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
      if (seenApplicationIds.has(row.applicationId)) {
        throw new Error("V3 calendar received a duplicate application deadline.");
      }
      seenApplicationIds.add(row.applicationId);
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
  applicationDeadlines: readonly CalendarApplicationDeadline[];
  nearestApplicationDeadline: CalendarApplicationDeadline | null;
  cases: readonly CalendarCaseOption[];
  casesHaveMore: boolean;
  assignees: readonly CalendarAssigneeOption[];
}>;

/**
 * One write-ready V3 calendar projection. Cases and assignees come from the
 * same authorized Supabase repositories as the task commands; there is no
 * browser-only picker data or an unbound task path.
 */
export async function readCalendarWorkspace(
  actor: ActivePlatformActor,
  from: Day,
  to: Day,
): Promise<CalendarWorkspace> {
  const [read, applicationDeadlines, nearestDeadline, cases] = await Promise.all([
    readCalendarTasks(actor, from, to),
    readCalendarApplicationDeadlines(actor, from, to),
    readNearestCalendarApplicationDeadline(actor),
    readActiveCases(actor),
  ]);
  const workspace = cases.rows[0]
    ? await getPlatformAdmissionsTaskWorkspace(actor, cases.rows[0].id)
    : null;
  const assignees = workspace?.assignees
    .filter((assignee) => assignee.role !== "sales")
    .map((assignee) => ({
      membershipId: assignee.membershipId,
      displayName: assignee.displayName,
    } satisfies CalendarAssigneeOption)) ?? [];

  return Object.freeze({
    tasks: read.tasks,
    applicationDeadlines,
    nearestApplicationDeadline: nearestDeadline
      ? calendarDeadlineFromRow(nearestDeadline)
      : null,
    cases: cases.rows,
    casesHaveMore: cases.hasNext,
    assignees: Object.freeze(assignees),
  });
}
