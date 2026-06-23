import Link from "next/link";
import { getT } from "@/lib/i18n";
import { listLeads, listStaff } from "@/lib/queries";
import { LEAD_STATUSES } from "@/lib/db";
import { addLeadAction, moveLeadAction } from "@/lib/actions";
import { inputCls, btnCls } from "@/components/ui";

const COLUMN_COLORS: Record<string, string> = {
  new: "border-t-slate-400",
  contacted: "border-t-sky-400",
  meeting: "border-t-violet-400",
  proposal: "border-t-amber-400",
  won: "border-t-green-500",
  lost: "border-t-red-300",
};

export default async function SalesPage() {
  const { t } = await getT();
  const leads = listLeads();
  const staff = listStaff();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">{t("pipeline")}</h1>
        <details className="relative">
          <summary className={`${btnCls} cursor-pointer list-none`}>+ {t("addLead")}</summary>
          <form
            action={addLeadAction}
            className="absolute right-0 z-20 mt-2 w-80 space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-lg"
          >
            <input name="name" required placeholder={t("leadName")} className={inputCls} />
            <input name="phone" placeholder={t("phone")} className={inputCls} />
            <input name="email" type="email" placeholder={t("email")} className={inputCls} />
            <input name="source" placeholder={t("source")} className={inputCls} />
            <input name="target_country" placeholder={t("country")} className={inputCls} />
            <input name="amount" type="number" placeholder={t("leadAmount")} className={inputCls} />
            <select name="manager_id" className={inputCls}>
              <option value="">{t("manager")}…</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button type="submit" className={`${btnCls} w-full`}>{t("add")}</button>
          </form>
        </details>
      </div>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {LEAD_STATUSES.map((status) => {
          const column = leads.filter((l) => l.status === status);
          const total = column.reduce((s, l) => s + (l.amount ?? 0), 0);
          return (
            <div key={status} className={`rounded-xl border border-slate-200 border-t-4 bg-white shadow-sm ${COLUMN_COLORS[status]}`}>
              <div className="border-b border-slate-100 px-3 py-2">
                <div className="text-sm font-semibold text-slate-800">{t(`lead.${status}`)}</div>
                <div className="text-xs text-slate-400">
                  {column.length} · {total.toLocaleString("ru-RU")} KGS
                </div>
              </div>
              <div className="space-y-2 p-2">
                {column.map((lead) => (
                  <div key={lead.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 transition hover:border-indigo-300">
                    <Link href={`/sales/${lead.id}`} className="block">
                      <div className="text-sm font-medium text-indigo-700 hover:underline">{lead.name}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {[lead.target_country, lead.source].filter(Boolean).join(" · ")}
                      </div>
                      {lead.amount != null && (
                        <div className="mt-0.5 text-xs font-semibold text-slate-700">
                          {lead.amount.toLocaleString("ru-RU")} {lead.currency}
                        </div>
                      )}
                      {lead.manager_name && <div className="mt-0.5 text-xs text-slate-400">{lead.manager_name}</div>}
                    </Link>
                    <form action={moveLeadAction} className="mt-2 flex gap-1">
                      <input type="hidden" name="id" value={lead.id} />
                      <select name="status" defaultValue={lead.status} className="w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-xs">
                        {LEAD_STATUSES.map((s) => <option key={s} value={s}>{t(`lead.${s}`)}</option>)}
                      </select>
                      <button type="submit" className="rounded border border-slate-300 bg-white px-2 text-xs hover:bg-slate-100">→</button>
                    </form>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
