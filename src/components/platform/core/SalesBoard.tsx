import Link from "next/link";

import { Icon } from "@/components/icons";
import { EmptyState, cn } from "@/components/ui";
import type { LeadStatus } from "@/lib/db";
import type { Locale } from "@/lib/i18n";
import type { LeadRow } from "@/lib/queries";
import type { SalesCopy } from "./SalesCopy";
import {
  SALES_STAGE_TONE,
  formatSalesNumber,
  salesTaskTone,
  shortSalesDate,
} from "./SalesPresentation";

function taskLabel(lead: LeadRow, t: (key: string) => string) {
  if (lead.overdue_tasks > 0) {
    return `${t("overdueTasks")}: ${lead.overdue_tasks}`;
  }
  if (lead.open_tasks === 0) return t("noNextTask");
  return `${t("nextTask")}: ${lead.next_task_due_date ?? "—"}`;
}

export function SalesBoard({
  leads,
  statuses,
  locale,
  copy,
  t,
}: {
  leads: LeadRow[];
  statuses: readonly LeadStatus[];
  locale: Locale;
  copy: SalesCopy;
  t: (key: string) => string;
}) {
  return (
    <div
      role="region"
      aria-label={copy.kanban}
      tabIndex={0}
      className="max-w-full overflow-x-auto rounded-card pb-2"
    >
      <div className="flex w-max min-w-full items-stretch gap-3">
        {statuses.map((status) => {
          const column = leads.filter((lead) => lead.status === status);
          const currencies = [
            ...new Set(
              column
                .filter((lead) => lead.amount != null)
                .map((lead) => lead.currency),
            ),
          ];
          const total = column.reduce(
            (sum, lead) => sum + (lead.amount ?? 0),
            0,
          );
          const totalLabel =
            total > 0 && currencies.length === 1
              ? `${formatSalesNumber(total, locale)} ${currencies[0]}`
              : "—";
          const headingId = `sales-stage-${status}`;

          return (
            <section
              key={status}
              aria-labelledby={headingId}
              className="flex w-[286px] shrink-0 flex-col overflow-hidden rounded-card border border-border bg-surface-2 sm:w-[300px] xl:w-[312px]"
            >
              <header className="flex min-h-12 items-center justify-between gap-2 border-b border-border px-3.5 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "h-2.5 w-2.5 shrink-0 rounded-full",
                      SALES_STAGE_TONE[status],
                    )}
                    aria-hidden="true"
                  />
                  <h3
                    id={headingId}
                    className="truncate text-[13px] font-semibold text-fg"
                  >
                    {t(`lead.${status}`)}
                  </h3>
                  <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-surface px-1.5 font-mono text-[11.5px] font-semibold text-fg-2">
                    {column.length}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-[10.5px] text-fg-3">
                  {totalLabel}
                </span>
              </header>

              {column.length === 0 ? (
                <div className="px-3">
                  <EmptyState text={t("noResults")} />
                </div>
              ) : (
                <ol className="space-y-2.5 p-2.5">
                  {column.map((lead) => (
                    <li key={lead.id}>
                      <article className="rounded-ctl border border-border bg-surface p-3 shadow-evo transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-0.5 hover:border-border-strong hover:shadow-evo-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <Link
                              href={`/sales/${lead.id}`}
                              className="block truncate text-[13.5px] font-semibold leading-5 text-fg hover:text-accent"
                            >
                              {lead.name}
                            </Link>
                            <p className="truncate text-[11.5px] text-fg-3">
                              {[lead.target_country, lead.source]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </p>
                          </div>
                          {lead.amount != null && (
                            <span className="shrink-0 font-mono text-[12px] font-semibold text-fg">
                              {formatSalesNumber(lead.amount, locale)}{" "}
                              {lead.currency}
                            </span>
                          )}
                        </div>

                        <div className="mt-2.5">
                          <span
                            className={cn(
                              "inline-flex min-h-6 max-w-full items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                              salesTaskTone(lead),
                            )}
                          >
                            <span className="truncate">{taskLabel(lead, t)}</span>
                          </span>
                        </div>

                        <dl className="mt-2.5 grid gap-1 text-[11.5px]">
                          <div className="flex justify-between gap-2">
                            <dt className="text-fg-3">{t("manager")}</dt>
                            <dd className="truncate text-right text-fg-2">
                              {lead.manager_name ?? t("notAssigned")}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-fg-3">{t("lastTouch")}</dt>
                            <dd className="shrink-0 text-right font-mono text-[11px] text-fg-2">
                              {shortSalesDate(
                                lead.last_touch_at ?? lead.updated_at,
                              )}
                            </dd>
                          </div>
                        </dl>

                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] text-fg-3">
                            <span className="inline-flex items-center gap-1">
                              <Icon name="phone" size={12} />
                              <span className="sr-only">{t("calls")}: </span>
                              {lead.call_count}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Icon name="message-circle" size={12} />
                              <span className="sr-only">{t("messages")}: </span>
                              {lead.wa_message_count}
                            </span>
                            {lead.unread_messages > 0 && (
                              <span className="inline-flex items-center rounded-full bg-info-weak px-1.5 py-0.5 font-sans text-[10.5px] font-semibold text-info">
                                {t("unread")}: {lead.unread_messages}
                              </span>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {lead.phone && (
                              <a
                                href={`tel:${lead.phone}`}
                                aria-label={`${t("phone")}: ${lead.name}`}
                                title={t("phone")}
                                className="grid h-8 w-8 place-items-center rounded-nav border border-border bg-surface text-fg-2 transition-[border-color,color,background-color] hover:border-border-strong hover:bg-surface-2 hover:text-fg"
                              >
                                <Icon name="phone" size={14} />
                              </a>
                            )}
                            <Link
                              href={`/sales/${lead.id}`}
                              aria-label={`${t("messages")}: ${lead.name}`}
                              title={t("messages")}
                              className="grid h-8 w-8 place-items-center rounded-nav border border-border bg-surface text-fg-2 transition-[border-color,color,background-color] hover:border-border-strong hover:bg-surface-2 hover:text-fg"
                            >
                              <Icon name="message-circle" size={14} />
                            </Link>
                          </div>
                        </div>
                      </article>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
