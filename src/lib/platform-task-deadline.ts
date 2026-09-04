import {
  PLATFORM_ORGANIZATION_TIMEZONE,
  PLATFORM_ORGANIZATION_UTC_OFFSET,
} from "./platform-organization-time.ts";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: PLATFORM_ORGANIZATION_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const TIME_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: PLATFORM_ORGANIZATION_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function part(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const value = parts.find((candidate) => candidate.type === type)?.value;
  if (!value) throw new Error("Platform task date formatting is unavailable.");
  return value;
}

export function dayInOrganizationTimezone(value: Date): string {
  if (!Number.isFinite(value.getTime())) {
    throw new Error("Platform task calendar received an invalid clock.");
  }
  const parts = DAY_PARTS.formatToParts(value);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}

function minutesInOrganizationTimezone(value: Date): number {
  const parts = TIME_PARTS.formatToParts(value);
  return Number(part(parts, "hour")) * 60 + Number(part(parts, "minute"));
}

export type PlatformTaskDeadlineProjection = Readonly<{
  day: string | null;
  minutes: number | null;
  overdue: boolean;
}>;

/** One canonical deadline becomes one calendar placement, never a fallback. */
export function projectPlatformTaskDeadline(
  dueOn: string | null,
  dueAt: string | null,
  now: Date,
): PlatformTaskDeadlineProjection {
  const today = dayInOrganizationTimezone(now);
  if (dueOn !== null && dueAt !== null) {
    throw new Error("Platform task received two canonical deadlines.");
  }
  if (dueOn !== null) {
    const parsed = new Date(`${dueOn}T00:00:00Z`);
    if (
      !ISO_DATE_PATTERN.test(dueOn) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== dueOn
    ) {
      throw new Error("Platform task received an invalid all-day deadline.");
    }
    return Object.freeze({ day: dueOn, minutes: null, overdue: today > dueOn });
  }
  if (dueAt !== null) {
    const instant = new Date(dueAt);
    if (!Number.isFinite(instant.getTime())) {
      throw new Error("Platform task received an invalid timed deadline.");
    }
    return Object.freeze({
      day: dayInOrganizationTimezone(instant),
      minutes: minutesInOrganizationTimezone(instant),
      overdue: instant.getTime() < now.getTime(),
    });
  }
  return Object.freeze({ day: null, minutes: null, overdue: false });
}

/** Mirrors the canonical queue ordering for timed, all-day, then unscheduled work. */
export function platformTaskDeadlineSortTime(
  dueOn: string | null,
  dueAt: string | null,
): number {
  projectPlatformTaskDeadline(dueOn, dueAt, new Date(0));
  const value = dueAt ?? (dueOn === null
    ? "9999-12-31T00:00:00Z"
    : `${dueOn}T00:00:00${PLATFORM_ORGANIZATION_UTC_OFFSET}`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Platform task received an invalid queue deadline.");
  }
  return parsed;
}
