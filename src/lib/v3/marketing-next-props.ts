import { randomUUID } from "node:crypto";

import type { MarketingNextProps } from "@/components/v3/marketing-next/marketing-next-types";
import { marketingLeadFilterParams, NO_MARKETING_FILTERS, type MarketingLeadFilters, type SpendRow } from "@/lib/marketing-contract";
import { marketingHref, MARKETING_VIEWS, RECENT_DAYS_FOR_SIGNAL, shiftIsoDate, type MarketingView } from "@/lib/marketing-view";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { ReportLinkRead } from "@/lib/report-link-contract";
import { PERIODS, periodLabel, type Period } from "@/lib/v3/funnel-source";
import { readMarketingLeads, readMarketingOverview, readMarketingRecent } from "@/lib/v3/marketing-source";

/** Откуда цифры вкладки «Отчёты»: одна видимая строка под заголовком (каждый источник назван). */
const REPORT_SOURCE = "Данные Meta Ads и Instagram приходят из Windsor.ai. Цена заявки и договора — во вкладке «Обзор».";

/**
 * Свойства «Маркетинга» нового вида — только данные: те же чтения, что у прежних видов страницы (`readMarketingOverview`,
 * `readMarketingRecent`, `readMarketingLeads`), та же граница «только администратор» (страница уже вызвала
 * `requireMarketingAdmin`), те же адреса вкладок и периода. Выдаёт на сервере request_id записи и отмены расхода.
 */
export async function marketingNextProps(input: Readonly<{
  actor: ActivePlatformActor;
  view: MarketingView;
  period: Period;
  filters: MarketingLeadFilters;
  reportRead: Promise<ReportLinkRead>;
}>): Promise<MarketingNextProps> {
  const { actor, view, period, filters } = input;
  const hrefPeriod = period.key === "custom" ? { key: period.key, from: period.from, to: period.to } : { key: period.key };
  const range = { from: period.from, to: period.to };
  const retryHref = marketingHref({ view, period: hrefPeriod, filters });
  // Чтения вида идут рядом со ссылкой на отчёт (как у прежней страницы), а не после неё.
  const overviewReads = view === "overview"
    ? Promise.all([readMarketingOverview(actor, range), readMarketingRecent(actor, { from: shiftIsoDate(period.today, -(RECENT_DAYS_FOR_SIGNAL - 1)), to: period.today })])
    : null;
  const leadsRead = view === "leads" ? readMarketingLeads(actor, range, filters, null) : null;
  const report = await input.reportRead;
  const reportsTab = report.status === "available" && report.link.configured;
  const tabs = MARKETING_VIEWS.filter((tab) => tab.key !== "reports" || reportsTab).map((tab) => ({
    key: tab.key, label: tab.title, href: marketingHref({ view: tab.key, period: hrefPeriod, filters }),
  }));
  if (view === "reports") {
    return { view, meta: REPORT_SOURCE, tabs, period: null, body: { kind: "reports", read: report, retryHref: marketingHref({ view: "reports", period: hrefPeriod }) } };
  }
  const choices = PERIODS.map((one) => ({
    key: one.key, title: one.title, active: one.key === period.key,
    href: marketingHref({ view, period: one.key === "custom" && period.key === "custom" ? hrefPeriod : { key: one.key }, filters }),
  }));
  const periodBar = {
    choices,
    range: period.key === "custom" ? { from: period.from, to: period.to, max: period.today } : null,
    hidden: view === "leads" ? { view: "leads", ...marketingLeadFilterParams(filters) } : {},
  };
  const meta = periodLabel(period);
  if (view === "leads") {
    const read = await leadsRead!;
    return {
      view, meta, tabs, period: periodBar,
      body: { kind: "leads", read, period: { key: period.key, from: period.from, to: period.to }, filters, retryHref, clearHref: marketingHref({ view: "leads", period: hrefPeriod }) },
    };
  }
  const [read, recent] = await overviewReads!;
  const spend: readonly SpendRow[] = read.status === "available" ? [...read.overview.spend.insidePeriod, ...read.overview.spend.partiallyOverlapping] : [];
  return {
    view, meta, tabs, period: periodBar,
    body: {
      kind: "overview", read, recent, range, retryHref,
      unknownHref: marketingHref({ view: "leads", period: hrefPeriod, filters: { ...NO_MARKETING_FILTERS, unknownOnly: true } }),
      addId: randomUUID(),
      cancelIds: Object.fromEntries(spend.map((row) => [row.id, randomUUID()])),
    },
  };
}
