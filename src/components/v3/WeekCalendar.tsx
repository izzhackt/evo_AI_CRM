"use client";

import { useState } from "react";

import { Icon } from "@/components/icons";

/**
 * Недельный календарь: колонка дел слева, сетка недели справа.
 *
 * Собран по референсу. Раньше я считал, что сетка с часами не построится,
 * потому что у задачи один срок без времени, — но в референсе есть ответ:
 * строка «Весь день». Задача со временем встаёт в сетку, задача без времени
 * ложится наверх и остаётся видимой, а не пропадает.
 *
 * ДАННЫЕ. Компонент рисует переданное и ничего не грузит. При подключении
 * событию понадобится начало и конец; задача, у которой есть только `due_at`,
 * приходит как `startMinutes: null` и встаёт в «Весь день» — это не заглушка,
 * а нормальное состояние, которое схема допускает уже сейчас.
 */

export type WeekEvent = Readonly<{
  id: string;
  title: string;
  /** 0 — понедельник. */
  day: number;
  /** Минуты от полуночи. null — событие на весь день. */
  startMinutes: number | null;
  /** Минуты от полуночи. Игнорируется, когда событие на весь день. */
  endMinutes: number | null;
  /** Тон карточки: обычная работа, срок, встреча. */
  tone: "work" | "deadline" | "meeting";
  /** Кто участвует. Пустой массив — никого не показываем. */
  people: readonly string[];
  /** Подпись действия на карточке, если оно есть. */
  action: string | null;
}>;

export type DayColumn = Readonly<{
  date: number;
  weekday: string;
  today: boolean;
}>;

export type TodoGroup = Readonly<{
  title: string;
  items: readonly Readonly<{ id: string; title: string; done: boolean }>[];
}>;

const DAY_START = 8 * 60;
const DAY_END = 19 * 60;
/**
 * Высота часа. 56px не хватало: две строки названия плюс время требуют 62px,
 * и время обрезалось. В референсе строка часа тоже заметно выше.
 */
const ROW = 76;

const TONE: Record<WeekEvent["tone"], string> = {
  work: "border-s-info bg-info-weak",
  deadline: "border-s-danger bg-danger-weak",
  meeting: "border-s-ok bg-ok-weak",
};

function timeLabel(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/**
 * Сколько остаётся под аватары и кнопку после названия и времени.
 * Название в две строки — 32px, время 14px, отступы и зазоры — 20px.
 */
const RESERVED = 66;
const NEEDS_AVATARS = 24;
const NEEDS_ACTION = 32;

function EventCard({ event, height }: { event: WeekEvent; height: number }) {
  const span =
    event.startMinutes !== null && event.endMinutes !== null
      ? `${timeLabel(event.startMinutes)} – ${timeLabel(event.endMinutes)}`
      : "весь день";

  // Место считается, а не отдаётся на волю обрезки: обрезанная наполовину
  // кнопка читается как поломка, а не как «не поместилось».
  const spare = height - RESERVED;
  const showAvatars = event.people.length > 0 && spare >= NEEDS_AVATARS;
  const showAction = Boolean(event.action) && spare >= NEEDS_ACTION + (showAvatars ? NEEDS_AVATARS : 0);

  // Заголовок и время не сжимаются: когда карточка короткая, уступают
  // аватары и кнопка, а не название. В первой версии было наоборот, и
  // часовые события показывали только время без названия.
  return (
    <article
      className={`flex h-full flex-col gap-1 overflow-hidden rounded-nav border-s-2 px-2 py-1.5 ${TONE[event.tone]}`}
    >
      <h4 className="line-clamp-2 shrink-0 text-xs font-semibold leading-4 text-fg">
        {event.title}
      </h4>
      <p className="shrink-0 font-mono text-2xs text-fg-3">
        {span}
        {event.people.length > 0 && !showAvatars ? (
          <span className="sr-only">. Участники: {event.people.join(", ")}</span>
        ) : null}
      </p>

      {showAvatars || showAction ? (
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-1 overflow-hidden">
          {showAvatars ? (
            <p className="flex items-center">
              {/* Кружки — украшение; состав читается вслух из строки ниже.
                  aria-label нельзя вешать на элемент без подходящей роли. */}
              {event.people.slice(0, 4).map((person, index) => (
                <span
                  key={person}
                  aria-hidden="true"
                  title={person}
                  style={{ marginInlineStart: index === 0 ? 0 : -6 }}
                  className="grid h-5 w-5 place-items-center rounded-full border border-surface bg-surface-3 font-mono text-[9px] font-semibold text-fg-2"
                >
                  {person.slice(0, 1).toUpperCase()}
                </span>
              ))}
              <span className="sr-only">Участники: {event.people.join(", ")}</span>
            </p>
          ) : null}

          {showAction ? (
            <button
              type="button"
              className="min-h-7 shrink-0 rounded-[6px] bg-accent px-2 text-2xs font-semibold text-on-accent"
            >
              {event.action}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function WeekCalendar({
  days,
  events,
  groups,
  monthLabel,
}: {
  days: readonly DayColumn[];
  events: readonly WeekEvent[];
  groups: readonly TodoGroup[];
  monthLabel: string;
}) {
  const [panel, setPanel] = useState<"todo" | "events">("todo");

  const hours: number[] = [];
  for (let minute = DAY_START; minute < DAY_END; minute += 60) hours.push(minute);

  const allDay = events.filter((event) => event.startMinutes === null);
  const timed = events.filter((event) => event.startMinutes !== null);

  return (
    <div className="grid gap-4 @6xl:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
      {/* ---- Колонка дел, как «Today» в референсе ---- */}
      <aside className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-md font-bold text-fg">Сегодня</h3>
          <button
            type="button"
            aria-label="Добавить дело"
            className="grid h-8 w-8 place-items-center rounded-nav border border-border text-fg-2 hover:bg-surface-2"
          >
            <Icon name="plus" size={16} />
          </button>
        </div>

        <div role="tablist" aria-label="Что показывать" className="flex gap-4 border-b border-border">
          {(["todo", "events"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={panel === key}
              onClick={() => setPanel(key)}
              className={`-mb-px min-h-9 border-b-2 text-sm font-semibold ${
                panel === key ? "border-accent text-fg" : "border-transparent text-fg-3"
              }`}
            >
              {key === "todo" ? "Дела" : "События"}
            </button>
          ))}
        </div>

        {panel === "todo" ? (
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <section key={group.title}>
                <h4 className="flex items-center justify-between text-sm font-semibold text-fg-2">
                  {group.title}
                  <span className="font-mono text-2xs font-normal text-fg-3">
                    {group.items.length}
                  </span>
                </h4>
                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <label className="flex min-h-8 items-start gap-2 text-sm text-fg-2">
                        <input
                          type="checkbox"
                          defaultChecked={item.done}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                        />
                        <span className={item.done ? "text-fg-3 line-through" : ""}>
                          {item.title}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {events.map((event) => (
              <li key={event.id} className="rounded-nav border border-border px-2.5 py-2 text-sm">
                <span className="block font-medium text-fg">{event.title}</span>
                <span className="font-mono text-2xs text-fg-3">
                  {event.startMinutes === null
                    ? "весь день"
                    : `${timeLabel(event.startMinutes)} – ${timeLabel(event.endMinutes ?? event.startMinutes)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* ---- Сетка недели ---- */}
      <section
        aria-label={`Неделя, ${monthLabel}`}
        className="min-w-0 rounded-card border border-border bg-surface"
      >
        <div className="max-w-full overflow-x-auto" role="group" aria-label="Сетка недели" tabIndex={0}>
          <div className="min-w-[640px]">
            {/* Шапка с днями */}
            <div
              className="grid border-b border-border"
              style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}
            >
              <span />
              {days.map((day) => (
                <span
                  key={day.date}
                  className={`flex flex-col items-center gap-0.5 py-2.5 ${
                    day.today ? "border-b-2 border-accent" : ""
                  }`}
                >
                  <span
                    className={`font-mono text-lg font-semibold leading-none ${
                      day.today ? "text-fg" : "text-fg-2"
                    }`}
                  >
                    {day.date}
                  </span>
                  <span className="font-mono text-2xs uppercase tracking-wide text-fg-3">
                    {day.weekday}
                  </span>
                </span>
              ))}
            </div>

            {/* Весь день — сюда ложится работа со сроком, но без времени */}
            <div
              className="grid border-b border-border bg-surface-2"
              style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}
            >
              <span className="px-2 py-2 font-mono text-2xs text-fg-3">весь день</span>
              {days.map((day, index) => (
                <span key={day.date} className="border-s border-border p-1">
                  {allDay
                    .filter((event) => event.day === index)
                    .map((event) => (
                      <span
                        key={event.id}
                        className={`mb-1 block truncate rounded-[5px] border-s-2 px-1.5 py-1 text-2xs font-semibold text-fg ${TONE[event.tone]}`}
                        title={event.title}
                      >
                        {event.title}
                      </span>
                    ))}
                </span>
              ))}
            </div>

            {/* Часы */}
            <div
              className="relative grid"
              style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}
            >
              <div>
                {hours.map((minute) => (
                  <div
                    key={minute}
                    style={{ height: ROW }}
                    className="pe-2 text-end font-mono text-2xs text-fg-3"
                  >
                    <span className="relative -top-1.5">{timeLabel(minute)}</span>
                  </div>
                ))}
              </div>

              {days.map((day, index) => (
                <div key={day.date} className="relative border-s border-border">
                  {hours.map((minute) => (
                    <div key={minute} style={{ height: ROW }} className="border-b border-border" />
                  ))}

                  {timed
                    .filter((event) => event.day === index)
                    .map((event) => {
                      const start = event.startMinutes ?? DAY_START;
                      const end = event.endMinutes ?? start + 60;
                      return (
                        <div
                          key={event.id}
                          className="absolute inset-x-1"
                          style={{
                            top: ((start - DAY_START) / 60) * ROW,
                            height: Math.max(((end - start) / 60) * ROW - 4, 44),
                          }}
                        >
                          <EventCard
                            event={event}
                            height={Math.max(((end - start) / 60) * ROW - 4, 44)}
                          />
                        </div>
                      );
                    })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
