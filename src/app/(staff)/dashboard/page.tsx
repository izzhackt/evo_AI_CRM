import Link from "next/link";
import { getT } from "@/lib/i18n";
import { dashboardStats, listClients } from "@/lib/queries";
import { APP_STATUSES, DOC_STATUSES, LEAD_STATUSES, STAGES } from "@/lib/db";
import { Badge, Card, EmptyState, StatCard } from "@/components/ui";

export default async function DashboardPage() {
  const { t } = await getT();
  const stats = dashboardStats();
  const recent = listClients().slice(0, 6);
  const maxStage = Math.max(1, ...stats.byStage.map((s) => s.c));
  const stageCount = (stage: string) => stats.byStage.find((s) => s.stage === stage)?.c ?? 0;
  const maxLeadStatus = Math.max(1, ...stats.byLeadStatus.map((s) => s.c));
  const leadStatusCount = (status: string) => stats.byLeadStatus.find((s) => s.status === status)?.c ?? 0;
  const maxApplicationStatus = Math.max(1, ...stats.byApplicationStatus.map((s) => s.c));
  const applicationStatusCount = (status: string) => stats.byApplicationStatus.find((s) => s.status === status)?.c ?? 0;
  const maxDocumentStatus = Math.max(1, ...stats.byDocumentStatus.map((s) => s.c));
  const documentStatusCount = (status: string) => stats.byDocumentStatus.find((s) => s.status === status)?.c ?? 0;
  const queueItems = [
    { href: "/sales", label: t("admissionsPipeline"), value: stats.activeLeads, meta: t("activeLeads") },
    { href: "/applications", label: t("applicationQueue"), value: stats.activeApps, meta: t("activeApplications") },
    { href: "/documents", label: t("documentQueue"), value: stats.documentsInReview, meta: t("documentsInReview") },
    { href: "/tasks", label: t("tasks"), value: stats.urgentTasks, meta: t("urgentTasks") },
    { href: "/finance", label: t("financeOverview"), value: stats.overduePayments, meta: t("overduePayments") },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("commandCenter")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">{t("commandCenterHint")}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("activeLeads")} value={stats.activeLeads} href="/sales" />
        <StatCard label={t("totalClients")} value={stats.totalClients} href="/clients" />
        <StatCard label={t("activeApplications")} value={stats.activeApps} href="/applications" />
        <StatCard label={t("documentsInReview")} value={stats.documentsInReview} href="/documents" />
        <StatCard label={t("openTasks")} value={stats.openTasks} href="/tasks" />
        <StatCard label={t("urgentTasks")} value={stats.urgentTasks} href="/tasks" />
        <StatCard label={t("pendingPayments")} value={stats.pendingPayments} href="/finance" />
        <StatCard label={t("overduePayments")} value={stats.overduePayments} href="/finance" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("clientsByStage")}>
          <div className="space-y-2">
            {STAGES.filter((s) => s !== "archived").map((stage) => {
              const c = stageCount(stage);
              return (
                <Link
                  key={stage}
                  href={`/clients?stage=${stage}`}
                  className="flex items-center gap-3 rounded-lg px-2 py-1 transition hover:bg-slate-50"
                >
                  <span className="w-32 shrink-0 text-xs font-medium text-slate-600">{t(`stage.${stage}`)}</span>
                  <span className="h-3 rounded bg-blue-500" style={{ width: `${(c / maxStage) * 100}%` }} />
                  <span className="text-xs font-semibold text-slate-700">{c}</span>
                </Link>
              );
            })}
          </div>
        </Card>

        <Card title={t("pipelineHealth")}>
          <div className="space-y-2">
            {LEAD_STATUSES.map((status) => {
              const c = leadStatusCount(status);
              return (
                <Link
                  key={status}
                  href="/sales"
                  className="flex items-center gap-3 rounded-lg px-2 py-1 transition hover:bg-slate-50"
                >
                  <span className="w-28 shrink-0 text-xs font-medium text-slate-600">{t(`lead.${status}`)}</span>
                  <span className="h-3 rounded bg-cyan-500" style={{ width: `${(c / maxLeadStatus) * 100}%` }} />
                  <span className="text-xs font-semibold text-slate-700">{c}</span>
                </Link>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("applicationStatuses")}>
          <div className="space-y-2">
            {APP_STATUSES.map((status) => {
              const c = applicationStatusCount(status);
              return (
                <Link
                  key={status}
                  href={`/applications?status=${status}`}
                  className="flex items-center gap-3 rounded-lg px-2 py-1 transition hover:bg-slate-50"
                >
                  <span className="w-28 shrink-0 text-xs font-medium text-slate-600">{t(`app.${status}`)}</span>
                  <span className="h-3 rounded bg-violet-500" style={{ width: `${(c / maxApplicationStatus) * 100}%` }} />
                  <span className="text-xs font-semibold text-slate-700">{c}</span>
                </Link>
              );
            })}
          </div>
        </Card>

        <Card title={t("documentStatuses")}>
          <div className="space-y-2">
            {DOC_STATUSES.map((status) => {
              const c = documentStatusCount(status);
              return (
                <Link
                  key={status}
                  href={`/documents?status=${status}`}
                  className="flex items-center gap-3 rounded-lg px-2 py-1 transition hover:bg-slate-50"
                >
                  <span className="w-28 shrink-0 text-xs font-medium text-slate-600">{t(`doc.${status}`)}</span>
                  <span className="h-3 rounded bg-emerald-500" style={{ width: `${(c / maxDocumentStatus) * 100}%` }} />
                  <span className="text-xs font-semibold text-slate-700">{c}</span>
                </Link>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card title={t("workQueues")}>
          <div className="space-y-2">
            {queueItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 px-3 py-2 transition hover:border-blue-200 hover:bg-blue-50"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                  <div className="text-xs text-slate-500">{item.meta}</div>
                </div>
                <span className="text-lg font-semibold text-slate-950">{item.value}</span>
              </Link>
            ))}
          </div>
        </Card>

        <Card title={t("upcomingDeadlines")}>
          {stats.deadlines.length === 0 ? (
            <EmptyState text={t("noResults")} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {stats.deadlines.map((d, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <Link href={`/clients/${d.client_id}`} className="text-sm font-medium text-indigo-700 hover:underline">
                      {d.client_name}
                    </Link>
                    <div className="text-xs text-slate-500">{d.university}</div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-semibold text-slate-700">{d.deadline}</span>
                    <div className="mt-1"><Badge value={d.status} label={t(`app.${d.status}`)} /></div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={t("recentClients")}>
        {recent.length === 0 ? (
          <EmptyState text={t("noResults")} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <Link href={`/clients/${c.id}`} className="text-sm font-medium text-indigo-700 hover:underline">
                    {c.name}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {[c.target_country, c.target_degree].filter(Boolean).join(" · ") || c.email}
                  </div>
                </div>
                <Badge value={c.stage} label={t(`stage.${c.stage}`)} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
