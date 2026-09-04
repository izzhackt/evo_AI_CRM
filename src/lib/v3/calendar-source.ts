import "server-only";

import type {
  CalendarAssigneeOption,
  CalendarCaseOption,
  CalendarTask,
  Day,
} from "@/components/v3/calendar/types";
import { listPlatformStudentCases } from "@/lib/platform-admissions";
import {
  getPlatformAdmissionsTaskWorkspace,
  listPlatformAdmissionsTaskQueue,
} from "@/lib/platform-admissions-workspace";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { ORG_TIMEZONE } from "@/lib/v3/period";

const QUEUE_PAGE_SIZE = 100;
const CASE_PAGE_SIZE = 100;

const DAY_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: ORG_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const TIME_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: ORG_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function part(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const value = parts.find((candidate) => candidate.type === type)?.value;
  if (!value) throw new Error("V3 calendar date formatting is unavailable.");
  return value;
}

function dayInOrganizationTimezone(value: Date): Day {
  const parts = DAY_PARTS.formatToParts(value);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}

function minutesInOrganizationTimezone(value: Date): number {
  const parts = TIME_PARTS.formatToParts(value);
  return Number(part(parts, "hour")) * 60 + Number(part(parts, "minute"));
}

/** Today in the same Bishkek calendar used to place canonical task deadlines. */
export async function readToday(): Promise<Day> {
  return dayInOrganizationTimezone(new Date());
}

/**
 * Read the current actor's canonical Admissions task queue through Supabase.
 * The adapter only narrows it to the calendar interval; it never reads a
 * second database authority or invents task details absent from the RPC.
 */
export async function readCalendarTasks(
  actor: ActivePlatformActor,
  from: Day,
  to: Day,
): Promise<readonly CalendarTask[]> {
  const queue = await listPlatformAdmissionsTaskQueue(actor, {
    pageSize: QUEUE_PAGE_SIZE,
  });

  if (queue.hasNext) {
    throw new Error("V3 calendar task queue exceeds its canonical read window.");
  }

  return queue.rows.flatMap((row) => {
    const dueAt = row.dueAt === null ? null : new Date(row.dueAt);
    if (dueAt && !Number.isFinite(dueAt.getTime())) {
      throw new Error("V3 calendar received an invalid canonical task deadline.");
    }

    const day = dueAt ? dayInOrganizationTimezone(dueAt) : null;
    if (day !== null && (day < from || day > to)) return [];

    return [{
      id: row.caseTaskId,
      studentCaseId: row.studentCaseId,
      taskType: row.taskType,
      title: row.title,
      details: null,
      dueAt: row.dueAt,
      day,
      minutes: dueAt ? minutesInOrganizationTimezone(dueAt) : null,
      state: row.status,
      cancelReason: null,
      person: row.studentDisplayName,
      priority: row.priority,
      studentVisible: row.studentVisible,
      assigneeMembershipId: row.assigneeMembershipId,
      assigneeDisplayName: row.assigneeDisplayName,
      caseState: row.caseState,
      version: row.version,
    } satisfies CalendarTask];
  });
}

async function readActiveCases(
  actor: ActivePlatformActor,
): Promise<Readonly<{
  cases: readonly CalendarCaseOption[];
  hasNext: boolean;
}>> {
  const page = await listPlatformStudentCases(actor, {
    pageSize: CASE_PAGE_SIZE,
    state: "active",
  });
  const cases: CalendarCaseOption[] = [];
  const caseIds = new Set<string>();

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
    cases: Object.freeze(cases),
    hasNext: page.hasNext,
  });
}

export type CalendarWorkspace = Readonly<{
  tasks: readonly CalendarTask[];
  cases: readonly CalendarCaseOption[];
  casesHaveMore: boolean;
  assignees: readonly CalendarAssigneeOption[];
}>;

/**
 * One write-ready V3 calendar projection. Cases and assignees come from the
 * same authorized Supabase repositories as the task commands; there is no
 * browser-only picker data or unbound task fallback.
 */
export async function readCalendarWorkspace(
  actor: ActivePlatformActor,
  from: Day,
  to: Day,
): Promise<CalendarWorkspace> {
  const [tasks, casePage] = await Promise.all([
    readCalendarTasks(actor, from, to),
    readActiveCases(actor),
  ]);
  const workspace = casePage.cases[0]
    ? await getPlatformAdmissionsTaskWorkspace(actor, casePage.cases[0].id)
    : null;
  const assignees = workspace?.assignees
    .filter((assignee) => assignee.role !== "sales")
    .map((assignee) => ({
      membershipId: assignee.membershipId,
      displayName: assignee.displayName,
    } satisfies CalendarAssigneeOption)) ?? [];

  return Object.freeze({
    tasks,
    cases: casePage.cases,
    casesHaveMore: casePage.hasNext,
    assignees: Object.freeze(assignees),
  });
}
