"use client";

import { PageShell, SectionTabs } from "@/components/kit";
import { LookerReportNext } from "@/components/v3/reports-next/LookerReportNext";

import { LeadsNext } from "./LeadsNext";
import { MarketingPeriodBar } from "./MarketingPeriodBar";
import { OverviewNext } from "./OverviewNext";
import type { MarketingNextProps } from "./marketing-next-types";

/**
 * «Маркетинг» в новом виде: рамка страницы, вкладки-ссылки «Обзор · Заявки · Отчёты» (отчётов — только при подключённой ссылке),
 * период и содержимое вкладки. Читает и проверяет права страница (`marketing/page.tsx`: только настоящий администратор); сюда
 * приходят готовые данные. На вкладке «Отчёты» периода нет — даты выбираются внутри отчёта.
 */
export function MarketingNextPage({ view, meta, tabs, period, body }: MarketingNextProps) {
  return (
    <PageShell title="Маркетинг" testId="v3-marketing" meta={meta}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <SectionTabs label="Разделы маркетинга" tabs={tabs} value={view} />
        {period ? <MarketingPeriodBar period={period} /> : null}
      </div>
      {body.kind === "overview" ? <OverviewNext body={body} /> : null}
      {body.kind === "leads" ? <LeadsNext body={body} /> : null}
      {body.kind === "reports" ? <LookerReportNext reportKey="marketing" read={body.read} canManage retryHref={body.retryHref} /> : null}
    </PageShell>
  );
}
