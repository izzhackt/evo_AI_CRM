import type { DataTableColumn } from "@/components/kit";

import { CaseLinkCell, CuratorCell, SignalsCell, StageCell, StepCell, StudentCell } from "./StudentCells";
import type { NextStudentRow } from "./students-next-model";

/**
 * Колонки «Студентов». «Студент» — заголовок карточки на телефоне; в её ячейке уже есть ссылка-название, открывающая
 * панель (`opensRow`: второй кнопки таблица не добавляет). «Этап» — колонка второго плана (от 64rem блока; в панели он есть).
 * «Куратор» нет в «Мои». «Срок» сортирует шаг по дате; дело целиком открывает стрелка (на телефоне — из панели).
 */
export function studentColumns(curatorColumn: boolean): DataTableColumn<NextStudentRow>[] {
  return [
    { id: "student", header: "Студент", accessorFn: (item) => item.name, sortFn: "text", enableHiding: false,
      meta: { label: "Студент", mobile: "title", opensRow: true }, cell: ({ row }) => <StudentCell item={row.original} /> },
    { id: "step", header: "Следующий шаг", accessorFn: (item) => item.row.nextAction ?? "", sortFn: (left, right) => left.original.dueSort - right.original.dueSort,
      meta: { label: "Следующий шаг" }, cell: ({ row }) => <StepCell item={row.original} /> },
    { id: "stage", header: "Этап", accessorFn: (item) => item.stage ?? "", sortFn: "text",
      meta: { label: "Этап", wide: true }, cell: ({ row }) => <StageCell item={row.original} /> },
    ...(curatorColumn ? [{ id: "curator", header: "Куратор", accessorFn: (item: NextStudentRow) => item.row.currentCuratorDisplayName ?? "", sortFn: "text" as const,
      meta: { label: "Куратор" }, cell: ({ row }: { row: { original: NextStudentRow } }) => <CuratorCell item={row.original} /> } satisfies DataTableColumn<NextStudentRow>] : []),
    { id: "signals", header: "Сигналы", enableSorting: false, accessorFn: (item) => item.row.overdueTaskCount,
      meta: { label: "Сигналы" }, cell: ({ row }) => <SignalsCell item={row.original} /> },
    { id: "case", header: () => <span className="sr-only">Дело</span>, enableSorting: false, enableHiding: false,
      meta: { label: "Дело", mobile: "hide", align: "end" }, cell: ({ row }) => <CaseLinkCell item={row.original} /> },
  ];
}
