import Link from "next/link";
import type { ReactNode } from "react";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type Tone = "neutral" | "info" | "ok" | "warn" | "danger" | "accent";

const TONE_CLS: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg-2",
  info: "bg-info-weak text-info",
  ok: "bg-ok-weak text-ok",
  warn: "bg-warn-weak text-warn",
  danger: "bg-danger-weak text-danger",
  accent: "bg-accent-weak text-accent",
};

// Semantic status → tone (theme-adaptive; never hardcode palette).
const BADGE_TONE: Record<string, Tone> = {
  // client stages
  lead: "neutral",
  consultation: "info",
  contract: "accent",
  documents: "warn",
  applying: "info",
  offer: "ok",
  visa: "info",
  enrolled: "ok",
  archived: "neutral",
  // application / document / visa / payment statuses
  preparing: "warn",
  submitted: "info",
  rejected: "danger",
  required: "danger",
  uploaded: "info",
  review: "warn",
  approved: "ok",
  not_started: "neutral",
  docs: "info",
  appointment: "info",
  pending: "warn",
  paid: "ok",
  overdue: "danger",
  open: "info",
  done: "ok",
  // lead pipeline statuses
  processing_mp: "info",
  qualified: "info",
  meeting_scheduled: "neutral",
  meeting_done: "warn",
  contract_signed: "ok",
  no_request: "neutral",
  // calls
  answered: "ok",
  missed: "danger",
  busy: "warn",
  // task columns
  todo: "neutral",
  in_progress: "accent",
};

export function Badge({ value, label, className }: { value: string; label: string; className?: string }) {
  const tone = BADGE_TONE[value] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold leading-4 whitespace-nowrap",
        TONE_CLS[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}

export function Card({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-card border border-border bg-surface shadow-evo", className)}>
      {(title || action) && (
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          {title && <h2 className="text-base font-semibold text-fg">{title}</h2>}
          {action}
        </header>
      )}
      <div className={cn("px-5 py-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  href,
  meta,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  href?: string;
  meta?: string;
  tone?: "neutral" | "primary" | "accent" | "info" | "warning" | "danger" | "success";
}) {
  const stripe = {
    neutral: "bg-border-strong",
    primary: "bg-accent",
    accent: "bg-accent",
    info: "bg-info",
    warning: "bg-warn",
    danger: "bg-danger",
    success: "bg-ok",
  }[tone];
  const inner = (
    <div
      className={cn(
        "relative h-full overflow-hidden rounded-card border border-border bg-surface px-5 py-4 shadow-evo transition-[transform,box-shadow,border-color] duration-150 ease-out motion-reduce:transition-none",
        href && "hover:-translate-y-0.5 hover:border-border-strong hover:shadow-evo-lg motion-reduce:hover:translate-y-0",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", stripe)} aria-hidden="true" />
      <div className="font-mono text-3xl font-semibold leading-none text-fg">{value}</div>
      <div className="mt-2 text-xs font-medium text-fg-2">{label}</div>
      {meta && <div className="mt-1.5 text-xs leading-4 text-fg-3">{meta}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-card">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-[60ch] text-sm leading-6 text-fg-3">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export const inputCls =
  "h-11 w-full min-w-0 rounded-ctl border border-border-strong bg-surface px-3 text-base text-fg placeholder:text-fg-3 transition-[border-color,box-shadow,background-color] duration-150 ease-out hover:bg-surface-2 focus-visible:border-accent motion-reduce:transition-none";

export const btnCls =
  "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-ctl border border-accent bg-accent px-4 text-base font-semibold text-on-accent transition-[background-color,border-color,transform] duration-150 ease-out hover:border-accent-2 hover:bg-accent-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100";

export const btnGhostCls =
  "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-ctl border border-border-strong bg-surface px-3 text-sm font-semibold text-fg-2 transition-[background-color,border-color,color,transform] duration-150 ease-out hover:bg-surface-2 hover:text-fg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100";

export const btnDangerGhostCls =
  "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-ctl border border-border-strong bg-surface px-3 text-sm font-semibold text-fg-2 transition-[background-color,border-color,color,transform] duration-150 ease-out hover:border-danger hover:bg-danger-weak hover:text-danger active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100";

export const compactActionCls =
  "inline-flex min-h-10 items-center gap-1 rounded-nav px-2.5 py-1 text-xs font-semibold text-accent transition-[background-color,color] duration-150 ease-out hover:bg-accent-weak motion-reduce:transition-none";

export const filterBarCls =
  "grid gap-2 rounded-card border border-border bg-surface p-3 shadow-evo";

export const labelCls = "mb-1 block text-xs font-medium text-fg-2";

export function EmptyState({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-fg-3">{text}</p>;
}
