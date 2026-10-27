import type { DataTableColumn } from "@/components/kit";

import { TaskActionsCell, TaskAssigneeCell, TaskDueCell } from "./TaskRowCells";
import { TaskTitleCell } from "./TaskTitleCell";
import type { TaskRow } from "./task-table-model";

/**
 * Колонки таблицы «Задач». Это одни и те же функции для всех строк: состояние (завершённые на месте, выбор, права)
 * ячейки читают из `TaskTableContext`. «Задача» — заголовок карточки на телефоне; под ним до трёх данных: срок и
 * исполнитель. «Исполнитель» есть только там, где в списке не только мои задачи. «⋯» и «Позвонить» на телефоне
 * уходят в панель задачи.
 */
export function taskColumns(showAssignee: boolean): DataTableColumn<TaskRow>[] {
  return [
    {
      id: "task", header: "Задача", accessorFn: (row) => row.search, enableHiding: false, sortFn: "text",
      meta: { label: "Задача", mobile: "title" }, cell: ({ row }) => <TaskTitleCell row={row.original} />,
    },
    {
      id: "due", header: "Срок", accessorFn: (row) => row.task.dueAt ?? row.task.dueOn ?? "", enableGlobalFilter: false,
      sortFn: (left, right) => left.original.dueSort - right.original.dueSort,
      meta: { label: "Срок" }, cell: ({ row }) => <TaskDueCell row={row.original} />,
    },
    ...(showAssignee ? [{
      id: "assignee", header: "Исполнитель", accessorFn: (row: TaskRow) => row.task.assigneeDisplayName, sortFn: "text" as const,
      meta: { label: "Исполнитель" }, cell: ({ row }: { row: { original: TaskRow } }) => <TaskAssigneeCell row={row.original} />,
    } satisfies DataTableColumn<TaskRow>] : []),
    {
      id: "actions", header: () => <span className="sr-only">Действия</span>, enableSorting: false, enableHiding: false, enableGlobalFilter: false,
      meta: { label: "Действия", mobile: "hide", align: "end" }, cell: ({ row }) => <TaskActionsCell row={row.original} />,
    },
  ];
}
