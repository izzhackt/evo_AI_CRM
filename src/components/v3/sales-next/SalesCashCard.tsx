import { WidgetCard } from "@/components/kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { SalesCashData } from "./sales-next-types";

/** «Поступления и возвраты за месяц»: подтверждённые события всей организации; фильтры строк продаж на блок не влияют (пояснение — за «?»). */
export function SalesCashCard({ data }: Readonly<{ data: SalesCashData }>) {
  return (
    <WidgetCard
      title="Поступления и возвраты за месяц"
      id="sales-cash-totals"
      help="Подтверждённые финансовые события всей организации по дате операции, время Бишкека. Фильтры строк продаж на этот блок не влияют. Расходы третьих сторон не являются выручкой EVO."
    >
      {data.kind === "unavailable" ? <p role="alert" className="t-body-compact text-fg-2">Не удалось загрузить финансовую сводку. Обновите страницу, чтобы повторить.</p>
        : data.kind === "empty" ? <p className="t-body-compact text-fg-2">В этом месяце подтверждённых финансовых событий нет.</p>
        : (
          <Table data-testid="sales-cash-totals" className="sm:w-auto sm:min-w-[34rem] [&_td]:px-2 [&_th]:px-2 sm:[&_td]:px-4 sm:[&_th]:px-4">
            <caption className="sr-only">Получено, возвращено и итого по валютам</caption>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead><span className="sr-only">Валюта</span></TableHead>
                <TableHead className="text-right">Получено</TableHead>
                <TableHead className="text-right">Возвращено</TableHead>
                <TableHead className="text-right">Итого</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.totals.map((total) => (
                <TableRow key={total.currency}>
                  <TableHead scope="row" className="t-item text-fg">{total.currency}</TableHead>
                  <TableCell className="text-right tabular-nums">{total.payments}</TableCell>
                  <TableCell className="text-right tabular-nums">{total.refunds}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{total.net}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
    </WidgetCard>
  );
}
