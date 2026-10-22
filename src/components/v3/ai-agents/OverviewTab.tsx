import Link from "next/link";
import type { ReactNode } from "react";

import { MetricCard, type Metric } from "@/components/v3/MetricCard";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { TrendChart } from "@/components/v3/TrendChart";
import {
  AI_AGENT_DIGEST_KIND_LABELS,
  type AiAgentDetail,
  type AiAgentDigestRow,
} from "@/lib/ai-agents/contract";
import {
  aiAgentHref,
  chartBarRows,
  chartToolRows,
  describeSchedule,
  formatDateTimeRu,
  formatDayRu,
  formatUsdCents,
  parseDigestMetrics,
  pluralRu,
  relativeTimeRu,
  successShare,
} from "@/lib/v3/ai-agents-view";

import { DayBars, ToolBars } from "./Charts";
import { Markdown } from "./Markdown";

function Panel({ id, title, children, hint }: Readonly<{ id: string; title: string; children: ReactNode; hint?: string }>) {
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-card border border-border bg-surface p-4">
      <h2 id={id} className="t-section text-fg">{title}</h2>
      {hint ? <p className="mt-0.5 t-meta text-fg-3">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function periodWords(digest: AiAgentDigestRow): string | null {
  if (!digest.periodFrom && !digest.periodTo) return null;
  if (digest.periodFrom && digest.periodTo) return `за период ${formatDayRu(digest.periodFrom)} — ${formatDayRu(digest.periodTo)}`;
  return `на ${formatDayRu((digest.periodTo ?? digest.periodFrom) as string)}`;
}

/** Один отчёт агента: заголовок, плитки показателей, линии, текст (безопасный Markdown). */
function DigestBody({ digest, now }: Readonly<{ digest: AiAgentDigestRow; now: string }>) {
  const metrics = parseDigestMetrics(digest.metrics);
  const period = periodWords(digest);
  return (
    <article data-testid="v3-aia-digest">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="t-item text-fg">{digest.title}</h3>
        <StatusChip label={AI_AGENT_DIGEST_KIND_LABELS[digest.kind]} />
        <span className="t-meta text-fg-3">{formatDateTimeRu(digest.createdAt, now)}{period ? ` · ${period}` : ""}</span>
      </header>
      {metrics.kpis.length > 0 ? (
        <ul className="mt-3 grid grid-cols-2 gap-3 @3xl:grid-cols-4" aria-label="Показатели отчёта">
          {metrics.kpis.map((kpi) => (
            <MetricCard key={kpi.label} metric={{ label: kpi.label, value: kpi.unit ? `${kpi.value} ${kpi.unit}` : kpi.value, insteadOfDelta: null }} />
          ))}
        </ul>
      ) : null}
      {metrics.series.map((series) => (
        <div key={series.label} className="mt-4 rounded-card border border-border p-3">
          <p className="mb-2 t-label text-fg">{series.label}</p>
          <TrendChart series={[{ label: series.label, values: series.values, emphasis: "primary" }]} ticks={series.ticks} caption={series.label} />
        </div>
      ))}
      <div className="mt-3"><Markdown source={digest.bodyMd} /></div>
    </article>
  );
}

export function OverviewTab({
  detail,
  digests,
  now,
}: Readonly<{ detail: AiAgentDetail; digests: readonly AiAgentDigestRow[]; now: string }>) {
  const { stats, charts } = detail;
  const share = successShare(stats);
  const metrics: readonly Metric[] = [
    {
      label: "Запусков за 7 дней",
      value: stats.runs7d,
      insteadOfDelta: stats.runsRunning > 0 ? `сейчас работает: ${stats.runsRunning}` : stats.runs7d === 0 ? "запусков ещё не было" : null,
    },
    { label: "Без ошибок", value: share === null ? "—" : `${share}%`, insteadOfDelta: share === null ? "нет запусков" : stats.failed7d > 0 ? `с ошибкой: ${stats.failed7d}` : "ошибок не было" },
    { label: "Действий за 7 дней", value: stats.actions7d, insteadOfDelta: "вызовов инструментов" },
    { label: "Расход за 7 дней", value: formatUsdCents(stats.costCents7d), insteadOfDelta: "лимиты — в Claude Console" },
    {
      label: "Ждут решения",
      value: stats.draftsPending,
      insteadOfDelta: stats.draftsPending === 0 ? "черновиков нет" : pluralRu(stats.draftsPending, ["черновик", "черновика", "черновиков"]),
    },
  ];
  const runRows = chartBarRows(charts.runsPerDay, "count");
  const spendRows = chartBarRows(charts.spendPerDay, "costCents");
  const toolRows = chartToolRows(charts.actionsByTool);
  const last = detail.lastDigest;
  const older = digests.filter((digest) => digest.id !== last?.id);
  const triggers = [detail.triggerWebsiteLead ? "новая заявка с сайта" : null, detail.triggerWhatsappInbound ? "новое сообщение в WhatsApp" : null].filter(Boolean);
  const hasSchedule = detail.scheduleCron !== null;

  return (
    <div className="space-y-5" data-testid="v3-aia-overview">
      <ul className="grid grid-cols-2 gap-3 @4xl:grid-cols-5" aria-label="Показатели за 7 дней">
        {metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
      </ul>

      {stats.lastRunAt === null ? (
        <p className="rounded-card border border-border bg-surface px-4 py-3 t-body-compact text-fg-2" data-testid="v3-aia-first-run">
          Запусков ещё не было. Поручите агенту первую задачу во вкладке{" "}
          <Link href={aiAgentHref(detail.key, { tab: "command" })} className="text-fg underline underline-offset-4">«Поручить»</Link>.
        </p>
      ) : null}

      <div className="grid gap-4 @4xl:grid-cols-2">
        <Panel id="aia-runs-chart" title="Запуски по дням" hint="за последние 30 дней">
          <DayBars rows={runRows} mode="count" caption="Запуски по дням" emptyText="За 30 дней запусков не было." tableHead={["День", "Запусков", "С ошибкой"]} />
        </Panel>
        <Panel id="aia-spend-chart" title="Расход по дням" hint="по запускам; общий лимит задаёт владелец в Claude Console">
          <DayBars rows={spendRows} mode="money" caption="Расход по дням" emptyText="Расхода за 30 дней нет." tableHead={["День", "Расход"]} />
        </Panel>
      </div>

      <Panel id="aia-tools-chart" title="Что делает агент" hint="вызовы инструментов за 30 дней">
        <ToolBars rows={toolRows} emptyText="Агент пока не вызывал инструменты." />
      </Panel>

      <Panel id="aia-last-digest" title="Последний отчёт">
        {last ? <DigestBody digest={last} now={now} /> : (
          <p className="t-body-compact text-fg-2" data-testid="v3-aia-no-digest">
            Отчётов пока нет. Агент публикует их сам, когда его просят об отчёте или он работает по расписанию.
          </p>
        )}
      </Panel>

      {older.length > 0 ? (
        <Panel id="aia-older-digests" title="Прошлые отчёты">
          <ul className="divide-y divide-border">
            {older.map((digest) => (
              <li key={digest.id}>
                <details>
                  <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
                    <span className="t-item text-fg">{digest.title}</span>
                    <span className="t-meta text-fg-3">{AI_AGENT_DIGEST_KIND_LABELS[digest.kind]} · {relativeTimeRu(digest.createdAt, now)}</span>
                  </summary>
                  <div className="pb-3 pt-1"><DigestBody digest={digest} now={now} /></div>
                </details>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel id="aia-when" title="Когда работает">
        <dl className="grid gap-x-8 gap-y-3 @2xl:grid-cols-2">
          <div>
            <dt className="t-meta text-fg-3">Расписание</dt>
            <dd className="t-body-compact text-fg">
              {describeSchedule(detail.scheduleCron, detail.scheduleTz)}
              {hasSchedule ? (
                <span className="block t-meta text-fg-3">
                  {detail.enabled ? "Следующий запуск виден в Claude Console." : "Агент выключен — запуски по расписанию на паузе."}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="t-meta text-fg-3">Реагирует на события</dt>
            <dd className="t-body-compact text-fg">
              {triggers.length > 0 ? triggers.join(", ") : "Не реагирует: запускается поручением или по расписанию"}
              {triggers.length > 0 && !detail.enabled ? <span className="block t-meta text-fg-3">Агент выключен — события пропускаются.</span> : null}
            </dd>
          </div>
        </dl>
      </Panel>
    </div>
  );
}
