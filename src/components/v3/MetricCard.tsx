/**
 * Карточка метрики: число крупно, подпись мелко, изменение под ним.
 *
 * `delta` намеренно может быть null. В референсе под каждым числом стоит
 * «+12.5% this month», но такое сравнение существует только когда есть история.
 * Пустая карточка честнее выдуманного роста, поэтому вместо процента здесь
 * появляется причина, по которой его нет.
 */

export type MetricTone = "accent" | "info" | "warn" | "ok";

const TONE_MARK: Record<MetricTone, string> = {
  accent: "bg-accent-weak text-accent-text",
  info: "bg-info-weak text-info",
  warn: "bg-warn-weak text-warn",
  ok: "bg-ok-weak text-ok",
};

export type Metric = Readonly<{
  label: string;
  value: number | string;
  tone: MetricTone;
  /** Изменение за период. null — сравнивать не с чем. */
  delta: Readonly<{ direction: "up" | "down"; text: string }> | null;
  /** Почему сравнения нет. Показывается вместо delta. */
  insteadOfDelta: string | null;
}>;

export function MetricCard({ metric }: { metric: Metric }) {
  return (
    <li className="flex flex-col gap-1 rounded-card border border-border bg-surface px-4 py-3.5">
      <span
        aria-hidden="true"
        className={`mb-1 grid h-7 w-7 place-items-center rounded-nav text-xs ${TONE_MARK[metric.tone]}`}
      >
        ●
      </span>

      <span className="text-xs text-fg-3">{metric.label}</span>

      <span className="font-mono text-2xl font-semibold leading-none tracking-[-0.02em] text-fg">
        {metric.value}
      </span>

      {metric.delta ? (
        <span
          className={`text-2xs font-semibold ${
            metric.delta.direction === "up" ? "text-ok" : "text-danger"
          }`}
        >
          {metric.delta.direction === "up" ? "↑" : "↓"} {metric.delta.text}
        </span>
      ) : (
        <span className="text-2xs text-fg-3">{metric.insteadOfDelta}</span>
      )}
    </li>
  );
}

export function MetricRow({ metrics }: { metrics: readonly Metric[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {metrics.map((metric) => (
        <MetricCard key={metric.label} metric={metric} />
      ))}
    </ul>
  );
}
