import Link from "next/link";
import { getT } from "@/lib/i18n";
import { allPayments, listClients } from "@/lib/queries";
import { addPaymentAction, markPaymentPaidAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { Badge, Card, StatCard, EmptyState, inputCls, btnCls, btnGhostCls, cn } from "@/components/ui";

const num = (n: number) => n.toLocaleString("ru-RU");

export default async function FinancePage() {
  const user = await requireStaffRoute("/finance");

  const { t } = await getT();
  const payments = allPayments();
  const clients = listClients();
  const canMutatePayments = user.role === "admin" || user.role === "finance";
  const today = new Date().toISOString().slice(0, 10);
  const overduePayments = payments.filter(
    (payment) => payment.status !== "paid" && payment.due_date && payment.due_date < today,
  ).length;

  const totals = (status: "paid" | "pending") => {
    const sums = new Map<string, number>();
    for (const p of payments) {
      const match = status === "paid" ? p.status === "paid" : p.status !== "paid";
      if (match) sums.set(p.currency, (sums.get(p.currency) ?? 0) + p.amount);
    }
    return [...sums.entries()].map(([cur, sum]) => `${num(sum)} ${cur}`).join(" + ") || "0";
  };

  return (
    <div className="space-y-5">
      {!canMutatePayments && <p className="text-[12.5px] text-fg-3">{t("financeReadOnlyHint")}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t("totalPaid")} value={totals("paid")} tone="success" />
        <StatCard label={t("totalPending")} value={totals("pending")} tone="warning" />
        <StatCard label={t("overduePayments")} value={overduePayments} tone="danger" />
      </div>

      {canMutatePayments && (
        <Card title={`+ ${t("addPayment")}`}>
          <form id="add" action={addPaymentAction} className="grid scroll-mt-24 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <select name="client_id" required className={inputCls}>
              <option value="">{t("client")}…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input name="title" required placeholder={t("payment")} className={cn(inputCls, "lg:col-span-2")} />
            <input name="amount" type="number" step="0.01" required placeholder={t("amount")} className={inputCls} />
            <select name="currency" className={inputCls}>
              <option value="KGS">KGS</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
            <input name="due_date" type="date" className={cn(inputCls, "font-mono")} />
            <button type="submit" className={btnCls}>{t("add")}</button>
          </form>
        </Card>
      )}

      <Card bodyClassName="px-0 py-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-[0.04em] text-fg-3">
              <tr>
                <th className="px-5 py-3 font-semibold">{t("client")}</th>
                <th className="px-4 py-3 font-semibold">{t("payment")}</th>
                <th className="px-4 py-3 text-right font-semibold">{t("amount")}</th>
                <th className="px-4 py-3 font-semibold">{t("dueDate")}</th>
                <th className="px-4 py-3 font-semibold">{t("status")}</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {payments.map((p) => {
                const isOverdue = p.status !== "paid" && !!p.due_date && p.due_date < today;
                const visibleStatus = isOverdue ? "overdue" : p.status;
                return (
                  <tr key={p.id} className="transition-[background-color] hover:bg-surface-2">
                    <td className="px-5 py-3">
                      <Link href={`/clients/${p.client_id}`} className="font-semibold text-fg hover:text-accent">
                        {p.client_name}
                      </Link>
                      <div className="mt-1 text-[12px] text-fg-3">
                        {[p.target_country, p.manager_name].filter(Boolean).join(" · ") || t("notAssigned")}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-fg-2">{p.title}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-fg">{num(p.amount)} {p.currency}</td>
                    <td className="px-4 py-3 font-mono text-[12.5px] text-fg-2">{p.due_date ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Badge value={visibleStatus} label={t(`pay.${visibleStatus}`)} />
                      {p.paid_at && <div className="mt-0.5 font-mono text-[11px] text-fg-3">{p.paid_at}</div>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {canMutatePayments && p.status !== "paid" && (
                        <form action={markPaymentPaidAction}>
                          <input type="hidden" name="id" value={p.id} />
                          <button type="submit" className={btnGhostCls}>{t("markPaid")}</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {payments.length === 0 && <div className="px-5 py-4"><EmptyState text={t("noResults")} /></div>}
      </Card>
    </div>
  );
}
