import { KeyFacts } from "@/components/kit/KeyFacts";
import { StatusBadge } from "@/components/kit/StatusBadge";

import { moneyMomentDay } from "../../case-money-view";
import type { ProfileDraft } from "../../types";

/**
 * Панель «Обязательства» в «Новом виде»: итог (всего, оплачено, остаток) и строки - название, сумма, срок или оплата, просрочка.
 * Данные те же, что у прежней панели (`draft.payments`, `draft.budget`); пояснение «Услуги EVO и другие расходы по делу» - за «?» панели.
 */
export function MoneyObligations({ draft, today }: Readonly<{ draft: ProfileDraft; today: string }>) {
  return (
    <div className="grid grid-cols-1 gap-3">
      <KeyFacts columns={3} facts={[
        { label: "Всего", value: draft.budget },
        { label: "Оплачено", value: draft.paid },
        { label: "Остаток", value: draft.remaining },
      ]} />
      <ul className="divide-y divide-border border-t border-border">
        {draft.payments.map((payment) => (
          <li key={payment.name} className="flex min-h-11 flex-wrap items-center gap-x-4 py-1.5">
            <span className="min-w-0 flex-1 break-words t-body-compact text-fg">{payment.name}</span>
            <span className="t-body-compact tabular-nums text-fg">{payment.amount}</span>
            <span className="t-meta text-fg-2">
              {payment.at ? <>{payment.state === "paid" ? "оплачен" : "до"}{" "}
                <time dateTime={payment.at} className="font-mono tabular-nums">{moneyMomentDay(payment.at, today)}</time></>
                : payment.state === "paid" ? "оплачен" : null}
            </span>
            {payment.state === "overdue" ? <StatusBadge label="просрочен" tone="danger" /> : null}
          </li>
        ))}
        {draft.payments.length === 0 ? <li className="py-2.5 t-body-compact text-fg-3">Обязательств пока нет.</li> : null}
      </ul>
    </div>
  );
}
