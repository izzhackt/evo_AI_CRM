"use client";

import { useState } from "react";

import { formatQueueDay, nextFriday } from "../queue/due-bucket";
import { QUEUE_FIELD } from "../queue/queue-buttons";
import { shiftDay, type Day } from "../calendar/types";

export type Choice = "today" | "tomorrow" | "friday" | "date" | "none";

const CHIP = "v3-choice inline-flex min-h-11 items-center rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg";

/** Быстрый вариант для дня по умолчанию: другой день — «Дата…» с этим днём. */
export function composerDeadlineChoice(day: Day, defaultDay: Day | null): Choice {
  if (defaultDay === null || defaultDay === day) return "today";
  if (defaultDay === shiftDay(day, 1)) return "tomorrow";
  if (defaultDay === nextFriday(day)) return "friday";
  return "date";
}

/**
 * Срок в диалоге «Новая задача»: по умолчанию сегодня, на весь день; из
 * календаря — выбранный день (Э7). Быстрые варианты — «Сегодня», «Завтра»,
 * ближайшая пятница, «Дата…» (только день, без времени) и «Без
 * срока». Поля формы — те же, что принимают команды создания:
 * `deadline_kind`, `due_on`, `due_at`. Тот же редактор — в панели задачи
 * (`current` — срок задачи сейчас): один способ задать срок везде.
 */
export function ComposerDeadlineField({ day, defaultDay = null, current = null, disabled = false }: Readonly<{
  /** Сегодня в Бишкеке. */
  day: Day;
  /** День срока по умолчанию; null — сегодня. */
  defaultDay?: Day | null;
  /**
   * Срок задачи сейчас (по Бишкеку): день и минуты от полуночи; `day === null` — без срока.
   * `dueAt` — старая точная отметка из базы: время не показываем, но пока выбор не менялся,
   * она уходит как есть (срок не сдвигается, когда в панели меняют только исполнителя).
   */
  current?: Readonly<{ day: Day | null; minutes: number | null; dueAt?: string | null }> | null;
  disabled?: boolean;
}>) {
  const [start] = useState<Readonly<{ choice: Choice; date: Day }>>(() => ({
    choice: current
      ? current.day === null ? "none" : composerDeadlineChoice(day, current.day)
      : composerDeadlineChoice(day, defaultDay),
    date: current?.day ?? defaultDay ?? day,
  }));
  const [choice, setChoice] = useState<Choice>(start.choice);
  const [date, setDate] = useState<Day>(start.date);
  // Выбор не менялся (или вернули как было): старый срок со временем уходит как есть.
  const unchanged = choice === start.choice && date === start.date;
  const friday = nextFriday(day);
  const quickDay = choice === "today" ? day : choice === "tomorrow" ? shiftDay(day, 1) : choice === "friday" ? friday : null;
  const keepLegacyTimed = unchanged && choice !== "none" && current?.minutes != null && Boolean(current.dueAt);
  const kind = choice === "none" ? "none" : keepLegacyTimed ? "timed" : "all_day";
  const dueOn = kind === "all_day" ? quickDay ?? date : "";
  const dueAt = kind === "timed" ? current?.dueAt ?? "" : "";
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
        <label className="mt-3 block t-label text-fg-2 sm:max-w-xs">
          Дата
          <input type="date" required value={date} onChange={(event) => setDate(event.target.value)} className={QUEUE_FIELD} />
        </label>
      ) : null}
    </fieldset>
  );
}
