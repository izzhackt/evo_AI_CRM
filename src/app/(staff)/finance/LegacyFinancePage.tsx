import Link from "next/link";
import { getT } from "@/lib/i18n";
import {
  listFinanceClientsForActor,
  listPaymentsForActor,
} from "@/lib/queries";
import { addPaymentAction, markPaymentPaidAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { Badge, Card, EmptyState, inputCls, btnCls, btnGhostCls, cn, labelCls } from "@/components/ui";
import {
  ContextBanner,
  QueueMetrics,
} from "@/components/platform/operations/OperationsPrimitives";

const num = (n: number) => n.toLocaleString("ru-RU");

/**
 * The accepted SQLite finance screen. It stays reachable only in the explicit
 * UI-contract fixture mode; `currentUser()` returns null outside it, so this
 * body would redirect to /login in a Platform session.
 */
export async function renderLegacyFinancePage() {
  const user = await requireStaffRoute("/finance");
  const { t } = await getT();
  const payments = listPaymentsForActor(user);
  const clients = listFinanceClientsForActor(user);
  const canMutatePayments = user.role === "admin" || user.role === "finance";
  const today = new Date().toISOString().slice(0, 10);
  const overduePayments = payments.filter(
    (payment) => payment.status !== "paid" && payment.due_date && payment.due_date < today,
  ).length;

  const totals = (status: "paid" | "pending") => {
    const sums = new Map<string, number>();
    for (const payment of payments) {
      const match = status === "paid" ? payment.status === "paid" : payment.status !== "paid";
      if (match) sums.set(payment.currency, (sums.get(payment.currency) ?? 0) + payment.amount);
    }
    return [...sums.entries()].map(([currency, sum]) => `${num(sum)} ${currency}`).join(" + ") || "0";
  };

  return (
    <div className="space-y-5">
      <ContextBanner
        title={canMutatePayments ? t("sourceBoundary") : t("readOnly")}
        description={canMutatePayments ? t("localRecordHint") : t("financeReadOnlyHint")}
        tone={canMutatePayments ? "neutral" : "warning"}
      />

      <QueueMetrics
        items={[
          { label: t("totalPaid"), value: totals("paid"), tone: "ok" },
          { label: t("totalPending"), value: totals("pending"), tone: "warn" },
          { label: t("overduePayments"), value: overduePayments, tone: overduePayments ? "danger" : "ok" },
          { label: t("payments"), value: payments.length, tone: "info" },
        ]}
      />

      {canMutatePayments && (
        <details id="add" className="scroll-mt-24 rounded-card border border-border bg-surface shadow-evo">
          <summary className="cursor-pointer list-none px-5 py-4 text-[13.5px] font-semibold text-accent marker:hidden">
            ＋ {t("addPayment")}
          </summary>
          <form action={addPaymentAction} className="grid gap-3 border-t border-border px-5 py-4 sm:grid-cols-2 xl:grid-cols-3">
            <div>
              <label htmlFor="payment-client" className={labelCls}>{t("client")}</label>
              <select id="payment-client" name="client_id" required className={inputCls}>
                <option value="">{t("client")}…</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-1 xl:col-span-2">
              <label htmlFor="payment-title" className={labelCls}>{t("payment")}</label>
              <input id="payment-title" name="title" required className={inputCls} />
            </div>
            <div>
              <label htmlFor="payment-amount" className={labelCls}>{t("amount")}</label>
              <input id="payment-amount" name="amount" type="number" step="0.01" required className={inputCls} />
            </div>
            <div>
              <label htmlFor="payment-currency" className={labelCls}>KGS / USD / EUR</label>
              <select id="payment-currency" name="currency" className={inputCls}>
                <option value="KGS">KGS</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div>
              <label htmlFor="payment-due" className={labelCls}>{t("dueDate")}</label>
              <input id="payment-due" name="due_date" type="date" className={cn(inputCls, "font-mono")} />
            </div>
            <button type="submit" className={cn(btnCls, "sm:col-span-2 sm:w-fit xl:col-span-3")}>
              {t("add")}
            </button>
          </form>
        </details>
      )}

      {payments.length === 0 ? (
        <Card>
          <EmptyState text={t("noResults")} />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {payments.map((payment) => {
              const isOverdue =
                payment.status !== "paid" &&
                !!payment.due_date &&
                payment.due_date < today;
              const visibleStatus = isOverdue ? "overdue" : payment.status;
              return (
                <article key={payment.id} className="rounded-card border border-border bg-surface p-4 shadow-evo">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/finance/${payment.id}`} className="font-bold text-fg hover:text-accent">
                        {payment.title}
                      </Link>
                      <p className="mt-1 text-[12.5px] font-medium text-fg-2">
                        {payment.client_name}
                      </p>
                    </div>
                    <Badge value={visibleStatus} label={t(`pay.${visibleStatus}`)} />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 rounded-nav bg-surface-2 p-3">
                    <div>
                      <div className="text-[11.5px] text-fg-3">{t("amount")}</div>
                      <div className="mt-1 font-mono text-[15px] font-bold text-fg">
                        {num(payment.amount)} {payment.currency}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11.5px] text-fg-3">{t("dueDate")}</div>
                      <div className={cn("mt-1 font-mono text-[13px] font-semibold", isOverdue ? "text-danger" : "text-fg")}>
                        {payment.due_date ?? "—"}
                      </div>
                    </div>
                  </div>
                  {canMutatePayments && payment.status !== "paid" && (
                    <form action={markPaymentPaidAction} className="mt-4">
                      <input type="hidden" name="id" value={payment.id} />
                      <button type="submit" className={cn(btnCls, "w-full")}>{t("markPaid")}</button>
                    </form>
                  )}
                </article>
              );
            })}
          </div>

          <Card bodyClassName="px-0 py-0" className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-[13px]">
                <thead className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-[0.04em] text-fg-3">
                  <tr>
                    <th className="px-5 py-3 font-semibold">{t("client")}</th>
                    <th className="px-4 py-3 font-semibold">{t("payment")}</th>
                    <th className="px-4 py-3 text-right font-semibold">{t("amount")}</th>
                    <th className="px-4 py-3 font-semibold">{t("dueDate")}</th>
                    <th className="px-4 py-3 font-semibold">{t("status")}</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {payments.map((payment) => {
                    const isOverdue =
                      payment.status !== "paid" &&
                      !!payment.due_date &&
                      payment.due_date < today;
                    const visibleStatus = isOverdue ? "overdue" : payment.status;
                    return (
                      <tr key={payment.id} className="transition-[background-color] hover:bg-surface-2">
                        <td className="px-5 py-3">
                          <span className="font-semibold text-fg">
                            {payment.client_name}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Link href={`/finance/${payment.id}`} className="font-semibold text-fg hover:text-accent">
                            {payment.title}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-fg">
                          {num(payment.amount)} {payment.currency}
                        </td>
                        <td className={cn("px-4 py-3 font-mono text-[12.5px]", isOverdue ? "font-bold text-danger" : "text-fg-2")}>
                          {payment.due_date ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Badge value={visibleStatus} label={t(`pay.${visibleStatus}`)} />
                          {payment.paid_at && <div className="mt-0.5 font-mono text-[11px] text-fg-3">{payment.paid_at}</div>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {canMutatePayments && payment.status !== "paid" && (
                            <form action={markPaymentPaidAction}>
                              <input type="hidden" name="id" value={payment.id} />
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
          </Card>
        </>
      )}
    </div>
  );
}
