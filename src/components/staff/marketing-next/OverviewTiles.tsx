import { StatTile } from "@/components/kit";
import { Card } from "@/components/ui/card";
import type { MarketingOverview } from "@/lib/marketing-contract";
import { formatMinor } from "@/lib/marketing-view";

import { n } from "./marketing-next-format";

/**
 * Числа периода из того же чтения, что таблицы ниже. Заявки, договоры и оплатившие — одна карточка-воронка в три колонки с линиями
 * между ними (14.11.2026, слово владельца: «можно эти 3 объединить как-то»): путь от заявки до оплаты читается одной строкой.
 * Введённый расход (суммы по валютам, без пересчёта) — своей плиткой: на телефоне во всю строку, сумма «1 200 USD · 500 EUR» шире
 * половины ряда на 320 px и переносится по валютам.
 */
export function OverviewTiles({ overview }: Readonly<{ overview: MarketingOverview }>) {
  const { cohort, spend } = overview;
  const spendText = spend.insideTotals.length ? spend.insideTotals.map((total) => formatMinor(total.amountMinor, total.currency)).join(" · ") : null;
  const steps = [
    { label: "Заявки", value: n(cohort.total), hint: `открыты ${n(cohort.openCount)}` },
    { label: "Договор", value: n(cohort.totals.contract), hint: "на сегодня" },
    { label: "Оплатили", value: n(cohort.totals.paid), hint: "на сегодня" },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-4" data-testid="marketing-tiles">
      <Card size="sm" className="flex-row gap-0 data-[size=sm]:gap-0 md:col-span-3" data-testid="marketing-funnel">
        {steps.map((step) => (
          <div key={step.label} className="grid min-w-0 flex-1 content-start gap-1 border-s border-border px-3 first:border-s-0 sm:px-4">
            <p className="t-caption text-fg-3">{step.label}</p>
            <p className="t-figure text-fg [overflow-wrap:anywhere]">{step.value}</p>
            <p className="t-meta text-fg-3">{step.hint}</p>
          </div>
        ))}
      </Card>
      <div className="[overflow-wrap:anywhere]"><StatTile label="Расход" value={spendText} hint={spendText ? "введён вручную" : undefined} /></div>
    </div>
  );
}
