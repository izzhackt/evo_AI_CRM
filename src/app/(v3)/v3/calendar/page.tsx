import {
  WeekCalendar,
  type DayColumn,
  type TodoGroup,
  type WeekEvent,
} from "@/components/v3/WeekCalendar";

export const metadata = { title: "V3 · Календарь" };

/**
 * Образец живёт здесь, а не в компоненте: подключение будет заменой этого
 * блока.
 *
 * УЧАСТНИКОВ У СОБЫТИЙ НЕТ, И ЭТО НЕ УПУЩЕНИЕ. Раньше здесь стояли аватары
 * «Айгерим», «Тимур», «Директор». Первые двое — это ЛИДЫ из нашей же базы:
 * интерфейс подставлял клиентов вместо сотрудников. А сущности сотрудника в
 * EVO не существует вовсе — есть три роли, и роль это не человек. Компонент
 * участников поддерживает (`people`), поэтому, когда сотрудники появятся,
 * меняется этот массив, а не карточка события. Задачи со сроком, но без времени приходят как startMinutes: null и
 * встают в строку «весь день» — так схема EVO выглядит уже сегодня.
 */
const DAYS: DayColumn[] = [
  { date: 31, weekday: "пн", today: false },
  { date: 1, weekday: "вт", today: false },
  { date: 2, weekday: "ср", today: true },
  { date: 3, weekday: "чт", today: false },
  { date: 4, weekday: "пт", today: false },
];

const EVENTS: WeekEvent[] = [
  { id: "e1", title: "Проверить нострификацию аттестата", day: 3, startMinutes: null, endMinutes: null, tone: "deadline", people: [], action: null },
  { id: "e2", title: "Подтвердить IELTS и загрузить сертификат", day: 4, startMinutes: null, endMinutes: null, tone: "deadline", people: [], action: null },
  { id: "e3", title: "Разбор очереди продаж", day: 2, startMinutes: 9 * 60, endMinutes: 10 * 60 + 30, tone: "work", people: [], action: null },
  { id: "e4", title: "Созвон с приёмной комиссией", day: 2, startMinutes: 11 * 60, endMinutes: 12 * 60, tone: "meeting", people: [], action: "Открыть встречу" },
  { id: "e5", title: "Передача лида в приёмную", day: 1, startMinutes: 10 * 60, endMinutes: 11 * 60, tone: "work", people: [], action: null },
  { id: "e6", title: "Сверка дедлайнов осеннего набора", day: 4, startMinutes: 14 * 60, endMinutes: 15 * 60 + 30, tone: "work", people: [], action: null },
  { id: "e7", title: "Обед", day: 2, startMinutes: 13 * 60, endMinutes: 14 * 60, tone: "work", people: [], action: null },
];

const GROUPS: TodoGroup[] = [
  {
    title: "Эта неделя",
    items: [
      { id: "t1", title: "Проверить нострификацию аттестата", done: false },
      { id: "t2", title: "Подтвердить IELTS", done: true },
      { id: "t3", title: "Позвонить в приёмную комиссию", done: false },
    ],
  },
  {
    title: "Этот месяц",
    items: [{ id: "t4", title: "Сводка по осеннему набору", done: false }],
  },
  {
    title: "Без срока",
    items: [
      { id: "t5", title: "Проверить контекст от продаж", done: false },
      { id: "t6", title: "План запроса документов", done: false },
    ],
  },
];

export default function CalendarPart() {
  return (
    <main className="mx-auto w-full max-w-[1300px] px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">
        Календарь
      </h1>

      <div className="mt-6">
        <WeekCalendar days={DAYS} events={EVENTS} groups={GROUPS} monthLabel="Сентябрь 2026" />
      </div>
    </main>
  );
}
