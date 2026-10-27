import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";

/**
 * Что умеет `DataTable` (TanStack Table v9, функции подключаются явно): сортировка, общий поиск, видимость
 * колонок, страницы. Один набор на все таблицы: правила и права остаются у данных, таблица только показывает.
 */
export type DataTableColumnMeta = {
  /** Подпись в списке колонок и в карточке на телефоне; по умолчанию — заголовок колонки, если он строка. */
  label?: string;
  /** Телефон (<768 px): `title` — заголовок карточки (одна колонка), `hide` — не показывать в карточке. */
  mobile?: "title" | "hide";
  /** Числа и суммы — к правому краю. */
  align?: "end";
  /**
   * Ячейка-заголовок сама содержит настоящую ссылку или кнопку, которая открывает запись (клавиши очереди и возврат
   * фокуса привязаны к ней): таблица не добавляет в ячейку второй, одноимённый переход.
   */
  opensRow?: boolean;
  /**
   * Колонка второго плана: рисуется, только когда блок таблицы шире 64rem (`@5xl`); у́же её место отдают главной колонке.
   * Сведения из неё должны быть и в панели записи. Телефон (карточки) от этого не зависит: там `mobile`.
   */
  wide?: boolean;
  /**
   * Колонка ровно по содержимому (флажок выбора, значок «Скачать»): `w-px` + `nowrap`. Без этого автоширина таблицы раздаёт свободное
   * место и таким колонкам тоже, и ширина «Выбора» гуляет от 36 до 146 px от экрана к экрану.
   */
  fit?: boolean;
};

export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text, datetime: sortFn_datetime, basic: sortFn_basic },
  filterFns: { includesString: filterFn_includesString },
  columnMeta: {} as DataTableColumnMeta,
});

/** Колонка таблицы: `accessorKey`/`accessorFn`, `header`, `cell`, `meta` (см. `DataTableColumnMeta`). */
export type DataTableColumn<T extends RowData> = ColumnDef<typeof dataTableFeatures, T>;

export const PAGE_SIZES = [10, 25, 50] as const;
