import Link from "next/link";
import { getT } from "@/lib/i18n";
import { listCalls, listLeads } from "@/lib/queries";
import { logCallAction, getIntegrationStatus } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { Badge, Card, EmptyState, inputCls, btnCls, cn } from "@/components/ui";
import { Icon } from "@/components/icons";

function fmtDuration(sec: number): string {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function CallsPage() {
  await requireStaffRoute("/calls");
  const { t } = await getT();
  const calls = listCalls();
  const leads = listLeads();
  const integrations = await getIntegrationStatus();

  return (
    <div className="space-y-5">
      {!integrations.telephony && (
        <p className="flex items-center gap-2 rounded-ctl bg-warn-weak px-4 py-2.5 text-[13px] text-warn">
          <Icon name="alert" size={15} /> {t("telephonyDemoNote")}
        </p>
      )}

      <Card title={`+ ${t("logCall")}`}>
        <form id="add" action={logCallAction} className="grid scroll-mt-24 gap-2 sm:grid-cols-2 lg:grid-cols-3">
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

      <Card bodyClassName="px-0 py-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-[0.04em] text-fg-3">
              <tr>
                <th className="px-5 py-3 font-semibold">{t("direction")}</th>
                <th className="px-4 py-3 font-semibold">{t("phone")}</th>
                <th className="px-4 py-3 font-semibold">{t("linkedLead")}</th>
                <th className="px-4 py-3 font-semibold">{t("manager")}</th>
                <th className="px-4 py-3 font-semibold">{t("status")}</th>
                <th className="px-4 py-3 text-right font-semibold">{t("duration")}</th>
                <th className="px-4 py-3 font-semibold">{t("createdAt")}</th>
                <th className="px-5 py-3 font-semibold">{t("recording")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {calls.map((c) => {
                const incoming = c.direction === "in";
                return (
                  <tr key={c.id} className="transition-[background-color] hover:bg-surface-2">
                    <td className="px-5 py-3">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold",
                        incoming ? "bg-info-weak text-info" : "bg-surface-2 text-fg-2",
                      )}>
                        <Icon name={incoming ? "call-in" : "call-out"} size={13} />
                        {incoming ? t("call.in") : t("call.out")}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12.5px] text-fg">{c.phone}</td>
                    <td className="px-4 py-3">
                      {c.lead_id ? (
                        <Link href={`/sales/${c.lead_id}`} className="text-accent hover:underline">{c.lead_name}</Link>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-fg-2">{c.manager_name ?? "—"}</td>
                    <td className="px-4 py-3"><Badge value={c.status} label={t(`call.${c.status}`)} /></td>
                    <td className="px-4 py-3 text-right font-mono text-[12.5px] text-fg-2">{fmtDuration(c.duration_sec)}</td>
                    <td className="px-4 py-3 font-mono text-[11.5px] text-fg-3">{c.started_at}</td>
                    <td className="px-5 py-3">
                      {c.recording_url ? (
                        <a href={c.recording_url} target="_blank" rel="noreferrer" aria-label={t("recording")} className="inline-grid h-8 w-8 place-items-center rounded-nav text-accent hover:bg-accent-weak">
                          <Icon name="play" size={14} />
                        </a>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {calls.length === 0 && <div className="px-5 py-4"><EmptyState text={t("noResults")} /></div>}
      </Card>
    </div>
  );
}
