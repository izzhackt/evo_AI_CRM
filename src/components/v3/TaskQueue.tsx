"use client";

import { useState } from "react";

import { Pill } from "@/components/v3/Pill";

/**
 * Очередь задач: один список, разбитый по срочности.
 *
 * Не доска и не календарь. У задачи есть срок и исполнительская роль, и
 * единственный вопрос, на который экран обязан отвечать, — что делать сначала.
 * Поэтому сортировка по сроку зашита, а не предложена: список, который можно
 * пересортировать «по названию», отвечает на вопрос, которого никто не задаёт.
 *
 * Галочка отмечает задачу выполненной только на экране: записи в базу здесь
 * нет, и это сказано на странице. Пустая галочка, которая ничего не делает и
 * молчит об этом, — хуже.
 */

export type QueueTask = Readonly<{
  id: string;
  title: string;
  details: string | null;
  open: boolean;
  status: string;
  role: string;
  /** Чей это студент. null — задача не привязана к кейсу. */
  person: string | null;
  /** Срок, «03.09». null — срока нет. */
  due: string | null;
  when: "overdue" | "today" | "tomorrow" | "later" | "none";
  closureReason: string | null;
}>;

const GROUPS = [
  { key: "overdue", title: "Просрочено", tone: "danger" as const },
  { key: "today", title: "Сегодня", tone: "warn" as const },
  { key: "tomorrow", title: "Завтра", tone: "neutral" as const },
  { key: "later", title: "Позже", tone: "neutral" as const },
  { key: "none", title: "Без срока", tone: "neutral" as const },
] as const;

type Filter = "open" | "closed" | "all";

export function TaskQueue({ tasks }: { tasks: readonly QueueTask[] }) {
  const [filter, setFilter] = useState<Filter>("open");
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());

  // Роль показывается только там, где она отличается от общей. Пилюля
  // «admissions» в каждой из двадцати строк не сообщает ничего — она просто
  // шумит. Общую роль достаточно назвать один раз сверху.
  const roles = [...new Set(tasks.map((task) => task.role))];
  const commonRole = roles.length === 1 ? roles[0] : null;

  const counts = {
    open: tasks.filter((t) => t.open).length,
    closed: tasks.filter((t) => !t.open).length,
    all: tasks.length,
  };
  const shown = tasks.filter((t) => (filter === "all" ? true : filter === "open" ? t.open : !t.open));

  const toggle = (id: string) =>
    setDone((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {(["open", "closed", "all"] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-nav border px-2.5 text-xs font-medium ${
              filter === key
                ? "border-accent bg-accent text-on-accent"
                : "border-border bg-surface text-fg-2 hover:border-control-edge"
            }`}
          >
            {key === "open" ? "Открытые" : key === "closed" ? "Закрытые" : "Все"}
            <span className="font-mono tabular-nums">{counts[key]}</span>
          </button>
        ))}

        {commonRole ? (
          <p className="text-2xs text-fg-3">все задачи — на роли {commonRole}</p>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-surface">
        {GROUPS.map((group) => {
          const inGroup = shown.filter((task) => task.when === group.key);
          if (inGroup.length === 0) return null;
          return (
            <section key={group.key} aria-label={group.title}>
              <h3 className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-2 text-2xs font-semibold uppercase tracking-wide text-fg-2">
                {group.title}
                <span className="font-mono tabular-nums font-normal text-fg-3">{inGroup.length}</span>
              </h3>
              <ul>
                {inGroup.map((task) => {
                  const checked = done.has(task.id);
                  return (
                    <li
                      key={task.id}
                      className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-surface-2"
                    >
                      <label className="flex min-h-6 min-w-0 flex-1 items-start gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(task.id)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block text-sm font-medium leading-5 ${
                              checked ? "text-fg-3 line-through" : "text-fg"
                            }`}
                          >
                            {task.title}
                          </span>
                          <span className="mt-0.5 block truncate text-2xs text-fg-3">
                            {task.person ?? "не привязана к студенту"}
                            {task.closureReason ? ` · ${task.closureReason}` : ""}
                          </span>
                        </span>
                      </label>

                      <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
                        {commonRole ? null : <Pill>{task.role}</Pill>}
                        {/* Внутри группы «Без срока» пилюля «без срока»
                            повторяла бы её же заголовок. */}
                        {task.due ? <Pill tone={group.tone}>{task.due}</Pill> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        {shown.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-fg-3">
            {filter === "closed" ? "Закрытых задач нет." : "Задач нет."}
          </p>
        ) : null}
      </div>
    </div>
  );
}
