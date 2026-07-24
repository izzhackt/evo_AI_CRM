import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/components/ui";

type BannerTone = "neutral" | "warning" | "danger" | "info";

const BANNER_TONE: Record<BannerTone, string> = {
  neutral: "border-border bg-surface text-fg-2",
  warning: "border-warn/30 bg-warn-weak text-warn",
  danger: "border-danger/30 bg-danger-weak text-danger",
  info: "border-info/30 bg-info-weak text-info",
};

export function ContextBanner({
  title,
  description,
  tone = "neutral",
  action,
}: {
  title: string;
  description: string;
  tone?: BannerTone;
  action?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "flex flex-col gap-3 rounded-card border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        BANNER_TONE[tone],
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-nav bg-surface/70">
          <Icon name={tone === "danger" || tone === "warning" ? "alert" : "file-check"} size={16} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[13px] font-bold text-current">{title}</h2>
          <p className="mt-0.5 text-[12.5px] leading-5 opacity-80">{description}</p>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </section>
  );
}

export function QueueMetrics({
  items,
}: {
  items: Array<{ label: string; value: ReactNode; meta?: string; tone?: "accent" | "info" | "warn" | "danger" | "ok" }>;
}) {
  return (
    <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="relative overflow-hidden rounded-card border border-border bg-surface px-4 py-4 shadow-evo">
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-y-0 left-0 w-1",
              item.tone === "info" && "bg-info",
              item.tone === "warn" && "bg-warn",
              item.tone === "danger" && "bg-danger",
              item.tone === "ok" && "bg-ok",
              (!item.tone || item.tone === "accent") && "bg-accent",
            )}
          />
          <dt className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-fg-3">{item.label}</dt>
          <dd className="mt-2 flex items-end gap-2">
            <span className="font-mono text-[24px] font-bold leading-none text-fg">{item.value}</span>
            {item.meta && <span className="text-[11px] text-fg-3">{item.meta}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function WorkflowStepper({
  label,
  steps,
  current,
  terminalDanger = false,
}: {
  label: string;
  steps: Array<{ value: string; label: string }>;
  current: string;
  terminalDanger?: boolean;
}) {
  const activeIndex = Math.max(0, steps.findIndex((step) => step.value === current));

  return (
    <ol aria-label={label} className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      {steps.map((step, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;
        return (
          <li
            key={step.value}
            aria-current={active ? "step" : undefined}
            className={cn(
              "relative rounded-nav border px-3 py-2.5 text-[12px] font-semibold",
              done && "border-ok/25 bg-ok-weak text-ok",
              active && !terminalDanger && "border-accent/30 bg-accent-weak text-accent",
              active && terminalDanger && "border-danger/30 bg-danger-weak text-danger",
              !done && !active && "border-border bg-surface-2 text-fg-3",
            )}
          >
            <span className="mr-2 font-mono text-[10px] opacity-70">{String(index + 1).padStart(2, "0")}</span>
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}

export function DetailBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-10 items-center gap-2 rounded-nav px-2 text-[12.5px] font-semibold text-fg-2 hover:bg-surface-2 hover:text-fg"
    >
      <Icon name="arrow-left" size={15} />
      {label}
    </Link>
  );
}

export function KeyValueGrid({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 border-b border-border pb-3">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-3">{item.label}</dt>
          <dd className="mt-1 break-words text-[13.5px] font-medium text-fg">{item.value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
