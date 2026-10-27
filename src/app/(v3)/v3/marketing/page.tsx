import { MarketingLeadsView } from "@/components/v3/marketing/MarketingLeadsView";
import { MarketingNav } from "@/components/v3/marketing/MarketingNav";
import { MarketingNextLazy } from "@/components/v3/marketing-next/MarketingNextLazy";
import { MarketingOverviewView } from "@/components/v3/marketing/MarketingOverviewView";
import { PartShell } from "@/components/v3/PartShell";
import { LookerReport } from "@/components/v3/reports/LookerReport";
import { NO_MARKETING_FILTERS, parseMarketingLeadFilters } from "@/lib/marketing-contract";
import { marketingHref, parseMarketingView, RECENT_DAYS_FOR_SIGNAL, shiftIsoDate } from "@/lib/marketing-view";
import { requireV3PageActor } from "@/lib/platform-guards";
import { isNextUi } from "@/lib/ui-next";
import { periodLabel, resolvePeriod } from "@/lib/v3/funnel-source";
import { readMarketingLeads, readMarketingOverview, readMarketingRecent, requireMarketingAdmin } from "@/lib/v3/marketing-source";
import { marketingNextProps } from "@/lib/v3/marketing-next-props";
import { readReportLink } from "@/lib/v3/report-links-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "Маркетинг" };

type Query = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

/**
 * «Маркетинг» (М1): только настоящий администратор, не просмотр роли. `?view=overview` (по умолчанию) —
 * когорта заявок и продажи периода двумя блоками, расход; `?view=leads` — заявки с именами. Период —
 * `resolvePeriod`, время Бишкека; имён и телефонов в адресе нет. `?view=reports` — отчёт Looker Studio
 * (миграция 323, Meta Ads и Instagram через Windsor.ai): вкладка «Отчёты» рисуется только при подключённой ссылке,
 * на этом виде не читаются ни обзор, ни заявки и нет периода.
 */
export default async function MarketingPage({ searchParams }: { searchParams: Promise<Query> }) {
  const actor = await requireV3PageActor("/v3/marketing");
  requireMarketingAdmin(actor);
  const query = await searchParams;
  const view = parseMarketingView(one(query.view));
  const period = resolvePeriod({ period: one(query.period), from: one(query.from), to: one(query.to) });
  const filters = view === "leads" ? parseMarketingLeadFilters(query) : NO_MARKETING_FILTERS;
  const hrefPeriod = period.key === "custom" ? { key: period.key, from: period.from, to: period.to } : { key: period.key };
  const retryHref = marketingHref({ view, period: hrefPeriod, filters });
  const range = { from: period.from, to: period.to };

  // Ссылка на отчёт читается на любом виде и рядом с остальными чтениями: от неё зависит, рисовать ли вкладку «Отчёты»
  // (ошибка чтения — вкладки нет).
  const reportRead = readReportLink(actor, "marketing");
  const reportsTab = (read: Awaited<typeof reportRead>) => read.status === "available" && read.link.configured;

  // «Новый вид» (переключатель администратора): те же чтения, права и адреса, другая расстановка — плитки, таблицы и панели набора.
  if (await isNextUi(actor)) return <MarketingNextLazy {...await marketingNextProps({ actor, view, period, filters, reportRead })} />;

  if (view === "reports") {
    const report = await reportRead;
    return (
      <PartShell title="Маркетинг" testId="v3-marketing">
        <div className="space-y-6">
          <MarketingNav view={view} period={period} filters={filters} reports={reportsTab(report)} />
          <LookerReport
            reportKey="marketing"
            read={report}
            source="Данные Meta Ads и Instagram приходят из Windsor.ai. Цена заявки и договора — во вкладке «Обзор»."
            canManage
            retryHref={marketingHref({ view: "reports", period: hrefPeriod })}
          />
        </div>
      </PartShell>
    );
  }

  const contentRead = view === "leads"
    ? readMarketingLeads(actor, range, filters, null)
      .then((read) => <MarketingLeadsView read={read} period={period} filters={filters} retryHref={retryHref} />)
    : (async () => {
      // Узкий период сигнала («расход есть, заявок нет») — тот же обзор, читается рядом с основным.
      const [read, recent] = await Promise.all([
        readMarketingOverview(actor, range),
        readMarketingRecent(actor, { from: shiftIsoDate(period.today, -(RECENT_DAYS_FOR_SIGNAL - 1)), to: period.today }),
      ]);
      const unknownHref = marketingHref({ view: "leads", period: hrefPeriod, filters: { ...NO_MARKETING_FILTERS, unknownOnly: true } });
      return <MarketingOverviewView read={read} recent={recent} period={range} retryHref={retryHref} unknownHref={unknownHref} />;
    })();
  const [report, content] = await Promise.all([reportRead, contentRead]);

  return (
    <PartShell title="Маркетинг" meta={periodLabel(period)} testId="v3-marketing">
      <div className="space-y-6">
        <MarketingNav view={view} period={period} filters={filters} reports={reportsTab(report)} />
        {content}
      </div>
    </PartShell>
  );
}
