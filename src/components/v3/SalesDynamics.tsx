import Link from "next/link";

import { Icon } from "@/components/icons";
import type { SalesDynamicsRead } from "@/lib/v3/sales-dynamics-source";

import { Funnel } from "./Funnel";
import { MainHeader, type PeriodChoice } from "./MainHeader";
import { MetricCard } from "./MetricCard";
import { QUEUE_QUIET_LINK } from "./queue/QueueStates";
import { TrendChart } from "./TrendChart";

/**
 * «Динамика по дням» внизу «Отчёта продаж» (Э3, 26.09.2026): графики,
 * переключатель периода, «Лиды за период» и воронка ушли со стартовой
 * страницы «Сегодня». Раздел свёрнут; открыт, когда в адресе выбран период.
 * Воронка — по определению доски (этапы в работе и «Переданы»); при
 * усечённом чтении чисел нет.
 */
export function SalesDynamics({
  id,
  open,
  choices,
  range,
  periodText,
  formAction,
  carry,
  retryHref,
  read,
}: Readonly<{
  id: string;
  open: boolean;
  choices: readonly PeriodChoice[];
  range: Readonly<{ from: string; to: string; max: string }> | null;
  /** «1–26 сентября» — подпись выбранного периода. */
  periodText: string;
  formAction: string;
  carry: Readonly<Record<string, string>>;
  retryHref: string;
  read: SalesDynamicsRead;
}>) {
  const { dashboard, funnel } = read;
  const trend = dashboard?.trend;
  return (
    <details id={id} open={open} className="group mt-8 scroll-mt-4 border-t border-border pt-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-nav text-fg [&::-webkit-details-marker]:hidden">
        <Icon name="chevron-right" size={18} className="shrink-0 text-fg-3 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
        <h2 className="t-section">Динамика по дням</h2>
      </summary>

      <div className="mt-4 grid items-start gap-6 @4xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-labelledby={`${id}-period`} className="min-w-0">
          <h3 id={`${id}-period`} className="t-item mb-3 text-fg">Лиды за период</h3>
          <MainHeader choices={choices} range={range} action={formAction} hidden={carry} />
          {!dashboard ? (
            <div role="alert" className="mt-4 border-y border-border py-6 t-body-compact text-fg-2">
              <p>Не удалось загрузить данные за выбранный период.</p>
              <Link className={QUEUE_QUIET_LINK} href={retryHref}>Повторить</Link>
            </div>
          ) : dashboard.figures.counts.leads === 0 ? (
            <p className="mt-4 border-y border-border py-8 text-center t-body-compact text-fg-3">За этот период лидов нет.</p>
          ) : (
            <>
              <ul className="mt-4 grid grid-cols-2 gap-3 @2xl:grid-cols-3">
                {dashboard.figures.metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
              </ul>
              <section aria-labelledby={`${id}-trend`} className="mt-4 min-w-0 rounded-card border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 id={`${id}-trend`} className="t-item text-fg">Динамика</h4>
                  <span className="t-meta text-fg-3">{periodText}</span>
                </div>
                {trend ? (
                  <>
                    <p className="t-meta mt-2 flex flex-wrap gap-4 text-fg-3">
                      {trend.series.map((one) => (
                        <span key={one.label} className="inline-flex items-center gap-1.5">
                          {one.emphasis === "primary" ? <span aria-hidden="true" className="inline-block h-0.5 w-3.5 bg-accent" />
                            : <span aria-hidden="true" className="inline-block h-0 w-3.5 border-t-2 border-dashed border-fg-3" />}
                          {one.label}
                        </span>
                      ))}
                    </p>
                    <div className="mt-3"><TrendChart series={trend.series} ticks={trend.ticks} caption={`Динамика, ${trend.label}`} /></div>
                  </>
                ) : <p className="px-1 py-10 text-center t-body-compact text-fg-3">Динамики за этот период нет.</p>}
              </section>
            </>
          )}
        </section>

        <section aria-labelledby={`${id}-funnel`} className="min-w-0 rounded-card border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id={`${id}-funnel`} className="t-item text-fg">Воронка продаж</h3>
            <Link href="/v3/pipeline" className={QUEUE_QUIET_LINK}>К доске</Link>
          </div>
          <p className="t-meta mb-3 text-fg-3">Как на доске: этапы в работе и «Переданы».</p>
          {funnel.status === "available" ? (
            <>
              {funnel.stages.every((stage) => stage.value === 0) ? <p className="py-2 t-body-compact text-fg-2">На доске пока нет лидов.</p> : null}
              <Funnel stages={funnel.stages} caption="Этапы доски продаж" />
            </>
          ) : funnel.status === "truncated" ? (
            <p className="py-4 t-body-compact text-fg-2">Лидов больше, чем читается за раз: числа не показываются.</p>
          ) : funnel.status === "preview" ? (
            <p className="py-4 t-body-compact text-fg-2">При просмотре роли воронка не показывается.</p>
          ) : (
            <div role="alert" className="py-4 t-body-compact text-fg-2">
              <p>Не удалось загрузить воронку.</p>
              <Link className={QUEUE_QUIET_LINK} href={retryHref}>Повторить</Link>
            </div>
          )}
        </section>
      </div>
    </details>
  );
}
