"use client";

import { useState } from "react";

import { formatQueueDay, nextFriday } from "../queue/due-bucket";
import { QUEUE_FIELD } from "../queue/queue-buttons";
import { shiftDay, type Day } from "../calendar/types";

type Choice = "today" | "tomorrow" | "friday" | "date" | "none";

const CHIP = "v3-choice inline-flex min-h-11 items-center rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg";

/**
 * Срок в диалоге «Новая задача»: по умолчанию сегодня, на весь день. Быстрые
 * варианты — «Сегодня», «Завтра», ближайшая пятница, «Дата…» (день и, если
 * нужно, время по Бишкеку) и «Без срока». Поля формы — те же, что принимают
 * команды создания: `deadline_kind`, `due_on`, `due_at`.
 */
export function ComposerDeadlineField({ day, disabled = false }: Readonly<{ day: Day; disabled?: boolean }>) {
  const [choice, setChoice] = useState<Choice>("today");
  const [date, setDate] = useState(day);
  const [time, setTime] = useState("");
  const friday = nextFriday(day);
  const quickDay = choice === "today" ? day : choice === "tomorrow" ? shiftDay(day, 1) : choice === "friday" ? friday : null;
  const kind = choice === "none" ? "none" : choice === "date" && time ? "timed" : "all_day";
  const dueOn = kind === "all_day" ? quickDay ?? date : "";
  const dueAt = kind === "timed" ? `${date}T${time}` : "";
  // В четверг ближайшая пятница — это «Завтра»: второй кнопки на тот же день нет.
  const chips: readonly (readonly [Choice, string])[] = [
    ["today", "Сегодня"],
    ["tomorrow", "Завтра"],
    ...(friday !== shiftDay(day, 1) ? [["friday", `Пт ${formatQueueDay(friday, day)}`] as const] : []),
    ["date", "Дата…"],
    ["none", "Без срока"],
  ];
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="t-label text-fg">Срок</legend>
      <input type="hidden" name="deadline_kind" value={kind} />
      <input type="hidden" name="due_on" value={dueOn} />
      <input type="hidden" name="due_at" value={dueAt} />
      <div className="mt-1 flex flex-wrap gap-2">
        {chips.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={choice === value} onClick={() => setChoice(value)} className={CHIP}>
            {label}
          </button>
        ))}
      </div>
      {choice === "date" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="t-label text-fg-2">
            Дата
            <input type="date" required value={date} onChange={(event) => setDate(event.target.value)} className={QUEUE_FIELD} />
          </label>
          <label className="t-label text-fg-2">
            Время · по Бишкеку
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={QUEUE_FIELD} />
            <span className="mt-1 block t-meta text-fg-3">Пусто — весь день</span>
          </label>
        </div>
      ) : null}
    </fieldset>
  );
}
