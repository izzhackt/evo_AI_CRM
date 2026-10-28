import { WidgetCard } from "@/components/kit";
import type { MarketingOverview, SpendRow } from "@/lib/marketing-contract";
import { formatMinor } from "@/lib/marketing-view";
import { MarketingSpendCancel } from "@/components/v3/marketing/MarketingSpendCancel";

import { dayText } from "./marketing-next-format";
import { SpendAddSheet } from "./SpendAddSheet";

const periodText = (row: Pick<SpendRow, "periodStart" | "periodEnd">) =>
  row.periodStart === row.periodEnd ? dayText(row.periodStart) : `${dayText(row.periodStart)} — ${dayText(row.periodEnd)}`;

function SpendList({ rows, testId, cancelIds }: Readonly<{ rows: readonly SpendRow[]; testId: string; cancelIds: Readonly<Record<string, string>> }>) {
  return (
    <ul className="divide-y divide-border border-y border-border" data-testid={testId}>
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2" data-spend-id={row.id}>
          <div className="min-w-0">
            <p className="t-body-compact text-fg">
              <span className="tabular-nums">{formatMinor(row.amountMinor, row.currency)}</span>
              <span className="text-fg-3"> · {periodText(row)}{row.campaign ? ` · ${row.campaign}` : ""}</span>
            </p>
            <p className="t-meta text-fg-3">введено вручную{row.note ? ` · ${row.note}` : ""}</p>
          </div>
          <MarketingSpendCancel spendId={row.id} requestId={cancelIds[row.id] ?? row.id} />
        </li>
      ))}
    </ul>
  );
}

/**
 * «Расход периода» — ручные записи по валютам с пометкой «введено вручную» и «Отменить» у каждой (с подтверждением, как раньше).
 * В итог входят только записи, целиком лежащие в периоде; пересекающиеся частично названы отдельно и не делятся по дням.
 * «Добавить расход» открывает панель с прежней формой.
 */
export function SpendCard({ overview, period, addId, cancelIds }: Readonly<{
  overview: MarketingOverview;
  period: Readonly<{ from: string; to: string }>;
  addId: string;
  cancelIds: Readonly<Record<string, string>>;
}>) {
  const { spend } = overview;
  return (
    <WidgetCard title="Расход периода" actions={<SpendAddSheet requestId={addId} defaultStart={period.from} defaultEnd={period.to} />} bodyClassName="grid gap-3">
      <div data-testid="marketing-spend" className="grid gap-3">
        {spend.insidePeriod.length ? (
          <>
            <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              {spend.insideTotals.map((total) => <span key={total.currency} className="t-figure tabular-nums text-fg">{formatMinor(total.amountMinor, total.currency)}</span>)}
            </p>
            <SpendList rows={spend.insidePeriod} testId="marketing-spend-inside" cancelIds={cancelIds} />
          </>
        ) : <p className="t-body-compact text-fg-3">Расход за период не введён.</p>}
        {spend.partiallyOverlapping.length ? (
          <div className="grid gap-1">
            <p className="t-body-compact text-fg-2">Частично в периоде (не входят в итог):</p>
            <SpendList rows={spend.partiallyOverlapping} testId="marketing-spend-partial" cancelIds={cancelIds} />
          </div>
        ) : null}
      </div>
    </WidgetCard>
  );
}
