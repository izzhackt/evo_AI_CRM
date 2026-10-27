import { useId } from "react";

import type { DataTableColumnMeta } from "@/components/kit/data-table-core";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type CardCell = {
  id: string;
  column: { columnDef: { header?: unknown; meta?: DataTableColumnMeta } };
  render: () => React.ReactNode;
};
export type CardRow = { id: string; cells: readonly CardCell[]; onOpen?: () => void };

/**
 * Содержимое карточки лежит поверх невидимой кнопки на всю карточку и пропускает касания к ней
 * (`pointer-events-none`), а ссылки, кнопки и поля в ячейках сами ловят нажатия — те же элементы, что
 * пропускает нажатие строки таблицы (`INTERACTIVE` в `DataTableParts`). Кнопка не оборачивает ячейки:
 * вложенных интерактивных элементов нет, ссылка в ячейке не открывает запись, действие не нажимает карточку.
 */
const INTERACTIVE_AUTO = "[&_:is(a,button,input,select,textarea,label,[role=checkbox],[role=switch],[role=menuitem])]:pointer-events-auto";

const labelOf = (cell: CardCell) => {
  const header = cell.column.columnDef.header;
  return cell.column.columnDef.meta?.label ?? (typeof header === "string" ? header : "");
};

/**
 * Список карточек вместо таблицы на телефоне (<768 px). Заголовок карточки — колонка с `meta.mobile = "title"`
 * (иначе первая), под ним не больше трёх данных «подпись — значение»; колонки с `mobile = "hide"` не рисуются.
 * Карточка с `onOpen` открывается нажатием на свободное место и клавишей на невидимой кнопке (имя — заголовок
 * карточки); ссылки и кнопки внутри ячеек работают сами по себе.
 */
export function DataTableCards({ rows, loading = false }: Readonly<{ rows: readonly CardRow[]; loading?: boolean }>) {
  const baseId = useId();
  if (loading) {
    return (
      <ul className="grid gap-2 md:hidden" aria-hidden="true">
        {[0, 1, 2].map((key) => (
          <li key={key}><Skeleton className="h-24 w-full" /></li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="grid gap-2 md:hidden" data-slot="data-table-cards">
      {rows.map((row, index) => {
        const titleId = `${baseId}-${index}`;
        const shown = row.cells.filter((cell) => cell.column.columnDef.meta?.mobile !== "hide");
        const title = shown.find((cell) => cell.column.columnDef.meta?.mobile === "title") ?? shown[0];
        const rest = shown.filter((cell) => cell !== title).slice(0, 3);
        const body = (
          <>
            <span id={titleId} className="t-item block min-w-0 text-fg">{title?.render()}</span>
            {rest.length > 0 ? (
              <dl className="mt-2 grid gap-1">
                {rest.map((cell) => (
                  <div key={cell.id} className="flex min-w-0 items-baseline justify-between gap-3">
                    <dt className="t-caption shrink-0 text-fg-3">{labelOf(cell)}</dt>
                    <dd className="t-body-compact min-w-0 text-right text-fg">{cell.render()}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </>
        );
        return (
          <li key={row.id} className={cn("relative min-h-11 rounded-card border border-border bg-surface", row.onOpen && "hover:bg-surface-2")}>
            {row.onOpen ? <button type="button" onClick={row.onOpen} aria-labelledby={titleId} className="absolute inset-0 rounded-card" /> : null}
            <div className={cn("p-4", row.onOpen && cn("pointer-events-none relative", INTERACTIVE_AUTO))}>{body}</div>
          </li>
        );
      })}
    </ul>
  );
}
