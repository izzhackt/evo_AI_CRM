import { StatusBadge } from "@/components/kit";
import { TrendChart } from "@/components/v3/TrendChart";
import { AI_AGENT_DIGEST_KIND_LABELS, type AiAgentDigestRow } from "@/lib/ai-agents/contract";
import { formatDateTimeRu, formatDayRu, parseDigestMetrics } from "@/lib/v3/ai-agents-view";

import { Markdown } from "@/components/v3/ai-agents/Markdown";

function periodWords(digest: AiAgentDigestRow): string | null {
  if (!digest.periodFrom && !digest.periodTo) return null;
  if (digest.periodFrom && digest.periodTo) return `за период ${formatDayRu(digest.periodFrom)} — ${formatDayRu(digest.periodTo)}`;
  return `на ${formatDayRu((digest.periodTo ?? digest.periodFrom) as string)}`;
}

/** Один отчёт агента: заголовок со словом вида, показатели плитками, линии, текст (безопасный Markdown). */
export function NextDigest({ digest, now, showTitle = true }: Readonly<{ digest: AiAgentDigestRow; now: string; showTitle?: boolean }>) {
  const metrics = parseDigestMetrics(digest.metrics);
  const period = periodWords(digest);
  return (
    <article data-testid="v3-aia-digest" className="grid min-w-0 gap-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {showTitle ? <h3 className="t-item text-fg">{digest.title}</h3> : null}
        <StatusBadge label={AI_AGENT_DIGEST_KIND_LABELS[digest.kind]} />
        <span className="t-meta text-fg-3">{formatDateTimeRu(digest.createdAt, now)}{period ? ` · ${period}` : ""}</span>
      </header>
      {metrics.kpis.length > 0 ? (
        <dl aria-label="Показатели отчёта" className="grid grid-cols-2 gap-x-4 gap-y-3 @3xl:grid-cols-4">
          {metrics.kpis.map((kpi) => (
            <div key={kpi.label} className="min-w-0">
              <dt className="t-caption text-fg-3">{kpi.label}</dt>
              <dd className="t-figure text-fg">{kpi.unit ? `${kpi.value} ${kpi.unit}` : kpi.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {metrics.series.map((series) => (
        <div key={series.label} className="min-w-0">
          <p className="mb-2 t-label text-fg">{series.label}</p>
          <TrendChart series={[{ label: series.label, values: series.values, emphasis: "primary" }]} ticks={series.ticks} caption={series.label} />
        </div>
      ))}
      <Markdown source={digest.bodyMd} />
    </article>
  );
}
