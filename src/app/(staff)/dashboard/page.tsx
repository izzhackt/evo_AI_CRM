import Link from "next/link";

import { DashboardAttention } from "@/components/platform/core/DashboardAttention";
import { getDashboardCopy } from "@/components/platform/core/DashboardCopy";
import { Icon } from "@/components/icons";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  StatCard,
  btnCls,
  btnGhostCls,
  cn,
} from "@/components/ui";
import { isActiveLeadStatus, LEAD_STAGE_DEFINITIONS } from "@/lib/db";
import { requireStaffRoute } from "@/lib/guards";
import { getT } from "@/lib/i18n";
import { dashboardStats, listLeads, salesCockpitStats } from "@/lib/queries";

const FUNNEL_BAR: Record<string, string> = {
  processing_mp: "bg-info",
  qualified: "bg-accent",
  meeting_scheduled: "bg-violet",
  meeting_done: "bg-warn",
  contract_signed: "bg-ok",
};

export default async function DashboardPage() {
  await requireStaffRoute("/dashboard");
  const { t, locale } = await getT();
  const num = (value: number) =>
    value.toLocaleString({ ru: "ru-RU", ky: "ky-KG", en: "en-US" }[locale]);
  const copy = getDashboardCopy(locale);
  const stats = dashboardStats();
  const cockpit = salesCockpitStats();
  const leads = listLeads();

  const pipelineAmount = leads
    .filter((lead) => !lead.client_id && isActiveLeadStatus(lead.status))
    .reduce((sum, lead) => sum + (lead.amount ?? 0), 0);

  const funnelStages = LEAD_STAGE_DEFINITIONS.filter(
    (stage) => stage.status !== "no_request",
  );
  const leadStatusCount = (status: string) =>
    stats.byLeadStatus.find((stage) => stage.status === status)?.c ?? 0;
  const maxFunnel = Math.max(
    1,
    ...funnelStages.map((stage) => leadStatusCount(stage.status)),
  );

  const attentionItems = [
    {
      href: "/sales?risk=overdue",
      label: t("overdueLeadTasks"),
      value: cockpit.overdueLeadTasks,
      icon: "alert" as const,
      tone: "danger" as const,
    },
    {
      href: "/sales?risk=no_task",
      label: t("dealsWithoutTasks"),
      value: cockpit.dealsWithoutTasks,
      icon: "funnel" as const,
      tone: "warning" as const,
    },
    {
      href: "/finance",
      label: t("overduePayments"),
      value: stats.overduePayments,
      icon: "wallet" as const,
      tone: "danger" as const,
    },
    {
      href: "/documents",
      label: t("documentsInReview"),
      value: stats.documentsInReview,
      icon: "folder" as const,
      tone: "warning" as const,
    },
    {
      href: "/tasks",
      label: t("urgentTasks"),
      value: stats.urgentTasks,
      icon: "check-square" as const,
      tone: "violet" as const,
    },
    {
      href: "/whatsapp",
      label: t("unread"),
      value: cockpit.channelActivity.unreadConversations,
      icon: "message-circle" as const,
      tone: "info" as const,
    },
  ];

  const channel = cockpit.channelActivity;
  const avgResponse =
    channel.avgResponseMinutes === null
      ? "—"
      : `${channel.avgResponseMinutes} ${t("minutesShort")}`;
  const channelTiles = [
    {
      label: `${t("incoming")} · ${t("calls")}`,
      value: num(channel.incomingCalls),
    },
    {
      label: `${t("outgoing")} · ${t("calls")}`,
      value: num(channel.outgoingCalls),
    },
    {
      label: `${t("incoming")} · ${t("messages")}`,
      value: num(channel.incomingMessages),
    },
    {
      label: `${t("outgoing")} · ${t("messages")}`,
      value: num(channel.outgoingMessages),
    },
    { label: t("responseTime"), value: avgResponse },
    { label: t("unread"), value: num(channel.unreadConversations) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("dashboard")}
        description={copy.overviewHint}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/tasks" className={btnGhostCls}>
              <Icon name="check-square" size={16} />
              {t("tasks")}
            </Link>
            <Link href="/sales#add" className={btnCls}>
              <Icon name="plus" size={16} />
              {t("addLead")}
            </Link>
          </div>
        }
      />

      <DashboardAttention items={attentionItems} copy={copy} locale={locale} />

      <section aria-labelledby="dashboard-metrics-title">
        <h2 id="dashboard-metrics-title" className="sr-only">
          {copy.metricsLabel}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            tone="accent"
            label={t("activeLeads")}
            value={num(stats.activeLeads)}
            href="/sales"
          />
          <StatCard
            tone="info"
            label={t("pipelineValue")}
            value={num(pipelineAmount)}
            meta="KGS"
            href="/sales"
          />
          <StatCard
            tone="warning"
            label={t("dealsWithoutTasks")}
            value={num(cockpit.dealsWithoutTasks)}
            href="/sales?risk=no_task"
          />
          <StatCard
            tone="danger"
            label={t("overdueLeadTasks")}
            value={num(cockpit.overdueLeadTasks)}
            href="/sales?risk=overdue"
          />
        </div>
      </section>

      <div className="grid gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card
          title={t("admissionsPipeline")}
          action={
            <Link
              href="/sales"
              aria-label={t("admissionsPipeline")}
              className="inline-flex h-8 items-center gap-1 rounded-nav px-2 text-[12px] font-semibold text-accent hover:bg-accent-weak"
            >
              <Icon name="chevron-right" size={15} />
            </Link>
          }
        >
          <div className="space-y-2.5">
            {funnelStages.map((stage) => {
              const count = leadStatusCount(stage.status);
              return (
                <Link
                  key={stage.status}
                  href={`/sales?status=${stage.status}`}
                  className="flex items-center gap-3 rounded-nav px-2 py-1.5 transition-[background-color] hover:bg-surface-2"
                >
                  <span className="w-36 shrink-0 truncate text-[12.5px] text-fg-2 sm:w-40 sm:text-[13px]">
                    {t(`lead.${stage.status}`)}
                  </span>
                  <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        FUNNEL_BAR[stage.status],
                      )}
                      style={{
                        width: `${Math.max(4, (count / maxFunnel) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-right font-mono text-[13px] font-semibold text-fg">
                    {count}
                  </span>
                </Link>
              );
            })}
          </div>
        </Card>

        <Card title={t("channelActivity")}>
          <div className="grid grid-cols-2 gap-2.5">
            {channelTiles.map((tile) => (
              <div
                key={tile.label}
                className="min-w-0 rounded-ctl bg-surface-2 px-3 py-2.5"
              >
                <div className="truncate text-[11.5px] text-fg-3">
                  {tile.label}
                </div>
                <div className="mt-1 font-mono text-[16px] font-semibold text-fg">
                  {tile.value}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card
        title={t("upcomingDeadlines")}
        action={
          <Link
            href="/applications"
            className="inline-flex min-h-8 items-center gap-1 rounded-nav px-2 text-[12px] font-semibold text-accent hover:bg-accent-weak"
          >
            {copy.allApplications}
            <Icon name="chevron-right" size={14} />
          </Link>
        }
      >
        {stats.deadlines.length === 0 ? (
          <EmptyState text={t("noResults")} />
        ) : (
          <ul className="divide-y divide-border">
            {stats.deadlines.map((deadline, index) => (
              <li
                key={`${deadline.client_id}-${deadline.deadline}-${index}`}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <Link
                    href={`/clients/${deadline.client_id}`}
                    className="text-[13.5px] font-semibold text-fg hover:text-accent"
                  >
                    {deadline.client_name}
                  </Link>
                  <div className="truncate text-[12px] text-fg-3">
                    {deadline.university}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-mono text-[12.5px] text-fg-2">
                    {deadline.deadline}
                  </span>
                  <Badge
                    value={deadline.status}
                    label={t(`app.${deadline.status}`)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t("managerAccountability")} bodyClassName="px-0 py-0">
        {cockpit.managerRows.length === 0 ? (
          <div className="px-5 py-4">
            <EmptyState text={t("noResults")} />
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-[13px]">
              <thead className="border-b border-border text-[11px] uppercase tracking-[0.04em] text-fg-3">
                <tr>
                  <th className="px-5 py-2.5 font-semibold">{t("manager")}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    {t("deals")}
                  </th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    {t("signed")}
                  </th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    {t("calls")}
                  </th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    {t("messages")}
                  </th>
                  <th className="px-5 py-2.5 text-right font-semibold">
                    {t("value")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cockpit.managerRows.map((manager) => (
                  <tr
                    key={manager.id}
                    className="transition-[background-color] hover:bg-surface-2"
                  >
                    <td className="px-5 py-2.5">
                      <Link
                        href={`/sales?manager=${manager.id}`}
                        className="flex items-center gap-2.5"
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-weak text-[11px] font-semibold text-accent">
                          {manager.name.slice(0, 1)}
                        </span>
                        <span className="font-medium text-fg hover:text-accent">
                          {manager.name}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-fg-2">
                      {num(manager.deals)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-ok">
                      {num(manager.signed)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-fg-2">
                      {num(manager.calls)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-fg-2">
                      {num(manager.messages)}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono font-semibold text-fg">
                      {num(Number(manager.value))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
