import { MarketingNextLazy } from "@/components/staff/marketing-next/MarketingNextLazy";
import { NO_MARKETING_FILTERS, parseMarketingLeadFilters } from "@/lib/marketing-contract";
import { parseMarketingView } from "@/lib/marketing-view";
import { requireV3PageActor } from "@/lib/platform-guards";
import { resolvePeriod } from "@/lib/v3/funnel-source";
import { requireMarketingAdmin } from "@/lib/v3/marketing-source";
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
  const actor = await requireV3PageActor("/marketing");
  requireMarketingAdmin(actor);
  const query = await searchParams;
  const view = parseMarketingView(one(query.view));
  const period = resolvePeriod({ period: one(query.period), from: one(query.from), to: one(query.to) });
  const filters = view === "leads" ? parseMarketingLeadFilters(query) : NO_MARKETING_FILTERS;
  // Ссылка на отчёт читается рядом с остальными чтениями: от неё зависит, рисовать ли вкладку «Отчёты» (ошибка чтения — вкладки нет).
  const reportRead = readReportLink(actor, "marketing");

  // «Новый вид» (единственный вид, #1327): плитки, таблицы и панели набора.
  return <MarketingNextLazy {...await marketingNextProps({ actor, view, period, filters, reportRead })} />;
}
