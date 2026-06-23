import Link from "next/link";
import { getT } from "@/lib/i18n";
import { listCalls, listLeads } from "@/lib/queries";
import { logCallAction, getIntegrationStatus } from "@/lib/actions";
import { Badge, Card, EmptyState, inputCls, btnCls } from "@/components/ui";

function fmtDuration(sec: number): string {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function CallsPage() {
  const { t } = await getT();
  const calls = listCalls();
  const leads = listLeads();
  const integrations = await getIntegrationStatus();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">📞 {t("callLog")}</h1>

      {!integrations.telephony && (
        <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">⚠ {t("telephonyDemoNote")}</p>
      )}

      <Card title={`+ ${t("logCall")}`}>
        <form action={logCallAction} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <input name="phone" required placeholder={t("phone")} className={inputCls} />
          <select name="direction" className={inputCls}>
            <option value="out">{t("call.out")}</option>
            <option value="in">{t("call.in")}</option>
          </select>
          <select name="status" className={inputCls}>
            <option value="answered">{t("call.answered")}</option>
            <option value="missed">{t("call.missed")}</option>
            <option value="busy">{t("call.busy")}</option>
          </select>
          <input name="duration_sec" type="number" placeholder={`${t("duration")} (сек)`} className={inputCls} />
          <select name="lead_id" className={inputCls}>
            <option value="">{t("linkedLead")}: —</option>
            {leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <input name="notes" placeholder={t("notes")} className={inputCls} />
          <button type="submit" className={btnCls}>{t("add")}</button>
        </form>
      </Card>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">{t("direction")}</th>
              <th className="px-4 py-3">{t("phone")}</th>
              <th className="px-4 py-3">{t("linkedLead")}</th>
              <th className="px-4 py-3">{t("manager")}</th>
              <th className="px-4 py-3">{t("status")}</th>
              <th className="px-4 py-3">{t("duration")}</th>
              <th className="px-4 py-3">{t("createdAt")}</th>
              <th className="px-4 py-3">{t("recording")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {calls.map((c) => (
              <tr key={c.id} className="transition hover:bg-slate-50">
                <td className="px-4 py-3">{c.direction === "in" ? `📥 ${t("call.in")}` : `📤 ${t("call.out")}`}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{c.phone}</td>
                <td className="px-4 py-3">
                  {c.lead_id ? (
                    <Link href={`/sales/${c.lead_id}`} className="text-indigo-700 hover:underline">{c.lead_name}</Link>
                  ) : "—"}
                </td>
                <td className="px-4 py-3 text-slate-600">{c.manager_name ?? "—"}</td>
                <td className="px-4 py-3"><Badge value={c.status} label={t(`call.${c.status}`)} /></td>
                <td className="px-4 py-3 text-slate-600">{fmtDuration(c.duration_sec)}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{c.started_at}</td>
                <td className="px-4 py-3">
                  {c.recording_url ? (
                    <a href={c.recording_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">▶</a>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {calls.length === 0 && <EmptyState text={t("noResults")} />}
      </div>
    </div>
  );
}
