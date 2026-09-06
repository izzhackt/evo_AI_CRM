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
import { PLATFORM_ORGANIZATION_TIMEZONE } from "@/lib/platform-organization-time";
import {
  dayInOrganizationTimezone,
  projectPlatformTaskDeadline,
} from "@/lib/platform-task-deadline";

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
  /**
   * День срока последней прочитанной задачи, когда очередь оборвана внутри
   * отрезка; обрыв может рассечь этот день пополам, поэтому экран называет
   * его включительно («{дата} и позже прочитаны не полностью»). null при
   * periodComplete=false означает обрыв без известной даты (например, при
   * сломанном порядке очереди) — плашка тогда безадресная. Канонический RPC
   * читает одну страницу без курсора и без фильтра по датам, добрать хвост
   * отсюда нечем: обрыв выносится на экран фактом, а не роняет страницу.
   */
  truncatedAfter: Day | null;
  /**
   * Отрезок [from, to] дочитан до конца: «на этот период задач нет» — правда,
   * а не обрыв чтения. Очередь отсортирована по сроку, поэтому обрыв на дне
   * позже `to` (или на задачах без срока — они в самом хвосте) не отнимает
   * у отрезка ни одной задачи со сроком.
   */
  periodComplete: boolean;
}>;

/**
 * Read the current actor's canonical Admissions task queue through Supabase.
 * The adapter only narrows it to the calendar interval; it never reads a
 * second database authority or invents task details absent from the RPC.
 */
export async function readCalendarTasks(
  actor: ActivePlatformActor,
  from: Day,
  to: Day,
): Promise<CalendarTasksRead> {
  const queue = await listPlatformAdmissionsTaskQueue(actor, {
    pageSize: QUEUE_PAGE_SIZE,
  });

  const now = new Date();

  // Вывод «отрезок дочитан» держится на сортировке очереди по сроку.
  // Предположение проверяется, а не берётся на веру: сломанный порядок
  // означает, что по хвосту ничего сказать нельзя, и чтение считается
  // оборванным (consеrvативно, в пользу честности).
  let orderedByDeadline = true;
  let previousDay: Day | null = null;
  let seenUndated = false;
  for (const row of queue.rows) {
    const day = projectPlatformTaskDeadline(row.dueOn, row.dueAt, now).day;
    if (day === null) {
      seenUndated = true;
      continue;
    }
    if (seenUndated || (previousDay !== null && day < previousDay)) {
      orderedByDeadline = false;
      break;
    }
    previousDay = day;
  }

  let truncatedAfter: Day | null = null;
  let periodComplete = true;
  if (queue.hasNext) {
    const tail = queue.rows[queue.rows.length - 1];
    const tailDay = tail
      ? projectPlatformTaskDeadline(tail.dueOn, tail.dueAt, now).day
      : null;
    periodComplete =
      orderedByDeadline && (tailDay === null || tailDay > to);
    if (!periodComplete) truncatedAfter = tailDay;
  }

  const tasks = queue.rows.flatMap((row) => {
    const deadline = projectPlatformTaskDeadline(row.dueOn, row.dueAt, now);
    const day = deadline.day;
    if (day !== null && (day < from || day > to)) return [];

    return [{
      id: row.caseTaskId,
      studentCaseId: row.studentCaseId,
      taskType: row.taskType,
      title: row.title,
      details: null,
      dueOn: row.dueOn,
      dueAt: row.dueAt,
      day,
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
    } satisfies CalendarTask];
  });

  return Object.freeze({
    tasks: Object.freeze(tasks),
    truncatedAfter,
    periodComplete,
  });
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
  /** Очередь отдала первые N задач по сроку; null — прочитаны все. */
  tasksTruncatedAfter: Day | null;
  /** Видимый отрезок дочитан: пустой период — факт, а не обрыв чтения. */
  periodComplete: boolean;
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
  const [read, cases] = await Promise.all([
    readCalendarTasks(actor, from, to),
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
    tasksTruncatedAfter: read.truncatedAfter,
    periodComplete: read.periodComplete,
    cases: cases.rows,
    casesHaveMore: cases.hasNext,
    assignees: Object.freeze(assignees),
  });
}
