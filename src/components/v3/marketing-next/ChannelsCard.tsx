import { KeyFacts, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { LEAD_CHANNELS } from "@/lib/lead-channel-contract";
import type { CohortChannelRow, MarketingOverview } from "@/lib/marketing-contract";
import { MARKETING_MIN_FOR_SHARE, shareText, unknownSource } from "@/lib/marketing-view";
import { ChannelLabel, ShareMeter, type ChannelKey } from "@/components/v3/marketing/ChannelLabel";

import { channelBasisLine, leadsWord, n } from "./marketing-next-format";
import { MoneyLines } from "./MoneyLines";
import { ReportTable, type ReportTableRow } from "@/components/v3/admin-next/ReportTable";

type Cells = Pick<CohortChannelRow, "leads" | "qualified" | "handedOff" | "contract" | "contractLinked" | "paid" | "paidWithoutAmount"> & { paidAmounts?: CohortChannelRow["paidAmounts"] };

/** Доля заявок периода, дошедших до этапа: «7 из 23 · 30 %» и тонкая полоса цвета канала (от 10 заявок); меньше — только «N из M». */
function share(part: number, row: Cells) {
  if (row.leads <= 0) return "—";
  return row.leads < MARKETING_MIN_FOR_SHARE ? shareText(part, row.leads) : <>{shareText(part, row.leads)}<ShareMeter part={part} whole={row.leads} /></>;
}

function stageCells(row: Cells) {
  return [
    share(row.qualified, row),
    share(row.handedOff, row),
    <>{share(row.contract, row)}{row.contractLinked > 0 ? <span className="block t-meta text-fg-3">связано вручную {n(row.contractLinked)}</span> : null}</>,
    <>
      {share(row.paid, row)}
      {row.paidAmounts ? <MoneyLines items={row.paidAmounts} noun={leadsWord} /> : null}
      {row.paidWithoutAmount > 0 ? <span className="block t-meta text-fg-3">сумма не названа: {n(row.paidWithoutAmount)}</span> : null}
    </>,
  ];
}

/**
 * «Заявки по каналам» — когорта периода: что стало с заявками на сегодня. Полоса состава — только от 10 заявок и скрыта от
 * читалки (её данные в таблице). Под таблицей три факта: доля неизвестного источника со ссылкой «Указать источник»,
 * повторные обращения, анкеты платформы. Пояснения про даты, доли и «не новые лиды» — за «?».
 */
export function ChannelsCard({ overview, unknownHref }: Readonly<{ overview: MarketingOverview; unknownHref?: string }>) {
  const { cohort } = overview;
  const { unknown, whole } = unknownSource(overview);
  const bar = [
    ...cohort.channels.filter((row) => row.channel !== "unknown").map((row) => ({ key: row.channel as ChannelKey, title: LEAD_CHANNELS[row.channel], leads: row.leads })),
    { key: "unknown" as ChannelKey, title: LEAD_CHANNELS.unknown, leads: unknown },
    { key: "cabinet" as ChannelKey, title: "Анкеты на платформе", leads: cohort.cabinetForms },
  ].filter((part) => part.leads > 0);
  const rows: ReportTableRow[] = cohort.channels.map((row) => {
    const basis = channelBasisLine(row, cohort.cabinetForms);
    return {
      key: row.channel, channel: row.channel,
      head: <><ChannelLabel channel={row.channel}>{LEAD_CHANNELS[row.channel]}</ChannelLabel>{basis ? <span className="block pl-4 t-meta font-normal text-fg-3">{basis}</span> : null}</>,
      cells: [n(row.leads), ...stageCells(row)],
    };
  });
  return (
    <WidgetCard
      title="Заявки по каналам"
      help="Заявки периода по дате заявки и то, что с ними стало на сегодня. Доли считаются от 10 заявок; повторные обращения — не новые лиды, канал лида они не меняют."
      actions={unknownHref && unknown > 0 ? <Button variant="outline" asChild><a href={unknownHref}>Указать источник</a></Button> : undefined}
      bodyClassName="grid gap-4"
    >
      <div data-testid="marketing-cohort" className="grid gap-4">
        {cohort.total >= MARKETING_MIN_FOR_SHARE ? (
          <div className="v3-mix" aria-hidden="true" data-testid="marketing-mix-bar">
            {bar.map((part) => <span key={part.key} className="v3-mix-seg" data-channel={part.key} style={{ flexGrow: part.leads, flexBasis: 0 }} title={`${part.title}: ${n(part.leads)}`} />)}
          </div>
        ) : null}
        <ReportTable
          label="Таблица заявок по каналам"
          columns={["Откуда узнал", "Заявки", "Квалифицированы", "Переданы", "Договор", "Оплатили"]}
          rows={rows}
          foot={{ head: "Всего", cells: [n(cohort.totals.leads), ...stageCells({ ...cohort.totals })] }}
        />
        <KeyFacts columns={4} facts={[
          { label: "Заявки с сайта", value: <span data-testid="marketing-website-source" className="tabular-nums">{n(cohort.sourceKeys.website ?? 0)}</span> },
          { label: "Источник не известен", value: <span data-testid="marketing-unknown-line" className="tabular-nums">{shareText(unknown, whole)}</span> },
          { label: "Повторные обращения", value: <span data-testid="marketing-repeats" className="tabular-nums">{n(cohort.repeatSubmissions)}</span> },
          { label: "Анкеты на платформе", value: cohort.cabinetForms > 0 ? <span className="tabular-nums">{n(cohort.cabinetForms)}</span> : null },
        ]} />
      </div>
    </WidgetCard>
  );
}
