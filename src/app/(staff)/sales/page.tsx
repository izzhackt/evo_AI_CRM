import Link from "next/link";
import { getT } from "@/lib/i18n";
import { listLeads, listStaff } from "@/lib/queries";
import { EVO_AMO_PIPELINE_ID, isActiveLeadStatus, LEAD_STATUSES } from "@/lib/db";
import { addLeadAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { inputCls, btnCls, btnGhostCls, StatCard, cn } from "@/components/ui";
import { Icon } from "@/components/icons";

const num = (n: number) => n.toLocaleString("ru-RU");

const COLUMN_CHIP: Record<string, string> = {
  processing_mp: "bg-info",
  qualified: "bg-accent",
  meeting_scheduled: "bg-violet",
  meeting_done: "bg-warn",
  contract_signed: "bg-ok",
  no_request: "bg-border-strong",
};

function shortDate(value: string | null) {
  if (!value) return "—";
  return value.replace("T", " ").slice(0, 16);
}

function taskTone(lead: { open_tasks: number; overdue_tasks: number }) {
  if (lead.overdue_tasks > 0) return "bg-danger-weak text-danger";
  if (lead.open_tasks === 0) return "bg-warn-weak text-warn";
  return "bg-ok-weak text-ok";
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ manager?: string; source?: string; risk?: string; status?: string }>;
}) {
  await requireStaffRoute("/sales");
  const { t } = await getT();
  const { manager, source, risk, status } = await searchParams;
  const leads = listLeads();
  const staff = listStaff();
  const managerId = manager ? parseInt(manager, 10) : null;
  const selectedStatus = status && (LEAD_STATUSES as readonly string[]).includes(status) ? status : "";
  const sources = [...new Set(leads.map((lead) => lead.source).filter(Boolean) as string[])].sort();
  const isActiveDeal = (lead: { client_id: number | null; status: string }) => !lead.client_id && isActiveLeadStatus(lead.status);
  const filteredLeads = leads.filter((lead) => {
    if (managerId && lead.manager_id !== managerId) return false;
    if (source && lead.source !== source) return false;
    if (selectedStatus && lead.status !== selectedStatus) return false;
    if (risk === "no_task" && (!isActiveDeal(lead) || lead.open_tasks > 0)) return false;
    if (risk === "overdue" && (!isActiveDeal(lead) || lead.overdue_tasks === 0)) return false;
    return true;
  });
  const openLeads = leads.filter(isActiveDeal);
  const convertedLeads = leads.filter((lead) => lead.client_id);
  const pipelineAmount = openLeads.reduce((sum, lead) => sum + (lead.amount ?? 0), 0);
  const signedAmount = leads
    .filter((lead) => lead.status === "contract_signed" || lead.client_id)
    .reduce((sum, lead) => sum + (lead.amount ?? 0), 0);
  const noTaskLeads = openLeads.filter((lead) => lead.open_tasks === 0).length;
  const overdueLeads = openLeads.filter((lead) => lead.overdue_tasks > 0).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label={t("activeLeads")} value={num(openLeads.length)} tone="accent" />
        <StatCard label={t("convertedLeads")} value={num(convertedLeads.length)} tone="success" />
        <StatCard label={t("dealsWithoutTasks")} value={num(noTaskLeads)} tone="warning" />
        <StatCard label={t("overdueLeadTasks")} value={num(overdueLeads)} tone="danger" />
        <StatCard label={t("pipelineValue")} value={`${num(pipelineAmount)} KGS`} meta={`${t("signed")}: ${num(signedAmount)} KGS`} tone="info" />
      </div>

      <form className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface p-3 shadow-evo">
        <div className="relative min-w-[150px] flex-1">
          <select name="manager" defaultValue={manager ?? ""} className={inputCls}>
            <option value="">{t("manager")}: {t("all")}</option>
            {staff.map((person) => (
              <option key={person.id} value={person.id}>{person.name}</option>
            ))}
          </select>
        </div>
        <select name="source" defaultValue={source ?? ""} className={cn(inputCls, "min-w-[150px] flex-1")}>
          <option value="">{t("source")}: {t("all")}</option>
          {sources.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <select name="status" defaultValue={selectedStatus} className={cn(inputCls, "min-w-[150px] flex-1")}>
          <option value="">{t("status")}: {t("all")}</option>
          {LEAD_STATUSES.map((item) => (
            <option key={item} value={item}>{t(`lead.${item}`)}</option>
          ))}
        </select>
        <select name="risk" defaultValue={risk ?? ""} className={cn(inputCls, "min-w-[150px] flex-1")}>
          <option value="">{t("risk")}: {t("all")}</option>
          <option value="no_task">{t("dealsWithoutTasks")}</option>
          <option value="overdue">{t("overdueLeadTasks")}</option>
        </select>
        <button type="submit" className={btnCls}>
          <Icon name="search" size={16} />
          {t("search")}
        </button>
        <Link href="/sales" className={btnGhostCls}>{t("clearFilter")}</Link>
        <span className="ml-auto inline-flex h-9 items-center rounded-full bg-surface-2 px-3 font-mono text-[12px] font-medium text-fg-3">
          amoCRM #{EVO_AMO_PIPELINE_ID}
        </span>
      </form>

      <div className="grid gap-3 md:auto-cols-[minmax(300px,1fr)] md:grid-flow-col md:overflow-x-auto md:pb-2 xl:auto-cols-[minmax(320px,1fr)]">
        {LEAD_STATUSES.map((status, index) => {
          const column = filteredLeads.filter((lead) => lead.status === status);
          const total = column.reduce((sum, lead) => sum + (lead.amount ?? 0), 0);
          return (
            <section key={status} className="rounded-card border border-border bg-surface shadow-evo">
              <header className="sticky top-[68px] z-[1] flex items-center justify-between gap-2 rounded-t-card border-b border-border bg-surface px-3.5 py-3 md:static">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", COLUMN_CHIP[status])} />
                  <span className="truncate text-[13.5px] font-semibold text-fg">{t(`lead.${status}`)}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-surface-2 px-1.5 font-mono text-[12px] font-semibold text-fg-2">{column.length}</span>
                  <span className="font-mono text-[11.5px] text-fg-3">{num(total)}</span>
                </div>
              </header>
              <div className="space-y-2.5 p-2.5">
                {index === 0 && (
                  <form id="add" action={addLeadAction} className="scroll-mt-24 space-y-2 rounded-ctl border border-dashed border-accent/50 bg-accent-weak/40 p-3">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-accent">
                      <Icon name="plus" size={14} /> {t("quickAddLead")}
                    </div>
                    <input name="name" required placeholder={t("leadName")} className={inputCls} />
                    <input name="phone" placeholder={t("phone")} className={inputCls} />
                    <input name="email" type="email" placeholder={t("email")} className={inputCls} />
                    <div className="grid grid-cols-2 gap-2">
                      <input name="source" placeholder={t("source")} className={inputCls} />
                      <input name="target_country" placeholder={t("country")} className={inputCls} />
                      <input name="amount" type="number" placeholder={t("leadAmount")} className={cn(inputCls, "col-span-2")} />
                    </div>
                    <select name="manager_id" className={inputCls}>
                      <option value="">{t("manager")}...</option>
                      {staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                    </select>
                    <button type="submit" className={cn(btnCls, "w-full")}>{t("add")}</button>
                  </form>
                )}

                {column.map((lead) => {
                  const taskLabel = lead.overdue_tasks > 0
                    ? `${t("overdueTasks")}: ${lead.overdue_tasks}`
                    : lead.open_tasks === 0
                      ? t("noNextTask")
                      : `${t("nextTask")}: ${lead.next_task_due_date ?? "—"}`;
                  return (
                    <article key={lead.id} className="rounded-ctl border border-border bg-surface p-3 transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-0.5 hover:border-border-strong hover:shadow-evo-lg">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/sales/${lead.id}`} className="min-w-0 text-[14px] font-semibold leading-5 text-fg hover:text-accent">
                          {lead.name}
                        </Link>
                        {lead.amount != null && (
                          <span className="shrink-0 font-mono text-[13px] font-semibold text-fg">{num(lead.amount)} {lead.currency}</span>
                        )}
                      </div>

                      <div className="mt-2.5">
                        <span className={cn("inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold", taskTone(lead))}>
                          {taskLabel}
                        </span>
                      </div>

                      <dl className="mt-2.5 grid gap-1 text-[12px]">
                        <div className="flex justify-between gap-2">
                          <dt className="text-fg-3">{t("source")}</dt>
                          <dd className="truncate text-right text-fg-2">{lead.source ?? "—"}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-fg-3">{t("manager")}</dt>
                          <dd className="truncate text-right text-fg-2">{lead.manager_name ?? t("notAssigned")}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-fg-3">{t("lastTouch")}</dt>
                          <dd className="text-right font-mono text-[11.5px] text-fg-2">{shortDate(lead.last_touch_at ?? lead.updated_at)}</dd>
                        </div>
                      </dl>

                      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
                        <div className="flex items-center gap-3 font-mono text-[12px] text-fg-3">
                          <span className="inline-flex items-center gap-1"><Icon name="phone" size={13} />{t("calls")}: {lead.call_count}</span>
                          <span className="inline-flex items-center gap-1"><Icon name="message-circle" size={13} />{t("messages")}: {lead.wa_message_count}</span>
                          {lead.unread_messages > 0 && (
                            <span className="inline-flex items-center rounded-full bg-accent-weak px-1.5 text-[11px] font-semibold text-accent">{t("unread")}: {lead.unread_messages}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {lead.phone && (
                            <a href={`tel:${lead.phone}`} aria-label={t("phone")} title={t("phone")} className="grid h-8 w-8 place-items-center rounded-nav border border-border bg-surface text-fg-2 transition hover:border-border-strong hover:text-fg">
                              <Icon name="phone" size={15} />
                            </a>
                          )}
                          <Link href={`/sales/${lead.id}`} aria-label="WhatsApp" title="WhatsApp" className="grid h-8 w-8 place-items-center rounded-nav border border-border bg-surface text-fg-2 transition hover:border-border-strong hover:text-fg">
                            <Icon name="message-circle" size={15} />
                          </Link>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
