import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { getLead, leadActivities, listStaff, listConversations } from "@/lib/queries";
import { LEAD_STATUSES } from "@/lib/db";
import { updateLeadAction, moveLeadAction, addLeadNoteAction, convertLeadAction } from "@/lib/actions";
import { Badge, Card, EmptyState, inputCls, btnCls, btnGhostCls } from "@/components/ui";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const leadId = parseInt(id, 10);
  const lead = getLead(leadId);
  if (!lead) notFound();

  const { t } = await getT();
  const activities = leadActivities(leadId);
  const staff = listStaff();
  const conversation = listConversations().find((c) => c.lead_id === leadId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/sales" className="text-sm text-indigo-600 hover:underline">← {t("pipeline")}</Link>
        <h1 className="text-xl font-bold text-slate-900">{lead.name}</h1>
        <Badge value={lead.status} label={t(`lead.${lead.status}`)} />
        {lead.client_id && (
          <Link href={`/clients/${lead.client_id}`} className="text-sm text-green-700 hover:underline">
            ✓ {t("converted")} →
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form action={moveLeadAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={lead.id} />
          <span className="text-xs text-slate-500">{t("moveTo")}:</span>
          <select name="status" defaultValue={lead.status} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm">
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{t(`lead.${s}`)}</option>)}
          </select>
          <button type="submit" className={btnGhostCls}>{t("save")}</button>
        </form>
        {!lead.client_id && (
          <form action={convertLeadAction}>
            <input type="hidden" name="id" value={lead.id} />
            <button type="submit" className={btnCls}>🎓 {t("convertToClient")}</button>
          </form>
        )}
        {conversation && (
          <Link href={`/whatsapp/${conversation.id}`} className={btnGhostCls}>💬 WhatsApp</Link>
        )}
        {lead.phone && <a href={`tel:${lead.phone}`} className={btnGhostCls}>📞 {lead.phone}</a>}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("client")}>
          <form action={updateLeadAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={lead.id} />
            <label className="block text-xs font-medium text-slate-500">
              {t("leadName")}
              <input name="name" defaultValue={lead.name} required className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-xs font-medium text-slate-500">
              {t("phone")}
              <input name="phone" defaultValue={lead.phone ?? ""} className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-xs font-medium text-slate-500">
              {t("email")}
              <input name="email" defaultValue={lead.email ?? ""} className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-xs font-medium text-slate-500">
              {t("source")}
              <input name="source" defaultValue={lead.source ?? ""} className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-xs font-medium text-slate-500">
              {t("country")}
              <input name="target_country" defaultValue={lead.target_country ?? ""} className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-xs font-medium text-slate-500">
              {t("leadAmount")}
              <input name="amount" type="number" defaultValue={lead.amount ?? ""} className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-xs font-medium text-slate-500">
              {t("manager")}
              <select name="manager_id" defaultValue={lead.manager_id ?? ""} className={`${inputCls} mt-1`}>
                <option value="">{t("notAssigned")}</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-500 sm:col-span-2">
              {t("notes")}
              <textarea name="notes" defaultValue={lead.notes ?? ""} rows={2} className={`${inputCls} mt-1`} />
            </label>
            <div><button type="submit" className={btnCls}>{t("save")}</button></div>
          </form>
        </Card>

        <Card title={t("activityLog")}>
          <form action={addLeadNoteAction} className="mb-3 flex gap-2">
            <input type="hidden" name="lead_id" value={lead.id} />
            <input name="text" required placeholder={t("addNote")} className={inputCls} />
            <button type="submit" className={btnCls}>+</button>
          </form>
          {activities.length === 0 ? (
            <EmptyState text={t("noResults")} />
          ) : (
            <ul className="space-y-2">
              {activities.map((a) => (
                <li key={a.id} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-xs font-medium text-slate-400">
                    {t(`act.${a.type}`)} · {a.author_name ?? "—"} · {a.created_at}
                  </div>
                  <div className="text-sm text-slate-800">
                    {a.type === "status" ? t(`lead.${a.text}`) : a.text}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
