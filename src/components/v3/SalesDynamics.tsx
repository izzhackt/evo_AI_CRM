import Link from "next/link";

import { Icon } from "@/components/icons";
import type { SalesDynamicsRead } from "@/lib/v3/sales-dynamics-source";
import { FUNNEL_STEP } from "@/lib/v3/wording";

import { Funnel } from "./Funnel";
import { MainHeader, type PeriodChoice } from "./MainHeader";
import { QUEUE_QUIET_LINK } from "./queue/QueueStates";
import { TrendChart } from "./TrendChart";

/**
 * Слова когорты периода. Когорта — лиды, пришедшие за период, и сколько из
 * НИХ сейчас квалифицированы и переданы; у доски «Переданы» — вся колонка
 * сейчас. Одно слово с двумя разными числами рядом — то самое «один лид,
 * разные числа» из разбора 26.09, поэтому у когорты слова свои, со словом
 * области. Ключи — слова серий чтения (`FUNNEL_STEP`).
 */
export const PERIOD_WORDS: Readonly<Record<string, string>> = {
  [FUNNEL_STEP.leads]: "Пришло лидов",
  [FUNNEL_STEP.qualified]: "Из них квалифицированы",
  [FUNNEL_STEP.handed]: "Из них переданы",
};

/**
 * «Динамика по дням» внизу «Отчёта продаж» (Э3, 26.09.2026): графики,
 * переключатель периода, «Лиды за период» и воронка ушли со стартовой
 * страницы «Сегодня». Раздел свёрнут; открыт, когда в адресе выбран период.
 *
 * Две области — две подписи, а не одна строка: «Лиды за период» (когорта
 * периода, свои слова) и ниже «Сейчас на доске» (воронка по определению
 * доски: этапы в работе и «Переданы»; при усечённом чтении чисел нет).
 * Облик спокойный: числа строкой на волосяных линиях, график и воронка —
 * чернилами; красный остаётся главному действию отчёта и проблемам.
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
  const counts = dashboard?.figures.counts;
  return (
    <details id={id} open={open} className="group mt-8 scroll-mt-4 border-t border-border pt-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-nav text-fg [&::-webkit-details-marker]:hidden">
        <Icon name="chevron-right" size={18} className="shrink-0 text-fg-3 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
        <h2 className="t-section">Динамика по дням</h2>
      </summary>

      <div className="mt-4 space-y-8">
        <section aria-labelledby={`${id}-period`} className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <h3 id={`${id}-period`} className="t-item text-fg">Лиды за период</h3>
              <p className="t-meta text-fg-3">{periodText}</p>
            </div>
            <MainHeader choices={choices} range={range} action={formAction} hidden={carry} />
          </div>
          {!dashboard ? (
            <div role="alert" className="mt-4 border-y border-border py-6 t-body-compact text-fg-2">
              <p>Не удалось загрузить данные за выбранный период.</p>
              <Link className={QUEUE_QUIET_LINK} href={retryHref}>Повторить</Link>
            </div>
          ) : counts?.leads === 0 ? (
            <p className="mt-4 border-y border-border py-8 text-center t-body-compact text-fg-3">За этот период лидов нет.</p>
          ) : (
            <>
              {/* На телефоне — список «подпись … число» (три длинные подписи в треть
                  ширины не помещаются), шире — три колонки. */}
              <dl className="mt-4 grid divide-y divide-border border-y border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0" data-period-figures="">
                {([["leads", FUNNEL_STEP.leads], ["qualified", FUNNEL_STEP.qualified], ["handed", FUNNEL_STEP.handed]] as const).map(([key, word]) => (
                  <div key={key} className="flex min-w-0 items-baseline justify-between gap-x-4 gap-y-1 py-2 sm:flex-col sm:items-start sm:px-4 sm:py-3 sm:first:ps-0">
                    <dt className="t-caption text-fg-2">{PERIOD_WORDS[word]}</dt>
                    <dd className="t-figure tabular-nums text-fg">{counts?.[key].toLocaleString("ru-RU")}</dd>
                  </div>
                ))}
              </dl>
              <section aria-labelledby={`${id}-trend`} className="mt-4 min-w-0 rounded-card border border-border bg-surface p-4">
                <h4 id={`${id}-trend`} className="mb-3 t-item text-fg">Нарастающим итогом</h4>
                {trend ? (
                  <TrendChart
                    series={trend.series.map((one) => ({ ...one, label: PERIOD_WORDS[one.label] ?? one.label }))}
                    ticks={trend.ticks}
                    caption={`Лиды за период нарастающим итогом, ${trend.label}`}
                  />
                ) : <p className="px-1 py-10 text-center t-body-compact text-fg-3">Динамики за этот период нет.</p>}
              </section>
            </>
          )}
        </section>

        <section aria-labelledby={`${id}-board`} className="min-w-0" data-board-funnel="">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="min-w-0">
              <h3 id={`${id}-board`} className="t-item text-fg">Сейчас на доске</h3>
              <p className="t-meta text-fg-3">Воронка продаж, как на доске: этапы в работе и «Переданы» — без периода.</p>
            </div>
            <Link href="/v3/pipeline" className={QUEUE_QUIET_LINK}>К доске</Link>
          </div>
          <div className="mt-3 max-w-2xl rounded-card border border-border bg-surface p-4">
            {funnel.status === "available" ? (
              <>
                {funnel.stages.every((stage) => stage.value === 0) ? <p className="py-2 t-body-compact text-fg-2">На доске пока нет лидов.</p> : null}
                <Funnel stages={funnel.stages} caption="Этапы доски продаж сейчас" />
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
          </div>
        </section>
      </div>
    </details>
  );
}
