import { StatusBadge } from "@/components/kit/StatusBadge";
import { financeMoney, type CaseAgreement } from "@/lib/platform-case-agreement-contract";

import { CaseAgreementPaymentForm, CaseAgreementTrancheEditor } from "../../CaseAgreementForms";
import { CasePaymentReceiptUpload } from "../../CasePaymentReceiptUpload";
import { CASE_MONEY_ROW_ACTION, caseMoneySummary, caseTrancheState, moneyDay } from "../../case-money-view";
import { NamedCard } from "../NamedCard";

// Строки траншей и оплат: на узкой карточке - перенос по словам, от 56rem карточки - колонки, суммы по правому краю своей колонки.
// У оплаты на узкой карточке «Транш · кто» - своей строкой под датой и суммой, чек - справа на строке суммы.
const TRANCHE_ROW = "flex flex-wrap items-center gap-x-4 py-1 @4xl:grid @4xl:grid-cols-[minmax(0,1fr)_8.5rem_5.5rem_minmax(0,15rem)_5rem]";
const PAYMENT_ROW = "flex flex-wrap items-center gap-x-4 py-1 @4xl:grid @4xl:grid-cols-[4rem_8.5rem_minmax(0,1fr)_auto]";

type Props = Readonly<{ agreement: CaseAgreement; canWrite: boolean; today: string }>;

/** «Транши»: строки те же, что у прежней сводки, редактор транша - прежняя форма (`CaseAgreementTrancheEditor`). */
export function TranchesCard({ agreement, canWrite, today }: Props) {
  const caseId = agreement.studentCaseId;
  const against = caseMoneySummary(agreement).tranchesAgainstCost;
  return (
    <NamedCard
      title="Транши"
      testId="v3-case-agreement-tranches"
      className="@container"
      actions={against ? <span className="t-meta text-fg-2">{against}</span> : null}
    >
      <ul className="divide-y divide-border border-t border-border">
        {agreement.tranches.map((tranche) => {
          const state = caseTrancheState(tranche, today);
          return (
            <li key={tranche.id} className={TRANCHE_ROW}>
              <span className="flex min-h-11 min-w-0 flex-1 basis-40 items-center break-words t-body-compact text-fg">{tranche.label}</span>
              <span className="t-body-compact tabular-nums text-fg @4xl:text-end">{financeMoney(tranche.amountMinor, tranche.currency)}</span>
              <span className="t-meta text-fg-2">
                {tranche.dueOn ? <>до <time dateTime={tranche.dueOn} className="font-mono tabular-nums">{moneyDay(tranche.dueOn, today)}</time></> : null}
              </span>
              <span className="flex min-h-11 flex-wrap items-center gap-x-2">
                {state === "paid" ? <StatusBadge label="оплачен" tone="ok" /> : (
                  <span className="t-meta tabular-nums text-fg-2">осталось {financeMoney(tranche.outstandingMinor, tranche.currency)}</span>
                )}
                {state === "overdue" ? <StatusBadge label="просрочен" tone="danger" /> : null}
              </span>
              {canWrite ? <CaseAgreementTrancheEditor studentCaseId={caseId} tranche={tranche} canArchive={tranche.totalPaidMinor === "0"} /> : null}
            </li>
          );
        })}
        {agreement.tranches.length === 0 ? <li className="py-2.5 t-body-compact text-fg-3">Траншей нет.</li> : null}
      </ul>
      {canWrite ? (
        <CaseAgreementTrancheEditor studentCaseId={caseId} tranche={null} canArchive={false} addLabel={agreement.tranches.length === 0 ? "Разбить на транши" : "Добавить транш"} />
      ) : null}
    </NamedCard>
  );
}

/** «Оплаты и чеки»: оплата или возврат, транш и кто внёс, чек; форма «Внести оплату» - прежняя (`CaseAgreementPaymentForm`). */
export function PaymentsCard({ agreement, canWrite, today }: Props) {
  const caseId = agreement.studentCaseId;
  const trancheLabel = new Map(agreement.tranches.map((tranche) => [tranche.id, tranche.label]));
  return (
    <NamedCard title="Оплаты и чеки" testId="v3-case-agreement-payment" className="@container">
      <ul className="divide-y divide-border border-t border-border">
        {agreement.payments.map((payment) => (
          <li key={payment.id} className={PAYMENT_ROW}>
            <time dateTime={payment.occurredOn} className="flex min-h-11 items-center font-mono t-meta tabular-nums text-fg-2">{moneyDay(payment.occurredOn, today)}</time>
            <span className="t-body-compact tabular-nums text-fg @4xl:text-end">
              {payment.eventType === "refund" ? "−" : ""}
              {financeMoney(payment.amountMinor, payment.currency)}
            </span>
            <span className="order-last flex min-w-0 basis-full flex-wrap items-center gap-x-2 break-words pb-1 t-meta text-fg-2 @4xl:order-none @4xl:pb-0">
              {payment.eventType === "refund" ? <StatusBadge label="возврат" tone="warn" /> : null}
              {[trancheLabel.get(payment.obligationId), payment.actorDisplayName].filter(Boolean).join(" · ")}
            </span>
            <span className="ms-auto flex items-center justify-end gap-x-4">
              {payment.receipts.map((receipt) => (
                <a key={receipt.id} className={CASE_MONEY_ROW_ACTION} href={`/api/v2/payment-receipt-files/${caseId}/${receipt.id}/download`}>Чек</a>
              ))}
              {canWrite && payment.eventType === "payment" && payment.receipts.length === 0 ? <CasePaymentReceiptUpload paymentEventId={payment.id} /> : null}
            </span>
          </li>
        ))}
        {agreement.payments.length === 0 ? <li className="py-2.5 t-body-compact text-fg-3">Оплат ещё нет.</li> : null}
      </ul>
      {canWrite && agreement.tranches.length > 0 ? <CaseAgreementPaymentForm studentCaseId={caseId} tranches={agreement.tranches} /> : null}
    </NamedCard>
  );
}
