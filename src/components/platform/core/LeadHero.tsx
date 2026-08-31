import type { ReactNode } from "react";
import { Badge, cn } from "@/components/ui";
import { Icon } from "@/components/icons";

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "EV";
}

type Metric = {
  label: string;
  value: string;
  meta?: string;
  tone?: "default" | "accent";
};

export function LeadHero({
  name,
  status,
  statusLabel,
  meta,
  amount,
  actions,
  moveForm,
  pipelineLabel,
  metrics,
}: {
  name: string;
  status: string;
  statusLabel: string;
  meta: string[];
  amount?: { value: string; label: string } | null;
  actions?: ReactNode;
  moveForm?: ReactNode;
  pipelineLabel: string;
  metrics: Metric[];
}) {
  return (
    <section className="rounded-card border border-border bg-surface shadow-evo">
      <div className="border-b border-border px-4 py-4 sm:px-5 sm:py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent-weak text-xl font-semibold text-accent sm:h-16 sm:w-16 sm:text-2xl">
              {initials(name)}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-3xl font-bold leading-tight text-fg">{name}</h1>
                <Badge value={status} label={statusLabel} />
              </div>
              {meta.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-fg-3 sm:text-sm">
                  {meta.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex w-full flex-col gap-3 lg:w-auto lg:min-w-[280px] lg:items-end">
            {amount ? (
              <div className="rounded-ctl border border-border bg-surface-2 px-4 py-3 text-left lg:min-w-[200px] lg:text-right">
                <div className="font-mono text-2xl font-semibold leading-none text-fg">{amount.value}</div>
                <div className="mt-1 text-xs text-fg-3">{amount.label}</div>
              </div>
            ) : null}
            {actions ? <div className="flex flex-wrap gap-2 lg:justify-end">{actions}</div> : null}
          </div>
        </div>
      </div>

      <div className="grid gap-4 px-4 py-4 sm:px-5 sm:py-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <div
              key={`${metric.label}-${metric.value}`}
              className={cn(
                "rounded-ctl border px-3.5 py-3.5",
                metric.tone === "accent"
                  ? "border-accent/30 bg-accent-weak/50"
                  : "border-border bg-surface-2",
              )}
            >
              <div className="text-xs font-semibold uppercase tracking-[0.05em] text-fg-3">{metric.label}</div>
              <div className="mt-2 text-md font-semibold leading-snug text-fg">{metric.value}</div>
              {metric.meta ? <div className="mt-1 text-xs text-fg-3">{metric.meta}</div> : null}
            </div>
          ))}
        </div>

        <div className="rounded-ctl border border-border bg-surface-2 px-3.5 py-3.5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.05em] text-fg-3">
            <Icon name="funnel" size={14} />
            <span>{pipelineLabel}</span>
          </div>
          <div className="mt-3">{moveForm}</div>
        </div>
      </div>
    </section>
  );
}
