"use client";

import { FileText, Image as ImageIcon, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import type { PortalStrings } from "@/lib/portal/i18n";
import {
  PAYMENT_RECEIPT_MAX_BYTES,
  PAYMENT_RECEIPT_MIME_TYPES,
  PAYMENT_RECEIPT_UPLOAD_PATH,
  minorToReceiptInput,
  paymentReceiptErrorKey,
  receiptAmountToMinor,
} from "@/lib/portal/payment-center";

type Strings = PortalStrings<"admission">;

const MIME = PAYMENT_RECEIPT_MIME_TYPES as readonly string[];

function bishkekToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bishkek" });
}

function fileProblem(file: File): "receiptErrorTooLarge" | "receiptErrorFileType" | null {
  if (file.size > PAYMENT_RECEIPT_MAX_BYTES || file.size < 1) return "receiptErrorTooLarge";
  if (!MIME.includes(file.type)) return "receiptErrorFileType";
  return null;
}

async function postReceipt(body: FormData, attemptKey: { current: string | null }): Promise<{ ok: true } | { ok: false; errorKey: string }> {
  attemptKey.current ??= crypto.randomUUID();
  try {
    const response = await fetch(PAYMENT_RECEIPT_UPLOAD_PATH, {
      method: "POST",
      body,
      headers: { "Idempotency-Key": attemptKey.current },
    });
    if (response.status === 201 || response.status === 200) {
      attemptKey.current = null;
      return { ok: true };
    }
    const result: unknown = await response.json().catch(() => null);
    const code = result && typeof result === "object" && "error" in result ? (result as { error: unknown }).error : null;
    if (response.status < 500) attemptKey.current = null;
    return { ok: false, errorKey: paymentReceiptErrorKey(code) };
  } catch {
    return { ok: false, errorKey: "receiptErrorUnavailable" };
  }
}

function ErrorLine({ strings, errorKey }: Readonly<{ strings: Strings; errorKey: string | null }>) {
  if (!errorKey) return null;
  const text = strings as Readonly<Record<string, string>>;
  return <p role="alert" className="pt-receipt-error">{text[errorKey] ?? strings.receiptErrorUnavailable}</p>;
}

function FileGlyph({ name }: Readonly<{ name: string }>) {
  const Icon = /\.(png|jpe?g)$/i.test(name) ? ImageIcon : FileText;
  return <Icon aria-hidden size={16} />;
}

function HiddenFileInput({
  inputRef,
  label,
  disabled,
  onPick,
}: Readonly<{ inputRef: React.RefObject<HTMLInputElement | null>; label: string; disabled: boolean; onPick: (file: File | undefined) => void }>) {
  return (
    <input
      ref={inputRef}
      className="pt-pay-file-input"
      type="file"
      accept="image/jpeg,image/png,application/pdf"
      aria-label={label}
      tabIndex={-1}
      disabled={disabled}
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        onPick(file);
      }}
    />
  );
}

/**
 * Ячейка «Чек» у строки платежа: выбрать файл и «Сохранить», либо «Заменить» у отклонённого.
 * Сумма и валюта — у строки, дата оплаты — день чека или сегодня по Бишкеку. Тот же POST, что и раньше.
 */
export function ReceiptSlot({
  strings,
  obligationId,
  amountMinor,
  currency,
  paidOn,
  mode,
}: Readonly<{
  strings: Strings;
  obligationId: string | null;
  amountMinor: number;
  currency: string;
  paidOn: string | null;
  mode: "attach" | "replace";
}>) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const attemptKey = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const locked = state === "sending";

  function pick(next: File | undefined) {
    if (!next) return;
    const problem = fileProblem(next);
    if (problem) {
      setFile(null);
      setErrorKey(problem);
      return;
    }
    setErrorKey(null);
    setFile(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || !file) return;
    const amount = minorToReceiptInput(amountMinor);
    const cur = currency.trim().toUpperCase();
    const day = paidOn ?? bishkekToday();
    if (!receiptAmountToMinor(amount) || !/^[A-Z]{3}$/.test(cur) || !day) {
      setErrorKey("receiptErrorInvalid");
      return;
    }
    const body = new FormData();
    body.set("file", file);
    body.set("amount", amount);
    body.set("currency", cur);
    body.set("paid_on", day);
    if (obligationId) body.set("payment_obligation_id", obligationId);
    setState("sending");
    const result = await postReceipt(body, attemptKey);
    if (result.ok) {
      setState("sent");
      router.refresh();
      return;
    }
    setErrorKey(result.errorKey);
    setState("idle");
  }

  if (state === "sent") return <p role="status" className="pt-receipt-sent">{strings.receiptSent}</p>;

  return (
    <div className="pt-pay-slot-wrap">
      <HiddenFileInput inputRef={inputRef} label={strings.receiptFieldFile} disabled={locked} onPick={pick} />
      {file ? (
        <form onSubmit={submit} className="pt-pay-picked" aria-busy={locked}>
          <span className="pt-pay-file">
            <FileGlyph name={file.name} />
            <span className="pt-pay-filename">{file.name}</span>
          </span>
          <button type="button" className="pt-pay-clear" aria-label={strings.receiptClearFile} disabled={locked} onClick={() => setFile(null)}>
            <X aria-hidden size={14} />
          </button>
          <button type="submit" className="pt-btn pt-pay-save" disabled={locked}>
            {locked ? strings.receiptSaving : strings.receiptSave}
          </button>
        </form>
      ) : (
        <button type="button" className={mode === "replace" ? "pt-pay-textbtn" : "pt-pay-slot"} disabled={locked} onClick={() => inputRef.current?.click()}>
          {mode === "attach" ? <Plus aria-hidden size={14} /> : null}
          {mode === "replace" ? strings.replaceButton : strings.receiptAttach}
        </button>
      )}
      <ErrorLine strings={strings} errorKey={errorKey} />
    </div>
  );
}

/** «Добавить платёж»: сумма, валюта, дата и чек без платежа в графике. Куратор относит его сам — прежний путь «чека без платежа». */
export function AddPaymentForm({
  strings,
  currencies,
  defaultCurrency,
  onClose,
}: Readonly<{ strings: Strings; currencies: readonly string[]; defaultCurrency: string; onClose: () => void }>) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const attemptKey = useRef<string | null>(null);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [paidOn, setPaidOn] = useState(bishkekToday);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const locked = state === "sending";

  function pick(next: File | undefined) {
    if (!next) return;
    const problem = fileProblem(next);
    if (problem) {
      setFile(null);
      setErrorKey(problem);
      return;
    }
    setErrorKey(null);
    setFile(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    const minor = receiptAmountToMinor(amount);
    const cur = currency.trim().toUpperCase();
    if (!file || !minor || !/^[A-Z]{3}$/.test(cur) || !paidOn) {
      setErrorKey(!file ? (errorKey === "receiptErrorTooLarge" || errorKey === "receiptErrorFileType" ? errorKey : "receiptErrorInvalid") : "receiptErrorInvalid");
      return;
    }
    const problem = fileProblem(file);
    if (problem) {
      setErrorKey(problem);
      return;
    }
    const body = new FormData();
    body.set("file", file);
    body.set("amount", amount.trim());
    body.set("currency", cur);
    body.set("paid_on", paidOn);
    setState("sending");
    const result = await postReceipt(body, attemptKey);
    if (result.ok) {
      setState("sent");
      router.refresh();
      return;
    }
    setErrorKey(result.errorKey);
    setState("idle");
  }

  if (state === "sent") return <p role="status" className="pt-receipt-sent pt-pay-add-sent">{strings.receiptSent}</p>;

  return (
    <form className="pt-pay-add" onSubmit={submit} aria-busy={locked}>
      <div className="pt-pay-add-grid">
        <label className="pt-field">
          <span className="pt-field-label">{strings.receiptFieldAmount}</span>
          <input className="pt-input pt-data" inputMode="decimal" autoComplete="off" required autoFocus value={amount} disabled={locked}
            onChange={(event) => setAmount(event.target.value)} placeholder="0.00" />
        </label>
        <label className="pt-field">
          <span className="pt-field-label">{strings.receiptFieldCurrency}</span>
          <input className="pt-input pt-data" list="pay-currencies" maxLength={3} required value={currency} disabled={locked}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
          <datalist id="pay-currencies">
            {currencies.map((code) => <option key={code} value={code} />)}
          </datalist>
        </label>
        <label className="pt-field">
          <span className="pt-field-label">{strings.receiptFieldDate}</span>
          <input className="pt-input pt-data" type="date" required value={paidOn} max={bishkekToday()} disabled={locked}
            onChange={(event) => setPaidOn(event.target.value)} />
        </label>
        <div className="pt-field">
          <span className="pt-field-label">{strings.receiptColumnReceipt}</span>
          <HiddenFileInput inputRef={inputRef} label={strings.receiptFieldFile} disabled={locked} onPick={pick} />
          {file ? (
            <span className="pt-pay-picked">
              <span className="pt-pay-file">
                <FileGlyph name={file.name} />
                <span className="pt-pay-filename">{file.name}</span>
              </span>
              <button type="button" className="pt-pay-clear" aria-label={strings.receiptClearFile} disabled={locked} onClick={() => setFile(null)}>
                <X aria-hidden size={14} />
              </button>
            </span>
          ) : (
            <button type="button" className="pt-pay-slot" disabled={locked} onClick={() => inputRef.current?.click()}>
              <Plus aria-hidden size={14} />
              {strings.receiptAttach}
            </button>
          )}
        </div>
        <div className="pt-pay-add-actions">
          <button type="submit" className="pt-btn pt-pay-save" disabled={locked}>{locked ? strings.receiptSaving : strings.receiptSave}</button>
          <button type="button" className="pt-btn-ghost" disabled={locked} onClick={onClose}>{strings.receiptCancel}</button>
        </div>
      </div>
      <p className="pt-pay-hint">{strings.receiptAddHint}</p>
      <ErrorLine strings={strings} errorKey={errorKey} />
    </form>
  );
}

/** Шапка «Платежи» и кнопка, которая открывает форму нового платежа над списком. */
export function PaymentsSection({
  strings,
  canUpload,
  currencies,
  defaultCurrency,
  children,
}: Readonly<{
  strings: Strings;
  canUpload: boolean;
  currencies: readonly string[];
  defaultCurrency: string;
  children: ReactNode;
}>) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <section className="pt-card pt-pay-card" aria-labelledby="pay-list">
      <header className="pt-card-header">
        <div className="pt-card-header-main">
          <h2 id="pay-list" className="pt-card-title">{strings.paymentsHeading}</h2>
          <p className="pt-card-note">{strings.bishkekNote}</p>
        </div>
        {canUpload ? (
          <button
            ref={buttonRef}
            type="button"
            className="pt-btn"
            aria-expanded={open}
            aria-controls="pay-add-form"
            data-testid="portal-add-payment"
            onClick={() => setOpen((value) => !value)}
          >
            <Plus aria-hidden size={14} />
            {strings.receiptAddPayment}
          </button>
        ) : null}
      </header>
      <div id="pay-add-form" hidden={!open}>
        {open ? <AddPaymentForm strings={strings} currencies={currencies} defaultCurrency={defaultCurrency} onClose={close} /> : null}
      </div>
      {children}
    </section>
  );
}
