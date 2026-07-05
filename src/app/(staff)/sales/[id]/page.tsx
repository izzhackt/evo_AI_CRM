import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { getLead, leadActivities, listStaff, listConversations } from "@/lib/queries";
import { LEAD_STATUSES } from "@/lib/db";
import { updateLeadAction, moveLeadAction, addLeadNoteAction, convertLeadAction, addTaskAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { Badge, Card, EmptyState, inputCls, btnCls, btnGhostCls, labelCls, cn } from "@/components/ui";
import { Icon } from "@/components/icons";

const num = (n: number) => n.toLocaleString("ru-RU");

const ACT_CHIP: Record<string, { tag: string; cls: string }> = {
  wa: { tag: "WA", cls: "bg-ok-weak text-ok" },
  call: { tag: "Зв", cls: "bg-info-weak text-info" },
  note: { tag: "Зам", cls: "bg-violet-weak text-violet" },
  status: { tag: "→", cls: "bg-accent-weak text-accent" },
};

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffRoute("/sales");
  const { id } = await params;
  const leadId = parseInt(id, 10);
  const lead = getLead(leadId);
  if (!lead) notFound();

  const { t } = await getT();
  const activities = leadActivities(leadId);
  const staff = listStaff();
  const conversation = listConversations().find((c) => c.lead_id === leadId);
  const metaParts = [lead.phone, lead.email, [lead.target_country].filter(Boolean).join(" · ")].filter(Boolean) as string[];

  return (
    <div className="space-y-5">
      {/* Back + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/sales" className={cn(btnGhostCls, "gap-1")}>
          <Icon name="arrow-left" size={15} /> {t("pipeline")}
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {conversation && (
            <Link href={`/whatsapp/${conversation.id}`} className={btnGhostCls}>
              <Icon name="message-circle" size={15} /> WhatsApp
            </Link>
          )}
          {lead.phone && (
            <a href={`tel:${lead.phone}`} className={btnGhostCls}>
              <Icon name="phone" size={15} /> {lead.phone}
            </a>
          )}
          {!lead.client_id ? (
            <form action={convertLeadAction}>
              <input type="hidden" name="id" value={lead.id} />
              <button type="submit" className={btnCls}>
                <Icon name="plus" size={15} /> {t("convertToClient")}
              </button>
            </form>
          ) : (
            <Link href={`/clients/${lead.client_id}`} className={btnCls}>{t("converted")}</Link>
          )}
        </div>
      </div>

      {/* Identity header */}
      <div className="rounded-card border border-border bg-surface p-5 shadow-evo">
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-full bg-accent-weak text-[20px] font-semibold text-accent">
            {initials(lead.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[20px] font-bold leading-tight text-fg">{lead.name}</h1>
              <Badge value={lead.status} label={t(`lead.${lead.status}`)} />
            </div>
            {metaParts.length > 0 && (
              <div className="mt-1.5 font-mono text-[12.5px] text-fg-3">{metaParts.join("  ·  ")}</div>
            )}
          </div>
          {lead.amount != null && (
            <div className="text-right">
              <div className="font-mono text-[22px] font-semibold text-fg">{num(lead.amount)}</div>
              <div className="text-[11.5px] text-fg-3">{lead.currency} · {t("value")}</div>
            </div>
          )}
        </div>

        <form action={moveLeadAction} className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <input type="hidden" name="id" value={lead.id} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">{t("moveTo")}</span>
          <select name="status" defaultValue={lead.status} className={cn(inputCls, "h-10 w-auto min-w-56")}>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{t(`lead.${s}`)}</option>)}
          </select>
          <button type="submit" className={btnGhostCls}>{t("save")}</button>
        </form>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        {/* Profile */}
        <Card title={t("client")}>
          <form action={updateLeadAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={lead.id} />
            <label className={cn(labelCls, "sm:col-span-1")}>
              {t("leadName")}
              <input name="name" defaultValue={lead.name} required className={cn(inputCls, "mt-1")} />
            </label>
            <label className={labelCls}>
              {t("phone")}
              <input name="phone" defaultValue={lead.phone ?? ""} className={cn(inputCls, "mt-1 font-mono")} />
            </label>
            <label className={labelCls}>
              {t("email")}
              <input name="email" defaultValue={lead.email ?? ""} className={cn(inputCls, "mt-1")} />
            </label>
            <label className={labelCls}>
              {t("source")}
              <input name="source" defaultValue={lead.source ?? ""} className={cn(inputCls, "mt-1")} />
            </label>
            <label className={labelCls}>
              {t("country")}
              <input name="target_country" defaultValue={lead.target_country ?? ""} className={cn(inputCls, "mt-1")} />
            </label>
            <label className={labelCls}>
              {t("leadAmount")}
              <input name="amount" type="number" defaultValue={lead.amount ?? ""} className={cn(inputCls, "mt-1 font-mono")} />
            </label>
            <label className={labelCls}>
              {t("manager")}
              <select name="manager_id" defaultValue={lead.manager_id ?? ""} className={cn(inputCls, "mt-1")}>
                <option value="">{t("notAssigned")}</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className={cn(labelCls, "sm:col-span-2")}>
              {t("notes")}
              <textarea name="notes" defaultValue={lead.notes ?? ""} rows={3} className={cn(inputCls, "mt-1 h-24 resize-y py-2")} />
            </label>
            <div className="sm:col-span-2"><button type="submit" className={btnCls}>{t("save")}</button></div>
          </form>
        </Card>

        <div className="space-y-5">
          <Card title={t("nextTask")}>
            <div className="mb-3 rounded-ctl bg-ok-weak px-3 py-2.5 text-[13px] font-medium text-ok">
              {lead.overdue_tasks > 0
                ? `${t("overdueTasks")}: ${lead.overdue_tasks}`
                : lead.open_tasks === 0
                  ? t("noNextTask")
                  : `${lead.next_task_title ?? t("nextTask")} · ${lead.next_task_due_date ?? "—"}`}
            </div>
            <form action={addTaskAction} className="grid gap-2">
              <input type="hidden" name="lead_id" value={lead.id} />
              <input type="hidden" name="assignee_id" value={lead.manager_id ?? ""} />
              <input name="title" required placeholder={t("nextTask")} className={inputCls} />
              <div className="grid grid-cols-2 gap-2">
                <input name="due_date" type="date" className={cn(inputCls, "font-mono")} />
                <select name="priority" defaultValue="normal" className={inputCls}>
                  <option value="normal">{t("prio.normal")}</option>
                  <option value="high">{t("prio.high")}</option>
                  <option value="urgent">{t("prio.urgent")}</option>
                </select>
              </div>
              <button type="submit" className={btnCls}>{t("add")}</button>
            </form>
          </Card>

          <Card title={t("activityLog")}>
            <form action={addLeadNoteAction} className="mb-3 flex gap-2">
              <input type="hidden" name="lead_id" value={lead.id} />
              <input name="text" required placeholder={t("addNote")} className={inputCls} />
              <button type="submit" aria-label="+" title={t("add")} className={cn(btnCls, "w-11 px-0")}><Icon name="plus" size={16} /></button>
            </form>
            {activities.length === 0 ? (
              <EmptyState text={t("noResults")} />
            ) : (
              <ul className="space-y-2.5">
                {activities.map((a) => {
                  const chip = ACT_CHIP[a.type] ?? { tag: "•", cls: "bg-surface-2 text-fg-2" };
                  return (
                    <li key={a.id} className="flex gap-3">
                      <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-[10.5px] font-bold", chip.cls)}>
                        {chip.tag}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] text-fg">{a.type === "status" ? t(`lead.${a.text}`) : a.text}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-fg-3">
                          {t(`act.${a.type}`)} · {a.author_name ?? "—"} · {a.created_at}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
