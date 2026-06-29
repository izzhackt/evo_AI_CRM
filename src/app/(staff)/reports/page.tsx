import { getT } from "@/lib/i18n";
import { salesReport } from "@/lib/queries";
import { requireStaffRoute } from "@/lib/guards";
import { Card, EmptyState, StatCard, cn } from "@/components/ui";

const num = (n: number) => n.toLocaleString("ru-RU");

export default async function ReportsPage() {
  await requireStaffRoute("/reports");
  const { t } = await getT();
  const { byManager, bySource } = salesReport();

  const totalLeads = byManager.reduce((s, m) => s + m.leads, 0);
  const totalWon = byManager.reduce((s, m) => s + m.won, 0);
  const totalWonAmount = byManager.reduce((s, m) => s + m.won_amount, 0);
  const conversion = totalLeads ? Math.round((totalWon / totalLeads) * 100) : 0;
  const avgCheck = totalWon ? Math.round(totalWonAmount / totalWon) : 0;
  const maxSource = Math.max(1, ...bySource.map((s) => s.c));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("leadsCount")} value={num(totalLeads)} tone="accent" />
        <StatCard label={t("signed")} value={num(totalWon)} tone="success" />
        <StatCard label={t("conversion")} value={`${conversion}%`} tone="info" />
        <StatCard label={t("avgCheck")} value={`${num(avgCheck)} KGS`} tone="neutral" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Card title={t("byManager")} bodyClassName="px-0 py-0">
          {byManager.length === 0 ? (
            <div className="px-5 py-4"><EmptyState text={t("noResults")} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-[0.04em] text-fg-3">
                  <tr>
                    <th className="px-5 py-3 font-semibold">{t("manager")}</th>
                    <th className="px-3 py-3 text-right font-semibold">{t("leadsCount")}</th>
                    <th className="px-3 py-3 text-right font-semibold">{t("signed")}</th>
                    <th className="px-3 py-3 text-right font-semibold">{t("conversion")}</th>
                    <th className="px-5 py-3 text-right font-semibold">{t("value")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {byManager.map((m) => {
                    const conv = m.leads ? Math.round((m.won / m.leads) * 100) : 0;
                    return (
                      <tr key={m.id} className="transition-[background-color] hover:bg-surface-2">
                        <td className="px-5 py-3 font-medium text-fg">{m.name}</td>
                        <td className="px-3 py-3 text-right font-mono text-fg-2">{num(m.leads)}</td>
                        <td className="px-3 py-3 text-right font-mono font-semibold text-ok">{num(m.won)}</td>
                        <td className="px-3 py-3 text-right font-mono text-fg-2">{conv}%</td>
                        <td className="px-5 py-3 text-right font-mono font-semibold text-fg">{num(m.won_amount)} KGS</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={t("bySource")}>
          {bySource.length === 0 ? (
            <EmptyState text={t("noResults")} />
          ) : (
            <div className="space-y-3.5">
              {bySource.map((s) => (
                <div key={s.source}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] text-fg-2">{s.source}</span>
                    <span className="shrink-0 font-mono text-[12px] text-fg-3">
                      {s.c} · {s.won} {t("signed").toLowerCase()}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
                    <div className={cn("h-full rounded-full bg-accent")} style={{ width: `${Math.max(4, (s.c / maxSource) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
