import { PartShell } from "@/components/v3/PartShell";
import { Calendar } from "@/components/v3/calendar/Calendar";
import { gridDays, resolveDay, resolveView } from "@/components/v3/calendar/types";
import { requirePlatformAdmissionsActor } from "@/lib/platform-guards";
import { readCalendarTasks, readCaseOptions, readToday } from "@/lib/v3/calendar-source";

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
  const [tasks, cases] = await Promise.all([
    readCalendarTasks(actor, days[0], days[days.length - 1]),
    readCaseOptions(actor),
  ]);

  return (
    <PartShell title="Календарь">
      <Calendar
        view={view}
        day={day}
        today={today}
        days={days}
        tasks={tasks}
        cases={cases}
        basePath="/v3/calendar"
      />
    </PartShell>
  );
}
