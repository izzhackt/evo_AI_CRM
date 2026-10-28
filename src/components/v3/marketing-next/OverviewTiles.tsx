import { StatTile } from "@/components/kit";
import type { MarketingOverview } from "@/lib/marketing-contract";
import { formatMinor } from "@/lib/marketing-view";

import { n } from "./marketing-next-format";

/**
 * Четыре числа периода из того же чтения, что таблицы ниже: заявки, договоры, оплатившие и введённый расход (суммы по валютам, без пересчёта).
 * Расход — «1 200 USD · 500 EUR», шире половины ряда на узком телефоне (320 px): плитка занимает весь ряд и переносит строку по валютам,
 * иначе число выходило за край плитки и страницы.
 */
export function OverviewTiles({ overview }: Readonly<{ overview: MarketingOverview }>) {
  const { cohort, spend } = overview;
  const spendText = spend.insideTotals.length ? spend.insideTotals.map((total) => formatMinor(total.amountMinor, total.currency)).join(" · ") : null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="marketing-tiles">
      <StatTile label="Заявки" value={n(cohort.total)} hint={`открыты ${n(cohort.openCount)}`} />
      <StatTile label="Договор" value={n(cohort.totals.contract)} hint="на сегодня" />
      <StatTile label="Оплатили" value={n(cohort.totals.paid)} hint="на сегодня" />
      <div className="col-span-2 [overflow-wrap:anywhere] md:col-span-1"><StatTile label="Расход" value={spendText} hint={spendText ? "введён вручную" : undefined} /></div>
    </div>
  );
}
