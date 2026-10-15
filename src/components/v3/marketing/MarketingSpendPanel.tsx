import { randomUUID } from "node:crypto";
import { formatMinor } from "@/lib/marketing-view";
import type { MarketingOverview, SpendRow } from "@/lib/marketing-contract";
import { MarketingSpendCancel } from "./MarketingSpendCancel";
import { MarketingSpendForm } from "./MarketingSpendForm";

const dayText = (iso: string) => iso.split("-").reverse().join(".");
const periodText = (row: Pick<SpendRow, "periodStart" | "periodEnd">) =>
  row.periodStart === row.periodEnd ? dayText(row.periodStart) : `${dayText(row.periodStart)} — ${dayText(row.periodEnd)}`;

function SpendList({ rows, testId }: Readonly<{ rows: readonly SpendRow[]; testId: string }>) {
  return (
    <ul className="divide-y divide-border border-y border-border" data-testid={testId}>
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2" data-spend-id={row.id}>
          <div className="min-w-0">
            <p className="t-body-compact text-fg">
              <span className="tabular-nums">{formatMinor(row.amountMinor, row.currency)}</span>
              <span className="text-fg-2"> · {periodText(row)}{row.campaign ? ` · ${row.campaign}` : ""}</span>
            </p>
            <p className="t-meta text-fg-2">введено вручную{row.note ? ` · ${row.note}` : ""}</p>
          </div>
          <MarketingSpendCancel spendId={row.id} requestId={randomUUID()} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Ручной расход периода (план §4): записи по валютам с пометкой «введено вручную», форма добавления и
 * «Отменить» у каждой записи (с подтверждением). В итог и цену входят только записи, целиком лежащие
 * в периоде; пересекающиеся только частично названы отдельно и не делятся по дням.
 */
export function MarketingSpendPanel({ overview, period }: Readonly<{
  overview: MarketingOverview;
  period: Readonly<{ from: string; to: string }>;
}>) {
  const { spend } = overview;
  return (
    <div className="mt-2 space-y-3">
      {spend.insidePeriod.length ? (
        <>
          <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {spend.insideTotals.map((total) => (
              <span key={total.currency} className="t-figure tabular-nums text-fg">{formatMinor(total.amountMinor, total.currency)}</span>
            ))}
            <span className="t-meta text-fg-2">записи целиком в периоде</span>
          </p>
          <SpendList rows={spend.insidePeriod} testId="marketing-spend-inside" />
        </>
      ) : <p className="t-body-compact text-fg-2">Расход за период не введён.</p>}
      {spend.partiallyOverlapping.length ? (
        <div>
          <p className="t-body-compact text-fg-2">Частично в периоде — в итог и цену не входят, по дням не делятся:</p>
          <SpendList rows={spend.partiallyOverlapping} testId="marketing-spend-partial" />
        </div>
      ) : null}
      <MarketingSpendForm requestId={randomUUID()} defaultStart={period.from} defaultEnd={period.to} />
    </div>
  );
}
