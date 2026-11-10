"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import {
  PAYMENT_RECEIPT_MAX_BYTES,
  PAYMENT_RECEIPT_MIME_TYPES,
  PAYMENT_RECEIPT_UPLOAD_PATH,
  minorToReceiptInput,
  paymentReceiptErrorKey,
  receiptAmountToMinor,
} from "@/lib/portal/payment-center";
import type { PortalStrings } from "@/lib/portal/i18n";

type Strings = PortalStrings<"admission">;

export type ReceiptFormDue = Readonly<{ obligationId: string; label: string; currency: string; outstandingMinor: number }>;

const subscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

function bishkekToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bishkek" });
}

/**
 * «Приложить чек» (миграция 358): раскрывающаяся форма на месте, без окна. Либо к одному платежу (`fixedDue`), либо без платежа
 * (`dues` - подсказка, к какому платежу, необязательно). Файл уходит одним запросом; ключ повтора живёт, пока попытка не
 * завершится, поэтому повтор после обрыва сети не создаёт второй чек.
 */
export function PaymentReceiptForm({
  strings,
  label,
  fixedDue,
  dues,
}: Readonly<{ strings: Strings; label: string; fixedDue?: ReceiptFormDue; dues?: readonly ReceiptFormDue[] }>) {
  const hydrated = useSyncExternalStore(subscribe, onClient, onServer);
  const router = useRouter();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attemptKey = useRef<string | null>(null);
  const [dueId, setDueId] = useState(fixedDue?.obligationId ?? "");
  const chosen = fixedDue ?? dues?.find((item) => item.obligationId === dueId) ?? null;
  const [amount, setAmount] = useState(fixedDue && fixedDue.outstandingMinor > 0 ? minorToReceiptInput(fixedDue.outstandingMinor) : "");
  const [currency, setCurrency] = useState(fixedDue?.currency ?? dues?.[0]?.currency ?? "KGS");
  const [paidOn, setPaidOn] = useState(bishkekToday);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorKey, setErrorKey] = useState<string>("receiptErrorUnavailable");
  const text = strings as Readonly<Record<string, string>>;

  function pickDue(value: string) {
    setDueId(value);
    const next = dues?.find((item) => item.obligationId === value);
    if (next) {
      setCurrency(next.currency);
      if (next.outstandingMinor > 0) setAmount(minorToReceiptInput(next.outstandingMinor));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hydrated || state === "sending") return;
    const file = fileRef.current?.files?.[0];
    const minor = receiptAmountToMinor(amount);
    const cur = (chosen?.currency ?? currency).trim().toUpperCase();
    if (!file || !minor || !/^[A-Z]{3}$/.test(cur) || !paidOn || !(PAYMENT_RECEIPT_MIME_TYPES as readonly string[]).includes(file.type)
      || file.size < 1 || file.size > PAYMENT_RECEIPT_MAX_BYTES) {
      setErrorKey(file && file.size > PAYMENT_RECEIPT_MAX_BYTES ? "receiptErrorTooLarge" : file && !(PAYMENT_RECEIPT_MIME_TYPES as readonly string[]).includes(file.type) ? "receiptErrorFileType" : "receiptErrorInvalid");
      setState("error");
      return;
    }
    attemptKey.current ??= crypto.randomUUID();
    setState("sending");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("amount", amount);
      body.set("currency", cur);
      body.set("paid_on", paidOn);
      if (chosen) body.set("payment_obligation_id", chosen.obligationId);
      const response = await fetch(PAYMENT_RECEIPT_UPLOAD_PATH, { method: "POST", body, headers: { "Idempotency-Key": attemptKey.current } });
      if (response.status === 201 || response.status === 200) {
        attemptKey.current = null;
        setState("sent");
        router.refresh();
        return;
      }
      const result: unknown = await response.json().catch(() => null);
      const code = result && typeof result === "object" && "error" in result ? (result as { error: unknown }).error : null;
      // Отказ сервера по существу (не сеть, не 5xx) - новая попытка получит новый ключ.
      if (response.status < 500) attemptKey.current = null;
      setErrorKey(paymentReceiptErrorKey(code));
      setState("error");
    } catch {
      setErrorKey("receiptErrorUnavailable");
      setState("error");
    }
  }

  if (state === "sent") {
    return <p role="status" className="pt-receipt-sent">{strings.receiptSent}</p>;
  }
  const locked = !hydrated || state === "sending";
  return (
    <details ref={detailsRef} className="pt-receipt-form">
      <summary className="pt-link pt-receipt-summary">{label}</summary>
      <form onSubmit={submit} className="pt-receipt-fields" aria-busy={locked}>
        <p className="pt-profile-note">{strings.receiptDialogLead}</p>
        {!fixedDue && dues && dues.length > 0 ? (
          <label className="pt-field">
            <span className="pt-field-label">{strings.receiptFieldPayment}</span>
            <select className="pt-input" value={dueId} onChange={(event) => pickDue(event.target.value)} disabled={locked}>
              <option value="">{strings.receiptFieldPaymentNone}</option>
              {dues.map((item) => (
                <option key={item.obligationId} value={item.obligationId}>{item.label} · {item.currency}</option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="pt-receipt-row">
          <label className="pt-field">
            <span className="pt-field-label">{strings.receiptFieldAmount}</span>
            <input className="pt-input pt-data" inputMode="decimal" autoComplete="off" required value={amount} disabled={locked}
              onChange={(event) => setAmount(event.target.value)} placeholder="0.00" />
          </label>
          <label className="pt-field">
            <span className="pt-field-label">{strings.receiptFieldCurrency}</span>
            <input className="pt-input pt-data" maxLength={3} required value={chosen?.currency ?? currency} disabled={locked || chosen !== null}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
          </label>
          <label className="pt-field">
            <span className="pt-field-label">{strings.receiptFieldDate}</span>
            <input className="pt-input pt-data" type="date" required value={paidOn} max={bishkekToday()} disabled={locked}
              onChange={(event) => setPaidOn(event.target.value)} />
          </label>
        </div>
        <label className="pt-field">
          <span className="pt-field-label">{strings.receiptFieldFile}</span>
          <input ref={fileRef} className="pt-input pt-receipt-file" type="file" accept="image/jpeg,image/png,application/pdf" required disabled={locked} />
          <span className="pt-profile-note">{strings.receiptFieldFileHint}</span>
        </label>
        <div className="pt-password-actions">
          <button type="submit" className="pt-btn" disabled={locked}>{state === "sending" ? strings.receiptSubmitting : strings.receiptSubmit}</button>
          <button type="button" className="pt-btn-ghost" disabled={locked} onClick={() => { if (detailsRef.current) detailsRef.current.open = false; setState("idle"); }}>
            {strings.receiptCancel}
          </button>
        </div>
        {state === "error" ? <p role="alert" className="pt-receipt-error">{text[errorKey] ?? strings.receiptErrorUnavailable}</p> : null}
      </form>
    </details>
  );
}
