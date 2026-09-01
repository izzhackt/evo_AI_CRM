import { Funnel } from "@/components/v3/Funnel";
import {
  WorkCalendar,
  type CalendarDay,
  type CalendarTask,
} from "@/components/v3/WorkCalendar";
import { readAdmissionsFunnel } from "@/lib/v3/funnel-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Части интерфейса" };

/**
 * Полигон: части нового интерфейса собираются здесь по одной, прежде чем
 * сойтись в одну главную страницу.
 *
 * Воронка уже читает настоящую PostgreSQL. Календарь пока получает образец
 * данных прямо отсюда — сотрудников и личных задач в системе ещё нет, а форма
 * нужна сейчас. Образец живёт в странице, а не в компоненте, чтобы подключение
 * к реальным данным было заменой этого блока, а не правкой вёрстки.
 */

const SAMPLE_DAYS: CalendarDay[] = (() => {
  const grid: CalendarDay[] = [];
  const withWork = new Map([[3, 1], [4, 1], [5, 2], [6, 2], [7, 1], [8, 1], [15, 1], [22, 2]]);
  grid.push({ date: 31, inMonth: false, today: false, count: 0 });
  for (let date = 1; date <= 30; date += 1) {
    grid.push({
      date,
      inMonth: true,
      today: date === 2,
      count: withWork.get(date) ?? 0,
    });
  }
  for (let date = 1; date <= 4; date += 1) {
    grid.push({ date, inMonth: false, today: false, count: 0 });
  }
  return grid;
})();

const SAMPLE_TASKS: readonly {
  urgency: "week" | "month" | "unscheduled";
  tasks: CalendarTask[];
}[] = [
  {
    urgency: "week",
    tasks: [
      { id: "s1", title: "Проверить нострификацию аттестата", dueAt: "2026-09-03", assignedBy: "Директор", assignedTo: "Айгерим", ownerRole: "admissions", done: false, href: "#" },
      { id: "s2", title: "Подтвердить IELTS и загрузить сертификат", dueAt: "2026-09-05", assignedBy: null, assignedTo: "Айгерим", ownerRole: "admissions", done: true, href: "#" },
      { id: "s3", title: "Позвонить в приёмную комиссию вуза", dueAt: "2026-09-06", assignedBy: null, assignedTo: "Айгерим", ownerRole: "admissions", done: false, href: null },
    ],
  },
  {
    urgency: "month",
    tasks: [
      { id: "s4", title: "Сводка по осеннему набору", dueAt: "2026-09-22", assignedBy: "Директор", assignedTo: "Айгерим", ownerRole: "admissions", done: false, href: null },
    ],
  },
  {
    urgency: "unscheduled",
    tasks: [
      { id: "s5", title: "Проверить унаследованный контекст Sales", dueAt: null, assignedBy: null, assignedTo: null, ownerRole: "admissions", done: false, href: "#" },
      { id: "s6", title: "Подготовить первичный план запроса документов", dueAt: null, assignedBy: null, assignedTo: null, ownerRole: "admissions", done: false, href: "#" },
    ],
  },
];

export default async function V3Page() {
  const stages = await readAdmissionsFunnel();

  return (
    <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-8 px-4 py-8 sm:px-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">
          Воронка поступления
        </h1>
        <p className="mt-1 max-w-[56ch] text-sm leading-6 text-fg-3">
          Ступени и конверсия читаются из канонической PostgreSQL одним запросом.
        </p>
        <div className="mt-5 rounded-card bg-surface p-5">
          <Funnel stages={stages} caption="Воронка поступления" />
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-semibold tracking-[-0.02em] text-fg">
          Календарь сотрудника
        </h2>
        <p className="mt-1 max-w-[56ch] text-sm leading-6 text-fg-3">
          Форма готова; данные — образец, пока в системе нет сотрудников и личных
          задач. Компонент принимает их через props, поэтому подключение будет
          заменой источника, а не переделкой.
        </p>
        <div className="mt-5 rounded-card bg-surface p-5">
          <WorkCalendar
            monthLabel="Сентябрь"
            year={2026}
            days={SAMPLE_DAYS}
            groups={SAMPLE_TASKS}
            personName="Айгерим"
          />
        </div>
      </section>
    </main>
  );
}
