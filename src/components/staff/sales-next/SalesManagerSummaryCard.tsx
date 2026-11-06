import { WidgetCard } from "@/components/kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { SalesManagerSummaryData } from "./sales-next-types";

/**
 * «Продажи по менеджерам»: число продаж и сумма по каждому менеджеру выбранного месяца и итоговая строка. Суммы — в валюте записи,
 * по одной строке на валюту; валюты не пересчитываются. Записи без стоимости названы словами, а не нулём.
 */
export function SalesManagerSummaryCard({ data, caption }: Readonly<{ data: SalesManagerSummaryData | null; caption: string; }>) {
  if (!data) return null;
  const row = (line: SalesManagerSummaryData["total"], strong: boolean) => (
    <TableRow key={line.name + (strong ? ":total" : "")} className={strong ? "border-t-2 border-border font-medium" : undefined} data-summary-row={strong ? "total" : "manager"}>
      <TableCell className="max-w-56 truncate">{line.name}</TableCell>
      <TableCell className="text-right tabular-nums">{line.count.toLocaleString("ru-RU")}</TableCell>
      <TableCell className="text-right tabular-nums">
        {line.sums.length > 0 ? line.sums.map((sum) => <span key={sum} className="block whitespace-nowrap">{sum}</span>) : "—"}
        {line.noCost > 0 ? <span className="block t-meta text-fg-3">без стоимости: {line.noCost.toLocaleString("ru-RU")}</span> : null}
      </TableCell>
    </TableRow>
  );
  return (
    <WidgetCard title="Продажи по менеджерам" help={caption} bodyClassName="p-0">
      <div className="overflow-x-auto" data-testid="sales-manager-summary" role="region" aria-label="Продажи по менеджерам" tabIndex={0}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Менеджер</TableHead>
              <TableHead className="text-right">Продаж</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.managers.length === 0
              ? <TableRow><TableCell colSpan={3} className="text-fg-3">Продаж в выбранном периоде нет.</TableCell></TableRow>
              : data.managers.map((line) => row(line, false))}
            {data.managers.length > 0 ? row(data.total, true) : null}
          </TableBody>
        </Table>
      </div>
    </WidgetCard>
  );
}
