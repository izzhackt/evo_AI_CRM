"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";

import { StatusBadge } from "@/components/kit/StatusBadge";
import { fieldLabelCls, inputCls } from "@/components/ui";
import { acceptStudentReceiptAction, rejectStudentReceiptAction } from "@/lib/platform-student-receipts-actions";
import { financeMoney } from "@/lib/platform-case-agreement-contract";
import type { StudentReceipt, StudentReceiptActionState } from "@/lib/platform-student-receipts-contract";

import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "../queue/queue-buttons";
import { moneyDay } from "./case-money-view";

const MESSAGES: Record<StudentReceiptActionState["status"], string> = {
  idle: "",
  saved: "Готово.",
  invalid: "Проверьте платёж, сумму и дату.",
  forbidden: "Нет доступа к этому действию.",
  not_pending: "Чек уже разобран другим сотрудником. Обновите страницу.",
  obligation_required: "Выберите платёж, на который засчитать оплату.",
  request_conflict: "Этот запрос уже использован. Обновите страницу и проверьте результат.",
  unavailable: "Результат неизвестен. Нажмите ещё раз: повтор безопасен.",
};

function minorToInput(minor: string): string {
  const value = BigInt(minor);
  const whole = value / BigInt(100);
  const fraction = value % BigInt(100);
  return fraction === BigInt(0) ? whole.toString() : `${whole}.${fraction.toString().padStart(2, "0")}`;
}

/** «Принять»: сотрудник подтверждает или поправляет платёж, сумму и дату; оплата создаётся командой оплаты дела, итоги пересчитываются. */
function AcceptForm({ receipt, onDone }: Readonly<{ receipt: StudentReceipt; onDone: () => void }>) {
  const router = useRouter();
  const [requestId] = useState(() => crypto.randomUUID());
  const initialDue = receipt.dues.find((due) => due.id === receipt.paymentObligationId)
    ?? receipt.dues.find((due) => due.currency === receipt.currency) ?? receipt.dues[0] ?? null;
  const [dueId, setDueId] = useState(initialDue?.id ?? "");
  const due = receipt.dues.find((item) => item.id === dueId) ?? null;
  const [state, action, pending] = useActionState(
    async (previous: StudentReceiptActionState, form: FormData): Promise<StudentReceiptActionState> => {
      try {
        const result = await acceptStudentReceiptAction(previous, form);
        if (result.status === "saved") {
          router.refresh();
          onDone();
        }
        return result;
      } catch {
        return { ...previous, status: "unavailable" };
      }
    },
    { status: "idle", requestId, message: null } as StudentReceiptActionState,
  );
  if (receipt.dues.length === 0) {
    return <p role="status" className="t-body-compact text-fg-2">Чтобы принять чек, добавьте платёж в карточке дела: оплата засчитывается на платёж.</p>;
  }
  const locked = pending || state.status === "saved";
  return (
    <form action={action} className="grid max-w-xl gap-3 pt-2" data-testid="student-receipt-accept">
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="receipt_id" value={receipt.id} />
      <input type="hidden" name="currency" value={due?.currency ?? receipt.currency} />
      <fieldset disabled={locked} className="grid gap-3">
        <label className="block">
          <span className={fieldLabelCls}>Платёж</span>
          <select name="payment_obligation_id" required value={dueId} onChange={(event) => setDueId(event.target.value)} className={inputCls}>
            {receipt.dues.map((item) => (
              <option key={item.id} value={item.id}>{item.label} · осталось {financeMoney(item.outstandingMinor, item.currency)}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <label className="block">
            <span className={fieldLabelCls}>Сумма{due ? ` (${due.currency})` : ""}</span>
            <input name="amount" required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" defaultValue={minorToInput(receipt.amountMinor)} className={inputCls} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Дата оплаты</span>
            <input name="at" type="date" required defaultValue={receipt.paidOn} className={inputCls} />
          </label>
        </div>
        {due && due.currency !== receipt.currency ? (
          <p className="t-meta text-fg-2">Студент указал {financeMoney(receipt.amountMinor, receipt.currency)}; платёж в {due.currency}: введите сумму в {due.currency}.</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button className={QUEUE_CONFIRM} disabled={locked}>{pending ? "Принимаем…" : "Принять оплату"}</button>
          <button type="button" className={QUEUE_SECONDARY} disabled={locked} onClick={onDone}>Отмена</button>
        </div>
      </fieldset>
      {state.status !== "idle" && state.status !== "saved" ? (
        <p role="alert" className="t-body-compact text-danger">{state.message ?? MESSAGES[state.status]}</p>
      ) : null}
    </form>
  );
}

/** «Отклонить»: причина обязательна, студент увидит её и сможет приложить чек заново. */
function RejectForm({ receipt, onDone }: Readonly<{ receipt: StudentReceipt; onDone: () => void }>) {
  const router = useRouter();
  const [requestId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(
    async (previous: StudentReceiptActionState, form: FormData): Promise<StudentReceiptActionState> => {
      try {
        const result = await rejectStudentReceiptAction(previous, form);
        if (result.status === "saved") {
          router.refresh();
          onDone();
        }
        return result;
      } catch {
        return { ...previous, status: "unavailable" };
      }
    },
    { status: "idle", requestId, message: null } as StudentReceiptActionState,
  );
  const locked = pending || state.status === "saved";
  return (
    <form action={action} className="grid max-w-xl gap-3 pt-2" data-testid="student-receipt-reject">
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="receipt_id" value={receipt.id} />
      <fieldset disabled={locked} className="grid gap-3">
        <label className="block">
          <span className={fieldLabelCls}>Причина (её увидит студент)</span>
          <textarea name="reason" required maxLength={1000} rows={3} className={`${inputCls} h-auto py-2`} placeholder="Например: не видно сумму, приложите чек ещё раз" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button className={QUEUE_SECONDARY} disabled={locked}>{pending ? "Отклоняем…" : "Отклонить чек"}</button>
          <button type="button" className={QUEUE_SECONDARY} disabled={locked} onClick={onDone}>Отмена</button>
        </div>
      </fieldset>
      {state.status !== "idle" && state.status !== "saved" ? (
        <p role="alert" className="t-body-compact text-danger">{state.message ?? MESSAGES[state.status]}</p>
      ) : null}
    </form>
  );
}

function Row({ receipt, showStudent, today }: Readonly<{ receipt: StudentReceipt; showStudent: boolean; today: string }>) {
  const [mode, setMode] = useState<"none" | "accept" | "reject">("none");
  return (
    <li className="flex min-w-0 flex-col gap-1 py-3" data-testid="student-receipt-row" data-receipt-id={receipt.id}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
        {showStudent ? (
          <Link href={`/profile?case=${receipt.studentCaseId}&tab=money#case-receipts`} className="min-w-0 break-words t-body-compact text-fg underline-offset-4 hover:underline">
            {receipt.studentDisplayName}
          </Link>
        ) : null}
        <span className="t-body-compact font-medium tabular-nums text-fg">{financeMoney(receipt.amountMinor, receipt.currency)}</span>
        <time dateTime={receipt.paidOn} className="font-mono t-meta tabular-nums text-fg-2">{moneyDay(receipt.paidOn, today)}</time>
        <StatusBadge label="на проверке" tone="info" />
      </div>
      <p className="min-w-0 break-words t-meta text-fg-2">
        {receipt.paymentLabel ? `К платежу: ${receipt.paymentLabel}` : "Платёж не указан: его выберет сотрудник при приёме"}
        {" · "}
        <a className="underline underline-offset-4 hover:text-fg" href={`/api/v2/student-payment-receipts/${receipt.id}/download`}>
          Открыть чек
        </a>
        {" · "}{receipt.originalFilename}
      </p>
      {receipt.canReview ? (
        mode === "accept" ? <AcceptForm receipt={receipt} onDone={() => setMode("none")} />
          : mode === "reject" ? <RejectForm receipt={receipt} onDone={() => setMode("none")} />
            : (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button type="button" className={QUEUE_CONFIRM} onClick={() => setMode("accept")}>Принять</button>
                <button type="button" className={QUEUE_SECONDARY} onClick={() => setMode("reject")}>Отклонить</button>
              </div>
            )
      ) : <p className="t-meta text-fg-3">Решение принимает куратор или администратор.</p>}
    </li>
  );
}

/**
 * «Чеки на проверке»: чек от студента ещё не деньги. Сотрудник открывает файл, принимает (сумма, дата и платёж подтверждаются или
 * поправляются) либо отклоняет с причиной. Принятие создаёт оплату, итоги «Оплачено/Осталось» пересчитываются.
 */
export function StudentReceiptsReview({ receipts, showStudent, today, emptyText }: Readonly<{
  receipts: readonly StudentReceipt[];
  showStudent: boolean;
  today: string;
  emptyText?: string;
}>) {
  if (receipts.length === 0) return emptyText ? <p className="py-2.5 t-body-compact text-fg-3">{emptyText}</p> : null;
  return (
    <ul className="divide-y divide-border border-t border-border" data-testid="student-receipts">
      {receipts.map((receipt) => <Row key={receipt.id} receipt={receipt} showStudent={showStudent} today={today} />)}
    </ul>
  );
}
