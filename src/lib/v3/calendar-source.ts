import "server-only";

import { getPostgresClient } from "@/lib/server/database";
import { ORG_TIMEZONE } from "@/lib/v3/period";

import type { CalendarTask, CaseOption, Day, TaskState } from "@/components/v3/calendar/types";

/**
 * Единственное место, где календарь знает, откуда берутся задачи.
 *
 * Задачи приёмной кампании — `evo_admissions_tasks`. Имя человека к задаче не
 * привязано напрямую: она принадлежит делу студента, а дело — человеку,
 * поэтому имя тянется через `evo_student_cases` → `evo_people`.
 *
 * ДЕНЬ И ВРЕМЯ СЧИТАЮТСЯ В ЗАПРОСЕ, А НЕ В JS. Причина та же, что у воронки:
 * `timestamptz` приходит из драйвера не как `Date`, а браузер и сервер живут в
 * разных часовых поясах. Пока день собирает `to_char`, «сегодня» на экране и
 * «сегодня» в отборе — одна и та же дата, потому что обе из базы.
 *
 * И считаются они В ПОЯСЕ ОРГАНИЗАЦИИ (`ORG_TIMEZONE`), а не в поясе
 * соединения: пояс соединения — свойство сервера, а сутки — свойство людей,
 * которые по этим суткам работают. Без явного пояса задача со сроком 01:00
 * вставала бы на предыдущий день.
 *
 * Задача без срока в календарь не попадает: у неё нет дня, на который её
 * поставить. Такие задачи видны в деле студента, а не здесь.
 */

/** Что разрешает `evo_admissions_tasks_status_check`. */
const KNOWN_STATES: readonly TaskState[] = ["open", "completed", "cancelled"];

type Row = {
  id: string;
  title: string;
  details: string | null;
  status: string;
  closure_reason: string | null;
  person: string | null;
  day: string;
  time: string;
};

/** Сегодняшний день — из базы, чтобы он совпадал с днями самих задач. */
export async function readToday(): Promise<Day> {
  const sql = getPostgresClient();
  const [row] = await sql<{ day: string }[]>`
    select to_char((now() at time zone ${ORG_TIMEZONE}::text)::date, 'YYYY-MM-DD') as day
  `;
  return row.day;
}

/**
 * Задачи со сроком внутри отрезка, включая оба края.
 *
 * Отрезок считает страница по виду календаря: сетка месяца показывает и
 * хвосты соседних месяцев, поэтому читать «месяц» было бы мало.
 */
export async function readCalendarTasks(
  from: Day,
  to: Day,
): Promise<readonly CalendarTask[]> {
  const sql = getPostgresClient();

  const rows = await sql<Row[]>`
    select
      t.id,
      t.title,
      t.details,
      t.status,
      t.closure_reason,
      p.full_name                                                        as person,
      to_char(t.due_at at time zone ${ORG_TIMEZONE}::text, 'YYYY-MM-DD') as day,
      to_char(t.due_at at time zone ${ORG_TIMEZONE}::text, 'HH24:MI')    as time
    from evo_admissions_tasks t
    left join evo_student_cases sc on sc.id = t.student_case_id
    left join evo_people p on p.id = sc.person_id
    where t.due_at is not null
      and (t.due_at at time zone ${ORG_TIMEZONE}::text)::date >= ${from}::date
      and (t.due_at at time zone ${ORG_TIMEZONE}::text)::date <= ${to}::date
    order by t.due_at asc, t.title asc
  `;

  return rows.map((row) => {
    // Не словарь, а проверка: значение, которого схема не знает, приходит как
    // `null`, и тогда состояние просто не рисуется. Слово по ключу даёт
    // `wording.ts`, здесь его нет намеренно.
    const state = KNOWN_STATES.includes(row.status as TaskState)
      ? (row.status as TaskState)
      : null;
    return {
      id: row.id,
      title: row.title,
      details: row.details,
      day: row.day,
      // Срок в модели — момент времени, и отдельного признака «дата без
      // времени» в ней нет. Полночь читается как срок на день целиком: иначе
      // задача, у которой времени никто не назначал, вставала бы в 00:00 —
      // час, в который никто не работает.
      minutes: row.time === "00:00" ? null : hourMinutes(row.time),
      state,
      // Причина есть только у отменённой: у остальных схема её запрещает.
      cancelReason: state === "cancelled" ? row.closure_reason : null,
      person: row.person,
    } satisfies CalendarTask;
  });
}

/**
 * Кому можно завести задачу.
 *
 * Задача принадлежит делу студента, и `student_case_id` в схеме `NOT NULL`:
 * задачи «ничьей» не бывает. Поэтому форма заведения спрашивает человека, а
 * список для неё читается здесь — компонент по-прежнему ничего не грузит.
 *
 * Закрытые дела не предлагаются: заводить работу в закрытое дело — это либо
 * ошибка выбора, либо признак того, что дело надо открывать заново.
 */
export async function readCaseOptions(): Promise<readonly CaseOption[]> {
  const sql = getPostgresClient();

  const rows = await sql<{ id: string; person: string }[]>`
    select sc.id, p.full_name as person
    from evo_student_cases sc
    join evo_people p on p.id = sc.person_id
    where sc.status <> 'closed'
    order by p.full_name asc, sc.created_at asc
  `;

  return rows.map((row) => ({ id: row.id, person: row.person }) satisfies CaseOption);
}

function hourMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}
