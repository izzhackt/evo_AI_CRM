import Link from "next/link";

import { Pill } from "@/components/v3/Pill";
import { applicationStatus } from "@/lib/v3/wording";

import {
  type CalendarApplicationDeadline,
  type Day,
  dayDelta,
  dayLabel,
} from "./types";

function applicationHref(deadline: CalendarApplicationDeadline): string {
  return `/v3/profile?case=${encodeURIComponent(deadline.studentCaseId)}&tab=overview#applications`;
}

export function ApplicationDeadlineChip({
  deadline,
}: Readonly<{ deadline: CalendarApplicationDeadline }>) {
  const status = applicationStatus(deadline.status);
  return (
    <Link
      href={applicationHref(deadline)}
      className="flex min-h-11 w-full flex-col items-start gap-0.5 rounded-nav border border-accent/40 bg-accent/5 px-1.5 py-1 text-start hover:border-accent hover:bg-accent/10"
      aria-label={`Дедлайн заявки: ${deadline.universityName}, ${deadline.programName}, ${deadline.studentDisplayName}`}
    >
      <span className="line-clamp-2 w-full break-words text-xs font-semibold text-fg">
        {deadline.universityName} · {deadline.programName}
      </span>
      <span className="flex w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs text-fg-3">
        <span>{deadline.studentDisplayName}</span>
        {status ? <Pill tone="neutral">{status}</Pill> : null}
      </span>
    </Link>
  );
}

export function nearestDeadlineLabel(today: Day, deadline: Day): string {
  const delta = dayDelta(today, deadline);
  if (delta < 0) return `Просрочено ${Math.abs(delta)} дн`;
  if (delta === 0) return "Сегодня";
  return `До дедлайна ${delta} дн`;
}

export function NearestApplicationDeadline({
  today,
  deadline,
}: Readonly<{
  today: Day;
  deadline: CalendarApplicationDeadline | null;
}>) {
  return (
    <section
      aria-label="Ближайший дедлайн заявки"
      className="rounded-card border border-border bg-surface p-4"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-fg-3">
        Ближайший дедлайн
      </p>
      {deadline ? (
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-fg">
              {nearestDeadlineLabel(today, deadline.day)}
            </p>
            <p className="mt-1 text-sm text-fg-2">
              {dayLabel(deadline.day)} · {deadline.universityName} · {deadline.programName}
            </p>
            <p className="mt-1 text-xs text-fg-3">{deadline.studentDisplayName}</p>
          </div>
          <Link
            href={applicationHref(deadline)}
            className="inline-flex min-h-11 items-center rounded-ctl px-3 text-sm font-medium text-accent hover:bg-surface-2 hover:underline"
          >
            Открыть заявку
          </Link>
        </div>
      ) : (
        <p className="mt-2 text-sm text-fg-3">Активных дедлайнов нет.</p>
      )}
    </section>
  );
}
