import "server-only";

import type { CalendarCaseOption, CalendarCaseTask, CalendarTask, Day } from "@/components/v3/calendar/types";
import { getPlatformAdmissionsTaskTarget } from "@/lib/platform-admissions-workspace";
import { listPlatformStudentCases } from "@/lib/platform-admissions";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { staffPresentationCan } from "@/lib/platform-access";
import { PLATFORM_ORGANIZATION_TIMEZONE } from "@/lib/platform-organization-time";
import { dayInOrganizationTimezone, projectPlatformTaskDeadline } from "@/lib/platform-task-deadline";
import {
  personalCalendarAccess,
  readPersonalCalendarPage,
  readPersonalCalendarTarget,
  type PersonalCalendarCursor,
  type PersonalCalendarKind,
} from "@/lib/v3/personal-calendar-contract";

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

export async function readCalendarTasks(
  actor: ActivePlatformActor, from: Day, to: Day,
  undatedCursor: PersonalCalendarCursor | null = null,
) {
  const tasks: CalendarTask[] = [];
  const seen = new Set<string>();
  let datedCursor: PersonalCalendarCursor | null = null;
  do {
    const page = await readPersonalCalendarPage(actor, {
      mode: "dated", from, to, pageSize: QUEUE_PAGE_SIZE, cursor: datedCursor,
    });
    for (const task of page.tasks) {
      if (seen.has(task.key)) throw new Error("Personal calendar received a duplicate task.");
      seen.add(task.key);
      tasks.push(task);
    }
    datedCursor = page.nextCursor;
  } while (datedCursor !== null);
  const undated = await readPersonalCalendarPage(actor, {
    mode: "undated", pageSize: QUEUE_PAGE_SIZE, cursor: undatedCursor,
  });
  for (const task of undated.tasks) {
    if (seen.has(task.key)) throw new Error("Personal calendar received a duplicate task.");
    seen.add(task.key);
    tasks.push(task);
  }
  return { tasks: Object.freeze(tasks), undatedNextCursor: undated.nextCursor };
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

export async function readPersonalCalendarTaskTarget(
  actor: ActivePlatformActor, studentCaseId: string | null, taskId: string,
  kind: PersonalCalendarKind = "case",
) {
  return readPersonalCalendarTarget(actor, { kind, taskId, studentCaseId });
}

// Shared Tasks inspector keeps its existing object scope, independently of the
// personal calendar. Its write controls continue to use canonical authority.
export async function readCalendarTaskTarget(actor: ActivePlatformActor, studentCaseId: string, taskId: string) {
  const target = await getPlatformAdmissionsTaskTarget(actor, studentCaseId, taskId);
  const row = target.task;
  const deadline = projectPlatformTaskDeadline(row.dueOn, row.dueAt, new Date());
  const task: CalendarCaseTask = {
    kind: "case", key: `case:${row.caseTaskId}`, id: row.caseTaskId, studentCaseId: row.studentCaseId,
    taskType: row.taskType, title: row.title, details: null, dueOn: row.dueOn, dueAt: row.dueAt,
    day: deadline.day, minutes: deadline.minutes, overdue: deadline.overdue,
    state: row.status, cancelReason: null, person: row.studentDisplayName, priority: row.priority,
    studentVisible: row.studentVisible, assigneeMembershipId: row.assigneeMembershipId,
    assigneeDisplayName: row.assigneeDisplayName, caseState: row.caseState, version: row.version,
  };
  return { task, assignees: target.assignees.map(item => ({ membershipId: item.membershipId, displayName: item.displayName })),
    capabilities: { taskId: task.id, studentCaseId: task.studentCaseId, ...target.capabilities } };
}

export type CalendarTaskTarget = Awaited<ReturnType<typeof readPersonalCalendarTaskTarget>>;

export async function readCalendarWorkspace(
  actor: ActivePlatformActor, from: Day, to: Day,
  undatedCursor: PersonalCalendarCursor | null = null,
  target: CalendarTaskTarget | null = null,
) {
  const access = personalCalendarAccess(actor);
  // An unavailable branch is never called; an allowed read failure propagates.
  const [read, cases] = await Promise.all([
    access.tasks ? readCalendarTasks(actor, from, to, undatedCursor) : null,
    staffPresentationCan(actor, "admissions.read") ? readActiveCases(actor) : null,
  ]);
  const tasks = read?.tasks ?? [];
  return Object.freeze({
    access,
    tasks: target ? Object.freeze([target.task, ...tasks.filter(task => task.key !== target.task.key)]) : tasks,
    undatedNextCursor: read?.undatedNextCursor ?? null,
    cases: cases?.rows ?? [], casesHaveMore: cases?.hasNext ?? false,
    assignees: target?.assignees ?? [],
  });
}
