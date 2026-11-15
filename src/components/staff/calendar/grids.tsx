import { Fragment, useEffect, useRef, useState } from "react";

import Link from "next/link";

import { PlusIcon } from "lucide-react";

import { DueWord } from "@/components/staff/blocks/DueWord";
import { Button } from "@/components/ui/button";
import { Pill, type PillTone } from "@/components/staff/Pill";
import { taskPriorityMark, taskStatus } from "@/lib/v3/wording";

import { formatQueueDay } from "../queue/due-bucket";
import {
  type CalendarTask,
  type CalendarView,
  type Day,
  calendarDayList,
  calendarPeriodDays,
  calendarTaskIsOpen,
  calendarTasksOfDay,
  clockLabel,
  dayFullLabel,
  dayLabel,
  dayNumber,
  hasCalendarAllDayRow,
  isSameMonth,
  monthShort,
  taskCountLabel,
  weekdayNames,
  weekdayShort,
} from "./types";

/**
 * Сетки календаря: часовая (день и неделя), месячная и список по дням для
 * телефона (Э8.8).
 *
 * Все три рисуют переданное и ничего не решают: какой день считать
 * сегодняшним, какой выбран (на него «Создать задачу» ставит срок), какая
 * задача открыта и к какому часу прокручен день — приходит сверху.
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
export function taskStateKey(task: CalendarTask): string | null {
  return (
      task.state === "open" || task.state === "in_progress"
    ) && task.overdue
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
): Readonly<{ tone: PillTone; word: string }> | null {
  const key = taskStateKey(task);
  return key === "open" || key === "in_progress" ? null : statePill(key);
}

/**
 * Карточка задачи. Открытая в панели — общий нейтральный «выбрано»
 * (`v3-choice` с `aria-expanded`); наведение — тоже нейтральное: подложка
 * темнее на ступень, без красной рамки (сплошной красный на странице — только
 * главное действие и «сегодня»).
 */
export function TaskChip({
  task,
  selected,
  panelId,
  idPrefix = "task",
  onSelect,
  compact = false,
}: {
  /** Клетка месяца: название и под ним «время · состояние · кто» — без рамки, плотнее карточки недели. */
  compact?: boolean;
  task: CalendarTask;
  selected: boolean;
  /** Есть только когда подробности открыты: ссылка на несуществующий узел — ошибка разметки. */
  panelId: string | null;
  /**
   * Сетка и список телефона рисуются оба (виден один — по ширине окна), поэтому
   * у карточки списка свой префикс (`list-task`, не начинается с `task-`):
   * одинаковых `id` на странице нет, и `#task-…` по-прежнему — карточка сетки.
   */
  idPrefix?: string;
  /** Нажатая карточка — туда вернётся фокус, когда панель закроется. */
  onSelect: (trigger: HTMLElement) => void;
}) {
  const overdue = taskStateKey(task) === "overdue";
  // Просрочена — красное время и слово, без заливки: стена красных пилюль скрывала остальное. Пилюля — только
  // у «выполнена», «отменена» и «заблокирована»; выполненная и отменённая стоят тихо.
  const pill = overdue ? null : taskPill(task);
  const quiet = task.state === "done" || task.state === "cancelled";
  // Значение — заливкой, ребром слева и словом (15.11.2026: выделение по смыслу; референс владельца — залитые блоки событий):
  // просрочена — светло-красная, красное ребро и «просрочена»; срочная открытая — светло-жёлтая, тёмно-жёлтое ребро и «срочно»;
  // остальные — тёплая подложка стола без ребра. Ребро различимо и без цвета: заливки отличаются от подложки почти только оттенком.
  const urgent = !overdue && calendarTaskIsOpen(task) ? taskPriorityMark(task.priority) : null;
  const filled = overdue || urgent !== null;
  const mark = overdue ? "border-s-[3px] border-s-danger bg-danger-weak" : urgent ? "border-s-[3px] border-s-warn bg-warn-weak" : "bg-bg";
  const time = task.minutes === null ? null : clockLabel(task.minutes);
  // На залитом блоке слово состояния — простым текстом: плашка того же тона на той же заливке пропадает и оставляет лишний отступ.
  const pillWord = pill ? (filled ? <span>{pill.word}</span> : <Pill tone={pill.tone}>{pill.word}</Pill>) : null;
  const title = (
    <span className={`w-full ${compact ? "truncate t-body-compact" : "t-item line-clamp-2 break-words"} ${
      selected ? "" : quiet ? "text-fg-3" : "text-fg"
    } ${task.state === "done" ? "line-through" : ""}`}>
      {task.title}
    </span>
  );

  if (compact) {
    // Клетка месяца — две строки: название во всю ширину, под ним время, состояние словом и чей студент (имя обрезается последним
    // и первым: время и слово состояния важнее). Ревью 15.11: в одну строку от названия оставалось «Про…», а имя и слово — только
    // в подсказке.
    return (
      <button
        type="button"
        id={`${idPrefix}-${task.key}`}
        onClick={(event) => onSelect(event.currentTarget)}
        aria-expanded={selected}
        aria-controls={selected && panelId ? panelId : undefined}
        className={`v3-choice flex min-h-11 w-full flex-col items-start justify-center rounded-nav border border-transparent px-1.5 py-0.5 text-start hover:border-control-edge ${mark}`}
      >
        {title}
        {/* В узкой клетке строка обрезается многоточием, а не вылезает за край: первым сжимается имя, потом слово состояния. */}
        <span className={`t-meta flex w-full min-w-0 items-baseline gap-x-1.5 overflow-hidden whitespace-nowrap ${selected ? "text-fg-2" : "text-fg-3"}`}>
          {time ? <span className={`shrink-0 font-mono ${overdue ? "text-danger" : ""}`}>{time}</span> : null}
          {task.day === null ? <span className="min-w-0 truncate">без срока</span> : null}
          {overdue ? <span className="min-w-0 truncate text-danger">просрочена</span> : null}
          {urgent ? <span className="min-w-0 truncate text-warn">{urgent}</span> : null}
          {pill ? <span className="min-w-0 truncate">{pill.word}</span> : null}
          {task.person ? <span className="min-w-0 shrink-[4] truncate">{task.person}</span> : null}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      id={`${idPrefix}-${task.key}`}
      onClick={(event) => onSelect(event.currentTarget)}
      aria-expanded={selected}
      aria-controls={selected && panelId ? panelId : undefined}
      className={`v3-choice flex min-h-11 w-full flex-col items-start gap-0.5 rounded-nav border border-transparent px-2 py-1 text-start hover:border-control-edge ${mark}`}
    >
      {title}
      {/* Чей это студент — прямо на карточке, а не только в подробностях.
          У четырёх «Проверить нострификацию аттестата» в одном часе название
          одинаковое, и без имени они неразличимы: пришлось бы открывать
          каждую, чтобы понять, чья. */}
      <span
        className={`t-meta flex w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 ${
          selected ? "text-fg-2" : "text-fg-3"
        }`}
      >
        {time ? <span className={`font-mono ${overdue ? "text-danger" : ""}`}>{time}</span> : null}
        {task.day === null
          ? <span>без срока</span>
          : null}
        {task.person ? <span className="max-w-full truncate">{task.person}</span> : null}
        {overdue ? <span className="text-danger">просрочена</span> : null}
        {urgent ? <span className="text-warn">{urgent}</span> : null}
        {pillWord}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------ общие части */

/**
 * Что сетке нужно знать о состоянии страницы: сегодняшний день, выбранный
 * день (на него «Создать задачу» ставит срок — его видно нейтральной
 * подложкой) и открытая задача.
 */
export type CalendarCellProps = {
  today: Day;
  selectedDay: Day;
  selectedId: string | null;
  panelId: string | null;
  onSelect: (id: string, trigger: HTMLElement) => void;
  /** «+» на дне — новая задача со сроком на этот день; нет права создавать — `null`, кнопок нет. */
  create?: ((day: Day) => Readonly<{ label: string; onOpen: (trigger: HTMLElement) => void }>) | null;
};

/**
 * «+» на дне (15.11.2026, решение владельца): открывает «Создать задачу» со сроком на этот день. С мышью — виден при наведении
 * на день и при фокусе с клавиатуры; на сенсорном экране наведения нет, поэтому виден всегда.
 */
function DayCreate({ day, chip, className }: Readonly<{ day: Day; chip: CalendarCellProps; className: string }>) {
  const create = chip.create?.(day);
  if (!create) return null;
  return (
    <Button variant="ghost" size="icon" aria-label={create.label} title={create.label} aria-haspopup="dialog" data-calendar-create={day}
      onClick={(event) => create.onOpen(event.currentTarget)}
      className={`text-fg-3 transition-opacity focus-visible:opacity-100 motion-reduce:transition-none pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 ${className}`}>
      <PlusIcon aria-hidden="true" />
    </Button>
  );
}

/**
 * Число дня — ссылка на этот день, цель нажатия 44 px. «Сегодня» (Э6) —
 * маленькая красная заливка 24 px с белой цифрой внутри ссылки, как у слова
 * срока (правило плана: сплошной красный — главное действие и «сегодня»);
 * белый на #d70217 — 5.3:1. Выбранный день — общий нейтральный «выбрано»
 * (`v3-choice`): на него «Создать задачу» ставит срок.
 */
function DayLink({
  day,
  today,
  selected,
  href,
  muted = false,
  weekday = false,
  monthStart = false,
}: {
  /** Клетка месяца с первым числом другого месяца: «1 окт», как у «Акылмана». */
  monthStart?: boolean;
  day: Day;
  today: Day;
  selected: boolean;
  href: string;
  muted?: boolean;
  /** Шапка недели: «Пн 21» одной ссылкой. */
  weekday?: boolean;
}) {
  const isToday = day === today;
  return (
    <Link
      href={href}
      // Сегодняшний и выбранный день помечены не только пятном: пятно — это
      // цвет и форма, то есть признак, которого нет ни у читалки, ни у
      // человека, который цвет не различает. Слова в скрытой подписи и
      // `aria-current` говорят то же самое.
      aria-current={isToday ? "date" : selected ? "true" : undefined}
      data-calendar-selected-day={selected ? "" : undefined}
      className={`${selected ? "v3-choice " : ""}inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-nav px-1.5 hover:bg-surface-2${weekday ? " flex-col gap-0 py-1" : ""}`}
    >
      {/* Шапка недели (15.11.2026, как у «Акылмана»): день недели, под ним крупное число. */}
      {weekday ? (
        <span aria-hidden="true" className="t-caption text-fg-3">
          {weekdayShort(day)}
        </span>
      ) : null}
      <span
        aria-hidden="true"
        data-calendar-today={isToday ? "" : undefined}
        className={`${weekday ? "t-section grid h-8 min-w-8 place-items-center rounded-nav px-1 tabular-nums" : "t-item grid h-6 min-w-6 place-items-center rounded-nav px-1 tabular-nums"} ${
          isToday ? "bg-accent text-on-accent" : muted ? "text-fg-3" : "text-fg"
        }`}
      >
        {dayNumber(day)}{monthStart ? ` ${monthShort(day)}` : ""}
      </span>
      <span className="sr-only">
        {dayFullLabel(day)}
        {isToday ? ", сегодня" : ""}
        {selected ? ", выбранный день" : ""}
      </span>
    </Link>
  );
}

/**
 * Карточки клетки не больше `limit`: остальные — «ещё N» со ссылкой на день, где они лежат по часам. Открытая в панели
 * карточка остаётся видимой, даже если стоит дальше предела.
 */
function LimitedChips({
  tasks,
  limit,
  chip,
  moreHref,
  moreLabel,
  compact = false,
  nowAt = null,
}: {
  tasks: readonly CalendarTask[];
  limit: number;
  chip: CalendarCellProps;
  moreHref: string;
  moreLabel: string;
  compact?: boolean;
  nowAt?: number | null;
}) {
  const selected = tasks.findIndex((task) => task.key === chip.selectedId);
  const shown = selected >= limit ? [...tasks.slice(0, limit - 1), tasks[selected]] : tasks.slice(0, limit);
  const rest = tasks.length - shown.length;
  return (
    <>
      <Chips tasks={shown} chip={chip} compact={compact} nowAt={nowAt} />
      {rest > 0 ? (
        <Link
          href={moreHref}
          className="t-label inline-flex min-h-11 items-center rounded-nav px-1.5 text-fg-2 underline underline-offset-4 hover:bg-surface-2 hover:text-fg"
        >
          <span aria-hidden="true">ещё {rest}</span>
          <span className="sr-only">
            Ещё {taskCountLabel(rest)}, {moreLabel}
          </span>
        </Link>
      ) : null}
    </>
  );
}

/** Линия «сейчас» — красная (значит «сегодня») с точкой; декоративная, время названо сеткой. */
function NowLine({ className = "relative", style }: Readonly<{ className?: string; style?: React.CSSProperties }>) {
  return (
    <span aria-hidden="true" data-calendar-now="" className={`pointer-events-none block h-0.5 bg-accent ${className}`} style={style}>
      <span className="absolute -start-1 -top-[3px] size-2 rounded-full bg-accent" />
    </span>
  );
}

function Chips({
  tasks,
  chip,
  idPrefix,
  compact = false,
  nowAt = null,
}: {
  tasks: readonly CalendarTask[];
  chip: CalendarCellProps;
  idPrefix?: string;
  compact?: boolean;
  /** Минуты «сейчас» в этом часе: линия встаёт в поток между задачами — до первой, чьё время ещё не наступило. */
  nowAt?: number | null;
}) {
  if (tasks.length === 0) return null;
  const next = nowAt === null ? -1 : tasks.findIndex((task) => task.minutes !== null && task.minutes > nowAt);
  const at = nowAt === null ? -1 : next === -1 ? tasks.length : next;
  return (
    <div className={`flex flex-col ${compact ? "gap-0.5" : "gap-1"}`}>
      {tasks.map((task, index) => (
        <Fragment key={task.key}>
          {index === at ? <NowLine /> : null}
          <TaskChip
            task={task}
            idPrefix={idPrefix}
            compact={compact}
            selected={task.key === chip.selectedId}
            panelId={chip.panelId}
            onSelect={(trigger) => chip.onSelect(task.key, trigger)}
          />
        </Fragment>
      ))}
      {at === tasks.length ? <NowLine /> : null}
    </div>
  );
}

/**
 * «Сейчас» в минутах: с сервера — на момент чтения страницы, дальше идёт само раз в полминуты (вкладку календаря держат открытой
 * часами). Первая отрисовка — серверное значение, гидратация не расходится. После полуночи линии нет: день уже другой.
 */
function useLiveMinutes(start: number | null): number | null {
  const [state, setState] = useState(() => ({ start, now: start }));
  if (state.start !== start) setState({ start, now: start });
  useEffect(() => {
    if (start === null) return;
    const began = Date.now();
    const timer = window.setInterval(() => {
      setState({ start, now: start + Math.floor((Date.now() - began) / 60_000) });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [start]);
  return state.now === null || state.now >= 24 * 60 ? null : state.now;
}

/* --------------------------------------------------------- сетка с часами */

/**
 * Сколько карточек помещается в клетку часа недели: в один час бывает по два десятка однотипных задач
 * («Перезвонить клиенту»), и неделя вырастала на три экрана. Остальные — «ещё N» со ссылкой на день.
 * У дня предела нет: он и есть место, где задачи лежат по часам.
 */
const HOUR_LIMIT = 3;

export function TimeGrid({
  days,
  tasks,
  hours,
  anchor = null,
  now = null,
  hrefForDay,
  label,
  chip,
}: {
  /** Минуты от полуночи сейчас (Бишкек, на момент чтения страницы): линия «сейчас» в клетке сегодняшнего дня. null — без линии. */
  now?: number | null;
  days: readonly Day[];
  tasks: readonly CalendarTask[];
  /** Минуты от полуночи: начало каждого часа сетки. */
  hours: readonly number[];
  /** Час, к которому сетка прокручена при открытии. null — не прокручивать. */
  anchor?: number | null;
  hrefForDay: (day: Day) => string;
  /** Доступное имя области — она прокручивается по горизонтали. */
  label: string;
  chip: CalendarCellProps;
}) {
  // Столбец дня не уже 7.5rem: названия не рвутся посреди слова, неделя при нехватке места прокручивается.
  // Колонка часов 72 px: «весь день» помещается одной строкой.
  const columns = `72px repeat(${days.length}, minmax(${days.length > 1 ? "7.5rem" : "0px"}, 1fr))`;
  // Страница читает весь месяц: у дня и недели — только задачи показанных дней.
  const shownDays = new Set(days);
  const allDay = tasks.filter((task) => task.day !== null && shownDays.has(task.day) && task.minutes === null);
  const week = days.length > 1;

  // Прокрутка к якорному часу — эффект, а не адрес: фрагмента в ссылках нет.
  // Ключ склеен из показанного дня и часа, поэтому клик по карточке (чужое
  // состояние, тот же день) прокрутку не повторяет, а переход на соседний
  // день — повторяет. Прокручивается СВОЯ область дня, а не окно страницы:
  // окно унесло бы за верх экрана строку об обрыве очереди и задачи без срока.
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const dayScrollRef = useRef<HTMLDivElement | null>(null);
  const anchorKey = anchor === null ? null : `${days[0]}:${anchor}`;
  useEffect(() => {
    if (anchorKey === null) return;
    const container = dayScrollRef.current;
    const target = anchorRef.current;
    if (!container || !target) return;
    container.scrollTop =
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      8;
  }, [anchorKey]);

  const live = useLiveMinutes(now);
  const nowHour = live !== null && days.includes(chip.today) ? Math.floor(live / 60) * 60 : null;
  const nowHere = (day: Day, hour: number) => (live !== null && day === chip.today && Math.floor(live / 60) * 60 === hour ? live : null);

  const at = (day: Day, hour: number) =>
    tasks.filter(
      (task) => task.day === day && task.minutes !== null && Math.floor(task.minutes / 60) * 60 === hour,
    );

  const grid = (
    <div className={week ? "min-w-[912px]" : ""}>
      <div className="grid" style={{ gridTemplateColumns: columns }}>
        {/* Шапка с днями — только у недели: у дня период назван в строке
            сверху, и второй раз повторять его незачем. «Пн 21» — одна ссылка
            44 px; выбранный день — нейтральная подложка. */}
        {week ? (
          <>
            <span className="border-b border-border" />
            {days.map((day) => (
              <span
                key={day}
                className="group relative flex items-center justify-center border-b border-s border-border py-0.5"
              >
                <DayCreate day={day} chip={chip} className="absolute end-0.5 top-1/2 -translate-y-1/2" />
                <DayLink
                  day={day}
                  today={chip.today}
                  selected={day === chip.selectedDay}
                  href={hrefForDay(day)}
                  weekday
                />
              </span>
            ))}
          </>
        ) : null}

        {/* Строка «весь день»: сюда ложится задача со сроком без времени.
            Пустой строки нет — она появляется вместе с такой задачей. */}
        {hasCalendarAllDayRow(allDay) ? (
          <>
            <span className="t-caption flex items-center justify-end whitespace-nowrap border-b border-border pe-2 text-fg-3">
              весь день
            </span>
            {days.map((day) => (
              // Клетка — блок, а не `span`: внутри лежит список карточек, и
              // блочное содержимое в строчном элементе разметке не разрешено.
              <div key={day} className="border-b border-s border-border p-1">
                {week
                  ? <LimitedChips tasks={allDay.filter((task) => task.day === day)} limit={HOUR_LIMIT} chip={chip} moreHref={hrefForDay(day)} moreLabel={dayLabel(day)} />
                  : <Chips tasks={allDay.filter((task) => task.day === day)} chip={chip} />}
              </div>
            ))}
          </>
        ) : null}

        {hours.map((hour, index) => {
          const last = index === hours.length - 1;
          const edge = last ? "" : "border-b border-border";
          return (
            <Fragment key={hour}>
              {/* Колонка часов (15.11.2026, владелец просил доработать): без линий, метка часа стоит на линии своего часа, как в
                  календарях телефона; текущий час — тёмным и жирным, остальные тихо. Первая метка — под линией шапки. */}
              <span ref={hour === anchor ? anchorRef : undefined} className="relative scroll-mt-2">
                <span className={`absolute end-2 t-caption font-mono tabular-nums ${index === 0 ? "top-1" : "top-0 -translate-y-1/2"} ${
                  nowHour === hour ? "font-semibold text-fg" : "text-fg-3"
                }`}>
                  {clockLabel(hour)}
                </span>
              </span>
              {days.map((day) => (
                <div key={day} className={`relative min-h-16 border-s border-border p-1 ${edge}`}>
                  {/* «Сейчас» (15.11.2026): тонкая линия поперёк сегодняшнего дня. В часе с задачами — в потоке между ними (задачи
                      лежат потоком, без высоты, и линия поверх перечёркивала бы их, как «выполнена»); в пустом часе — по минутам. */}
                  {week
                    ? <LimitedChips tasks={at(day, hour)} limit={HOUR_LIMIT} chip={chip} moreHref={hrefForDay(day)} moreLabel={dayLabel(day)} nowAt={nowHere(day, hour)} />
                    : <Chips tasks={at(day, hour)} chip={chip} nowAt={nowHere(day, hour)} />}
                  {nowHere(day, hour) !== null && at(day, hour).length === 0
                    ? <NowLine className="absolute inset-x-0" style={{ top: `${((live! % 60) / 60) * 100}%` }} />
                    : null}
                </div>
              ))}
            </Fragment>
          );
        })}
      </div>
    </div>
  );

  // Прокрутка нужна только неделе: день помещается целиком, и лишняя
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
    // Дню — своя вертикальная прокрутка: сетка суток выше экрана, а якорный
    // час не должен утаскивать всю страницу вместе со строками над сеткой.
    <div
      ref={dayScrollRef}
      className="max-h-[75dvh] max-w-full overflow-y-auto"
      role="group"
      aria-label={label}
      tabIndex={0}
    >
      {grid}
    </div>
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
  chip: CalendarCellProps;
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
              className="t-caption border-b border-s border-border py-1.5 text-center text-fg-3 first:border-s-0"
            >
              {name}
            </span>
          ))}

          {days.map((day, index) => {
            const last = index >= days.length - 7;
            const dayTasks = calendarTasksOfDay(tasks, day);
            return (
              <div
                key={day}
                // Клетки идут следом за семью подписями дней, поэтому
                // первая в строке — это каждый седьмой ребёнок сетки.
                className={`group relative flex min-h-[112px] flex-col items-start gap-1 border-s border-border p-1 [&:nth-child(7n+1)]:border-s-0 ${
                  last ? "" : "border-b border-border"
                }`}
              >
                {/* Как у «Акылмана»: число в правом верхнем углу, «+» — в левом. */}
                <span className="self-end">
                  <DayLink
                    day={day}
                    today={chip.today}
                    selected={day === chip.selectedDay}
                    href={hrefForDay(day)}
                    muted={!isSameMonth(day, anchor)}
                    monthStart={dayNumber(day) === 1}
                  />
                </span>
                <DayCreate day={day} chip={chip} className="absolute start-1 top-1" />
                <div className="w-full">
                  <LimitedChips tasks={dayTasks} limit={CELL_LIMIT} chip={chip} moreHref={hrefForDay(day)} moreLabel={dayLabel(day)} compact />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------- список дней на телефоне */

/** «сб 26.09» — дата JetBrains Mono, год — только не текущий. */
function ListDate({ day, today }: { day: Day; today: Day }) {
  return (
    <>
      {weekdayShort(day).toLowerCase()}{" "}
      <span className="font-mono">{formatQueueDay(day, today)}</span>
    </>
  );
}

/**
 * Телефон (<768 px): сетки недели (820 px) и месяца (760 px) в окно не
 * помещаются, поэтому неделя и месяц — список по дням (Э8.8). День с задачами
 * — группа с датой-ссылкой на этот день; подряд идущие пустые дни — одна
 * строка «30.09–04.10 — задач нет»; сегодня и выбранный день видны своей
 * строкой. День на телефоне — тот же список для одного дня: только карточки,
 * день назван в строке периода. От 768 px — сетки.
 */
export function DayList({
  view,
  days,
  tasks,
  hrefForDay,
  label,
  chip,
}: {
  view: CalendarView;
  days: readonly Day[];
  tasks: readonly CalendarTask[];
  hrefForDay: (day: Day) => string;
  label: string;
  chip: CalendarCellProps;
}) {
  const { today, selectedDay } = chip;
  if (view === "day") {
    const dayTasks = calendarTasksOfDay(tasks, days[0]);
    return dayTasks.length ? (
      <div role="group" aria-label={label} className="p-2">
        <Chips tasks={dayTasks} chip={chip} idPrefix="list-task" />
      </div>
    ) : null;
  }
  const entries = calendarDayList(calendarPeriodDays(view, selectedDay, days), tasks, [today, selectedDay]);
  return (
    <ol aria-label={label} className="divide-y divide-border" data-calendar-day-list="">
      {entries.map((entry) => {
        if (entry.kind === "empty") {
          return (
            <li key={entry.from} className="flex min-h-11 flex-wrap items-center gap-x-1.5 px-4 py-1 t-body-compact text-fg-3">
              {entry.from === entry.to ? (
                <span><ListDate day={entry.from} today={today} /></span>
              ) : (
                <span className="font-mono">
                  {formatQueueDay(entry.from, today)}–{formatQueueDay(entry.to, today)}
                </span>
              )}
              <span>— задач нет</span>
            </li>
          );
        }
        const isToday = entry.day === today;
        const selected = entry.day === selectedDay;
        return (
          <li key={entry.day} className="px-2 py-1">
            <div className="flex min-h-11 flex-wrap items-center gap-x-1.5">
              <Link
                href={hrefForDay(entry.day)}
                aria-current={isToday ? "date" : selected ? "true" : undefined}
                data-calendar-selected-day={selected ? "" : undefined}
                className={`${selected ? "v3-choice " : ""}inline-flex min-h-11 items-center gap-2 rounded-nav px-2 t-item text-fg hover:bg-surface-2`}
              >
                <span aria-hidden="true"><ListDate day={entry.day} today={today} /></span>
                {isToday ? (
                  <span aria-hidden="true">
                    <DueWord view={{ text: "сегодня", tone: "today" }} />
                  </span>
                ) : null}
                <span className="sr-only">
                  {dayFullLabel(entry.day)}
                  {isToday ? ", сегодня" : ""}
                  {selected ? ", выбранный день" : ""}
                </span>
              </Link>
              {entry.tasks.length === 0 ? <span className="t-body-compact text-fg-3">— задач нет</span> : null}
            </div>
            {entry.tasks.length ? (
              <div className="px-1 pb-1 pt-1">
                <Chips tasks={entry.tasks} chip={chip} idPrefix="list-task" />
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
