import { WidgetCard } from "@/components/kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { SalesManagerSummaryData } from "./sales-next-types";

/**
 * «Продажи по менеджерам»: число продаж и сумма по каждому менеджеру выбранного месяца и итоговая строка. Суммы — в валюте записи,
 * по одной строке на валюту; валюты не пересчитываются. Записи без стоимости названы словами, а не нулём. Продаж нет — карточки нет
 * (15.11.2026: вкладка перегружена): ноль уже стоит в сводке «Продажи» над ней. Таблица не тянется на всю ширину карточки —
 * та же ширина (34rem) и те же поля, что у «Сумм» ниже: три столбца не разбегаются по краям. Карточка уже 37rem (телефон, узкое окно с
 * меню) — таблица от края до края карточки, как раньше: суммам нужна вся ширина. Порог — по ширине карточки, а не окна.
 */
export function SalesManagerSummaryCard({ data, caption }: Readonly<{ data: SalesManagerSummaryData | null; caption: string; }>) {
  if (!data || data.managers.length === 0) return null;
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
    <WidgetCard title="Продажи по менеджерам" help={caption} bodyClassName="@container p-0">
      <div className="overflow-x-auto @min-[37rem]:px-5" data-testid="sales-manager-summary" role="region" aria-label="Продажи по менеджерам" tabIndex={0}>
        <Table className="@min-[37rem]:w-auto @min-[37rem]:min-w-[34rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Менеджер</TableHead>
              <TableHead className="text-right">Продаж</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.managers.map((line) => row(line, false))}
            {row(data.total, true)}
          </TableBody>
        </Table>
      </div>
    </WidgetCard>
  );
}
