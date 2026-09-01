import Link from "next/link";

import {
  WorkCalendar,
  type CalendarDay,
  type CalendarTask,
} from "@/components/v3/WorkCalendar";

export const metadata = { title: "V3 · Календарь" };

/**
 * Образец данных живёт здесь, а не в компоненте: подключение к платформе
 * будет заменой этого блока, а не правкой вёрстки.
 */
const SAMPLE_DAYS: CalendarDay[] = (() => {
  const grid: CalendarDay[] = [{ date: 31, inMonth: false, today: false, count: 0 }];
  const work = new Map([[3, 1], [4, 1], [5, 2], [6, 2], [7, 1], [8, 1], [15, 1], [22, 2]]);
  for (let date = 1; date <= 30; date += 1) {
    grid.push({ date, inMonth: true, today: date === 2, count: work.get(date) ?? 0 });
  }
  for (let date = 1; date <= 4; date += 1) {
    grid.push({ date, inMonth: false, today: false, count: 0 });
  }
  return grid;
})();

const SAMPLE_GROUPS: readonly {
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

export default function CalendarPart() {
  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-6">
      <Link href="/v3" className="font-mono text-xs text-accent-text hover:underline">
        ← Части интерфейса
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-fg">
        Календарь сотрудника
      </h1>
      <p className="mt-1 max-w-[56ch] text-sm leading-6 text-fg-3">
        Форма готова; данные — образец, пока в системе нет сотрудников и личных
        задач. Компонент принимает их через props.
      </p>

      <div className="mt-6 rounded-card bg-surface p-5">
        <WorkCalendar
          monthLabel="Сентябрь"
          year={2026}
          days={SAMPLE_DAYS}
          groups={SAMPLE_GROUPS}
          personName="Айгерим"
        />
      </div>
    </main>
  );
}
