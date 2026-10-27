"use client";

import { useTable, type RowData } from "@tanstack/react-table";
import { SearchXIcon } from "lucide-react";

import { DataTableCards, type CardRow } from "@/components/kit/DataTableCards";
import { DataTableBodyRow, DataTableHeadCell, rowLabelOf } from "@/components/kit/DataTableParts";
import { DataTablePagination } from "@/components/kit/DataTablePagination";
import { DataTableToolbar } from "@/components/kit/DataTableToolbar";
import { dataTableFeatures, type DataTableColumn } from "@/components/kit/data-table-core";
import { EmptyState } from "@/components/kit/EmptyState";
import { useReportVisibleIds } from "@/components/kit/useReportVisibleIds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Таблица списка записей. Данные приходят готовыми (чтения и права остаются у страницы), здесь только вид:
 * сортировка по заголовку, общий поиск, видимость колонок, страницы, нажатие на строку, пустое состояние и
 * загрузка, прилипшая шапка. Меньше 768 px таблица заменяется карточками (`meta.mobile` в колонке).
 * `label` — имя прокручиваемой области для читалки; `toolbar` — свои фильтры страницы рядом с поиском.
 * `paginate={false}` — все присланные строки сразу, без полосы страниц и без «из N»: для списка, который сервер уже
 * ограничил («последние 30») или разбил на страницы своими ссылками («Следующая страница»); экран не называет общим
 * числом то, что получил, не ставит второй листатель и не сбрасывает номер страницы при каждой новой выдаче сервера.
 * `onVisibleIdsChange` — строки на экране после поиска и страницы («все на странице» считают их); `partial` — данные неполные.
 * `onRowClick` — строка нажимается мышью; с клавиатуры и для читалки запись открывает кнопка «Открыть: …» в ячейке-заголовке
 * (колонка с `meta.mobile = "title"`; у колонки с `meta.opensRow` — её собственная ссылка), сама строка фокус не берёт.
 * `getRowLabel` — название записи для имени этой кнопки и кнопки карточки телефона; без него — значение колонки-заголовка.
 */
export function DataTable<T extends RowData>({
  label,
  data,
  columns,
  getRowId,
  onRowClick,
  getRowLabel,
  searchPlaceholder = "Поиск",
  pageSize = 10,
  paginate = true,
  loading = false,
  empty,
  toolbar,
  columnMenu = true,
  onVisibleIdsChange,
  partial = false,
  className,
}: Readonly<{
  label: string;
  data: readonly T[];
  columns: DataTableColumn<T>[];
  getRowId?: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Название записи для имени перехода «Открыть: …» (таблица и карточка); без него — значение колонки-заголовка. */
  getRowLabel?: (row: T) => string;
  searchPlaceholder?: string;
  pageSize?: 10 | 25 | 50;
  /** `false` — своих страниц нет, показаны все присланные строки (сервер ограничил или разбил список). Поиск и сортировка — по ним. */
  paginate?: boolean;
  loading?: boolean;
  /** Что показать, когда записей нет совсем; по умолчанию «Пока пусто». */
  empty?: React.ReactNode;
  toolbar?: React.ReactNode;
  /** Меню «Колонки» (скрыть/показать); у таблицы из двух-трёх колонок оно лишнее. */
  columnMenu?: boolean;
  /** Ключи (`getRowId`) строк на экране, в порядке показа; зовётся, когда набор изменился. Функция должна быть устойчивой. */
  onVisibleIdsChange?: (ids: readonly string[]) => void;
  /** Данные — неполная выборка: «1–25» без «из N», чтобы не выдать неполное число за итог. */
  partial?: boolean;
  className?: string;
}>) {
  const table = useTable(
    { features: dataTableFeatures, columns, data: data as T[], getRowId, initialState: { pagination: { pageIndex: 0, pageSize } }, manualPagination: !paginate, globalFilterFn: "includesString" },
    (state) => state,
  );
  const search = String(table.state.globalFilter ?? "");
  const rows = table.getRowModel().rows;
  useReportVisibleIds(rows.map((row) => row.id), onVisibleIdsChange);
  const matches = table.getPrePaginatedRowModel().rows.length;
  const labelOf = (row: (typeof rows)[number]) => rowLabelOf(row.getVisibleCells(), getRowLabel?.(row.original));
  const cards: CardRow[] = rows.map((row) => ({
    id: row.id,
    label: labelOf(row),
    cells: row.getVisibleCells().map((cell) => ({ id: cell.id, column: cell.column, render: () => <table.FlexRender cell={cell} /> })),
    onOpen: onRowClick ? () => onRowClick(row.original) : undefined,
  }));

  let body: React.ReactNode;
  if (!loading && data.length === 0) {
    body = <div className="rounded-card border border-border bg-surface">{empty ?? <EmptyState title="Пока пусто" />}</div>;
  } else if (!loading && matches === 0) {
    body = (
      <div className="rounded-card border border-border bg-surface">
        <EmptyState icon={SearchXIcon} title="Ничего не найдено" action={<Button variant="outline" onClick={() => table.resetGlobalFilter()}>Сбросить поиск</Button>} />
      </div>
    );
  } else {
    body = (
      <>
        <div role="region" aria-label={label} tabIndex={0} aria-busy={loading || undefined} className="hidden max-h-[min(70dvh,48rem)] overflow-auto rounded-card border border-border bg-surface md:block">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id} className="hover:bg-transparent">
                  {group.headers.map((header) => (
                    <DataTableHeadCell
                      key={header.id}
                      colSpan={header.colSpan}
                      sorted={header.column.getIsSorted()}
                      canSort={header.column.getCanSort()}
                      onSort={header.column.getToggleSortingHandler()}
                      end={header.column.columnDef.meta?.align === "end"}
                      wide={header.column.columnDef.meta?.wide}
                    >
                      {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                    </DataTableHeadCell>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading
                ? [0, 1, 2, 3].map((key) => (
                    <TableRow key={key} className="hover:bg-transparent">
                      <TableCell colSpan={Math.max(1, table.getVisibleLeafColumns().length)}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                : rows.map((row) => (
                    <DataTableBodyRow key={row.id} cells={row.getVisibleCells()} label={labelOf(row)} onOpen={onRowClick ? () => onRowClick(row.original) : undefined} renderCell={(cell) => <table.FlexRender cell={cell} />} />
                  ))}
            </TableBody>
          </Table>
        </div>
        <DataTableCards rows={cards} loading={loading} />
        {loading || !paginate ? null : (
          <DataTablePagination total={matches} totalKnown={!partial} pageIndex={table.state.pagination.pageIndex} pageSize={table.state.pagination.pageSize} pageCount={table.getPageCount()} onPageSize={(size) => table.setPageSize(size)} onPrevious={() => table.previousPage()} onNext={() => table.nextPage()} />
        )}
      </>
    );
  }

  return (
    <div className={cn("@container flex min-w-0 flex-col gap-3", className)} data-slot="data-table">
      <DataTableToolbar search={search} onSearch={(value) => table.setGlobalFilter(value)} placeholder={searchPlaceholder} columns={columnMenu ? table.getAllLeafColumns() : undefined} extra={toolbar} />
      {body}
    </div>
  );
}
