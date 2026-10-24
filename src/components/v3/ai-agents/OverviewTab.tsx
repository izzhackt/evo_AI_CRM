import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/icons";
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
  relativeTimeRu,
  successShare,
} from "@/lib/v3/ai-agents-view";

import { AnswerActions } from "./AnswerActions";
import { AIA_LINK_SECONDARY } from "./buttons";
import { DayBars, ToolBars } from "./Charts";
import { Markdown } from "./Markdown";
import { PendingTile } from "./PendingTile";

function Panel({ id, title, children }: Readonly<{ id: string; title: string; children: ReactNode }>) {
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-card border border-border bg-surface p-4">
      <h2 id={id} className="t-section text-fg">{title}</h2>
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

/**
 * «Обзор»: что агент сделал. Порядок — по весу для руководителя: отчёт (продукт Директора),
 * показатели, графики, инструменты (свёрнуты), расписание. У агента, который ещё не работал,
 * десять пустых блоков вместо одного слова нет: либо шаги запуска, либо «Запусков ещё не было»
 * и кнопка «Поручить». Что мешает запуску, сказано здесь же и той же кнопкой, что в «Поручить».
 */
export function OverviewTab({
  detail,
  digests,
  now,
  canRun = true,
  setup = null,
  canMakeTasks = false,
}: Readonly<{
  detail: AiAgentDetail;
  digests: readonly AiAgentDigestRow[];
  now: string;
  /** Агенту можно поручать: без этого «Поручить» не предлагается, а причина — в `setup`. */
  canRun?: boolean;
  /** Что мешает запуску: шаги для администратора или одна строка причины; null — ничего. */
  setup?: ReactNode;
  canMakeTasks?: boolean;
}>) {
  const { stats, charts } = detail;
  const share = successShare(stats);
  const neverRan = stats.lastRunAt === null;
  const metrics: readonly Metric[] = [
    {
      label: "Запусков за 7 дней",
      value: stats.runs7d,
      insteadOfDelta: stats.runsRunning > 0 ? `сейчас работает: ${stats.runsRunning}` : null,
    },
    { label: "Без ошибок", value: share === null ? "—" : `${share}%`, insteadOfDelta: share === null ? "нет запусков" : stats.failed7d > 0 ? `с ошибкой: ${stats.failed7d}` : null },
    { label: "Расход за 7 дней", value: formatUsdCents(stats.costCents7d), insteadOfDelta: null },
  ];
  const runRows = chartBarRows(charts.runsPerDay, "count");
  const spendRows = chartBarRows(charts.spendPerDay, "costCents");
  const toolRows = chartToolRows(charts.actionsByTool);
  const toolTotal = toolRows.reduce((sum, row) => sum + row.count, 0);
  const last = detail.lastDigest;
  const older = digests.filter((digest) => digest.id !== last?.id);
  const triggers = [detail.triggerWebsiteLead ? "новая заявка с сайта" : null, detail.triggerWhatsappInbound ? "новое сообщение в WhatsApp" : null].filter(Boolean);
  const hasSchedule = detail.scheduleCron !== null;
  const draftsHref = aiAgentHref(detail.key, { tab: "drafts" });

  const when = hasSchedule || triggers.length > 0 ? (
    <Panel id="aia-when" title="Когда работает">
      <dl className="grid gap-x-8 gap-y-3 @2xl:grid-cols-2">
        {hasSchedule ? (
          <div>
            <dt className="t-meta text-fg-3">Расписание</dt>
            <dd className="t-body-compact text-fg">
              {describeSchedule(detail.scheduleCron, detail.scheduleTz)}
              {detail.enabled ? null : <span className="block t-meta text-fg-3">Агент выключен — по расписанию не запускается.</span>}
            </dd>
          </div>
        ) : null}
        {triggers.length > 0 ? (
          <div>
            <dt className="t-meta text-fg-3">Реагирует на события</dt>
            <dd className="t-body-compact text-fg">
              {triggers.join(", ")}
              {detail.enabled ? null : <span className="block t-meta text-fg-3">Агент выключен — события пропускаются.</span>}
            </dd>
          </div>
        ) : null}
      </dl>
    </Panel>
  ) : null;

  return (
    <div className="space-y-5" data-testid="v3-aia-overview">
      {setup}

      {neverRan ? (
        <>
          {canRun ? (
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface px-5 py-4" data-testid="v3-aia-first-run" aria-labelledby="aia-first-run">
              <h2 id="aia-first-run" className="t-section text-fg">Запусков ещё не было</h2>
              <Link href={aiAgentHref(detail.key, { tab: "command" })} className={AIA_LINK_SECONDARY}>Поручить первую задачу</Link>
            </section>
          ) : null}
          {when}
        </>
      ) : (
        <>
          {last || detail.key === "director" ? (
            <Panel id="aia-last-digest" title="Последний отчёт">
              {last ? (
                <>
                  <DigestBody digest={last} now={now} />
                  <div className="mt-2"><AnswerActions text={last.bodyMd} allowTask={canMakeTasks} /></div>
                </>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3" data-testid="v3-aia-no-digest">
                  <p className="t-body-compact text-fg-2">Отчётов пока нет.</p>
                  {canRun ? <Link href={aiAgentHref(detail.key, { tab: "command" })} className={AIA_LINK_SECONDARY}>Попросить отчёт</Link> : null}
                </div>
              )}
            </Panel>
          ) : null}

          <ul className="grid grid-cols-2 gap-3 @4xl:grid-cols-4" aria-label="Показатели за 7 дней">
            {metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
            {stats.draftsPending > 0
              ? <PendingTile value={stats.draftsPending} href={draftsHref} />
              : <MetricCard metric={{ label: "Ждут решения", value: 0, insteadOfDelta: null }} />}
          </ul>

          <div className="grid gap-4 @4xl:grid-cols-2">
            <Panel id="aia-runs-chart" title="Запуски по дням">
              <DayBars rows={runRows} mode="count" caption="Запуски по дням" emptyText="За 30 дней запусков не было." tableHead={["День", "Запусков", "С ошибкой"]} />
            </Panel>
            <Panel id="aia-spend-chart" title="Расход по дням">
              <DayBars rows={spendRows} mode="money" caption="Расход по дням" emptyText="Расхода за 30 дней нет." tableHead={["День", "Расход"]} />
            </Panel>
          </div>

          {toolRows.length > 0 ? (
            <details className="group rounded-card border border-border bg-surface px-4" data-testid="v3-aia-tools-panel">
              <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-x-3 t-section text-fg">
                Что делает агент
                <span className="inline-flex items-center gap-2 font-normal tabular-nums text-fg-3 t-meta">
                  {toolTotal} за 30 дней
                  <Icon name="chevron-down" size={16} className="shrink-0 text-fg-3 transition-transform duration-[180ms] group-open:rotate-180 motion-reduce:transition-none" />
                </span>
              </summary>
              <div className="pb-4 pt-1"><ToolBars rows={toolRows} emptyText="" /></div>
            </details>
          ) : null}

          {older.length > 0 ? (
            <Panel id="aia-older-digests" title="Прошлые отчёты">
              <ul className="divide-y divide-border">
                {older.map((digest) => (
                  <li key={digest.id}>
                    <details className="group">
                      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
                        <span className="t-item text-fg">{digest.title}</span>
                        <span className="t-meta text-fg-3">{AI_AGENT_DIGEST_KIND_LABELS[digest.kind]} · {relativeTimeRu(digest.createdAt, now)}</span>
                        <Icon name="chevron-down" size={16} className="ms-auto shrink-0 text-fg-3 transition-transform duration-[180ms] group-open:rotate-180 motion-reduce:transition-none" />
                      </summary>
                      <div className="pb-3 pt-1"><DigestBody digest={digest} now={now} /></div>
                    </details>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {when}
        </>
      )}
    </div>
  );
}
