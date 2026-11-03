import { WidgetCard } from "@/components/kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { SalesCurrencyStack, type CurrencyStackBlock } from "./SalesCurrencyStack";
import type { SalesMoneyData } from "./sales-next-types";

/** Те же числа и слова, что в таблице, блоками по валюте (узкая карточка): остаток — только внутри одной валюты, у пары валют его нет. */
function stackBlocks(data: SalesMoneyData): CurrencyStackBlock[] {
  const paidLabel = data.showRest ? "Оплачено" : "Оплачено по записям";
  const lines = data.lines.map((line): CurrencyStackBlock => ({
    key: line.currency, head: line.currency,
    items: [
      { label: "Стоимость", value: line.cost }, { label: paidLabel, value: line.paid },
      ...(data.showRest ? [{ label: "Остаток", value: line.rest ?? "—", tone: "medium" as const }] : []),
    ],
  }));
  const cross = data.cross.map((pair): CurrencyStackBlock => ({
    key: pair.key, head: pair.label, title: pair.title, sr: pair.sr,
    items: [
      ...(pair.cost !== null ? [{ label: "Стоимость", value: pair.cost }] : []), ...(pair.paid !== null ? [{ label: paidLabel, value: pair.paid }] : []),
      ...(data.showRest ? [{ label: "Остаток", value: "—", tone: "muted" as const, sr: "остаток не считается" }] : []),
    ],
  }));
  return [...lines, ...cross];
}

/**
 * «Суммы по записям»: по валютам стоимость, оплачено и остаток (остаток — только внутри одной валюты; оплата в другой валюте — строкой
 * пары валют без остатка). Подпись называет основу сумм, сноска — что в суммы не вошло и почему остатка нет: это предупреждения о данных,
 * они остаются на виду. Слова те же, что у прежнего вида (`salesMoneyParts`). Таблица — от 34rem ширины карточки; уже — стопка по валютам
 * (`SalesCurrencyStack`), чтобы «Остаток» не прятался за прокруткой.
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
      <div className="grid min-w-0 gap-3" data-testid="sales-money-summary">
        <p className="t-meta text-fg-2">{data.caption}</p>
        {refusal}
        {data.lines.length > 0 || data.cross.length > 0 ? (
          <div className="@container min-w-0">
            <SalesCurrencyStack label="Суммы по валютам" testId="sales-money-stack" blocks={stackBlocks(data)} />
            <div role="region" aria-label="Суммы по валютам" tabIndex={0} className="relative hidden min-w-0 overflow-x-auto @min-[34rem]:block">
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
            </div>
          </div>
        ) : null}
        <p className="t-meta text-fg-3">{data.footnote}</p>
      </div>
    </WidgetCard>
  );
}
