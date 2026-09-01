import Link from "next/link";

import { Icon } from "@/components/icons";
import { ContextBanner } from "@/components/platform/operations/OperationsPrimitives";
import {
  Card,
  EmptyState,
  PageHeader,
  StatCard,
  btnGhostCls,
  cn,
} from "@/components/ui";
import { requireStaffRoute } from "@/lib/guards";
import { getT } from "@/lib/i18n";
import { salesReport, type SalesReportPeriod } from "@/lib/queries";

const PERIODS: SalesReportPeriod[] = ["30d", "quarter", "year", "all"];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requireStaffRoute("/reports");
  const { t, locale } = await getT();
  const params = await searchParams;
  const period: SalesReportPeriod = PERIODS.includes(params.period as SalesReportPeriod)
    ? (params.period as SalesReportPeriod)
    : "quarter";
  const { byManager, byMonth, bySource } = salesReport(period);
  const canOpenSales = user.role === "admin" || user.role === "sales";
  const localeTag = locale === "ky" ? "ky-KG" : locale === "en" ? "en-GB" : "ru-RU";
  const number = (value: number) => value.toLocaleString(localeTag);
  const totalLeads = byManager.reduce((sum, manager) => sum + manager.leads, 0);
  const totalWon = byManager.reduce((sum, manager) => sum + manager.won, 0);
  const totalWonAmount = byManager.reduce((sum, manager) => sum + manager.won_amount, 0);
  const conversion = totalLeads ? Math.round((totalWon / totalLeads) * 100) : 0;
  const average = totalWon ? Math.round(totalWonAmount / totalWon) : 0;
  const maxSource = Math.max(1, ...bySource.map((source) => source.c));
  const maxMonth = Math.max(1, ...byMonth.map((month) => month.c));

  return (
    <div className="space-y-5" data-testid="reports-page">
      <PageHeader
        title={t("salesReport")}
        description={t("reportDrilldownHint")}
        action={
          <div className="flex flex-wrap gap-1 rounded-ctl bg-surface-2 p-1">
            {PERIODS.map((item) => (
              <Link
                key={item}
                href={`/reports?period=${item}`}
                aria-current={period === item ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-9 items-center rounded-nav px-3 text-xs font-semibold",
                  period === item
                    ? "border border-control-edge bg-surface text-accent-text"
                    : "border border-transparent text-fg-3 hover:text-fg",
                )}
              >
                {t(`period${item === "30d" ? "30d" : item[0].toUpperCase() + item.slice(1)}`)}
              </Link>
            ))}
          </div>
        }
      />

      {!canOpenSales && (
        <ContextBanner
          title={t("readOnly")}
          description={t("reportDrilldownRestricted")}
          tone="warning"
        />
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t("leadsCount")}
          value={number(totalLeads)}
          tone="accent"
          href={canOpenSales ? "/sales?view=list" : undefined}
        />
        <StatCard
          label={t("signed")}
          value={number(totalWon)}
          tone="success"
          href={canOpenSales ? "/sales?view=list&status=contract_signed" : undefined}
        />
        <StatCard label={t("conversion")} value={`${conversion}%`} tone="info" />
        <StatCard label={t("avgCheck")} value={`${number(average)} KGS`} tone="neutral" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
        <Card title={t("byManager")} bodyClassName="px-0 py-0">
          {byManager.length === 0 ? (
            <div className="px-5 py-4">
              <EmptyState text={t("reportNoData")} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-surface-2 text-xs uppercase tracking-[0.04em] text-fg-3">
                  <tr>
                    <th className="px-5 py-3 font-semibold">{t("manager")}</th>
                    <th className="px-3 py-3 text-right font-semibold">{t("leadsCount")}</th>
                    <th className="px-3 py-3 text-right font-semibold">{t("signed")}</th>
                    <th className="px-3 py-3 text-right font-semibold">{t("conversion")}</th>
                    <th className="px-5 py-3 text-right font-semibold">{t("value")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {byManager.map((manager) => {
                    const managerConversion = manager.leads
                      ? Math.round((manager.won / manager.leads) * 100)
                      : 0;
                    return (
                      <tr key={manager.id} className="hover:bg-surface-2">
                        <td className="px-5 py-3 font-medium text-fg">
                          {canOpenSales ? (
                            <Link
                              href={`/sales?view=list&manager=${manager.id}`}
                              className="inline-flex items-center gap-1 text-accent hover:underline"
                            >
                              {manager.name}
                              <Icon name="chevron-right" size={13} />
                            </Link>
                          ) : manager.name}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-fg-2">{number(manager.leads)}</td>
                        <td className="px-3 py-3 text-right font-mono font-semibold text-ok">{number(manager.won)}</td>
                        <td className="px-3 py-3 text-right font-mono text-fg-2">{managerConversion}%</td>
                        <td className="px-5 py-3 text-right font-mono font-semibold text-fg">
                          {number(manager.won_amount)} KGS
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={t("bySource")}>
          {bySource.length === 0 ? (
            <EmptyState text={t("reportNoData")} />
          ) : (
            <div className="space-y-2">
              {bySource.map((source) => {
                const content = (
                  <>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-fg-2">{source.source}</span>
                      <span className="shrink-0 font-mono text-xs text-fg-3">
                        {source.c} · {source.won} {t("signed").toLowerCase()}
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.max(4, (source.c / maxSource) * 100)}%` }}
                      />
                    </div>
                  </>
                );
                return canOpenSales ? (
                  <Link
                    key={source.source}
                    href={`/sales?view=list&source=${encodeURIComponent(source.source)}`}
                    className="block rounded-ctl border border-transparent p-2 hover:border-border hover:bg-surface-2"
                  >
                    {content}
                  </Link>
                ) : (
                  <div key={source.source} className="p-2">{content}</div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Card title={t("byMonth")}>
        {byMonth.length === 0 ? (
          <EmptyState text={t("reportNoData")} />
        ) : (
          <div className="grid h-56 grid-cols-6 items-end gap-2 sm:grid-cols-12" data-testid="report-month-chart">
            {byMonth.map((month) => (
              <div key={month.month} className="flex h-full min-w-0 flex-col justify-end gap-2">
                <span className="text-center font-mono text-2xs font-semibold text-fg-2">{month.c}</span>
                <div
                  className="min-h-2 rounded-t bg-accent"
                  style={{ height: `${Math.max(6, (month.c / maxMonth) * 100)}%` }}
                />
                <span className="truncate text-center font-mono text-2xs text-fg-3">
                  {month.month.slice(5)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="flex flex-wrap gap-2">
        <Link href="/tasks?view=list" className={btnGhostCls}>
          <Icon name="check-square" size={15} />
          {t("tasks")}
        </Link>
        {canOpenSales && (
          <>
            <Link href="/calls" className={btnGhostCls}>
              <Icon name="phone" size={15} />
              {t("calls")}
            </Link>
            <Link href="/whatsapp" className={btnGhostCls}>
              <Icon name="message-circle" size={15} />
              {t("whatsapp")}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
