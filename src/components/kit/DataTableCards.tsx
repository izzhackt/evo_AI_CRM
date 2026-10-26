import type { DataTableColumnMeta } from "@/components/kit/data-table-core";
import { Skeleton } from "@/components/ui/skeleton";

type CardCell = {
  id: string;
  column: { columnDef: { header?: unknown; meta?: DataTableColumnMeta } };
  render: () => React.ReactNode;
};
export type CardRow = { id: string; cells: readonly CardCell[]; onOpen?: () => void };

const labelOf = (cell: CardCell) => {
  const header = cell.column.columnDef.header;
  return cell.column.columnDef.meta?.label ?? (typeof header === "string" ? header : "");
};

/**
 * Список карточек вместо таблицы на телефоне (<768 px). Заголовок карточки — колонка с `meta.mobile = "title"`
 * (иначе первая), под ним не больше трёх данных «подпись — значение»; колонки с `mobile = "hide"` не рисуются.
 */
export function DataTableCards({ rows, loading = false }: Readonly<{ rows: readonly CardRow[]; loading?: boolean }>) {
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
      {rows.map((row) => {
        const shown = row.cells.filter((cell) => cell.column.columnDef.meta?.mobile !== "hide");
        const title = shown.find((cell) => cell.column.columnDef.meta?.mobile === "title") ?? shown[0];
        const rest = shown.filter((cell) => cell !== title).slice(0, 3);
        const body = (
          <>
            <span className="t-item block min-w-0 text-fg">{title?.render()}</span>
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
          <li key={row.id}>
            {row.onOpen ? (
              <button type="button" onClick={row.onOpen} className="block min-h-11 w-full min-w-0 rounded-card border border-border bg-surface p-4 text-left hover:bg-surface-2">
                {body}
              </button>
            ) : (
              <div className="min-h-11 rounded-card border border-border bg-surface p-4">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
