import type { ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type StackRow = Readonly<{ key: string; head: ReactNode; cells: readonly ReactNode[] }>;
type ItemProps = Readonly<{ head: ReactNode; labels: readonly string[]; cells: readonly ReactNode[]; total?: boolean }>;

function Pairs({ labels, cells, total, from = 0 }: Readonly<{ labels: readonly string[]; cells: readonly ReactNode[]; total?: boolean; from?: number }>) {
  return (
    <dl className="grid gap-1.5">
      {cells.slice(from).map((cell, index) => (
        <div key={index} className="flex items-baseline justify-between gap-4">
          <dt className="t-meta text-fg-3">{labels[from + index]}</dt>
          <dd className={cn("min-w-0 text-right tabular-nums", total && "font-semibold")}>{cell}</dd>
        </div>
      ))}
    </dl>
  );
}

function StackItem({ head, labels, cells, total }: ItemProps) {
  return (
    <li className="grid gap-2 py-3">
      <p className="t-item text-fg">{head}</p>
      <Pairs labels={labels} cells={cells} total={total} />
    </li>
  );
}

/**
 * Свёрнутая строка (14.11.2026, слово владельца: «добавим стрелку — нажимает, появляется доп. инфа»): название и первое число в одну
 * линию со стрелкой; нажатие раскрывает остальные подписи с числами. Настоящий `details`: клавиатура и читалка — без своего кода.
 * Рамка фокуса — внутри строки (общее правило рисует её снаружи, а обёртка таблицы с `overflow-hidden` срезала бы края);
 * поэтому у строки свой отступ `px-2`, чтобы рамка не легла на текст.
 */
function FoldItem({ head, labels, cells, total }: ItemProps) {
  return (
    <li>
      <details className="group" data-stack-fold="">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-nav px-2 py-3 focus-visible:-outline-offset-2! focus-visible:shadow-none! [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1 t-item text-fg">{head}</span>
          <span className="shrink-0 t-meta text-fg-3">{labels[0]}</span>
          <span className={cn("shrink-0 tabular-nums", total && "font-semibold")}>{cells[0]}</span>
          <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-fg-3 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="px-2 pb-3"><Pairs labels={labels} cells={cells} total={total} from={1} /></div>
      </details>
    </li>
  );
}

/**
 * Узкий вид итоговой таблицы (`ReportTable`): на телефоне столбец за краем карточки никто не найдёт, поэтому каждая строка — блок «название,
 * под ним подпись — число». Те же слова и числа, что в таблице; рисуется только когда таблица не помещается (классы показа у `ReportTable`),
 * скрытая часть не попадает ни в дерево доступности, ни в порядок Tab. `fold` — строки свёрнуты: название и первое число со стрелкой.
 */
export function ReportStack({ label, columns, rows, foot, fold = false, className }: Readonly<{
  label: string;
  columns: readonly string[];
  rows: readonly StackRow[];
  foot?: Readonly<{ head: ReactNode; cells: readonly ReactNode[] }>;
  fold?: boolean;
  className?: string;
}>) {
  const labels = columns.slice(1);
  const Item = fold ? FoldItem : StackItem;
  return (
    <ul aria-label={label} data-slot="report-stack" className={cn("divide-y divide-border", className)}>
      {rows.map((row) => <Item key={row.key} head={row.head} labels={labels} cells={row.cells} />)}
      {foot ? <Item head={foot.head} labels={labels} cells={foot.cells} total /> : null}
    </ul>
  );
}
