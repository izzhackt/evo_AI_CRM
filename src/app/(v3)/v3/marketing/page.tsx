import { MarketingLeadsView } from "@/components/v3/marketing/MarketingLeadsView";
import { MarketingNav } from "@/components/v3/marketing/MarketingNav";
import { MarketingOverviewView } from "@/components/v3/marketing/MarketingOverviewView";
import { PartShell } from "@/components/v3/PartShell";
import { NO_MARKETING_FILTERS, parseMarketingLeadFilters } from "@/lib/marketing-contract";
import { marketingHref, parseMarketingView, RECENT_DAYS_FOR_SIGNAL, shiftIsoDate } from "@/lib/marketing-view";
import { requireV3PageActor } from "@/lib/platform-guards";
import { periodLabel, resolvePeriod } from "@/lib/v3/funnel-source";
import { readMarketingLeads, readMarketingOverview, readMarketingRecent, requireMarketingAdmin } from "@/lib/v3/marketing-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "Маркетинг" };

type Query = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

/**
 * «Маркетинг» (М1): только настоящий администратор, не просмотр роли. `?view=overview` (по умолчанию) —
 * когорта заявок и продажи периода двумя блоками, расход; `?view=leads` — заявки с именами. Период —
 * `resolvePeriod`, время Бишкека; имён и телефонов в адресе нет.
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

  const content = view === "leads"
    ? <MarketingLeadsView read={await readMarketingLeads(actor, range, filters, null)} period={period} filters={filters} retryHref={retryHref} />
    : await (async () => {
      // Узкий период сигнала («расход есть, заявок нет») — тот же обзор, читается рядом с основным.
      const [read, recent] = await Promise.all([
        readMarketingOverview(actor, range),
        readMarketingRecent(actor, { from: shiftIsoDate(period.today, -(RECENT_DAYS_FOR_SIGNAL - 1)), to: period.today }),
      ]);
      return <MarketingOverviewView read={read} recent={recent} period={range} retryHref={retryHref} />;
    })();

  return (
    <PartShell title="Маркетинг" meta={periodLabel(period)} testId="v3-marketing">
      <div className="space-y-6">
        <MarketingNav view={view} period={period} filters={filters} />
        {content}
      </div>
    </PartShell>
  );
}
