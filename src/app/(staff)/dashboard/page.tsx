import Link from "next/link";
import { getT } from "@/lib/i18n";
import { dashboardStats, listLeads, salesCockpitStats } from "@/lib/queries";
import { isActiveLeadStatus, LEAD_STAGE_DEFINITIONS } from "@/lib/db";
import { requireStaffRoute } from "@/lib/guards";
import { Badge, Card, EmptyState, StatCard, cn } from "@/components/ui";
import { Icon } from "@/components/icons";

const num = (n: number) => n.toLocaleString("ru-RU");

const FUNNEL_BAR: Record<string, string> = {
  processing_mp: "bg-info",
  qualified: "bg-accent",
  meeting_scheduled: "bg-violet",
  meeting_done: "bg-warn",
  contract_signed: "bg-ok",
};

export default async function DashboardPage() {
  await requireStaffRoute("/dashboard");
  const { t } = await getT();
  const stats = dashboardStats();
  const cockpit = salesCockpitStats();
  const leads = listLeads();

  const pipelineAmount = leads
    .filter((lead) => !lead.client_id && isActiveLeadStatus(lead.status))
    .reduce((sum, lead) => sum + (lead.amount ?? 0), 0);

  const funnelStages = LEAD_STAGE_DEFINITIONS.filter((s) => s.status !== "no_request");
  const leadStatusCount = (status: string) => stats.byLeadStatus.find((s) => s.status === status)?.c ?? 0;
  const maxFunnel = Math.max(1, ...funnelStages.map((s) => leadStatusCount(s.status)));

  const queues = [
    { href: "/sales", dot: "bg-accent", label: t("admissionsPipeline"), value: stats.activeLeads },
    { href: "/applications", dot: "bg-info", label: t("applicationQueue"), value: stats.activeApps },
    { href: "/documents", dot: "bg-warn", label: t("documentQueue"), value: stats.documentsInReview },
    { href: "/tasks", dot: "bg-violet", label: t("tasks"), value: stats.urgentTasks },
    { href: "/finance", dot: "bg-danger", label: t("financeOverview"), value: stats.overduePayments },
  ];

  const channel = cockpit.channelActivity;
  const avgResponse =
    channel.avgResponseMinutes === null ? "—" : `${channel.avgResponseMinutes} ${t("minutesShort")}`;
  const tiles = [
    { label: `${t("incoming")} · ${t("calls")}`, value: num(channel.incomingCalls) },
    { label: `${t("outgoing")} · ${t("calls")}`, value: num(channel.outgoingCalls) },
    { label: `${t("incoming")} · ${t("messages")}`, value: num(channel.incomingMessages) },
    { label: `${t("outgoing")} · ${t("messages")}`, value: num(channel.outgoingMessages) },
    { label: t("responseTime"), value: avgResponse },
    { label: t("unread"), value: num(channel.unreadConversations) },
  ];

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard tone="accent" label={t("activeLeads")} value={num(stats.activeLeads)} href="/sales" />
        <StatCard tone="info" label={t("pipelineValue")} value={num(pipelineAmount)} meta="KGS" href="/sales" />
        <StatCard tone="warning" label={t("dealsWithoutTasks")} value={num(cockpit.dealsWithoutTasks)} href="/sales?risk=no_task" />
        <StatCard tone="danger" label={t("overdueLeadTasks")} value={num(cockpit.overdueLeadTasks)} href="/sales?risk=overdue" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        {/* Left column */}
        <div className="space-y-5">
          <Card
            title={t("admissionsPipeline")}
            action={
              <Link href="/sales" aria-label={t("admissionsPipeline")} className="inline-flex h-8 items-center gap-1 rounded-nav px-2 text-[12px] font-semibold text-accent hover:bg-accent-weak">
                <Icon name="chevron-right" size={15} />
              </Link>
            }
          >
            <div className="space-y-2.5">
              {funnelStages.map((stage) => {
                const c = leadStatusCount(stage.status);
                return (
                  <Link
                    key={stage.status}
                    href={`/sales?status=${stage.status}`}
                    className="flex items-center gap-3 rounded-nav px-2 py-1.5 transition-[background-color] hover:bg-surface-2"
                  >
                    <span className="w-40 shrink-0 truncate text-[13px] text-fg-2">{t(`lead.${stage.status}`)}</span>
                    <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <span
                        className={cn("block h-full rounded-full", FUNNEL_BAR[stage.status])}
                        style={{ width: `${Math.max(4, (c / maxFunnel) * 100)}%` }}
                      />
                    </span>
                    <span className="w-8 shrink-0 text-right font-mono text-[13px] font-semibold text-fg">{c}</span>
                  </Link>
                );
              })}
            </div>
          </Card>

          <Card title={t("upcomingDeadlines")}>
            {stats.deadlines.length === 0 ? (
              <EmptyState text={t("noResults")} />
            ) : (
              <ul className="divide-y divide-border">
                {stats.deadlines.map((d, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <Link href={`/clients/${d.client_id}`} className="text-[13.5px] font-semibold text-fg hover:text-accent">
                        {d.client_name}
                      </Link>
                      <div className="truncate text-[12px] text-fg-3">{d.university}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-[12.5px] text-fg-2">{d.deadline}</span>
                      <Badge value={d.status} label={t(`app.${d.status}`)} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          <Card title={t("workQueues")}>
            <div className="space-y-1.5">
              {queues.map((q) => (
                <Link
                  key={q.href}
                  href={q.href}
                  className="flex items-center justify-between gap-3 rounded-nav px-2.5 py-2 transition-[background-color] hover:bg-surface-2"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", q.dot)} />
                    <span className="truncate text-[13px] text-fg-2">{q.label}</span>
                  </span>
                  <span className="font-mono text-[14px] font-semibold text-fg">{num(q.value)}</span>
                </Link>
              ))}
            </div>
          </Card>

          <Card title={t("channelActivity")}>
            <div className="grid grid-cols-2 gap-2.5">
              {tiles.map((tile) => (
                <div key={tile.label} className="rounded-ctl bg-surface-2 px-3 py-2.5">
                  <div className="truncate text-[11.5px] text-fg-3">{tile.label}</div>
                  <div className="mt-1 font-mono text-[16px] font-semibold text-fg">{tile.value}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Managers */}
      <Card title={t("managerAccountability")} bodyClassName="px-0 py-0">
        {cockpit.managerRows.length === 0 ? (
          <div className="px-5 py-4"><EmptyState text={t("noResults")} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-border text-[11px] uppercase tracking-[0.04em] text-fg-3">
                <tr>
                  <th className="px-5 py-2.5 font-semibold">{t("manager")}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t("deals")}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t("signed")}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t("calls")}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t("messages")}</th>
                  <th className="px-5 py-2.5 text-right font-semibold">{t("value")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cockpit.managerRows.map((m) => (
                  <tr key={m.id} className="transition-[background-color] hover:bg-surface-2">
                    <td className="px-5 py-2.5">
                      <Link href={`/sales?manager=${m.id}`} className="flex items-center gap-2.5">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-weak text-[11px] font-semibold text-accent">
                          {m.name.slice(0, 1)}
                        </span>
                        <span className="font-medium text-fg hover:text-accent">{m.name}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-fg-2">{num(m.deals)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-ok">{num(m.signed)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-fg-2">{num(m.calls)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-fg-2">{num(m.messages)}</td>
                    <td className="px-5 py-2.5 text-right font-mono font-semibold text-fg">{num(Number(m.value))}</td>
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
