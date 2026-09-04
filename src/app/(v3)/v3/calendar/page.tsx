import { randomUUID } from "node:crypto";

import { PartShell } from "@/components/v3/PartShell";
import { Calendar } from "@/components/v3/calendar/Calendar";
import { gridDays, resolveDay, resolveView } from "@/components/v3/calendar/types";
import { requirePlatformAdmissionsActor } from "@/lib/platform-guards";
import { readCalendarWorkspace, readToday } from "@/lib/v3/calendar-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Календарь" };

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
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const [params, today, actor] = await Promise.all([
    searchParams,
    readToday(),
    requirePlatformAdmissionsActor(),
  ]);

  const view = resolveView(params.view);
  const day = resolveDay(params.date, today);
  const days = gridDays(view, day);
  if (actor.authorityRole !== "admin" && actor.authorityRole !== "admissions") {
    throw new Error("Admissions calendar resolved a non-Admissions staff role.");
  }
  const workspace = await readCalendarWorkspace(
    actor,
    days[0],
    days[days.length - 1],
  );
  const taskRequestIds = Object.fromEntries(
    workspace.tasks.map((task) => [task.id, { complete: randomUUID() }]),
  );

  return (
    <PartShell title="Календарь">
      <Calendar
        view={view}
        day={day}
        today={today}
        days={days}
        tasks={workspace.tasks}
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
    </PartShell>
  );
}
