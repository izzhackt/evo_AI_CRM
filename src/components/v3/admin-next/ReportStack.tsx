import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type StackRow = Readonly<{ key: string; head: ReactNode; cells: readonly ReactNode[] }>;

function StackItem({ head, labels, cells, total }: Readonly<{ head: ReactNode; labels: readonly string[]; cells: readonly ReactNode[]; total?: boolean }>) {
  return (
    <li className={cn("grid gap-2 px-4 py-3", total && "bg-surface-2")}>
      <p className="t-item text-fg">{head}</p>
      <dl className="grid gap-1.5">
        {cells.map((cell, index) => (
          <div key={index} className="flex items-baseline justify-between gap-4">
            <dt className="t-meta text-fg-3">{labels[index]}</dt>
            <dd className="min-w-0 text-right tabular-nums">{cell}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

/**
 * Узкий вид итоговой таблицы (`ReportTable`): на телефоне столбец за краем карточки никто не найдёт, поэтому каждая строка — блок «название,
 * под ним подпись — число». Те же слова и числа, что в таблице; рисуется только когда таблица не помещается (классы показа у `ReportTable`),
 * скрытая часть не попадает ни в дерево доступности, ни в порядок Tab.
 */
export function ReportStack({ label, columns, rows, foot, className }: Readonly<{
  label: string;
  columns: readonly string[];
  rows: readonly StackRow[];
  foot?: Readonly<{ head: ReactNode; cells: readonly ReactNode[] }>;
  className?: string;
}>) {
  const labels = columns.slice(1);
  return (
    <ul aria-label={label} data-slot="report-stack" className={cn("divide-y divide-border", className)}>
      {rows.map((row) => <StackItem key={row.key} head={row.head} labels={labels} cells={row.cells} />)}
      {foot ? <StackItem head={foot.head} labels={labels} cells={foot.cells} total /> : null}
    </ul>
  );
}
