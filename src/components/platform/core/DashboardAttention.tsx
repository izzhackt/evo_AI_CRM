import Link from "next/link";

import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import type { DashboardCopy } from "./DashboardCopy";

type AttentionTone = "danger" | "warning" | "info" | "violet";

export type DashboardAttentionItem = {
  href: string;
  label: string;
  value: number;
  icon: IconName;
  tone: AttentionTone;
};

export function orderDashboardAttentionItems(items: DashboardAttentionItem[]) {
  return [
    ...items.filter((item) => item.value !== 0),
    ...items.filter((item) => item.value === 0),
  ];
}

export function dashboardAttentionIsClear(items: DashboardAttentionItem[]) {
  return items.every((item) => item.value === 0);
}

const TONE_CLASSES: Record<
  AttentionTone,
  { icon: string; value: string; dot: string }
> = {
  danger: {
    icon: "bg-danger-weak text-danger",
    value: "bg-danger-weak text-danger",
    dot: "bg-danger",
  },
  warning: {
    icon: "bg-warn-weak text-warn",
    value: "bg-warn-weak text-warn",
    dot: "bg-warn",
  },
  info: {
    icon: "bg-info-weak text-info",
    value: "bg-info-weak text-info",
    dot: "bg-info",
  },
  violet: {
    icon: "bg-violet-weak text-violet",
    value: "bg-violet-weak text-violet",
    dot: "bg-violet",
  },
};

export function DashboardAttention({
  items,
  copy,
  locale,
}: {
  items: DashboardAttentionItem[];
  copy: DashboardCopy;
  locale: Locale;
}) {
  const localeTag = { ru: "ru-RU", ky: "ky-KG", en: "en-US" }[locale];
  const orderedItems = orderDashboardAttentionItems(items);
  const allClear = dashboardAttentionIsClear(orderedItems);

  return (
    <section
      aria-labelledby="dashboard-attention-title"
      className="overflow-hidden rounded-card border border-border bg-surface shadow-evo"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-accent">
            {copy.attentionEyebrow}
          </p>
          <h2
            id="dashboard-attention-title"
            className="mt-1 text-[17px] font-bold leading-tight text-fg"
          >
            {copy.attentionTitle}
          </h2>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-5 text-fg-3">
            {copy.attentionHint}
          </p>
        </div>
        <span className="inline-flex min-h-7 items-center rounded-full bg-surface-2 px-2.5 text-[11.5px] font-medium text-fg-3">
          {copy.localDataLabel}
        </span>
      </header>

      {allClear ? (
        <div className="flex min-h-40 items-center gap-3 px-4 py-6 sm:px-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ok-weak text-ok">
            <Icon name="check" size={20} strokeWidth={2.2} />
          </span>
          <div>
            <h3 className="text-[15px] font-bold text-fg">
              {copy.allClearTitle}
            </h3>
            <p className="mt-1 text-[12.5px] leading-5 text-fg-3">
              {copy.allClearHint}
            </p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {orderedItems.map((item) => {
          const tone = TONE_CLASSES[item.tone];
          const quiet = item.value === 0;
          return (
            <li
              key={item.href}
              data-attention-state={quiet ? "quiet" : "action"}
            >
              <Link
                href={item.href}
                className={cn(
                  "group flex min-h-16 items-center gap-3 px-4 py-3 transition-[background-color] duration-150 hover:bg-surface-2 motion-reduce:transition-none sm:px-5",
                  quiet && "text-fg-3",
                )}
              >
                <span
                  className={cn(
                    "grid h-9 w-9 shrink-0 place-items-center rounded-ctl",
                    quiet ? "bg-surface-2 text-fg-3" : tone.icon,
                  )}
                >
                  <Icon name={item.icon} size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        quiet ? "bg-border-strong" : tone.dot,
                      )}
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        "truncate text-[13.5px]",
                        quiet ? "font-medium text-fg-3" : "font-semibold text-fg",
                      )}
                    >
                      {item.label}
                    </span>
                  </span>
                </span>
                <span
                  className={cn(
                    "inline-flex min-w-8 items-center justify-center rounded-full px-2 py-1 font-mono text-[12px] font-semibold",
                    quiet ? "bg-surface-2 text-fg-3" : tone.value,
                  )}
                >
                  {item.value.toLocaleString(localeTag)}
                </span>
                <Icon
                  name="chevron-right"
                  size={16}
                  className="shrink-0 text-fg-3 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                />
              </Link>
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
