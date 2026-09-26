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
        "t-caption inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 whitespace-nowrap",
        TONE_CLS[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}

/**
 * Единственная карточка V3: hairline-рамка, `--surface`, радиус 10.
 *
 * Два режима заголовка:
 * - обычный (по умолчанию) — `h2` полужирным, действие справа, тень попап-уровня;
 *   для главных панелей экрана.
 * - `eyebrow` — плотная шапка без тени (бывший `profile/Card.tsx`); для
 *   рабочих панелей в кейсе. Заголовок той же роли `t-section`, что и у
 *   обычной карточки (раньше — 11 px заглавными, мельче текста под ним). В
 *   этом режиме тело не получает своих отступов: строки и таблицы внутри сами
 *   отвечают за отступы до края рамки.
 *
 * `id` — якорь для перехода на раздел (например, `#applications`).
 */
export function Card({
  id,
  title,
  aside,
  eyebrow = false,
  children,
  className,
  bodyClassName,
}: {
  id?: string;
  title?: string;
  aside?: ReactNode;
  eyebrow?: boolean;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const hasHeader = Boolean(title || aside);
  const body = eyebrow && bodyClassName === undefined
    ? children
    : <div className={cn(!eyebrow && "px-5 py-4", bodyClassName)}>{children}</div>;

  return (
    <section
      id={id}
      className={cn(
        "min-w-0 scroll-mt-4 rounded-card border border-border bg-surface",
        !eyebrow && "shadow-evo",
        className,
      )}
    >
      {hasHeader ? (
        eyebrow ? (
          <h3 className="t-section flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 text-fg">
            {title}
            {aside ? <span className="t-body-compact">{aside}</span> : null}
          </h3>
        ) : (
          <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-5 py-3.5">
            {title && <h2 className="t-section text-fg">{title}</h2>}
            {aside}
          </header>
        )
      ) : null}
      {body}
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
  tone?: Tone;
}) {
  const stripe: Record<Tone, string> = {
    neutral: "bg-border-strong",
    accent: "bg-accent",
    info: "bg-info",
    warn: "bg-warn",
    danger: "bg-danger",
    ok: "bg-ok",
  };
  const inner = (
    <div
      className={cn(
        "relative h-full overflow-hidden rounded-card border border-border bg-surface px-5 py-4 shadow-evo transition-[transform,box-shadow,border-color] duration-150 ease-out motion-reduce:transition-none",
        href && "hover:-translate-y-0.5 hover:border-control-edge hover:shadow-evo-lg motion-reduce:hover:translate-y-0",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", stripe[tone])} aria-hidden="true" />
      <div className="t-figure text-fg">{value}</div>
      <div className="t-caption mt-2 text-fg-2">{label}</div>
      {meta && <div className="t-meta mt-1.5 text-fg-3">{meta}</div>}
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
  count,
  description,
  meta,
  action,
}: {
  title: string;
  /** Размер того, что показано рядом с заголовком. null/undefined — считать нечего. */
  count?: number | null;
  description?: string;
  /** Второстепенная строка под заголовком (`t-meta`): например, дата «Сегодня». */
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="t-page-title flex flex-wrap items-baseline gap-2.5 text-fg">
          {title}
          {typeof count === "number" ? (
            <span className="font-normal tabular-nums text-fg-3">{count}</span>
          ) : null}
        </h1>
        {meta ? <p className="t-meta mt-1 text-fg-3">{meta}</p> : null}
        {description && <p className="mt-1 max-w-[56ch] text-sm leading-6 text-fg-3">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export const inputCls =
  "h-11 w-full min-w-0 rounded-ctl border border-control-edge bg-surface px-3 text-base text-fg placeholder:text-fg-3 transition-[border-color,box-shadow,background-color] duration-150 ease-out hover:bg-surface-2 focus-visible:border-accent motion-reduce:transition-none";

export const btnCls =
  "v3-raised inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-ctl border border-accent bg-accent px-4 text-base font-semibold text-on-accent transition-[background-color,border-color,transform] duration-150 ease-out hover:border-accent-2 hover:bg-accent-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100";

export const btnGhostCls =
  "v3-raised inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-ctl border border-control-edge bg-surface px-3 text-sm font-semibold text-fg-2 transition-[background-color,border-color,color,transform] duration-150 ease-out hover:bg-surface-2 hover:text-fg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100";

export const btnDangerGhostCls =
  "v3-raised inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-ctl border border-control-edge bg-surface px-3 text-sm font-semibold text-fg-2 transition-[background-color,border-color,color,transform] duration-150 ease-out hover:border-danger hover:bg-danger-weak hover:text-danger active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100";

export const compactActionCls =
  "inline-flex min-h-10 items-center gap-1 rounded-nav px-2.5 py-1 text-xs font-semibold text-accent transition-[background-color,color] duration-150 ease-out hover:bg-accent-weak motion-reduce:transition-none";

export const filterBarCls =
  "grid gap-2 rounded-card border border-border bg-surface p-3 shadow-evo";

export const labelCls = "mb-1 block text-xs font-medium text-fg-2";

/**
 * Подпись поля в staff CRM: роль `t-label` (14 px, 500) из `(v3)/v3.css`.
 * `labelCls` остаётся для страниц входа и Student, где этих ролей нет.
 */
export const fieldLabelCls = "mb-1 block t-label text-fg-2";

export function EmptyState({
  title,
  text,
  action,
}: {
  title?: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
      {title ? <p className="text-sm font-semibold text-fg">{title}</p> : null}
      <p className="text-sm text-fg-3">{text}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/**
 * Заготовка загрузки: прямоугольник, эхо будущей формы блока (строка текста,
 * карточка, ряд таблицы). `prefers-reduced-motion` гасит пульсацию глобально
 * через `.v3-world`; здесь дублируем `motion-reduce:` на случай использования
 * вне мира V3.
 */
export function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-card bg-surface-2 motion-reduce:animate-none", className)}
    />
  );
}
