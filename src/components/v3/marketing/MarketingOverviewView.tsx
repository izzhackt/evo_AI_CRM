import { LEAD_CHANNEL_AI_NOTE, LEAD_CHANNEL_BASES, LEAD_CHANNELS, type LeadChannelBasis } from "@/lib/lead-channel-contract";
import type { CohortChannelRow, MarketingOverview, MarketingOverviewRead, MoneyCount, SalesChannelRow } from "@/lib/marketing-contract";
import { costPerLead, formatMinor, formatPerLead, MARKETING_MIN_FOR_SHARE, marketingSignals, shareText, unknownSource, type MarketingSignal } from "@/lib/marketing-view";
import { Icon } from "@/components/icons";
import { ChannelLabel, ShareMeter, type ChannelKey } from "./ChannelLabel";
import { MarketingSpendPanel } from "./MarketingSpendPanel";

const TH = "px-3 py-2 text-left t-caption font-medium text-fg-2";
const TD = "px-3 py-2.5 align-top t-body-compact tabular-nums text-fg";
const META = "block t-meta text-fg-2";
const SECTION_TABLE = "min-w-[40rem] w-full border-collapse";

const n = (value: number) => value.toLocaleString("ru-RU");
const BLOCK = "border-t border-border pt-8";
const LIST = new Intl.ListFormat("ru", { type: "conjunction" });
const BASIS_ORDER: readonly LeadChannelBasis[] = ["utm", "referrer", "staff", "corrected", "unknown"];

/** «не прочитано» — отдельное слово, никогда ноль. */
function Unavailable({ what, retryHref }: Readonly<{ what: string; retryHref: string }>) {
  return (
    <p role="alert" className="t-body-compact text-fg-2">
      Не удалось загрузить {what}.{" "}
      <a href={retryHref} className="inline-flex min-h-11 items-center underline underline-offset-4">Повторить</a>
    </p>
  );
}

function MoneyLines({ items, noun, primary = false }: Readonly<{ items: readonly MoneyCount[]; noun: (count: number) => string; primary?: boolean }>) {
  return <>{items.map((item) => (
    <span key={item.currency} className={primary ? "block t-body-compact text-fg" : META}>
      {formatMinor(item.amountMinor, item.currency)}<span className="text-fg-2"> · {noun(item.count)}</span>
    </span>
  ))}</>;
}
function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100, ones = count % 10;
  return `${n(count)} ${tens >= 11 && tens <= 14 ? many : ones === 1 ? one : ones >= 2 && ones <= 4 ? few : many}`;
}
const leadsWord = (count: number) => plural(count, "лид", "лида", "лидов");
const requestsWord = (count: number) => plural(count, "заявка", "заявки", "заявок");
const contractsWord = (count: number) => plural(count, "договор", "договора", "договоров");

function channelBasisLine(row: CohortChannelRow, cabinetForms: number): string | null {
  const parts = BASIS_ORDER.filter((key) => row.basis[key] > 0 && !(row.channel === "unknown" && key === "unknown"))
    .map((key) => `${LEAD_CHANNEL_BASES[key]} ${n(row.basis[key])}`);
  // Анкеты кабинета в «Не известно» названы отдельно: у них нет формы с метками и слов сотрудника.
  if (row.channel === "unknown" && cabinetForms > 0) parts.push(`из них анкеты на платформе ${n(cabinetForms)}`);
  if (row.aiAssistant > 0) parts.push(`${LEAD_CHANNEL_AI_NOTE} ${n(row.aiAssistant)}`);
  return parts.length ? parts.join(" · ") : null;
}

function CohortCells({ row }: Readonly<{ row: Pick<CohortChannelRow, "leads" | "qualified" | "handedOff" | "contract" | "contractLinked" | "paid" | "paidWithoutAmount"> & { paidAmounts?: readonly MoneyCount[] } }>) {
  const cell = (part: number) => row.leads <= 0 ? "—" : row.leads < MARKETING_MIN_FOR_SHARE ? shareText(part, row.leads)
    : <>{shareText(part, row.leads)}<ShareMeter part={part} whole={row.leads} /></>;
  return (
    <>
      <td className={TD}>{cell(row.qualified)}</td>
      <td className={TD}>{cell(row.handedOff)}</td>
      <td className={TD}>{cell(row.contract)}
        {row.contractLinked > 0 ? <span className={META}>связано вручную {n(row.contractLinked)}</span> : null}</td>
      <td className={TD}>{cell(row.paid)}
        {row.paidAmounts ? <MoneyLines items={row.paidAmounts} noun={leadsWord} /> : null}
        {row.paidWithoutAmount > 0 ? <span className={META}>сумма не названа: {n(row.paidWithoutAmount)}</span> : null}</td>
    </>
  );
}

/**
 * «Откуда приходят заявки»: одна фраза о периоде, полоса состава заявок и подписи с количествами (решение
 * владельца 10.10.2026). Процентов здесь нет: единственная доля неизвестных — строка «Источник не известен»
 * под когортой (без анкет на платформе). Анкеты — отдельный нейтральный пункт, не «Не известно». Полоса —
 * только от 10 заявок, как и доли в таблице; меньше — подписи с количествами. Полоса скрыта от чтения с
 * экрана: её данные стоят в подписях.
 */
function ChannelMix({ overview }: Readonly<{ overview: MarketingOverview }>) {
  const { cohort } = overview;
  const { unknown } = unknownSource(overview);
  type Part = Readonly<{ key: ChannelKey; title: string; leads: number }>;
  const parts: readonly Part[] = ([
    ...cohort.channels.filter((row) => row.channel !== "unknown")
      .map((row): Part => ({ key: row.channel, title: LEAD_CHANNELS[row.channel], leads: row.leads })),
    { key: "unknown", title: LEAD_CHANNELS.unknown, leads: unknown },
    { key: "cabinet", title: "Анкеты на платформе", leads: cohort.cabinetForms },
  ] satisfies Part[]).filter((part) => part.leads > 0);
  const named = parts.filter((part) => part.key !== "unknown" && part.key !== "cabinet");
  const top = named.reduce((best, part) => Math.max(best, part.leads), 0);
  const leaders = named.filter((part) => part.leads === top);
  return (
    <section aria-labelledby="mk-mix" data-testid="marketing-mix">
      <h2 id="mk-mix" className="t-section text-fg">Откуда приходят заявки</h2>
      {cohort.total === 0 ? <p className="mt-1 t-body text-fg-2">За период заявок нет.</p> : (
        <>
          <p className="mt-1 t-body text-fg" data-testid="marketing-mix-summary">
            За период — <span className="font-semibold tabular-nums">{requestsWord(cohort.total)}</span>; из них на сегодня договор у{" "}
            <span className="font-semibold tabular-nums">{n(cohort.totals.contract)}</span>, оплатили{" "}
            <span className="font-semibold tabular-nums">{n(cohort.totals.paid)}</span>.
            {top > 0 ? (
              <span className="text-fg-2">
                {" "}Из известных каналов больше всего — {LIST.format(leaders.map((part) => `«${part.title}»`))}: {leaders.length > 1 ? "по " : ""}<span className="tabular-nums">{n(top)}</span>.
              </span>
            ) : null}
          </p>
          {cohort.total >= MARKETING_MIN_FOR_SHARE ? (
            <div className="v3-mix mt-4" aria-hidden="true" data-testid="marketing-mix-bar">
              {parts.map((part) => (
                <span key={part.key} className="v3-mix-seg" data-channel={part.key}
                  style={{ flexGrow: part.leads, flexBasis: 0 }} title={`${part.title}: ${n(part.leads)}`} />
              ))}
            </div>
          ) : null}
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2" aria-label="Заявки по каналам">
            {parts.map((part) => (
              <li key={part.key} className="t-body-compact text-fg">
                <ChannelLabel channel={part.key} size="lg">
                  {part.title} <span className="font-semibold tabular-nums">{n(part.leads)}</span>
                </ChannelLabel>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function CohortBlock({ overview }: Readonly<{ overview: MarketingOverview }>) {
  const { cohort } = overview;
  const { unknown: unknownLeads, whole: unknownOf } = unknownSource(overview);
  return (
    <section aria-labelledby="mk-cohort" data-testid="marketing-cohort" className={BLOCK}>
      <h2 id="mk-cohort" className="t-section text-fg">Заявки периода — что с ними стало на сегодня</h2>
      <p className="mt-1 t-meta text-fg-2">
        Заявок: <span className="tabular-nums">{n(cohort.total)}</span>, из них открыты <span className="tabular-nums" data-marketing-open={cohort.openCount}>{n(cohort.openCount)}</span>.
      </p>
      <div className="relative mt-3 overflow-x-auto">
        <table className={SECTION_TABLE}>
          <caption className="sr-only">Заявки периода по каналам и то, что с ними стало на сегодня</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className={TH}>Откуда узнал</th>
              <th scope="col" className={TH}>Заявки</th>
              <th scope="col" className={TH}>Квалифицированы</th>
              <th scope="col" className={TH}>Переданы</th>
              <th scope="col" className={TH}>Договор</th>
              <th scope="col" className={TH}>Оплатили</th>
            </tr>
          </thead>
          <tbody>
            {cohort.channels.map((row) => (
              <tr key={row.channel} className="border-b border-border" data-channel={row.channel}>
                <th scope="row" className={`${TD} text-left font-medium`}>
                  <ChannelLabel channel={row.channel}>{LEAD_CHANNELS[row.channel]}</ChannelLabel>
                  {channelBasisLine(row, cohort.cabinetForms) ? <span className={`${META} pl-4`}>{channelBasisLine(row, cohort.cabinetForms)}</span> : null}
                </th>
                <td className={TD}>{n(row.leads)}</td>
                <CohortCells row={row} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className={`${TD} text-left font-medium`}>Всего</th>
              <td className={`${TD} font-medium`}>{n(cohort.totals.leads)}</td>
              <CohortCells row={{ ...cohort.totals }} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 t-body-compact text-fg" data-testid="marketing-unknown-line">
        Источник не известен — <span className="tabular-nums">{shareText(unknownLeads, unknownOf)}</span>
        {cohort.cabinetForms > 0 ? <span className={META}>Анкеты на платформе ({n(cohort.cabinetForms)}) в эту долю не входят: у них нет источника заявки.</span> : null}
      </p>
      <p className="mt-1 t-body-compact text-fg" data-testid="marketing-repeats">
        Повторные обращения: <span className="tabular-nums">{n(cohort.repeatSubmissions)}</span>
        <span className={META}>Это не новые лиды: канал лида они не меняют.</span>
      </p>
    </section>
  );
}

function SalesRows({ rows }: Readonly<{ rows: readonly SalesChannelRow[] }>) {
  return <>{rows.map((row) => (
    <tr key={row.channel} className="border-b border-border" data-channel={row.channel}>
      <th scope="row" className={`${TD} text-left font-medium`}>
        <ChannelLabel channel={row.channel}>{row.channel === "without_lead" ? "Без привязки к лиду" : LEAD_CHANNELS[row.channel]}</ChannelLabel>
      </th>
      <td className={TD}>{n(row.contracts)}
        {row.linkedManually > 0 ? <span className={META}>связано вручную {n(row.linkedManually)}</span> : null}</td>
      <td className={TD}>
        {row.amounts.length ? <MoneyLines items={row.amounts} noun={contractsWord} primary /> : <span className="text-fg-2">{row.contracts > 0 ? "сумма не указана" : "—"}</span>}
        {row.amounts.length > 0 && row.amountMissing > 0 ? <span className={META}>без суммы: {n(row.amountMissing)}</span> : null}
      </td>
    </tr>
  ))}</>;
}

function SalesBlock({ overview }: Readonly<{ overview: MarketingOverview }>) {
  const { sales } = overview;
  const recon = sales.reconciliation;
  return (
    <section aria-labelledby="mk-sales" data-testid="marketing-sales" className={BLOCK}>
      <h2 id="mk-sales" className="t-section text-fg">Продажи периода — по дате договора</h2>
      <div className="relative mt-3 overflow-x-auto">
        <table className="min-w-[28rem] w-full border-collapse">
          <caption className="sr-only">Договоры периода по каналам</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className={TH}>Откуда узнал</th>
              <th scope="col" className={TH}>Договоры</th>
              <th scope="col" className={TH}>Сумма договоров</th>
            </tr>
          </thead>
          <tbody><SalesRows rows={sales.channels} /></tbody>
        </table>
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 t-body-compact text-fg" data-testid="marketing-reconciliation" data-matches={recon.matches}>
        <span>По каналам и без привязки — <span className="tabular-nums">{n(recon.byChannelPlusWithoutLead)}</span>; «Продажи» в отчёте — <span className="tabular-nums">{n(recon.reportSales)}</span>.</span>
        {recon.matches
          ? <span className="v3-chip t-caption gap-1" data-tone="ok"><Icon name="circle-check" size={14} />Совпадает.</span>
          : <span className="v3-chip t-caption gap-1" data-tone="danger"><Icon name="alert" size={14} />Расхождение: {recon.difference > 0 ? "+" : ""}{n(recon.difference)}.</span>}
      </p>
    </section>
  );
}

function CostBlock({ overview }: Readonly<{ overview: MarketingOverview }>) {
  const cost = costPerLead(overview);
  return (
    <div className="mt-6" data-testid="marketing-cost">
      <h3 className="t-item text-fg"><ChannelLabel channel="instagram_ads">Цена заявки Instagram-рекламы</ChannelLabel></h3>
      {cost.status === "no_spend" ? <p className="mt-1 t-body-compact text-fg-2">— Расход за период не введён.</p> : null}
      {cost.status === "mixed_currencies"
        ? <p className="mt-1 t-body-compact text-fg-2">— Расход в разных валютах ({cost.currencies.join(", ")}): цена не считается, валюты не складываются.</p> : null}
      {cost.status === "single" ? (
        <ul className="mt-3 grid gap-x-8 gap-y-4 sm:grid-cols-3">
          {cost.levels.map((level) => (
            <li key={level.key} className="t-body-compact text-fg" data-cost-level={level.key}>
              <span className="block t-caption text-fg-2">{level.title}</span>
              {level.leads === 0
                ? <span className="mt-1 block"><span className="t-section">—</span> <span className="text-fg-2">заявок нет</span></span>
                : level.perLeadMinor === null
                ? <span className="mt-1 block"><span className="t-section">—</span> <span className="text-fg-2">мало заявок для цены: {leadsWord(level.leads)}</span></span>
                : <span className="mt-1 block"><span className="block t-section tabular-nums">{formatPerLead(level.perLeadMinor, cost.currency)}</span> <span className="text-fg-2">на {leadsWord(level.leads)}</span></span>}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Signals({ signals }: Readonly<{ signals: readonly MarketingSignal[] }>) {
  if (!signals.length) return null;
  return (
    <div role="status" data-testid="marketing-signals" className="flex gap-3 rounded-card bg-warn-weak px-4 py-3 text-warn">
      <Icon name="alert" size={18} className="mt-0.5 flex-none" />
      <ul className="space-y-1">
        {signals.map((signal) => <li key={signal.key} className="t-body-compact">{signal.text}</li>)}
      </ul>
    </div>
  );
}

/**
 * Обзор «Маркетинга»: два блока, которые не смешиваются в одном отношении — когорта заявок (дата заявки,
 * «что с ними стало на сегодня») и продажи периода (дата договора) со сверкой с «Продажами» отчёта; ниже
 * расход, введённый вручную, и цена заявки. Сбой чтения — слова и «Повторить», а не ноль.
 */
export function MarketingOverviewView({ read, recent, period, retryHref }: Readonly<{
  read: MarketingOverviewRead;
  recent: Readonly<{ leads: number; spendRows: number }> | null;
  period: Readonly<{ from: string; to: string }>;
  retryHref: string;
}>) {
  if (read.status === "denied") return <p role="alert" className="t-body-compact text-fg-2">Раздел доступен только администратору.</p>;
  if (read.status === "unavailable") return <Unavailable what="обзор маркетинга" retryHref={retryHref} />;
  const { overview } = read;
  return (
    <div className="space-y-8" data-testid="marketing-overview">
      <Signals signals={marketingSignals(overview, recent)} />
      <ChannelMix overview={overview} />
      <CohortBlock overview={overview} />
      <SalesBlock overview={overview} />
      <section aria-labelledby="mk-spend" data-testid="marketing-spend" className={BLOCK}>
        <h2 id="mk-spend" className="t-section text-fg">Расход периода</h2>
        <MarketingSpendPanel overview={overview} period={period} />
        <CostBlock overview={overview} />
      </section>
    </div>
  );
}
