import { StatusBadge, WidgetCard } from "@/components/kit";
import { LEAD_CHANNELS } from "@/lib/lead-channel-contract";
import type { MarketingOverview } from "@/lib/marketing-contract";
import { ChannelLabel } from "@/components/v3/marketing/ChannelLabel";

import { contractsWord, n } from "./marketing-next-format";
import { MoneyLines } from "./MoneyLines";
import { ReportTable } from "@/components/v3/admin-next/ReportTable";

/**
 * «Продажи периода» — по дате договора; считаются отдельно от когорты заявок и сверяются с «Продажами» отчёта. Расхождение
 * остаётся на виду красным словом, совпадение — спокойным.
 */
export function SalesCard({ overview }: Readonly<{ overview: MarketingOverview }>) {
  const { sales } = overview;
  const recon = sales.reconciliation;
  return (
    <WidgetCard
      title="Продажи периода"
      help="Договоры по дате договора, отдельно от заявок периода. Ниже — сверка с «Продажами» отчёта."
      footer={(
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 t-body-compact text-fg" data-testid="marketing-reconciliation" data-matches={recon.matches}>
          <span>По каналам и без привязки — <span className="tabular-nums">{n(recon.byChannelPlusWithoutLead)}</span>; «Продажи» в отчёте — <span className="tabular-nums">{n(recon.reportSales)}</span>.</span>
          {recon.matches ? <StatusBadge tone="ok" label="Совпадает" /> : <StatusBadge tone="danger" label={`Расхождение: ${recon.difference > 0 ? "+" : ""}${n(recon.difference)}`} />}
        </p>
      )}
    >
      <div data-testid="marketing-sales">
        <ReportTable
          label="Таблица договоров по каналам"
          minWidth="min-w-[28rem]"
          columns={["Откуда узнал", "Договоры", "Сумма договоров"]}
          rows={sales.channels.map((row) => ({
            key: row.channel, channel: row.channel,
            head: <ChannelLabel channel={row.channel}>{row.channel === "without_lead" ? "Без привязки к лиду" : LEAD_CHANNELS[row.channel]}</ChannelLabel>,
            cells: [
              <>{n(row.contracts)}{row.linkedManually > 0 ? <span className="block t-meta text-fg-3">связано вручную {n(row.linkedManually)}</span> : null}</>,
              <>
                {row.amounts.length ? <MoneyLines items={row.amounts} noun={contractsWord} primary /> : <span className="text-fg-3">{row.contracts > 0 ? "сумма не указана" : "—"}</span>}
                {row.amounts.length > 0 && row.amountMissing > 0 ? <span className="block t-meta text-fg-3">без суммы: {n(row.amountMissing)}</span> : null}
              </>,
            ],
          }))}
        />
      </div>
    </WidgetCard>
  );
}
