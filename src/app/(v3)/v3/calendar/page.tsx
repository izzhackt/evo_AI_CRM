import { randomUUID } from "node:crypto";

import { notFound } from "next/navigation";

import { PartShell } from "@/components/v3/PartShell";
import { OperationsOverview } from "@/components/v3/OperationsOverview";
import { Calendar } from "@/components/v3/calendar/Calendar";
import {
  calendarUndatedContinuationHref,
  gridDays,
  resolveDay,
  resolveView,
} from "@/components/v3/calendar/types";
import { requireV3PageActor } from "@/lib/platform-guards";
import { parsePlatformAdmissionsUuid } from "@/lib/platform-admissions";
import { parseCalendarUndatedTaskCursor } from "@/lib/v3/calendar-contract";
import { readCalendarTaskTarget, readCalendarWorkspace, readNowMinutes, readToday } from "@/lib/v3/calendar-source";
import { readV3OperationalDashboard } from "@/lib/v3/operations-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Календарь" };

type CalendarSearchParams = Readonly<{
  case?: string | string[];
  task?: string | string[];
  view?: string | string[];
  date?: string | string[];
  undated_after_sort_at?: string | string[];
  undated_after_case_task_id?: string | string[];
}>;

function singleValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) notFound();
  return value;
}

function undatedCursorFromParams(params: CalendarSearchParams) {
  const sortAt = singleValue(params.undated_after_sort_at);
  const caseTaskId = singleValue(params.undated_after_case_task_id);
  if (sortAt === undefined && caseTaskId === undefined) return null;
  if (sortAt === undefined || caseTaskId === undefined) notFound();
  const cursor = parseCalendarUndatedTaskCursor(sortAt, caseTaskId);
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
  const hasTarget = caseParam !== undefined || taskParam !== undefined;
  const caseId = parsePlatformAdmissionsUuid(caseParam);
  const taskId = parsePlatformAdmissionsUuid(taskParam);
  if (hasTarget && (!caseId || !taskId)) notFound();
  const target = caseId && taskId ? await readCalendarTaskTarget(actor, caseId, taskId) : null;
  if (hasTarget && !target) notFound();
  const day = target?.task.day ?? resolveDay(singleValue(params.date), today);
  // Deep links include their authorized task even beyond the first undated page.
  const requestedCursor = undatedCursorFromParams(params);
  const undatedCursor = target ? null : requestedCursor;
  const days = gridDays(view, day);
  const [workspace, operations] = await Promise.all([
    readCalendarWorkspace(actor, days[0], days[days.length - 1], undatedCursor, target),
    readV3OperationalDashboard(actor),
  ]);
  const taskRequestIds = Object.fromEntries(
    workspace.tasks.map((task) => [
      task.id,
      {
        change: randomUUID(),
        complete: randomUUID(),
        cancel: randomUUID(),
      },
    ]),
  );

  return (
    <PartShell title="Календарь">
      <div className="space-y-8">
        <Calendar
          key={`${view}:${day}:${target?.task.id ?? ""}`}
          initialTaskId={target?.task.id ?? null}
          view={view}
          day={day}
          today={today}
          nowMinutes={nowMinutes}
          days={days}
          tasks={workspace.tasks}
          undatedContinuationPage={undatedCursor !== null}
          undatedNextHref={workspace.undatedNextCursor
            ? calendarUndatedContinuationHref(
                "/v3/calendar",
                view,
                day,
                workspace.undatedNextCursor,
              )
            : null}
          applicationDeadlines={workspace.applicationDeadlines}
          nearestApplicationDeadline={workspace.nearestApplicationDeadline}
          cases={workspace.cases}
          casesHaveMore={workspace.casesHaveMore}
          assignees={workspace.assignees}
          actorMembershipId={actor.membershipId}
          authorityRole={actor.authorityRole}
          presentationRole={actor.presentationRole}
          createRequestId={randomUUID()}
          taskRequestIds={taskRequestIds}
          basePath="/v3/calendar"
        />
        <OperationsOverview snapshot={operations} />
      </div>
    </PartShell>
  );
}
