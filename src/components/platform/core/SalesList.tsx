import Link from "next/link";

import { Badge, EmptyState, cn } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { Locale } from "@/lib/i18n";
import type { LeadRow } from "@/lib/queries";
import type { SalesCopy } from "./SalesCopy";
import {
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

export function SalesList({
  leads,
  locale,
  copy,
  t,
}: {
  leads: LeadRow[];
  locale: Locale;
  copy: SalesCopy;
  t: (key: string) => string;
}) {
  if (leads.length === 0) {
    return (
      <section className="rounded-card border border-border bg-surface px-5 py-4 shadow-evo">
        <EmptyState text={copy.noFilteredLeads} />
      </section>
    );
  }

  return (
    <div
      role="region"
      aria-label={copy.listCaption}
      tabIndex={0}
      className="max-w-full overflow-x-auto rounded-card border border-border bg-surface shadow-evo"
    >
      <table className="w-full min-w-[980px] text-left text-[12.5px]">
        <caption className="sr-only">{copy.listCaption}</caption>
        <thead className="border-b border-border bg-surface-2 text-[10.5px] uppercase tracking-[0.04em] text-fg-3">
          <tr>
            <th className="px-4 py-3 font-semibold">{t("leadName")}</th>
            <th className="px-3 py-3 font-semibold">{t("stage")}</th>
            <th className="px-3 py-3 text-right font-semibold">
              {t("leadAmount")}
            </th>
            <th className="px-3 py-3 font-semibold">{t("source")}</th>
            <th className="px-3 py-3 font-semibold">{t("manager")}</th>
            <th className="px-3 py-3 font-semibold">{t("nextTask")}</th>
            <th className="px-3 py-3 font-semibold">{t("lastTouch")}</th>
            <th className="px-4 py-3 text-right font-semibold">
              {copy.actions}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {leads.map((lead) => (
            <tr
              key={lead.id}
              className="transition-[background-color] hover:bg-surface-2"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/sales/${lead.id}`}
                  className="font-semibold text-fg hover:text-accent"
                >
                  {lead.name}
                </Link>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-3">
                  <span>{lead.phone ?? "—"}</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <Icon name="phone" size={11} />
                    <span className="sr-only">{t("calls")}: </span>
                    {lead.call_count}
                  </span>
                  {lead.wa_message_count !== null && (
                    <span className="inline-flex items-center gap-1">
                      <Icon name="message-circle" size={11} />
                      <span className="sr-only">{t("messages")}: </span>
                      {lead.wa_message_count}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-3">
                <Badge value={lead.status} label={t(`lead.${lead.status}`)} />
              </td>
              <td className="px-3 py-3 text-right font-mono font-semibold text-fg">
                {lead.amount == null
                  ? "—"
                  : `${formatSalesNumber(lead.amount, locale)} ${lead.currency}`}
              </td>
              <td className="max-w-32 truncate px-3 py-3 text-fg-2">
                {lead.source ?? "—"}
              </td>
              <td className="max-w-36 truncate px-3 py-3 text-fg-2">
                {lead.manager_name ?? t("notAssigned")}
              </td>
              <td className="px-3 py-3">
                <span
                  className={cn(
                    "inline-flex min-h-6 max-w-48 items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                    salesTaskTone(lead),
                  )}
                >
                  <span className="truncate">{taskLabel(lead, t)}</span>
                </span>
              </td>
              <td className="px-3 py-3 font-mono text-[11px] text-fg-2">
                {shortSalesDate(lead.last_touch_at ?? lead.updated_at)}
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-1">
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
