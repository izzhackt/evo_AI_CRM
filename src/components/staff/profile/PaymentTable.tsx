"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/icons";
import { StatusBadge } from "@/components/kit/StatusBadge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { saveCaseTrancheAction } from "@/lib/platform-case-agreement-actions";
import type { CaseAgreementState, CaseAgreementTranche } from "@/lib/platform-case-agreement-contract";
import { caseMoneyWords } from "@/lib/v3/wording";

import { CaseAgreementTrancheEditor } from "./CaseAgreementForms";
import { CasePaymentReceiptUpload } from "./CasePaymentReceiptUpload";
import { CASE_MONEY_ROW_ACTION, casePaymentLines, moneyAmount, moneyDay, type CaseMoneyLine, type CaseMoneyPlanLine } from "./case-money-view";
import { usePaymentDesk } from "./PaymentDesk";
import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "../queue/queue-buttons";

const words = caseMoneyWords.pay;

function minorToAmount(minor: string): string {
  const value = BigInt(minor);
  const whole = value / BigInt(100);
  const fraction = value % BigInt(100);
  return fraction === BigInt(0) ? whole.toString() : `${whole}.${fraction.toString().padStart(2, "0")}`;
}
const TONE = { paid: "ok", expected: "neutral", overdue: "danger", refund: "warn" } as const;

/** Дата, сумма, статус и чек — оплаты и ещё открытые платежи графика в одном списке. */
export function PaymentTable() {
  const desk = usePaymentDesk();
  const { lines, archived } = casePaymentLines(desk.agreement, desk.today);
  const several = desk.agreement.tranches.length > 1;
  return (
    <div data-testid="v3-case-agreement-tranches">
      <p className="sr-only">{words.columns.date}, {words.columns.amount}, {words.columns.status}, {words.columns.receipt}</p>
      <div className="hidden grid-cols-[4.5rem_minmax(0,11rem)_8.5rem_minmax(0,1fr)_2.75rem] gap-3 pb-1 t-caption text-fg-3 @3xl:grid" aria-hidden="true">
        <span>{words.columns.date}</span>
        <span>{words.columns.amount}</span>
        <span>{words.columns.status}</span>
        <span>{words.columns.receipt}</span>
        <span />
      </div>
      <ul className="border-t border-border">
        {lines.map((line) => (
          <PaymentRow key={`${line.kind}:${line.id}`} line={line} several={several} />
        ))}
        {lines.length === 0 ? <li className="py-2.5 t-body-compact text-fg-3">{caseMoneyWords.schedule.empty}</li> : null}
      </ul>
      {archived.length > 0 ? (
        <div className="border-t border-border pt-2">
          <p className="t-caption text-fg-3">{caseMoneyWords.schedule.archivedPayments}</p>
          <ul>
            {archived.map((payment) => (
              <li key={payment.id} className="flex min-h-11 flex-wrap items-center gap-x-3 t-meta text-fg-2">
                <time dateTime={payment.occurredOn} className="tabular-nums">{moneyDay(payment.occurredOn, desk.today)}</time>
                <span className="t-body-compact tabular-nums text-fg">{payment.eventType === "refund" ? "−" : ""}{moneyAmount(payment.amountMinor, payment.currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function PaymentRow({ line, several }: Readonly<{ line: CaseMoneyLine; several: boolean }>) {
  const desk = usePaymentDesk();
  // «⋯»: у ещё не оплаченного платежа - своя строка, у закрытого - первая из его оплат (название и срок можно править и после оплаты).
  const menu = desk.canWrite && (line.kind === "plan" || line.canEdit);
  return (
    <li className="border-t border-border py-2 first:border-t-0">
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_2.75rem] items-start gap-x-3 gap-y-1 @3xl:grid-cols-[4.5rem_minmax(0,11rem)_8.5rem_minmax(0,1fr)_2.75rem] @3xl:items-center">
        <time dateTime={line.date ?? undefined} className="pt-0.5 font-mono t-meta tabular-nums text-fg @3xl:pt-0">
          {line.date ? moneyDay(line.date, desk.today) : "—"}
        </time>
        <div className="min-w-0">
          <p className="t-body-compact font-semibold tabular-nums text-fg">
            {line.kind === "payment" && line.status === "refund" ? "−" : ""}{line.amountLabel}
          </p>
          {line.kind === "payment" && line.who ? <p className="t-meta text-fg-3">{line.who}</p> : null}
          {line.kind === "plan" || (line.kind === "payment" && several) ? (
            <p className="break-words t-meta text-fg-3">{line.kind === "plan" ? line.tranche.label : line.trancheLabel}</p>
          ) : null}
        </div>
        <div className="col-start-3 row-start-1 justify-self-end @3xl:col-start-5">
          {menu ? <RowMenu line={line} /> : null}
        </div>
        <div className="col-span-2 col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 @3xl:contents">
          <span className="@3xl:col-start-3 @3xl:row-start-1"><StatusBadge label={words.status[line.status]} tone={TONE[line.status]} /></span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 @3xl:col-start-4 @3xl:row-start-1">{line.kind === "payment" ? <Receipts line={line} /> : <PlanAction line={line} />}</span>
        </div>
      </div>
      {menu && desk.editingId === line.tranche.id ? (
        <CaseAgreementTrancheEditor studentCaseId={desk.agreement.studentCaseId} tranche={line.tranche} canArchive={line.kind === "plan" && line.canArchive} embedded onClose={() => desk.edit(null)} />
      ) : null}
      {line.kind === "plan" && desk.archivingId === line.id ? <ArchiveConfirm tranche={line.tranche} onClose={() => desk.archive(null)} /> : null}
    </li>
  );
}

function Receipts({ line }: Readonly<{ line: Extract<CaseMoneyLine, { kind: "payment" }> }>) {
  const desk = usePaymentDesk();
  const payment = line.payment;
  return (
    <>
      {payment.receipts.map((receipt) => (
        <a key={receipt.id} className={CASE_MONEY_ROW_ACTION} href={`/api/v2/payment-receipt-files/${desk.agreement.studentCaseId}/${receipt.id}/download`}>
          {receipt.originalFilename}
        </a>
      ))}
      {payment.eventType === "payment" && payment.receipts.length === 0 ? (
        <>
          <span className="t-meta text-fg-3">{caseMoneyWords.schedule.noReceipt}</span>
          {desk.canWrite ? <CasePaymentReceiptUpload paymentEventId={payment.id} /> : null}
        </>
      ) : null}
    </>
  );
}

function PlanAction({ line }: Readonly<{ line: CaseMoneyPlanLine }>) {
  const desk = usePaymentDesk();
  if (!desk.canWrite || line.status === "paid" || BigInt(line.tranche.outstandingMinor) <= BigInt(0)) return null;
  return (
    <button type="button" className={CASE_MONEY_ROW_ACTION} onClick={() => desk.openForm({ mode: "paid", obligationId: line.tranche.id })}>
      {words.markPaid}
    </button>
  );
}

/** «⋯» платежа графика: меню Radix (Esc и щелчок мимо закрывают, открыто одно). У закрытого платежа в нём одно «Изменить название и срок». */
function RowMenu({ line }: Readonly<{ line: CaseMoneyLine }>) {
  const desk = usePaymentDesk();
  const plan = line.kind === "plan";
  const canPay = plan && line.status !== "paid" && BigInt(line.tranche.outstandingMinor) > BigInt(0);
  const trigger = useRef<HTMLButtonElement>(null);
  // Пункт, который открывает форму или правку, отдаёт ей фокус, когда меню закроется: Radix иначе вернул бы его на «⋯»,
  // а раньше (пока меню открыто) ловушка фокуса меню забрала бы его назад.
  const focusAfter = useRef<"form" | "editor" | null>(null);
  const handOverFocus = (event: Event) => {
    const kind = focusAfter.current;
    focusAfter.current = null;
    if (!kind) return;
    event.preventDefault();
    const scope = kind === "form" ? trigger.current?.closest("[data-testid=v3-case-agreement]") : trigger.current?.closest("li");
    scope?.querySelector<HTMLElement>(kind === "form" ? "[data-testid=v3-case-agreement-payment] input[name=amount]" : "form input[name=label]")?.focus();
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={trigger} variant="ghost" size="icon" aria-label={`${words.rowActions}: ${line.tranche.label}`}><Icon name="more-horizontal" size={20} /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60" onCloseAutoFocus={handOverFocus}>
        {canPay ? <DropdownMenuItem onSelect={() => { focusAfter.current = "form"; desk.openForm({ mode: "paid", obligationId: line.tranche.id }); }}>{words.markPaidMenu}</DropdownMenuItem> : null}
        <DropdownMenuItem onSelect={() => { focusAfter.current = "editor"; desk.edit(line.tranche.id); }}>{plan ? words.edit : words.editPaid}</DropdownMenuItem>
        {plan && line.canArchive ? <DropdownMenuItem onSelect={() => desk.archive(line.tranche.id)}>{words.remove}</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ArchiveConfirm({ tranche, onClose }: Readonly<{ tranche: CaseAgreementTranche; onClose: () => void }>) {
  const desk = usePaymentDesk();
  const router = useRouter();
  const [requestId] = useState(() => crypto.randomUUID());
  const amount = minorToAmount(tranche.amountMinor);
  const [state, action, pending] = useActionState(async (previous: CaseAgreementState, form: FormData): Promise<CaseAgreementState> => {
    try {
      const result = await saveCaseTrancheAction(previous, form);
      if (result.status === "saved") router.refresh();
      return result;
    } catch {
      return { ...previous, status: "unavailable" };
    }
  }, { status: "idle", requestId, resourceId: null } as CaseAgreementState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 py-2">
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="student_case_id" value={desk.agreement.studentCaseId} />
      <input type="hidden" name="payment_obligation_id" value={tranche.id} />
      <input type="hidden" name="amount" value={amount} />
      <input type="hidden" name="currency" value={tranche.currency} />
      <input type="hidden" name="due_on" value={tranche.dueOn ?? ""} />
      <input type="hidden" name="label" value={tranche.label} />
      <input type="hidden" name="archive" value="true" />
      <p className="t-body-compact text-fg">{words.removeConfirm}</p>
      <button className={QUEUE_CONFIRM} disabled={pending}>{pending ? words.saving : words.remove}</button>
      <button type="button" className={QUEUE_SECONDARY} onClick={onClose}>{words.cancel}</button>
      {state.status !== "idle" && state.status !== "saved" ? <p role="alert" className="t-body-compact text-danger">Не удалось убрать платёж. Обновите страницу и повторите.</p> : null}
    </form>
  );
}
