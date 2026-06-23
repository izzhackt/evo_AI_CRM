import Link from "next/link";
import { redirect } from "next/navigation";
import { getT } from "@/lib/i18n";
import { currentUser } from "@/lib/auth";
import { allPayments, listClients } from "@/lib/queries";
import { addPaymentAction, markPaymentPaidAction } from "@/lib/actions";
import { Badge, Card, StatCard, EmptyState, inputCls, btnCls, btnGhostCls } from "@/components/ui";

export default async function FinancePage() {
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.role !== "finance")) redirect("/dashboard");

  const { t } = await getT();
  const payments = allPayments();
  const clients = listClients();
  const overduePayments = payments.filter(
    (payment) => payment.status !== "paid" && payment.due_date && payment.due_date < new Date().toISOString().slice(0, 10),
  ).length;

  const totals = (status: "paid" | "pending") => {
    const sums = new Map<string, number>();
    for (const p of payments) {
      const match = status === "paid" ? p.status === "paid" : p.status !== "paid";
      if (match) sums.set(p.currency, (sums.get(p.currency) ?? 0) + p.amount);
    }
    return [...sums.entries()].map(([cur, sum]) => `${sum.toLocaleString("ru-RU")} ${cur}`).join(" + ") || "0";
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("financeOverview")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("financeOverviewHint")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t("totalPaid")} value={totals("paid")} />
        <StatCard label={t("totalPending")} value={totals("pending")} />
        <StatCard label={t("overduePayments")} value={overduePayments} />
      </div>

      <Card title={`+ ${t("addPayment")}`}>
        <form action={addPaymentAction} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <select name="client_id" required className={inputCls}>
            <option value="">{t("client")}…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input name="title" required placeholder={t("payment")} className={`${inputCls} lg:col-span-2`} />
          <input name="amount" type="number" step="0.01" required placeholder={t("amount")} className={inputCls} />
          <select name="currency" className={inputCls}>
            <option value="KGS">KGS</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
          <input name="due_date" type="date" className={inputCls} />
          <button type="submit" className={btnCls}>{t("add")}</button>
        </form>
      </Card>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">{t("client")}</th>
              <th className="px-4 py-3">{t("payment")}</th>
              <th className="px-4 py-3">{t("amount")}</th>
              <th className="px-4 py-3">{t("dueDate")}</th>
              <th className="px-4 py-3">{t("status")}</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {payments.map((p) => (
              <tr key={p.id} className="transition hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/clients/${p.client_id}`} className="text-indigo-700 hover:underline">
                    {p.client_name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-700">{p.title}</td>
                <td className="px-4 py-3 font-medium text-slate-800">
                  {p.amount.toLocaleString("ru-RU")} {p.currency}
                </td>
                <td className="px-4 py-3 text-slate-600">{p.due_date ?? "—"}</td>
                <td className="px-4 py-3">
                  <Badge value={p.status} label={t(`pay.${p.status}`)} />
                  {p.paid_at && <div className="mt-0.5 text-xs text-slate-400">{p.paid_at}</div>}
                </td>
                <td className="px-4 py-3">
                  {p.status !== "paid" && (
                    <form action={markPaymentPaidAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="client_id" value={p.client_id} />
                      <button type="submit" className={btnGhostCls}>{t("markPaid")}</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {payments.length === 0 && <EmptyState text={t("noResults")} />}
      </div>
    </div>
  );
}
