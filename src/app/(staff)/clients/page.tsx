import Link from "next/link";
import { getT } from "@/lib/i18n";
import { listClients } from "@/lib/queries";
import { STAGES } from "@/lib/db";
import { createClientAction } from "@/lib/actions";
import { Badge, EmptyState, inputCls, btnCls } from "@/components/ui";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; q?: string }>;
}) {
  const { t } = await getT();
  const { stage, q } = await searchParams;
  const clients = listClients({ stage, q });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">{t("clients")}</h1>
        <details className="relative">
          <summary className={`${btnCls} cursor-pointer list-none`}>+ {t("addClient")}</summary>
          <form
            action={createClientAction}
            className="absolute right-0 z-20 mt-2 w-80 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-lg"
          >
            <input name="name" required placeholder={t("name")} className={inputCls} />
            <input name="email" type="email" required placeholder={t("email")} className={inputCls} />
            <input name="phone" placeholder={t("phone")} className={inputCls} />
            <input name="target_country" placeholder={t("country")} className={inputCls} />
            <input name="target_degree" placeholder={t("degree")} className={inputCls} />
            <input name="source" placeholder={t("source")} className={inputCls} />
            <button type="submit" className={`${btnCls} w-full`}>{t("add")}</button>
          </form>
        </details>
      </div>

      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder={t("search")} className={`${inputCls} max-w-xs`} />
        <select name="stage" defaultValue={stage ?? ""} className={`${inputCls} max-w-44`}>
          <option value="">{t("allStages")}</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>{t(`stage.${s}`)}</option>
          ))}
        </select>
        <button type="submit" className={btnCls}>{t("search")}</button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">{t("client")}</th>
              <th className="px-4 py-3">{t("stage")}</th>
              <th className="px-4 py-3">{t("country")}</th>
              <th className="px-4 py-3">{t("manager")}</th>
              <th className="px-4 py-3">{t("curator")}</th>
              <th className="px-4 py-3">{t("phone")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {clients.map((c) => (
              <tr key={c.id} className="transition hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/clients/${c.id}`} className="font-medium text-indigo-700 hover:underline">
                    {c.name}
                  </Link>
                  <div className="text-xs text-slate-400">{c.email}</div>
                </td>
                <td className="px-4 py-3"><Badge value={c.stage} label={t(`stage.${c.stage}`)} /></td>
                <td className="px-4 py-3 text-slate-600">
                  {[c.target_country, c.target_degree].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className="px-4 py-3 text-slate-600">{c.manager_name ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{c.curator_name ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{c.phone ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {clients.length === 0 && <EmptyState text={t("noResults")} />}
      </div>
    </div>
  );
}
