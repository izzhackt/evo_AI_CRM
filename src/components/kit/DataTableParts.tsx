"use client";

import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";

import type { DataTableColumnMeta } from "@/components/kit/data-table-core";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Нажатие внутри строки на ссылку, кнопку или поле — не нажатие на саму строку. */
const INTERACTIVE = "a,button,input,select,textarea,label,[role=checkbox],[role=switch],[role=menuitem]";
const SORT_ICON = { asc: ArrowUpIcon, desc: ArrowDownIcon } as const;

/**
 * Нажатие мышью по свободному месту строки или карточки открывает запись, но фокус сам не попадает на кнопку записи: он уходит на
 * ближайший фокусируемый предок (прокручиваемая область таблицы), и `DetailSheet` вернул бы его туда при закрытии (рамка вокруг всей
 * таблицы, следующий Tab — в заголовок). Поэтому перед открытием фокус ставится на кнопку «Открыть: …» (или ссылку-название
 * `data-queue-open`) этой записи: панель запоминает её, Esc возвращает на неё, а рамки при нажатии мышью нет.
 */
export function focusRecordOpener(scope: Element | null): void {
  scope?.querySelector<HTMLElement>("[data-row-open],[data-queue-open]")?.focus({ preventScroll: true });
}

/** Ячейка заголовка: прилипает сверху; сортируемая — кнопка со стрелкой и `aria-sort`. */
export function DataTableHeadCell({
  colSpan,
  sorted,
  canSort,
  onSort,
  meta,
  children,
}: Readonly<{
  colSpan?: number;
  sorted: false | "asc" | "desc";
  canSort: boolean;
  onSort?: (event: unknown) => void;
  /** `meta` колонки: `align`, `wide`, `fit`. */
  meta?: DataTableColumnMeta;
  children?: React.ReactNode;
}>) {
  const end = meta?.align === "end";
  const Icon = sorted ? SORT_ICON[sorted] : ArrowUpDownIcon;
  const ariaSort = sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : canSort ? "none" : undefined;
  return (
    <TableHead colSpan={colSpan} aria-sort={ariaSort} className={cn("sticky top-0 z-10 bg-surface shadow-[inset_0_-1px_0_var(--border)]", end && "text-right", meta?.wide && "hidden @5xl:table-cell", meta?.fit && "w-px")}>
      {children === null || children === undefined ? null : canSort ? (
        <button
          type="button"
          onClick={onSort}
          className={cn("-mx-1 inline-flex min-h-11 items-center gap-1 rounded-nav px-1 hover:text-fg", end && "flex-row-reverse")}
        >
          {children}
          <Icon className="size-3.5" aria-hidden="true" />
        </button>
      ) : (
        children
      )}
    </TableHead>
  );
}

type BodyCell = {
  id: string;
  column: { columnDef: { meta?: DataTableColumnMeta } };
  getValue: () => unknown;
};

/** Ячейка-заголовок записи: колонка с `meta.mobile = "title"`, иначе первая. В ней стоит переход к записи. */
export function titleCellOf<C extends BodyCell>(cells: readonly C[]): C | undefined {
  return cells.find((cell) => cell.column.columnDef.meta?.mobile === "title") ?? cells[0];
}

/** Название записи для имени перехода: заданное страницей, иначе значение колонки-заголовка. */
export function rowLabelOf(cells: readonly BodyCell[], explicit?: string): string {
  if (explicit !== undefined) return explicit.trim();
  const value = titleCellOf(cells)?.getValue();
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

/** Имя перехода к записи: у таблицы (кнопка в ячейке-заголовке) и у карточки телефона одно и то же. */
export const openLabel = (label: string) => (label ? `Открыть: ${label}` : "Открыть запись");

/**
 * Настоящая кнопка «Открыть: …» в ячейке-заголовке: единственная остановка клавиатуры строки и имя для читалки и голосового
 * управления. Прозрачна и не ловит мышь (текст выделяется, ссылки в ячейке работают); мышью открывает сама строка. Рамка
 * фокуса — внутри ячейки, а строка подсвечивается: снаружи её срезали бы прокрутка области и прилипшая шапка.
 */
function RowOpenButton({ label, onOpen }: Readonly<{ label: string; onOpen: () => void }>) {
  return (
    <button
      type="button"
      data-row-open=""
      aria-label={openLabel(label)}
      onClick={onOpen}
      className="pointer-events-none absolute inset-0 rounded-nav focus-visible:-outline-offset-2! focus-visible:shadow-none!"
    />
  );
}

/**
 * Строка тела таблицы. С `onOpen` строка нажимается мышью (удобство), а с клавиатуры открывается кнопкой в ячейке-заголовке
 * (`RowOpenButton`; у колонки с `meta.opensRow` — её собственной ссылкой): сама `<tr>` не принимает фокус и не остаётся
 * безымянной остановкой. Нажатие на ссылку, кнопку или поле внутри строки её не открывает.
 */
export function DataTableBodyRow<C extends BodyCell>({
  cells,
  label,
  onOpen,
  renderCell,
}: Readonly<{ cells: readonly C[]; label: string; onOpen?: () => void; renderCell: (cell: C) => React.ReactNode }>) {
  const title = titleCellOf(cells);
  const ownControl = Boolean(title?.column.columnDef.meta?.opensRow);
  const content = cells.map((cell) => (
    <TableCell key={cell.id} className={cn(cell.column.columnDef.meta?.align === "end" && "text-right", cell.column.columnDef.meta?.wide && "hidden @5xl:table-cell", cell.column.columnDef.meta?.fit && "w-px whitespace-nowrap", onOpen && !ownControl && cell === title && "relative")}>
      {onOpen && !ownControl && cell === title ? <RowOpenButton label={label} onOpen={onOpen} /> : null}
      {renderCell(cell)}
    </TableCell>
  ));
  if (!onOpen) return <TableRow>{content}</TableRow>;
  return (
    <TableRow
      className="cursor-pointer has-[:is([data-row-open],[data-queue-open]):focus-visible]:bg-surface-2"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
        focusRecordOpener(event.currentTarget);
        onOpen();
      }}
    >
      {content}
    </TableRow>
  );
}
