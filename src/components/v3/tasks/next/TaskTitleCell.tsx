"use client";

import Link from "next/link";

import { StatusBadge } from "@/components/kit";
import { taskStatus } from "@/lib/v3/wording";

import { RowSelect } from "../../queue/Bulk";
import { TaskCompleteControl } from "./TaskCompleteControl";
import { useTaskTable } from "./TaskTableContext";
import { exceptionWord, type TaskRow } from "./task-table-model";

/** Имя студента или клиента: ссылка на карточку только при мыши на широком экране (24 px высоты), на сенсорном — текст: нажатие открывает панель. Длинное имя переносится, а не обрезается: ячейка таблицы и карточка телефона не расширяются под него. */
function PersonName({ href, name }: Readonly<{ href: string; name: string }>) {
  return (
    <>
      <Link href={href} className="relative z-10 hidden min-h-6 min-w-0 items-center break-words underline-offset-2 hover:text-fg hover:underline md:pointer-fine:flex">
        {name}
      </Link>
      <span className="min-w-0 break-words md:pointer-fine:hidden">{name}</span>
    </>
  );
}

/**
 * Ячейка «Задача»: круг, название-ссылка (открывает панель; `data-queue-open` и `data-queue-row` оставлены, чтобы
 * работали клавиши очереди и возврат фокуса «Отменить») и одна строка под названием — студент или клиент,
 * «из чата», «дело закрыто» и слово-исключение (заблокирована, отменена). Отметка массового выбора стоит слева,
 * пока выбор открыт. Обёртка (`relative z-0`) держит слои круга и ссылок внутри ячейки: прилипшая шапка таблицы (z-10)
 * остаётся над прокрученными строками.
 */
export function TaskTitleCell({ row }: Readonly<{ row: TaskRow }>) {
  const table = useTaskTable();
  const { task, lead } = row;
  const done = Boolean(table.recent[task.key]);
  const exception = exceptionWord(task, table.open);
  const error = table.errors[task.key];
  const { selection } = table;
  const student = task.kind === "case" && task.studentCaseId ? { name: task.studentDisplayName ?? "", href: `/v3/profile?case=${encodeURIComponent(task.studentCaseId)}` } : null;
  const person = student ?? (lead ? { name: lead.name, href: lead.href } : null);
  const meta = [task.fromChat && !student ? "из чата" : null, task.caseState === "closed" ? "дело закрыто" : null].filter(Boolean);
  return (
    <div data-queue-row={task.key} data-kind={task.kind} className="relative z-0 flex min-w-0 items-start">
      {selection && table.selectable.has(task.key) && !done ? (
        <span className={selection.revealed ? "contents" : "hidden"}>
          <RowSelect label={task.title} checked={selection.has(task.key)} onToggle={() => selection.toggle(task.key)} />
        </span>
      ) : selection?.revealed ? <span aria-hidden="true" className="size-11 shrink-0" /> : null}
      <TaskCompleteControl row={row} />
      <div className="min-w-0 flex-1 py-0.5">
        <Link href={table.panelHref(task)} scroll={false} data-queue-open="" title={task.title}
          className={`break-words py-0.5 t-item before:absolute before:inset-0 before:content-[''] hover:underline ${done ? "text-fg-3 line-through" : "text-fg"}`}>
          {task.title}
        </Link>
        {done ? <p className="t-meta text-fg-2">Завершено</p> : person || meta.length > 0 || exception ? (
          <p className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-2 t-meta text-fg-2">
            {person ? <PersonName href={person.href} name={person.name} /> : null}
            {meta.map((part) => <span key={part} className="min-w-0 break-words">{part}</span>)}
            {exception ? <StatusBadge label={taskStatus(task.status) ?? exception} tone={exception === "blocked" ? "warn" : "neutral"} /> : null}
          </p>
        ) : null}
        {error ? <p role="alert" className="pb-1 t-body-compact text-danger">{error}</p> : null}
      </div>
    </div>
  );
}
