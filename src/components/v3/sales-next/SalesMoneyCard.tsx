import { WidgetCard } from "@/components/kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { SalesMoneyData } from "./sales-next-types";

/**
 * «Суммы по записям»: по валютам стоимость, оплачено и остаток (остаток — только внутри одной валюты; оплата в другой валюте — строкой
 * пары валют без остатка). Подпись называет основу сумм, сноска — что в суммы не вошло и почему остатка нет: это предупреждения о данных,
 * они остаются на виду. Слова те же, что у прежнего вида (`salesMoneyParts`).
 */
export function SalesMoneyCard({ data, archive }: Readonly<{ data: SalesMoneyData | null; archive: string | null }>) {
  if (archive) {
    return <p className="rounded-card border border-border bg-card px-5 py-3 t-meta text-fg-2" data-testid="sales-archive-basis">{archive}</p>;
  }
  if (!data) return null;
  const refusal = data.refusal ? <p className="t-meta text-fg-2" data-testid="sales-withdrawn-summary">{data.refusal}</p> : null;
  if (data.lines.length === 0 && data.cross.length === 0 && !data.caption) {
    return <WidgetCard title="Суммы">{refusal}</WidgetCard>;
  }
  return (
    <WidgetCard title="Суммы">
      <div className="grid gap-3" data-testid="sales-money-summary">
        <p className="t-meta text-fg-2">{data.caption}</p>
        {refusal}
        {data.lines.length > 0 || data.cross.length > 0 ? (
          <Table data-testid="sales-money-table" className="sm:w-auto sm:min-w-[34rem] [&_td]:px-2 [&_th]:px-2 sm:[&_td]:px-4 sm:[&_th]:px-4">
            <caption className="sr-only">Стоимость, оплачено и остаток по валютам</caption>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead><span className="sr-only">Валюта</span></TableHead>
                <TableHead className="text-right">Стоимость</TableHead>
                <TableHead className="text-right">{data.showRest ? "Оплачено" : "Оплачено по записям"}</TableHead>
                {data.showRest ? <TableHead className="text-right">Остаток</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.lines.map((line) => (
                <TableRow key={line.currency} data-money-line={line.currency}>
                  <TableHead scope="row" className="t-item text-fg">{line.currency}</TableHead>
                  <TableCell className="text-right tabular-nums">{line.cost}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.paid}</TableCell>
                  {data.showRest ? <TableCell className="text-right font-medium tabular-nums">{line.rest ?? "—"}</TableCell> : null}
                </TableRow>
              ))}
              {data.cross.map((pair) => (
                <TableRow key={pair.key} data-money-cross={pair.key}>
                  <TableHead scope="row" title={pair.title} className="font-normal text-fg-2">{pair.label}<span className="sr-only">{pair.sr}</span></TableHead>
                  <TableCell className="text-right tabular-nums">{pair.cost}</TableCell>
                  <TableCell className="text-right tabular-nums">{pair.paid}</TableCell>
                  <TableCell className="text-right text-fg-3">—<span className="sr-only">остаток не считается</span></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        <p className="t-meta text-fg-3">{data.footnote}</p>
      </div>
    </WidgetCard>
  );
}
