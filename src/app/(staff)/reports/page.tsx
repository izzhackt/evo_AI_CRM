import { getT } from "@/lib/i18n";
import { salesReport } from "@/lib/queries";
import { Card, EmptyState } from "@/components/ui";

export default async function ReportsPage() {
  const { t } = await getT();
  const { byManager, byMonth, bySource } = salesReport();
  const maxMonth = Math.max(1, ...byMonth.map((m) => m.c));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">{t("salesReport")}</h1>

      <Card title={t("byManager")}>
        {byManager.length === 0 ? (
          <EmptyState text={t("noResults")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-4">{t("manager")}</th>
                  <th className="py-2 pr-4">{t("leadsCount")}</th>
                  <th className="py-2 pr-4">{t("wonCount")}</th>
                  <th className="py-2 pr-4">{t("conversion")}</th>
                  <th className="py-2 pr-4">{t("wonAmount")}</th>
                  <th className="py-2">{t("avgCheck")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {byManager.map((m) => {
                  const conv = m.leads ? Math.round((m.won / m.leads) * 100) : 0;
                  const avg = m.won ? Math.round(m.won_amount / m.won) : 0;
                  return (
                    <tr key={m.id}>
                      <td className="py-2 pr-4 font-medium text-slate-800">{m.name}</td>
                      <td className="py-2 pr-4">{m.leads}</td>
                      <td className="py-2 pr-4 text-green-700">{m.won}</td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 overflow-hidden rounded bg-slate-100">
                            <div className="h-full bg-indigo-500" style={{ width: `${conv}%` }} />
                          </div>
                          <span className="text-xs font-semibold">{conv}%</span>
                        </div>
                      </td>
                      <td className="py-2 pr-4 font-semibold">{m.won_amount.toLocaleString("ru-RU")} KGS</td>
                      <td className="py-2 text-slate-600">{avg.toLocaleString("ru-RU")} KGS</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("byMonth")}>
          {byMonth.length === 0 ? (
            <EmptyState text={t("noResults")} />
          ) : (
            <div className="flex h-40 items-end gap-2">
              {byMonth.map((m) => (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-xs font-semibold text-slate-700">{m.c}</span>
                  <div
                    className="w-full rounded-t bg-indigo-500"
                    style={{ height: `${Math.max(6, (m.c / maxMonth) * 110)}px` }}
                  />
                  <span className="text-[10px] text-slate-400">{m.month}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title={t("bySource")}>
          {bySource.length === 0 ? (
            <EmptyState text={t("noResults")} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {bySource.map((s) => (
                <li key={s.source} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium text-slate-800">{s.source}</span>
                  <span className="text-slate-600">
                    {s.c} {t("leadsCount").toLowerCase()} · {s.won} {t("lead.won").toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
