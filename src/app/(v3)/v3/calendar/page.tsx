import { randomUUID } from "node:crypto";

import { notFound } from "next/navigation";

import { PartShell } from "@/components/v3/PartShell";
import { Calendar } from "@/components/v3/calendar/Calendar";
import {
  calendarUndatedContinuationHref,
  gridDays,
  resolveDay,
  resolveView,
} from "@/components/v3/calendar/types";
import { requireV3PageActor } from "@/lib/platform-guards";
import { parsePlatformAdmissionsUuid } from "@/lib/platform-admissions";
import { parsePersonalCalendarCursor, PersonalCalendarReadError } from "@/lib/v3/personal-calendar-contract";
import { readPersonalCalendarTaskTarget, readCalendarWorkspace, readNowMinutes, readToday } from "@/lib/v3/calendar-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "Календарь" };

type CalendarSearchParams = Readonly<{
  case?: string | string[];
  task?: string | string[];
  kind?: string | string[];
  view?: string | string[];
  date?: string | string[];
  undated_after_sort_at?: string | string[];
  undated_after_case_task_id?: string | string[];
  undated_after_kind?: string | string[];
  undated_after_task_id?: string | string[];
}>;

function singleValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) notFound();
  return value;
}

function undatedCursorFromParams(params: CalendarSearchParams) {
  const sortAt = singleValue(params.undated_after_sort_at);
  const legacyId = singleValue(params.undated_after_case_task_id);
  const kind = singleValue(params.undated_after_kind);
  const taskId = singleValue(params.undated_after_task_id);
  if ([sortAt, legacyId, kind, taskId].every(value => value === undefined)) return null;
  if (legacyId !== undefined && (kind !== undefined || taskId !== undefined)) notFound();
  const cursor = parsePersonalCalendarCursor(sortAt, legacyId !== undefined ? "case" : kind, legacyId ?? taskId, true);
  if (cursor === null) notFound();
  return cursor;
}

/**
 * Вид и период приходят адресом, а не состоянием: страницу можно переслать, и
 * «назад» в браузере возвращает на прежнюю неделю.
 *
 * Отрезок для чтения считается тут же, из вида: сетка месяца захватывает
 * хвосты соседних месяцев, и прочитать ровно месяц значило бы оставить эти
 * клетки пустыми при непустой базе.
 */
export default async function CalendarPart({
  searchParams,
}: {
  searchParams: Promise<CalendarSearchParams>;
}) {
  const [params, today, nowMinutes, actor] = await Promise.all([
    searchParams,
    readToday(),
    readNowMinutes(),
    requireV3PageActor("/v3/calendar"),
  ]);

  const view = resolveView(singleValue(params.view));
  const caseParam = singleValue(params.case);
  const taskParam = singleValue(params.task);
  const kindParam = singleValue(params.kind);
  const hasTarget = caseParam !== undefined || taskParam !== undefined || kindParam !== undefined;
  const caseId = parsePlatformAdmissionsUuid(caseParam);
  const taskId = parsePlatformAdmissionsUuid(taskParam);
  const kind = kindParam === undefined ? "case" : kindParam;
  if (hasTarget && (!taskId || (kind !== "case" && kind !== "staff")
    || (kind === "case" && !caseId) || (kind === "staff" && caseParam !== undefined))) notFound();
  const undatedCursor = undatedCursorFromParams(params);
  let target: Awaited<ReturnType<typeof readPersonalCalendarTaskTarget>> | null = null;
  let unavailableTarget: { key: string; returnHref: string } | null = null;
  if (hasTarget && taskId && (kind === "case" || kind === "staff")) {
    try {
      target = await readPersonalCalendarTaskTarget(actor, caseId, taskId, kind);
    } catch (error) {
      if (!(error instanceof PersonalCalendarReadError) || !error.unavailable) throw error;
      const returnDay = resolveDay(singleValue(params.date), today);
      const returnHref = undatedCursor
        ? calendarUndatedContinuationHref("/v3/calendar", view, returnDay, undatedCursor)
        : `/v3/calendar?${new URLSearchParams({ view, date: returnDay })}`;
      unavailableTarget = { key: `${kind}:${taskId}`, returnHref };
    }
  }
  const requestedDay = singleValue(params.date);
  const day = requestedDay !== undefined ? resolveDay(requestedDay, today) : target?.task.day ?? today;
  const days = gridDays(view, day);
  const workspace = await readCalendarWorkspace(actor, days[0], days[days.length - 1], undatedCursor, target);
  const taskRequestIds = Object.fromEntries(
    workspace.tasks.map((task) => [
      task.key,
      {
        change: randomUUID(),
        complete: randomUUID(),
        cancel: randomUUID(),
      },
    ]),
  );

  return (
    <PartShell title="Календарь">
      <Calendar
        key={JSON.stringify([actor.organizationId, actor.authUserId, actor.membershipId, actor.platformAccessVersion, actor.presentationRole])}
        initialTaskKey={target?.task.key ?? null}
        unavailableTarget={unavailableTarget}
        taskCapabilities={target?.capabilities ?? null}
        view={view}
        day={day}
        today={today}
        nowMinutes={nowMinutes}
        days={days}
        tasks={workspace.tasks}
        readAccess={workspace.access}
        undatedContinuationPage={workspace.access.tasks && undatedCursor !== null}
        undatedNextHref={workspace.undatedNextCursor
          ? calendarUndatedContinuationHref(
              "/v3/calendar",
              view,
              day,
              workspace.undatedNextCursor,
            )
          : null}
        undatedCursor={undatedCursor}
        cases={workspace.cases}
        casesHaveMore={workspace.casesHaveMore}
        assignees={workspace.assignees}
        actorMembershipId={actor.membershipId}
        actor={actor}
        createRequestId={randomUUID()}
        taskRequestIds={taskRequestIds}
        basePath="/v3/calendar"
      />
    </PartShell>
  );
}
