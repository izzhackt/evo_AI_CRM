import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { getLead, leadActivities, listStaff, listConversations } from "@/lib/queries";
import { LEAD_STATUSES } from "@/lib/db";
import { updateLeadAction, moveLeadAction, addLeadNoteAction, convertLeadAction, addTaskAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { btnCls, btnGhostCls, cn, inputCls } from "@/components/ui";
import { Icon } from "@/components/icons";
import { LeadActivityFeed } from "@/components/platform/core/LeadActivityFeed";
import { LeadHero } from "@/components/platform/core/LeadHero";
import { LeadInsightRail } from "@/components/platform/core/LeadInsightRail";
import { LeadProfileForm } from "@/components/platform/core/LeadProfileForm";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffRoute("/sales");
  const { id } = await params;
  const leadId = parseInt(id, 10);
  const lead = getLead(leadId);
  if (!lead) notFound();

  const { t, locale } = await getT();
  const num = (value: number) =>
    value.toLocaleString({ ru: "ru-RU", ky: "ky-KG", en: "en-US" }[locale]);
  const activities = leadActivities(leadId);
  const staff = listStaff();
  const conversation = listConversations().find((c) => c.lead_id === leadId);
  const metaParts = [
    lead.phone,
    lead.email,
    lead.target_country ? `${t("country")}: ${lead.target_country}` : null,
  ].filter(Boolean) as string[];
  const updatedAt = lead.last_touch_at ?? lead.updated_at;
  const lastTouchMeta = lead.last_channel ? `${lead.last_channel} · ${updatedAt}` : updatedAt;
  const activityType = {
    wa: t("whatsapp"),
    call: t("calls"),
    note: t("notes"),
    status: t("status"),
  };
  const leadStatus = Object.fromEntries(
    LEAD_STATUSES.map((status) => [status, t(`lead.${status}`)]),
  ) as Record<string, string>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/sales" className={cn(btnGhostCls, "gap-1")}>
          <Icon name="arrow-left" size={15} /> {t("pipeline")}
        </Link>
      </div>

      <LeadHero
        name={lead.name}
        status={lead.status}
        statusLabel={t(`lead.${lead.status}`)}
        meta={metaParts}
        amount={lead.amount != null ? { value: `${num(lead.amount)} ${lead.currency}`, label: t("leadAmount") } : null}
        pipelineLabel={t("pipeline")}
        actions={
          <>
            {conversation ? (
              <Link href={`/whatsapp/${conversation.id}`} className={btnGhostCls}>
                <Icon name="message-circle" size={15} /> WhatsApp
              </Link>
            ) : null}
            {lead.phone ? (
              <a href={`tel:${lead.phone}`} className={btnGhostCls}>
                <Icon name="phone" size={15} /> {lead.phone}
              </a>
            ) : null}
            {!lead.client_id ? (
              <form action={convertLeadAction}>
                <input type="hidden" name="id" value={lead.id} />
                <button type="submit" className={btnCls}>
                  <Icon name="plus" size={15} /> {t("convertToClient")}
                </button>
              </form>
            ) : (
              <Link href={`/clients/${lead.client_id}`} className={btnCls}>
                {t("converted")}
              </Link>
            )}
          </>
        }
        moveForm={
          <form action={moveLeadAction} className="space-y-2">
            <input type="hidden" name="id" value={lead.id} />
            <label className="block text-[12px] font-medium text-fg-2">
              {t("moveTo")}
              <select name="status" defaultValue={lead.status} className={cn(inputCls, "mt-1 h-10")}>
                {LEAD_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`lead.${status}`)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={cn(btnGhostCls, "h-10 w-full")}>
              {t("save")}
            </button>
          </form>
        }
        metrics={[
          { label: t("manager"), value: lead.manager_name ?? t("notAssigned") },
          { label: t("source"), value: lead.source ?? "—" },
          { label: t("lastTouch"), value: lastTouchMeta, tone: "accent" },
          {
            label: `${t("calls")} / ${t("messages")}`,
            value: `${lead.call_count} / ${lead.wa_message_count}`,
            meta: lead.unread_messages > 0 ? `${t("unread")}: ${lead.unread_messages}` : undefined,
          },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_360px]">
        <div className="space-y-5">
          <LeadProfileForm
            action={updateLeadAction}
            lead={lead}
            staff={staff}
            labels={{
              title: t("lead360"),
              name: t("leadName"),
              phone: t("phone"),
              email: t("email"),
              source: t("source"),
              country: t("country"),
              amount: t("leadAmount"),
              manager: t("manager"),
              notes: t("notes"),
              notAssigned: t("notAssigned"),
              save: t("save"),
            }}
          />

          <LeadActivityFeed
            activities={activities}
            noteAction={addLeadNoteAction}
            leadId={lead.id}
            labels={{
              title: t("activityLog"),
              addNote: t("addNote"),
              add: t("add"),
              noResults: t("noResults"),
              activityType,
              leadStatus,
            }}
          />
        </div>

        <LeadInsightRail
          sync={{
            stageLabel: t(`lead.${lead.status}`),
            managerName: lead.manager_name,
            source: lead.source,
            updatedAt: updatedAt,
            channel: lead.last_channel,
            conversationHref: conversation ? `/whatsapp/${conversation.id}` : null,
            draftReviewText: conversation?.agent_draft_review_text ?? null,
            draftReviewStatus: conversation?.agent_draft_review_status ?? null,
          }}
          nextTask={{
            openTasks: lead.open_tasks,
            overdueTasks: lead.overdue_tasks,
            title: lead.next_task_title,
            dueDate: lead.next_task_due_date,
            leadId: lead.id,
            assigneeId: lead.manager_id,
          }}
          taskAction={addTaskAction}
          labels={{
            sourceOfTruthTitle: t("leadSourceTruthTitle"),
            sourceOfTruthHint: t("leadReadModelHint"),
            syncStatus: t("syncNotVerified"),
            stage: t("status"),
            manager: t("manager"),
            source: t("source"),
            updatedAt: t("updatedAt"),
            lastChannel: t("lastChannel"),
            whatsapp: t("whatsapp"),
            nextTask: t("nextTask"),
            noNextTask: t("noNextTask"),
            overdueTasks: t("overdueTasks"),
            add: t("add"),
            addTask: t("addTask"),
            priority: t("priority"),
            priorities: [
              { value: "normal", label: t("prio.normal") },
              { value: "high", label: t("prio.high") },
              { value: "urgent", label: t("prio.urgent") },
            ],
            draftReview: t("draftReview"),
            draftReviewNotSent: t("draftReviewNotSent"),
            save: t("save"),
            notAssigned: t("notAssigned"),
            dueDate: t("dueDate"),
          }}
        />
      </div>
    </div>
  );
}
