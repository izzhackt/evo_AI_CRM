"use client";

import { useEffect, useId, useRef, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/icons";
import { Pill } from "@/components/v3/Pill";

import { MonthGrid, TimeGrid, statePill, taskStateKey } from "./grids";
import {
  type CalendarTask,
  type CalendarView,
  type CaseOption,
  type Day,
  VIEW_TITLES,
  dayLabel,
  periodLabel,
  stepDay,
  stepLabel,
  timeLabel,
  yearOf,
} from "./types";

/**
 * Календарь: день, неделя, месяц — и задачи приёмной кампании на них.
 *
 * ВИД И ПЕРИОД ЖИВУТ В АДРЕСЕ, А НЕ В СОСТОЯНИИ. «Неделя», «предыдущий
 * месяц», «сегодня» — это ссылки, поэтому открытый экран можно переслать, а
 * кнопка «назад» возвращает туда, где человек был. Кнопка с внутренним
 * состоянием не умеет ни того, ни другого.
 *
 * Отсюда же и `basePath` вместо привычного `hrefFor`: страница — серверная,
 * а этот компонент клиентский, и функцию через эту границу не передать.
 *
 * ЧТО ЗАВЕДЕНО И УДАЛЕНО ЗДЕСЬ — ЖИВЁТ ЗДЕСЬ. Записи в базу нет, поэтому
 * добавленные задачи и скрытые id лежат в модуле, а не в состоянии
 * компонента: каждое переключение вида — это переход по ссылке, и состояние
 * компонента он бы стирал. Перезагрузка страницы их не переживает.
 */

/** Заведённые на странице. Пишется только из обработчиков, то есть в браузере. */
let ADDED: readonly CalendarTask[] = [];
/** Убранные со страницы. Настоящие задачи из базы никуда не деваются. */
let HIDDEN: readonly string[] = [];
let counter = 0;

const INPUT =
  "min-h-11 w-full rounded-ctl border border-control-edge bg-surface px-2.5 text-sm text-fg placeholder:text-fg-3";
const SOLID =
  "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-ctl bg-accent px-3 text-xs font-semibold text-on-accent disabled:opacity-50";
// Граница здесь — единственный признак кнопки, поэтому она контрольного веса
// (≥3:1), а не волосяная рамка панели.
const GHOST =
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-ctl border border-control-edge bg-surface px-3 text-xs text-fg-2 hover:border-fg-2 hover:text-fg";
const FIELD_LABEL = "mb-1 block text-2xs text-fg-3";

/* ------------------------------------------------------------ подробности */

/**
 * Задача — карточка, а не строка: у неё есть описание, срок, состояние и
 * человек, к которому она относится. В сетке помещается только название, так
 * что подробности открываются отдельной панелью над сеткой — и на телефоне
 * тоже, поэтому при открытии фокус переезжает в неё, а браузер сам
 * подкручивает страницу к фокусу.
 */
function Details({
  task,
  today,
  panelId,
  onClose,
  onRemove,
}: {
  task: CalendarTask;
  today: Day;
  panelId: string;
  onClose: () => void;
  onRemove: () => void;
}) {
  const titleId = useId();
  const [confirming, setConfirming] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);

  // Панель открылась по нажатию на карточку, и на телефоне она может быть выше
  // места нажатия. Фокус переезжает сюда: тогда браузер сам подкручивает
  // страницу, а читалка начинает читать задачу, а не молчит.
  useEffect(() => {
    sectionRef.current?.focus();
  }, []);

  useEffect(() => {
    if (confirming) {
      confirmRef.current?.focus();
      return;
    }
    if (restore.current) {
      restore.current = false;
      removeRef.current?.focus();
    }
  }, [confirming]);

  // В подробностях «в работе» видно: здесь задача одна, и состояние её
  // описывает. В сетке ту же пилюлю пришлось бы поставить каждой карточке —
  // там она не различала бы ничего.
  const pill = statePill(taskStateKey(task, today));

  const due = `${dayLabel(task.day)} ${yearOf(task.day)}, ${
    task.minutes === null ? "весь день" : timeLabel(task.minutes)
  }`;

  const facts: readonly Readonly<{ label: string; value: string }>[] = [
    { label: "Срок", value: due },
    ...(task.person ? [{ label: "Студент", value: task.person }] : []),
    ...(task.details ? [{ label: "Описание", value: task.details }] : []),
    ...(task.cancelReason ? [{ label: "Причина отмены", value: task.cancelReason }] : []),
  ];

  return (
    <section
      ref={sectionRef}
      id={panelId}
      aria-labelledby={titleId}
      tabIndex={-1}
      className="rounded-card border border-border bg-surface"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        if (confirming) {
          restore.current = true;
          setConfirming(false);
        } else {
          onClose();
        }
      }}
    >
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-md break-words font-bold text-fg">
            {task.title}
          </h2>
          {pill ? (
            <p className="mt-1">
              <Pill tone={pill.tone}>{pill.word}</Pill>
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-nav text-fg-3 hover:bg-surface-2 hover:text-fg-2"
        >
          <span className="sr-only">Закрыть подробности</span>
          <Icon name="x" size={15} />
        </button>
      </div>

      <dl>
        {facts.map((fact) => (
          <div
            key={fact.label}
            className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5"
          >
            <dt className="w-32 shrink-0 text-2xs text-fg-3">{fact.label}</dt>
            <dd className="min-w-0 flex-1 whitespace-pre-line break-words text-sm text-fg">
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        {confirming ? (
          <>
            <p className="min-w-0 flex-1 basis-40 break-words text-sm text-fg">
              Удалить «{task.title}»?
            </p>
            <span className="flex shrink-0 items-center gap-2">
              <button ref={confirmRef} type="button" className={SOLID} onClick={onRemove}>
                Удалить
              </button>
              <button
                type="button"
                className={GHOST}
                onClick={() => {
                  restore.current = true;
                  setConfirming(false);
                }}
              >
                Отмена
              </button>
            </span>
          </>
        ) : (
          <button ref={removeRef} type="button" className={GHOST} onClick={() => setConfirming(true)}>
            <Icon name="x" size={14} />
            Удалить задачу
          </button>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ новая задача */

/**
 * Заведение задачи прямо из календаря — без похода в кейс.
 *
 * Поля ровно те, что у задачи и есть: заголовок, человек, дата и время срока,
 * описание. Время необязательно: пустое поле — это срок без времени, и такая
 * задача встаёт в строку «весь день».
 *
 * ЧЕЛОВЕК ОБЯЗАТЕЛЕН. Задача принадлежит делу студента, `student_case_id` в
 * схеме `NOT NULL`, и у каждой задачи из базы человек есть. Форма, которая о
 * нём не спрашивает, заводит то, чего в модели быть не может.
 */
function NewTask({
  day,
  cases,
  onSubmit,
  onCancel,
  cancelRef,
}: {
  day: Day;
  cases: readonly CaseOption[];
  onSubmit: (
    draft: Readonly<{ title: string; details: string; date: Day; time: string; caseId: string }>,
  ) => void;
  onCancel: () => void;
  cancelRef: React.Ref<HTMLButtonElement>;
}) {
  const ids = useId();
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [date, setDate] = useState<string>(day);
  const [time, setTime] = useState("");
  const [caseId, setCaseId] = useState("");
  const clean = title.trim();
  const ready = Boolean(clean && date && caseId);

  return (
    <form
      className="rounded-card border border-border bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onSubmit({ title: clean, details, date, time, caseId });
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div className="grid gap-3 @2xl:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <label htmlFor={`${ids}-title`} className={FIELD_LABEL}>
            Задача
          </label>
          <input
            id={`${ids}-title`}
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor={`${ids}-case`} className={FIELD_LABEL}>
            Студент
          </label>
          <select
            id={`${ids}-case`}
            required
            value={caseId}
            onChange={(event) => setCaseId(event.target.value)}
            className={INPUT}
          >
            <option value="">Не выбран</option>
            {cases.map((option) => (
              <option key={option.id} value={option.id}>
                {option.person}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-date`} className={FIELD_LABEL}>
            Дата срока
          </label>
          <input
            id={`${ids}-date`}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor={`${ids}-time`} className={FIELD_LABEL}>
            Время срока
          </label>
          <input
            id={`${ids}-time`}
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className={INPUT}
          />
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor={`${ids}-details`} className={FIELD_LABEL}>
          Описание
        </label>
        <textarea
          id={`${ids}-details`}
          rows={2}
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          className="w-full rounded-ctl border border-control-edge bg-surface px-2.5 py-2 text-sm text-fg"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={!ready} className={SOLID}>
          Добавить
        </button>
        <button ref={cancelRef} type="button" className={GHOST} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------- календарь */

export function Calendar({
  view,
  day,
  today,
  days,
  tasks,
  cases,
  basePath,
}: {
  view: CalendarView;
  /** Опорный день периода. */
  day: Day;
  today: Day;
  /** Клетки сетки: их посчитала страница, чтобы прочитать ровно этот отрезок. */
  days: readonly Day[];
  /** Задачи со сроком внутри отрезка. */
  tasks: readonly CalendarTask[];
  /** Кому можно завести задачу. Пусто — заводить не на кого, и кнопки нет. */
  cases: readonly CaseOption[];
  basePath: string;
}) {
  const router = useRouter();
  const panelId = useId();

  const [added, setAdded] = useState<readonly CalendarTask[]>(ADDED);
  const [hidden, setHidden] = useState<readonly string[]>(HIDDEN);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Список перерисовывается молча: одна область проговаривает, что произошло.
  const [said, setSaid] = useState("");

  const addRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const from = days[0];
  const to = days[days.length - 1];
  const inRange = (value: Day) => value >= from && value <= to;

  const visible = [
    ...tasks.filter((task) => !hidden.includes(task.id)),
    ...added.filter((task) => inRange(task.day)),
  ].sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      (a.minutes ?? -1) - (b.minutes ?? -1) ||
      a.title.localeCompare(b.title),
  );

  const open = visible.find((task) => task.id === selected) ?? null;

  // Часы сетки растягиваются под задачи: рабочий день по умолчанию 8–19, но
  // задача на 7 утра не должна оказаться за краем сетки.
  //
  // Конец упирается в сутки: задача в 23:30 иначе дорисовывала бы час «24:00»,
  // которого не бывает. Последняя строка сетки — 23:00, и 23:30 лежит в ней.
  const timed = visible.flatMap((task) => (task.minutes === null ? [] : [task.minutes]));
  const first = Math.floor(Math.min(8 * 60, ...timed) / 60) * 60;
  const last = Math.min(
    24 * 60,
    Math.ceil(Math.max(19 * 60, ...timed.map((minute) => minute + 60)) / 60) * 60,
  );
  const hours: number[] = [];
  for (let minute = first; minute < last; minute += 60) hours.push(minute);

  const href = (nextView: CalendarView, nextDay: Day) =>
    `${basePath}?view=${nextView}&date=${nextDay}`;

  const chip = {
    today,
    selectedId: open?.id ?? null,
    panelId,
    onSelect: (id: string) => {
      setAdding(false);
      setSelected((current) => (current === id ? null : id));
    },
  };

  const closePanel = (id: string) => {
    setSelected(null);
    document.getElementById(`task-${id}`)?.focus();
  };

  return (
    <div className="flex flex-col gap-4">
      <p aria-live="polite" className="sr-only">
        {said}
      </p>

      {/* ---- Перемещение по времени и выбор вида ---- */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-border bg-surface p-2">
        <div className="flex shrink-0 items-center gap-1">
          <Link href={href(view, stepDay(view, day, -1))} className={`${GHOST} w-11 px-0`}>
            <span className="sr-only">{stepLabel(view, -1)}</span>
            <Icon name="chevron-right" size={16} className="rotate-180" />
          </Link>
          <Link href={href(view, today)} className={GHOST}>
            Сегодня
          </Link>
          <Link href={href(view, stepDay(view, day, 1))} className={`${GHOST} w-11 px-0`}>
            <span className="sr-only">{stepLabel(view, 1)}</span>
            <Icon name="chevron-right" size={16} />
          </Link>
        </div>

        <p className="min-w-0 flex-1 basis-40 text-sm font-semibold text-fg">
          {periodLabel(view, day)}
        </p>

        <nav aria-label="Вид календаря" className="shrink-0">
          <ul className="flex items-center gap-1">
            {VIEW_TITLES.map((entry) => {
              const active = entry.key === view;
              return (
                <li key={entry.key}>
                  <Link
                    href={href(entry.key, day)}
                    aria-current={active ? "true" : undefined}
                    className={`flex min-h-11 items-center rounded-ctl px-3 text-xs ${
                      active
                        ? "bg-accent font-semibold text-on-accent"
                        : "text-fg-2 hover:bg-surface-2"
                    }`}
                  >
                    {entry.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {adding || cases.length === 0 ? null : (
          <button
            ref={addRef}
            type="button"
            className={SOLID}
            onClick={() => {
              setSelected(null);
              setAdding(true);
            }}
          >
            <Icon name="plus" size={15} />
            Новая задача
          </button>
        )}
      </div>

      {adding ? (
        <NewTask
          day={day}
          cases={cases}
          cancelRef={cancelRef}
          onCancel={() => {
            setAdding(false);
            addRef.current?.focus();
          }}
          onSubmit={({ title, details, date, time, caseId }) => {
            const minutes = time
              ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
              : null;
            const task: CalendarTask = {
              id: `local-${counter++}`,
              title,
              details: details.trim() || null,
              day: date,
              minutes,
              state: "open",
              cancelReason: null,
              // Дело выбрано, значит человек известен: карточка показывает
              // имя, в модель уйдёт `student_case_id`.
              person: cases.find((option) => option.id === caseId)?.person ?? null,
            };
            ADDED = [...ADDED, task];
            setAdded(ADDED);
            setAdding(false);
            setSaid(
              `Задача «${title}» заведена на ${dayLabel(date)}${
                minutes === null ? ", весь день" : `, ${timeLabel(minutes)}`
              }.`,
            );
            // Заведённая на другой период задача исчезла бы из виду: везём
            // экран к ней, а не оставляем человека гадать, куда она делась.
            if (inRange(date)) addRef.current?.focus();
            else router.push(href(view, date));
          }}
        />
      ) : null}

      {open ? (
        <Details
          key={open.id}
          task={open}
          today={today}
          panelId={panelId}
          onClose={() => closePanel(open.id)}
          onRemove={() => {
            if (open.id.startsWith("local-")) {
              ADDED = ADDED.filter((task) => task.id !== open.id);
              setAdded(ADDED);
            } else {
              HIDDEN = [...HIDDEN, open.id];
              setHidden(HIDDEN);
            }
            setSelected(null);
            setSaid(`Задача «${open.title}» удалена.`);
            // Карточка сейчас исчезнет вместе с панелью — уводим фокус туда,
            // что на месте всегда.
            (addRef.current ?? cancelRef.current)?.focus();
          }}
        />
      ) : null}

      {visible.length === 0 ? (
        <p className="px-1 text-sm text-fg-3">На этот период задач нет.</p>
      ) : null}

      <section className="min-w-0 overflow-hidden rounded-card border border-border bg-surface">
        {view === "month" ? (
          <MonthGrid
            days={days}
            tasks={visible}
            anchor={day}
            hrefForDay={(value) => href("day", value)}
            label={`Сетка месяца, ${periodLabel(view, day)}`}
            chip={chip}
          />
        ) : (
          <TimeGrid
            days={days}
            tasks={visible}
            hours={hours}
            hrefForDay={(value) => href("day", value)}
            label={`Сетка периода, ${periodLabel(view, day)}`}
            chip={chip}
          />
        )}
      </section>
    </div>
  );
}
