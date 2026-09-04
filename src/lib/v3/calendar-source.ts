import "server-only";

import type { CalendarTask, CaseOption, Day, TaskState } from "@/components/v3/calendar/types";
import { listPlatformAdmissionsTaskQueue } from "@/lib/platform-admissions-workspace";
import {
  listPlatformStudentCases,
  type PlatformAdmissionsCursor,
} from "@/lib/platform-admissions";
import type { PlatformCaseTaskStatus } from "@/lib/platform-admissions-task-contract";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { ORG_TIMEZONE } from "@/lib/v3/period";

const QUEUE_PAGE_SIZE = 100;

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

const TASK_STATE: Readonly<Record<PlatformCaseTaskStatus, TaskState | null>> = {
  open: "open",
  in_progress: "open",
  // V3 has no honest blocked state yet. Omitting the pill is safer than
  // labelling a blocked task as open, completed, or cancelled.
  blocked: null,
  done: "completed",
  cancelled: "cancelled",
};

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
    if (row.dueAt === null) return [];

    const dueAt = new Date(row.dueAt);
    if (!Number.isFinite(dueAt.getTime())) {
      throw new Error("V3 calendar received an invalid canonical task deadline.");
    }

    const day = dayInOrganizationTimezone(dueAt);
    if (day < from || day > to) return [];

    return [{
      id: row.caseTaskId,
      title: row.title,
      // These fields are not exposed by staff_case_task_queue. Null is the
      // truthful value until the canonical read contract supplies them.
      details: null,
      day,
      minutes: minutesInOrganizationTimezone(dueAt),
      state: TASK_STATE[row.status],
      cancelReason: null,
      person: row.studentDisplayName,
    } satisfies CalendarTask];
  });
}

/** Active handed-off cases available to the current Admissions actor. */
export async function readCaseOptions(
  actor: ActivePlatformActor,
): Promise<readonly CaseOption[]> {
  const cases: CaseOption[] = [];
  let cursor: PlatformAdmissionsCursor | null = null;

  do {
    const page = await listPlatformStudentCases(actor, {
      cursor,
      pageSize: QUEUE_PAGE_SIZE,
      state: "active",
    });

    for (const item of page.rows) {
      if (item.access !== "full") {
        throw new Error("V3 calendar received a non-Admissions case projection.");
      }
      cases.push({
        id: item.studentCase.studentCaseId,
        person: item.studentCase.studentDisplayName,
      });
    }

    if (!page.hasNext) break;
    if (page.nextCursor === null) {
      throw new Error("V3 calendar case pagination is unavailable.");
    }
    cursor = page.nextCursor;
  } while (true);

  return cases.toSorted((left, right) =>
    left.person.localeCompare(right.person, "ru"));
}
