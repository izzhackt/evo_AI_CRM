import { Funnel } from "@/components/v3/Funnel";
import { MainHeader, type PeriodChoice } from "@/components/v3/MainHeader";
import { MetricCard } from "@/components/v3/MetricCard";
import { OperationsOverview } from "@/components/v3/OperationsOverview";
import { PartShell } from "@/components/v3/PartShell";
import { TrendChart } from "@/components/v3/TrendChart";
import { SalesRegisterView, type SalesReportQuery } from "@/components/v3/SalesRegisterView";
import { SalesRegisterImportView } from "@/components/v3/SalesRegisterImportView";
import { isSalesImportQuery } from "@/lib/sales-register-navigation";
import { SalesReportNavigation } from "@/components/v3/SalesReportNavigation";
import { isStaffPreview, staffCan, staffPresentationCan } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import {
  PERIODS,
  periodLabel,
  readPeriodDashboard,
  resolvePeriod,
} from "@/lib/v3/funnel-source";
import { readV3OperationalDashboard } from "@/lib/v3/operations-source";
import { readCurrentSalesFunnel } from "@/lib/v3/current-sales-funnel-source";
import { v3SectionTitle } from "@/lib/v3/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Вкладка называет подсвеченный пункт меню: «Главная» или «Отчёт продаж». */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  return { title: v3SectionTitle("/v3/main", await searchParams) };
}

export default async function MainPart({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; view?: string } & SalesReportQuery>;
}) {
  const actor = await requireV3PageActor("/v3/main");
  const query = await searchParams;
  const canReadSales = staffPresentationCan(actor, "sales.read");
  const canReadReport = isStaffPreview(actor) ? canReadSales : staffCan(actor, "sales.report.read");
  if (query.view === "sales" || (!canReadSales && canReadReport)) {
    if (!canReadReport) redirect("/access-denied?from=%2Fv3%2Fmain");
    if (isSalesImportQuery(query)) return <SalesRegisterImportView actor={actor} query={query} />;
    return <SalesRegisterView actor={actor} query={query} />;
  }
  if (!canReadSales) {
    // Ниже мы уже знаем canReadReport === false, иначе выше был бы возврат:
    // это ровно условие «есть Admissions, нет отчёта продаж» из плана.
    const canReadAdmissions = staffPresentationCan(actor, "admissions.read");
    if (canReadAdmissions) {
      // OTH-1: «Мой день» (CuratorDay) is replaced — not layered — by the
      // kanban board «Воронка поступления» at its own route. CuratorDay.tsx
      // is deleted; this branch only redirects there now.
      redirect("/v3/admissions-pipeline");
    }
    const operations = await readV3OperationalDashboard(actor);
    return <PartShell title="Главная"><OperationsOverview snapshot={operations} /></PartShell>;
  }
  const period = resolvePeriod(query);
  const [periodDashboard, operations, currentFunnel] = await Promise.all([
    readPeriodDashboard(actor, period).catch(() => null),
    readV3OperationalDashboard(actor),
    readCurrentSalesFunnel(actor),
  ]);
  const trend = periodDashboard?.trend;

  // Нажатие на «Период», когда он уже выбран, не должно терять выбранные
  // даты: ссылка несёт их с собой. Даты берутся уже разобранные, поэтому в
  // адресе оказывается тот диапазон, который посчитан, а не тот, который
  // набрали руками.
  const choices: PeriodChoice[] = PERIODS.map((one) => ({
    key: one.key,
    title: one.title,
    href:
      one.key === "custom" && period.key === "custom"
        ? `/v3/main?period=custom&from=${period.from}&to=${period.to}`
        : `/v3/main?period=${one.key}`,
    active: one.key === period.key,
  }));

  const currentHref = choices.find(choice => choice.active)?.href ?? "/v3/main";

  return (
    <PartShell title="Главная">
      {canReadReport ? <SalesReportNavigation sales={false} /> : null}
      <div className="mt-5 grid items-start gap-6 @4xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-labelledby="current-sales-title" className="min-w-0 rounded-card border border-border bg-surface p-4 @4xl:order-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="current-sales-title" className="text-md font-bold text-fg">Воронка продаж</h2>
            <Link href="/v3/pipeline" className="inline-flex min-h-11 items-center text-sm text-accent hover:underline">К доске</Link>
          </div>
          <p className="mb-4 text-sm text-fg-3">Текущие этапы по доступным вам лидам.</p>
          {currentFunnel.status === "available" ? (
            <>
              {currentFunnel.stages.every(stage => stage.value === 0) ? (
                <p className="py-4 text-sm text-fg-2">В работе пока нет лидов.</p>
              ) : null}
              <Funnel stages={currentFunnel.stages} caption="Текущие этапы продаж" />
              <div className="mt-5 border-t border-border pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-fg">Продажи в вашем отчёте</h3>
                    <p className="mt-1 text-2xs text-fg-3">По лидам текущей воронки</p>
                  </div>
                  {currentFunnel.sales.status === "available" ? (
                    <span className="text-md font-semibold tabular-nums text-fg">{currentFunnel.sales.count.toLocaleString("ru-RU")}</span>
                  ) : null}
                </div>
                {currentFunnel.sales.status === "denied" ? (
                  <p className="mt-3 text-sm text-fg-2">Нет доступа к отчёту продаж.</p>
                ) : currentFunnel.sales.status === "unavailable" ? (
                  <p className="mt-3 text-sm text-fg-2">Не удалось загрузить продажи. <a href={currentHref} className="underline underline-offset-4">Повторить</a></p>
                ) : (
                  <Link href="/v3/main?view=sales" className="mt-2 inline-flex min-h-11 items-center text-sm text-accent hover:underline">Открыть отчёт</Link>
                )}
              </div>
            </>
          ) : currentFunnel.status === "preview" ? (
            <p className="py-5 text-sm text-fg-2">Данные воронки недоступны при просмотре другой роли.</p>
          ) : (
            <div className="py-5 text-sm text-fg-2">
              <p>Не удалось загрузить текущую воронку.</p>
              <a href={currentHref} className="mt-2 inline-flex min-h-11 items-center text-accent underline underline-offset-4">Повторить</a>
            </div>
          )}
        </section>

        <section aria-labelledby="period-leads-title" className="min-w-0 @4xl:order-1">
          <h2 id="period-leads-title" className="mb-3 text-md font-bold text-fg">Лиды за период</h2>
          <MainHeader choices={choices} range={period.key === "custom"
            ? { from: period.from, to: period.to, max: period.today } : null} />
          {!periodDashboard ? (
            <div className="mt-4 rounded-card border border-border bg-surface px-4 py-6 text-sm text-fg-3">
              <p>Не удалось загрузить данные за выбранный период.</p>
              <a className="mt-3 inline-flex min-h-11 items-center text-accent underline underline-offset-4" href={currentHref}>Повторить загрузку</a>
            </div>
          ) : periodDashboard.figures.counts.leads === 0 ? (
            <p className="mt-4 rounded-card border border-border bg-surface px-4 py-10 text-center text-sm text-fg-3">
              За этот период лидов нет.
            </p>
          ) : (
            <>
              <ul className="mt-4 grid grid-cols-2 gap-3 @2xl:grid-cols-3">
                {periodDashboard.figures.metrics.map(metric => <MetricCard key={metric.label} metric={metric} />)}
              </ul>
              <section className="mt-4 min-w-0 rounded-card border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-md font-bold text-fg">Динамика</h3>
                  <span className="text-2xs text-fg-3">{periodLabel(period)}</span>
                </div>
                {trend ? (
                  <>
                    <p className="mt-2 flex flex-wrap gap-4 text-2xs text-fg-3">
                      {trend.series.map(one => (
                        <span key={one.label} className="inline-flex items-center gap-1.5">
                          {one.emphasis === "primary" ? <span aria-hidden="true" className="inline-block h-0.5 w-3.5 bg-accent" />
                            : <span aria-hidden="true" className="inline-block h-0 w-3.5 border-t-2 border-dashed border-fg-3" />}
                          {one.label}
                        </span>
                      ))}
                    </p>
                    <div className="mt-3"><TrendChart series={trend.series} ticks={trend.ticks} caption={`Динамика, ${trend.label}`} /></div>
                  </>
                ) : <p className="px-1 py-10 text-center text-sm text-fg-3">Динамики за этот период нет.</p>}
              </section>
            </>
          )}
        </section>
      </div>
      <OperationsOverview snapshot={operations} />
    </PartShell>
  );
}
