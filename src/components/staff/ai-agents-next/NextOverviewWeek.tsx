import type { ReactNode } from "react";

import { WidgetCard } from "@/components/kit";
import type { AiAgentDetail } from "@/lib/ai-agents/contract";
import { chartBarRows, formatUsdCents, successShare } from "@/lib/v3/ai-agents-view";

import { DayBars, FailedLegend } from "@/components/staff/ai-agents/Charts";

const DAYS = 7;

function Figure({ id, label, value, hint, aside }: Readonly<{ id: string; label: string; value: string; hint?: string; aside?: ReactNode }>) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="grid gap-0.5">
        <h3 id={id} className="t-caption text-fg-3">{label}</h3>
        <p className="t-figure tabular-nums text-fg">{value}</p>
        {/* Строка под числом есть всегда (пустая — невидимая): иначе ось одного графика опускалась ниже соседнего. */}
        <p className="t-meta text-fg-3" aria-hidden={hint ? undefined : true}>{hint ?? "\u00a0"}</p>
      </div>
      {aside}
    </div>
  );
}

/**
 * «За 7 дней» на «Обзоре» агента (14.11.2026, «тут ещё дизайн улучши»): одна карточка вместо четырёх плиток и двух
 * графиков. Число стоит над своим графиком, период назван один раз и совпадает с итогами главной «ИИ-агентов».
 * «Ждут решения» здесь нет: число черновиков уже на вкладке «На одобрение» (есть в модели, намеренно не рисуется).
 */
export function NextOverviewWeek({ detail }: Readonly<{ detail: AiAgentDetail }>) {
  const { stats, charts } = detail;
  const share = successShare(stats);
  const runRows = chartBarRows(charts.runsPerDay, "count", DAYS);
  const spendRows = chartBarRows(charts.spendPerDay, "costCents", DAYS);
  const runsHint = [
    share === null ? null : `без ошибок ${share}%`,
    stats.failed7d > 0 ? `с ошибкой: ${stats.failed7d}` : null,
    stats.runsRunning > 0 ? `сейчас работает: ${stats.runsRunning}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <WidgetCard title="За 7 дней">
      <div className="grid gap-6 @4xl:grid-cols-2 @4xl:gap-0" data-testid="v3-aia-week">
        <section aria-labelledby="aia-week-runs" className="grid content-start gap-4 @4xl:pe-6">
          <Figure id="aia-week-runs" label="Запусков" value={String(stats.runs7d)} hint={runsHint || undefined} aside={runRows.some((row) => row.failed > 0) ? <FailedLegend /> : undefined} />
          <DayBars legend={false} rows={runRows} mode="count" caption="Запуски по дням" emptyText="За 7 дней запусков не было." tableHead={["День", "Запусков", "С ошибкой"]} />
        </section>
        <section aria-labelledby="aia-week-spend" className="grid content-start gap-4 border-t border-border pt-6 @4xl:border-s @4xl:border-t-0 @4xl:ps-6 @4xl:pt-0">
          <Figure id="aia-week-spend" label="Расход" value={formatUsdCents(stats.costCents7d)} />
          <DayBars legend={false} rows={spendRows} mode="money" caption="Расход по дням" emptyText="Расхода за 7 дней нет." tableHead={["День", "Расход"]} />
        </section>
      </div>
    </WidgetCard>
  );
}
