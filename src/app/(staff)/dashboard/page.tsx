import Link from "next/link";
import { getT } from "@/lib/i18n";
import { dashboardStats, listClients } from "@/lib/queries";
import { STAGES } from "@/lib/db";
import { Badge, Card, StatCard, EmptyState } from "@/components/ui";

export default async function DashboardPage() {
  const { t } = await getT();
  const stats = dashboardStats();
  const recent = listClients().slice(0, 6);
  const maxStage = Math.max(1, ...stats.byStage.map((s) => s.c));
  const stageCount = (stage: string) => stats.byStage.find((s) => s.stage === stage)?.c ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("totalClients")} value={stats.totalClients} href="/clients" />
        <StatCard label={t("activeApplications")} value={stats.activeApps} />
        <StatCard label={t("openTasks")} value={stats.openTasks} href="/tasks" />
        <StatCard label={t("pendingPayments")} value={stats.pendingPayments} href="/finance" />
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
                  <span className="h-3 rounded bg-indigo-500" style={{ width: `${(c / maxStage) * 100}%` }} />
                  <span className="text-xs font-semibold text-slate-700">{c}</span>
                </Link>
              );
            })}
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
                  <span className="text-xs font-semibold text-slate-700">{d.deadline}</span>
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
