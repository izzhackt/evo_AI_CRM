import { Fragment } from "react";

import Link from "next/link";

import { Pill, type PillTone } from "@/components/v3/Pill";
import { taskStatus } from "@/lib/v3/wording";

import {
  type CalendarTask,
  type Day,
  dayFullLabel,
  dayLabel,
  dayNumber,
  isSameMonth,
  taskCountLabel,
  timeLabel,
  weekdayNames,
  weekdayShort,
} from "./types";

/**
 * Сетки календаря: часовая (день и неделя) и месячная.
 *
 * Обе рисуют переданное и ничего не решают: какой день считать сегодняшним и
 * какая задача выбрана — приходит сверху.
 *
 * ПОЧЕМУ ЗАДАЧИ ЛЕЖАТ ПОТОКОМ, А НЕ ВИСЯТ АБСОЛЮТНО. У задачи нет
 * длительности, поэтому высоту карточки нечем задать — рисовать «час» было бы
 * выдумкой. Раз так, ей незачем и абсолютное положение: карточка просто лежит
 * в клетке своего часа, а строка часа растёт под содержимое. Заодно исчезает
 * старая беда абсолютной раскладки — две задачи в одном часе накладывались
 * друг на друга.
 */

/* ------------------------------------------------------------- карточка */

/**
 * Тон — здесь, слово — в `wording.ts`.
 *
 * Тон это оформление: он выбирается по смыслу состояния и на экран сам по
 * себе не выходит. Слово выходит, поэтому живёт в единственном словаре.
 */
const STATE_TONE: Record<string, PillTone> = {
  open: "neutral",
  in_progress: "neutral",
  blocked: "warn",
  done: "ok",
  cancelled: "neutral",
  overdue: "danger",
};

/**
 * Чем эта задача отличается от других: ключ состояния или `overdue`.
 *
 * `overdue` в базе нет — это открытая задача, у которой срок уже прошёл.
 */
export function taskStateKey(task: CalendarTask, today: Day): string | null {
  return (
      task.state === "open" || task.state === "in_progress"
    ) && task.day !== null && task.day < today
    ? "overdue"
    : task.state;
}

/** Пилюля по состоянию. null — состояния нет, рисовать нечего. */
export function statePill(
  key: string | null,
): Readonly<{ tone: PillTone; word: string }> | null {
  if (key === null) return null;
  const word = taskStatus(key);
  return word === null ? null : { tone: STATE_TONE[key] ?? "neutral", word };
}

/**
 * Пилюля на карточке ставится только там, где она что-то сообщает.
 *
 * У открытой задачи в срок пилюли нет: «в работе» на каждой карточке — это
 * значение, одинаковое во всех строках, то есть шум. Просроченная, отменённая
 * и выполненная отличаются от остальных, поэтому их видно.
 */
export function taskPill(
  task: CalendarTask,
  today: Day,
): Readonly<{ tone: PillTone; word: string }> | null {
  const key = taskStateKey(task, today);
  return key === "open" || key === "in_progress" ? null : statePill(key);
}

export function TaskChip({
  task,
  today,
  selected,
  panelId,
  onSelect,
}: {
  task: CalendarTask;
  today: Day;
  selected: boolean;
  /** Есть только когда подробности открыты: ссылка на несуществующий узел — ошибка разметки. */
  panelId: string | null;
  onSelect: () => void;
}) {
  const pill = taskPill(task, today);

  return (
    <button
      type="button"
      id={`task-${task.id}`}
      onClick={onSelect}
      aria-expanded={selected}
      aria-controls={selected && panelId ? panelId : undefined}
      className={`flex min-h-11 w-full flex-col items-start gap-0.5 rounded-nav border px-1.5 py-1 text-start ${
        selected
          ? "border-accent bg-accent text-on-accent"
          : "border-control-edge bg-surface-2 hover:border-accent"
      }`}
    >
      <span
        className={`line-clamp-2 w-full break-words text-xs font-semibold ${
          selected ? "text-on-accent" : "text-fg"
        } ${task.state === "done" ? "line-through" : ""}`}
      >
        {task.title}
      </span>
      {/* Чей это студент — прямо на карточке, а не только в подробностях.
          У четырёх «Проверить нострификацию аттестата» в одном часе название
          одинаковое, и без имени они неразличимы: пришлось бы открывать
          каждую, чтобы понять, чья. */}
      <span
        className={`flex w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs ${
          selected ? "text-on-accent" : "text-fg-3"
        }`}
      >
        <span className="font-mono">
          {task.minutes === null ? "весь день" : timeLabel(task.minutes)}
        </span>
        {task.person ? <span className="max-w-full truncate">{task.person}</span> : null}
        {pill ? <Pill tone={pill.tone}>{pill.word}</Pill> : null}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------ общие части */

function DayNumberLink({
  day,
  today,
  href,
  muted = false,
}: {
  day: Day;
  today: Day;
  href: string;
  muted?: boolean;
}) {
  const isToday = day === today;
  return (
    <Link
      href={href}
      // Сегодняшний день помечен не только тёмным пятном: пятно — это цвет и
      // форма, то есть признак, которого нет ни у читалки, ни у человека,
      // который цвет не различает. Слово в скрытой подписи и `aria-current`
      // говорят то же самое.
      aria-current={isToday ? "date" : undefined}
      className="inline-flex h-8 min-w-8 items-center justify-center rounded-nav hover:bg-surface-2"
    >
      <span
        aria-hidden="true"
        className={`grid h-6 min-w-6 place-items-center rounded-nav px-1 font-mono text-xs font-semibold ${
          isToday ? "bg-accent text-on-accent" : muted ? "text-fg-3" : "text-fg"
        }`}
      >
        {dayNumber(day)}
      </span>
      <span className="sr-only">
        {dayFullLabel(day)}
        {isToday ? ", сегодня" : ""}
      </span>
    </Link>
  );
}

type ChipProps = {
  today: Day;
  selectedId: string | null;
  panelId: string | null;
  onSelect: (id: string) => void;
};

function Chips({ tasks, chip }: { tasks: readonly CalendarTask[]; chip: ChipProps }) {
  if (tasks.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {tasks.map((task) => (
        <TaskChip
          key={task.id}
          task={task}
          today={chip.today}
          selected={task.id === chip.selectedId}
          panelId={chip.panelId}
          onSelect={() => chip.onSelect(task.id)}
        />
      ))}
    </div>
  );
}

/* --------------------------------------------------------- сетка с часами */

export function TimeGrid({
  days,
  tasks,
  hours,
  hrefForDay,
  label,
  chip,
}: {
  days: readonly Day[];
  tasks: readonly CalendarTask[];
  /** Минуты от полуночи: начало каждого часа сетки. */
  hours: readonly number[];
  hrefForDay: (day: Day) => string;
  /** Доступное имя области — она прокручивается по горизонтали. */
  label: string;
  chip: ChipProps;
}) {
  const columns = `56px repeat(${days.length}, minmax(0, 1fr))`;
  const allDay = tasks.filter((task) => task.day !== null && task.minutes === null);
  const week = days.length > 1;

  const at = (day: Day, hour: number) =>
    tasks.filter(
      (task) => task.day === day && task.minutes !== null && Math.floor(task.minutes / 60) * 60 === hour,
    );

  const grid = (
    <div className={week ? "min-w-[820px]" : ""}>
      <div className="grid" style={{ gridTemplateColumns: columns }}>
        {/* Шапка с днями — только у недели: у дня период назван в панели сверху,
            и второй раз повторять его незачем. */}
        {week ? (
          <>
            <span className="border-b border-border" />
            {days.map((day) => (
              <span
                key={day}
                className="flex flex-col items-center gap-0.5 border-b border-s border-border py-1.5"
              >
                <DayNumberLink day={day} today={chip.today} href={hrefForDay(day)} />
                <span aria-hidden="true" className="font-mono text-2xs uppercase tracking-wide text-fg-3">
                  {weekdayShort(day)}
                </span>
              </span>
            ))}
          </>
        ) : null}

        {/* Строка «весь день»: сюда ложится задача со сроком, но без времени.
            Пустой строки нет — она появляется вместе с такой задачей. */}
        {allDay.length > 0 ? (
          <>
            <span className="border-b border-border px-2 py-2 text-end font-mono text-2xs text-fg-3">
              весь день
            </span>
            {days.map((day) => (
              // Клетка — блок, а не `span`: внутри лежит список карточек, и
              // блочное содержимое в строчном элементе разметке не разрешено.
              <div key={day} className="border-b border-s border-border p-1">
                <Chips tasks={allDay.filter((task) => task.day === day)} chip={chip} />
              </div>
            ))}
          </>
        ) : null}

        {hours.map((hour, index) => {
          const last = index === hours.length - 1;
          const edge = last ? "" : "border-b border-border";
          return (
            <Fragment key={hour}>
              <span className={`pe-2 pt-1 text-end font-mono text-2xs text-fg-3 ${edge}`}>
                {timeLabel(hour)}
              </span>
              {days.map((day) => (
                <div key={day} className={`min-h-16 border-s border-border p-1 ${edge}`}>
                  <Chips tasks={at(day, hour)} chip={chip} />
                </div>
              ))}
            </Fragment>
          );
        })}
      </div>
    </div>
  );

  // Прокрутка нужна только неделе: день в 393px помещается целиком, и лишняя
  // остановка табуляции там была бы обманом — прокручивать нечего.
  //
  // `contain: paint` — не украшение. Без него ширина сетки просачивается в
  // `documentElement.scrollWidth`, и страница выглядит уехавшей вбок, хотя
  // окно никуда не прокручивается: одного `overflow-x: auto` браузеру мало,
  // чтобы перестать считать содержимое прокрутки шириной документа.
  return week ? (
    <div
      className="max-w-full overflow-x-auto [contain:paint]"
      role="group"
      aria-label={label}
      tabIndex={0}
    >
      {grid}
    </div>
  ) : (
    grid
  );
}

/* ------------------------------------------------------------ сетка месяца */

/**
 * Сколько карточек помещается в клетку месяца.
 *
 * Без предела двести задач одного дня растягивают строку на весь экран, и
 * месяц перестаёт быть месяцем. Остальные не пропадают: клетка ведёт в свой
 * день, где они лежат по часам.
 */
const CELL_LIMIT = 3;

export function MonthGrid({
  days,
  tasks,
  anchor,
  hrefForDay,
  label,
  chip,
}: {
  days: readonly Day[];
  tasks: readonly CalendarTask[];
  /** Любой день показанного месяца: по нему видно, какие клетки чужие. */
  anchor: Day;
  hrefForDay: (day: Day) => string;
  label: string;
  chip: ChipProps;
}) {
  return (
    <div
      className="max-w-full overflow-x-auto [contain:paint]"
      role="group"
      aria-label={label}
      tabIndex={0}
    >
      <div className="min-w-[760px]">
        <div className="grid grid-cols-7">
          {weekdayNames().map((name) => (
            <span
              key={name}
              className="border-b border-s border-border py-1.5 text-center font-mono text-2xs uppercase tracking-wide text-fg-3 first:border-s-0"
            >
              {name}
            </span>
          ))}

          {days.map((day, index) => {
            const last = index >= days.length - 7;
            const dayTasks = tasks.filter((task) => task.day === day);
            const rest = dayTasks.length - CELL_LIMIT;
            return (
              <div
                key={day}
                // Клетки идут следом за семью подписями дней, поэтому
                // первая в строке — это каждый седьмой ребёнок сетки.
                className={`flex min-h-[112px] flex-col gap-1 border-s border-border p-1 [&:nth-child(7n+1)]:border-s-0 ${
                  last ? "" : "border-b border-border"
                }`}
              >
                <DayNumberLink
                  day={day}
                  today={chip.today}
                  href={hrefForDay(day)}
                  muted={!isSameMonth(day, anchor)}
                />
                <Chips tasks={dayTasks.slice(0, CELL_LIMIT)} chip={chip} />
                {rest > 0 ? (
                  <Link
                    href={hrefForDay(day)}
                    className="inline-flex min-h-6 items-center rounded-nav px-1.5 text-2xs text-fg-2 underline hover:bg-surface-2 hover:text-fg"
                  >
                    <span aria-hidden="true">ещё {rest}</span>
                    <span className="sr-only">
                      Ещё {taskCountLabel(rest)}, {dayLabel(day)}
                    </span>
                  </Link>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
