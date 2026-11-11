import { StatusBadge } from "@/components/kit/StatusBadge";
import type { CaseAgreement, CaseAgreementPayment, CaseAgreementTranche } from "@/lib/platform-case-agreement-contract";
import type { PendingReceipt } from "@/lib/platform-pending-receipts-contract";
import { caseMoneyWords } from "@/lib/v3/wording";

import { CaseAgreementPaymentForm, CaseAgreementTrancheEditor } from "../../CaseAgreementForms";
import { CasePaymentReceiptUpload } from "../../CasePaymentReceiptUpload";
import { CASE_MONEY_ROW_ACTION, casePaymentsBySchedule, caseScheduleAgainstCost, caseTrancheState, moneyAmount, moneyDay } from "../../case-money-view";
import { PendingReceiptsCard } from "../../PendingReceiptsCard";
import { NamedCard } from "../NamedCard";

type Props = Readonly<{ agreement: CaseAgreement; canWrite: boolean; today: string; pendingReceipts?: readonly PendingReceipt[] }>;

/**
 * «График платежей» (10.11.2026, вместо двух карточек «Платежи» и «Оплаты и чеки»): платёж - сумма, срок и состояние словом,
 * под ним его оплаты с чеком. Одни 600 USD больше не повторяются в двух списках, а у каждой оплаты сразу видно, есть ли чек:
 * так проще вести отчёт. Формы - прежние (`CaseAgreementTrancheEditor`, `CaseAgreementPaymentForm`), только подписи.
 */
export function ScheduleCard({ agreement, canWrite, today, pendingReceipts = [] }: Props) {
  const caseId = agreement.studentCaseId;
  const against = caseScheduleAgainstCost(agreement);
  const { byTranche, other } = casePaymentsBySchedule(agreement);
  return (
    <NamedCard
      title={caseMoneyWords.schedule.title}
      testId="v3-case-agreement-tranches"
      className="@container"
      actions={against ? <span className="t-meta text-fg-2">{against}</span> : null}
    >
      <ul className="divide-y divide-border border-t border-border">
        {agreement.tranches.map((tranche) => (
          <ScheduleRow key={tranche.id} tranche={tranche} payments={byTranche.get(tranche.id) ?? []} caseId={caseId} canWrite={canWrite} today={today} />
        ))}
        {agreement.tranches.length === 0 ? (
          <li className="py-2.5 t-body-compact text-fg-3">{caseMoneyWords.schedule.empty}</li>
        ) : null}
      </ul>
      {other.length > 0 ? (
        <div className="border-t border-border pt-2">
          <p className="t-caption text-fg-3">{caseMoneyWords.schedule.archivedPayments}</p>
          <PaymentLines payments={other} caseId={caseId} canWrite={canWrite} today={today} />
        </div>
      ) : null}
      <div className="grid gap-1" data-testid="v3-case-agreement-payment">
        <PendingReceiptsCard receipts={pendingReceipts} payments={agreement.payments} canWrite={canWrite} today={today} />
        {canWrite && agreement.tranches.length > 0 ? <CaseAgreementPaymentForm studentCaseId={caseId} tranches={agreement.tranches} /> : null}
        {canWrite ? <CaseAgreementTrancheEditor studentCaseId={caseId} tranche={null} canArchive={false} addLabel="Добавить платёж" /> : null}
      </div>
    </NamedCard>
  );
}

/** Строка графика: название и срок, сумма, состояние словом, «Изменить»; под ней - оплаты этого платежа. */
function ScheduleRow({ tranche, payments, caseId, canWrite, today }: Readonly<{
  tranche: CaseAgreementTranche;
  payments: readonly CaseAgreementPayment[];
  caseId: string;
  canWrite: boolean;
  today: string;
}>) {
  const state = caseTrancheState(tranche, today);
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 @4xl:grid @4xl:grid-cols-[minmax(0,1fr)_8rem_minmax(0,12rem)_auto]">
        <div className="min-w-0 flex-1 basis-40">
          <p className="break-words t-body-compact font-medium text-fg">{tranche.label}</p>
          {tranche.dueOn ? (
            <p className="t-meta text-fg-2">до <time dateTime={tranche.dueOn} className="tabular-nums">{moneyDay(tranche.dueOn, today)}</time></p>
          ) : null}
        </div>
        <span className="t-body-compact tabular-nums text-fg @4xl:text-end">{moneyAmount(tranche.amountMinor, tranche.currency)}</span>
        <span className="flex min-h-11 flex-wrap items-center gap-x-2">
          {state === "paid" ? <StatusBadge label="оплачен" tone="ok" /> : (
            <span className="t-meta tabular-nums text-fg-2">осталось {moneyAmount(tranche.outstandingMinor, tranche.currency)}</span>
          )}
          {state === "overdue" ? <StatusBadge label="просрочен" tone="danger" /> : null}
        </span>
        {canWrite ? <CaseAgreementTrancheEditor studentCaseId={caseId} tranche={tranche} canArchive={tranche.totalPaidMinor === "0"} /> : <span />}
      </div>
      {payments.length > 0 ? <PaymentLines payments={payments} caseId={caseId} canWrite={canWrite} today={today} nested /> : null}
    </li>
  );
}

/** Оплаты: день, сумма (возврат - со знаком и словом), кто записал и чек: «Чек» скачать, «чека нет» и «Загрузить чек». */
function PaymentLines({ payments, caseId, canWrite, today, nested = false }: Readonly<{
  payments: readonly CaseAgreementPayment[];
  caseId: string;
  canWrite: boolean;
  today: string;
  nested?: boolean;
}>) {
  return (
    <ul className={nested ? "mt-1 grid border-s-2 border-border ps-3" : "grid"}>
      {payments.map((payment) => (
        <li key={payment.id} className="flex min-h-11 flex-wrap items-center gap-x-3 t-meta text-fg-2">
          <time dateTime={payment.occurredOn} className="tabular-nums">{moneyDay(payment.occurredOn, today)}</time>
          <span className="t-body-compact tabular-nums text-fg">
            {payment.eventType === "refund" ? "−" : ""}{moneyAmount(payment.amountMinor, payment.currency)}
          </span>
          {payment.eventType === "refund" ? <StatusBadge label="возврат" tone="warn" /> : null}
          {payment.actorDisplayName ? <span className="min-w-0 break-words">{payment.actorDisplayName}</span> : null}
          <span className="ms-auto flex items-center justify-end gap-x-3">
            {payment.receipts.map((receipt) => (
              <a key={receipt.id} className={CASE_MONEY_ROW_ACTION} href={`/api/v2/payment-receipt-files/${caseId}/${receipt.id}/download`}>Чек</a>
            ))}
            {payment.eventType === "payment" && payment.receipts.length === 0 ? (
              <>
                <span>{caseMoneyWords.schedule.noReceipt}</span>
                {canWrite ? <CasePaymentReceiptUpload paymentEventId={payment.id} /> : null}
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
