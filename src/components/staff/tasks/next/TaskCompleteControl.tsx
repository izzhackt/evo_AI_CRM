"use client";

import { Icon } from "@/components/icons";
import { taskStatus } from "@/lib/v3/wording";

import { taskRowAbilities } from "../TaskQueueRow";
import { useTaskTable } from "./TaskTableContext";
import type { TaskRow } from "./task-table-model";
import { useTaskQuickCommands } from "./useTaskQuickCommands";

const CIRCLE = "relative z-10 grid size-11 shrink-0 place-items-center rounded-full";
const HOVER_ICONS = (
  <>
    <Icon name="circle" size={22} className="group-hover:hidden group-focus-visible:hidden" />
    <Icon name="circle-check" size={22} className="hidden group-hover:block group-focus-visible:block" />
  </>
);

/**
 * Круг слева от названия — те же права и команды, что у круга прежней строки (`taskRowAbilities`). Рабочую задачу
 * он завершает на месте (строка остаётся около 6 секунд с «Отменить»), задачу по студенту — открывает панель с
 * полем «Результат»: без результата она не завершается. Завершённая — отметка; в «Завершённых» — только знак
 * состояния; нет права — пустое место, чтобы названия стояли ровно.
 */
export function TaskCompleteControl({ row }: Readonly<{ row: TaskRow }>) {
  const table = useTaskTable();
  const { task } = row;
  const commands = useTaskQuickCommands(task);
  const can = taskRowAbilities(task, table.permissions, table.open, new Date(table.nowIso));
  if (table.recent[task.key]) {
    return <span className={`${CIRCLE} text-ok`}><Icon name="circle-check" size={22} /><span className="sr-only">Завершено</span></span>;
  }
  if (can.complete && task.kind === "staff") {
    return (
      <button type="button" onClick={() => void commands.complete()} disabled={commands.pending} aria-label={`Завершить: ${task.title}`}
        className={`group ${CIRCLE} text-fg-3 hover:text-ok focus-visible:text-ok disabled:text-fg-3`}>
        {HOVER_ICONS}
      </button>
    );
  }
  if (can.complete) {
    return (
      <button type="button" onClick={() => table.navigate(table.panelHref(task))} aria-label={`Завершить с результатом: ${task.title}`}
        className={`group ${CIRCLE} text-fg-3 hover:text-ok focus-visible:text-ok`}>
        {HOVER_ICONS}
      </button>
    );
  }
  if (!table.open) {
    return (
      <span className={`${CIRCLE} text-fg-3`}>
        <Icon name={task.status === "done" ? "circle-check" : "circle"} size={22} />
        {task.status === "done" ? <span className="sr-only">{taskStatus(task.status)}</span> : null}
      </span>
    );
  }
  return <span aria-hidden="true" className="size-11 shrink-0" />;
}
