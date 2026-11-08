"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { QUEUE_SECONDARY } from "@/components/staff/queue/queue-buttons";
import { financeMoney, type CaseAgreement } from "@/lib/platform-case-agreement-contract";
import { allocatePendingReceiptAction } from "@/lib/platform-pending-receipt-actions";
import type { PendingReceipt } from "@/lib/platform-pending-receipts-contract";

import { moneyDay } from "./case-money-view";

const OUTCOME_TEXT: Record<"invalid" | "forbidden" | "already_allocated" | "unavailable", string> = {
  invalid: "Не удалось привязать чек. Обновите страницу и повторите.",
  forbidden: "Недостаточно прав, чтобы привязать чек к оплате.",
  already_allocated: "Этот чек уже привязан к другой оплате. Обновите страницу.",
  unavailable: "Сервер не ответил. Повторите попытку.",
};

function Row({ receipt, payments, canWrite, today }: Readonly<{ receipt: PendingReceipt; payments: CaseAgreement["payments"]; canWrite: boolean; today: string }>) {
  const router = useRouter();
  const [eventId, setEventId] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const options = payments.filter((payment) => payment.eventType === "payment");

  async function attach() {
    if (pending || !eventId) return;
    setPending(true); setMessage(null);
    const form = new FormData();
    form.set("pending_receipt_id", receipt.id); form.set("payment_event_id", eventId);
    try {
      const result = await allocatePendingReceiptAction(form);
      if (result.outcome === "saved") { router.refresh(); return; }
      setMessage(OUTCOME_TEXT[result.outcome]);
    } catch { setMessage(OUTCOME_TEXT.unavailable); }
    finally { setPending(false); }
  }

  return (
    <li className="flex min-w-0 flex-col gap-2 py-2" data-testid="pending-receipt-row">
      <span className="min-w-0 break-words t-body-compact text-fg">{receipt.originalFilename}</span>
      {canWrite ? (
        options.length > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`pending-receipt-${receipt.id}`}>Оплата</label>
            <select id={`pending-receipt-${receipt.id}`} className="h-11 min-w-0 flex-1 basis-56 rounded-ctl border border-control-edge bg-surface px-3 t-body text-fg"
              value={eventId} disabled={pending} onChange={(event) => setEventId(event.target.value)} data-testid="pending-receipt-pick">
              <option value="">К какой оплате…</option>
              {options.map((payment) => (
                <option key={payment.id} value={payment.id}>{moneyDay(payment.occurredOn, today)} · {financeMoney(payment.amountMinor, payment.currency)}</option>
              ))}
            </select>
            <button type="button" className={QUEUE_SECONDARY} disabled={pending || !eventId} onClick={() => void attach()} data-testid="pending-receipt-attach">
              {pending ? "Привязываем…" : "Привязать к оплате"}
            </button>
          </div>
        ) : <p className="t-meta text-fg-2">Сначала внесите оплату ниже: чек привяжется к ней.</p>
      ) : null}
      <p className="t-meta text-danger" role="status" aria-live="polite">{message}</p>
    </li>
  );
}

/** «Чеки ждут оплату»: принятые в разборе документов чеки без оплаты. Суммы не выдумываются: оплату вносят ниже, потом чек привязывают к ней. */
export function PendingReceiptsCard({ receipts, payments, canWrite, today }: Readonly<{ receipts: readonly PendingReceipt[]; payments: CaseAgreement["payments"]; canWrite: boolean; today: string }>) {
  if (receipts.length === 0) return null;
  return (
    <div className="border-t border-border pt-3" data-testid="pending-receipts">
      <h3 className="t-section text-fg">Чеки ждут оплату · {receipts.length}</h3>
      <p className="t-body-compact text-fg-2">Приняты в «Документах» как чек об оплате. Сумму из файла система не читает: привяжите чек к внесённой оплате.</p>
      <ul className="divide-y divide-border">
        {receipts.map((receipt) => <Row key={receipt.id} receipt={receipt} payments={payments} canWrite={canWrite} today={today} />)}
      </ul>
    </div>
  );
}
