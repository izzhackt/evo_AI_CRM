"use client";

import { Check, Copy, X } from "lucide-react";
import { useId, useRef, useState } from "react";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import {
  parseHowToPayText,
  writeCopiedText,
  type HowToPayAmount,
  type HowToPayFieldKey,
} from "@/lib/portal/how-to-pay";

type Feedback = Readonly<{ key: string; ok: boolean }>;

const COPY_LABEL: Readonly<Record<HowToPayFieldKey | "amount", "howToPayCopyBank" | "howToPayCopyRecipient" | "howToPayCopyPhone" | "howToPayCopyAmount">> = {
  bank: "howToPayCopyBank",
  recipient: "howToPayCopyRecipient",
  phone: "howToPayCopyPhone",
  amount: "howToPayCopyAmount",
};

const FIELD_LABEL: Readonly<Record<HowToPayFieldKey | "amount", "howToPayBankLabel" | "howToPayRecipientLabel" | "howToPayPhoneLabel" | "howToPayAmountLabel">> = {
  bank: "howToPayBankLabel",
  recipient: "howToPayRecipientLabel",
  phone: "howToPayPhoneLabel",
  amount: "howToPayAmountLabel",
};

function selectFallback(value: string): boolean {
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.inset = "0";
  area.style.opacity = "0";
  document.body.append(area);
  area.focus();
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  return ok;
}

function CopyButton({
  label,
  copyValue,
  copied,
  onCopy,
}: Readonly<{ label: string; copyValue: string; copied: boolean; onCopy: () => void }>) {
  const Icon = copied ? Check : Copy;
  return (
    <button type="button" className="pt-howtopay-copy" data-copy-value={copyValue} aria-label={label} onClick={onCopy}>
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" focusable="false" />
    </button>
  );
}

function DetailField({
  fieldKey,
  label,
  value,
  copyLabel,
  copyValue,
  due,
  feedback,
  copiedLabel,
  failedLabel,
  onCopy,
}: Readonly<{
  fieldKey: string;
  label: string;
  value: string;
  copyLabel: string;
  copyValue: string;
  due: string | null;
  feedback: Feedback | null;
  copiedLabel: string;
  failedLabel: string;
  onCopy: () => void;
}>) {
  const mine = feedback?.key === fieldKey ? feedback : null;
  return (
    <div className="pt-howtopay-field" data-testid={`portal-how-to-pay-${fieldKey}`}>
      <dt className="pt-howtopay-label">{label}</dt>
      <dd>
        <div className="pt-howtopay-value-row">
          <span className="pt-howtopay-cluster">
            <span className="pt-howtopay-value">{value}</span>
            <CopyButton label={copyLabel} copyValue={copyValue} copied={mine?.ok === true} onCopy={onCopy} />
          </span>
          {mine ? (
            <span className={mine.ok ? "pt-howtopay-copied" : "pt-howtopay-copy-error"}>
              {mine.ok ? copiedLabel : failedLabel}
            </span>
          ) : null}
        </div>
        {due ? <p className="pt-howtopay-due">{due}</p> : null}
      </dd>
    </div>
  );
}

/**
 * «Как оплатить»: поля из текста реквизитов и крупный QR.
 * Окно QR — системный `<dialog>` (`showModal`): Esc и ловушка фокуса встроены, фокус возвращается на кнопку.
 */
export function HowToPayCard({
  text,
  qrSrc,
  amount,
  locale,
  previewOpen = false,
  initialFeedback = null,
}: Readonly<{
  text: string;
  qrSrc: string | null;
  amount: HowToPayAmount | null;
  locale: Locale;
  /** Только для статичного снимка окна. В кабинете окно открывает `showModal`. */
  previewOpen?: boolean;
  /** Только для статичного снимка подтверждения копирования. */
  initialFeedback?: Feedback | null;
}>) {
  const strings = getPortalStrings("admission", locale);
  const parsed = parseHowToPayText(text);
  const titleId = useId();
  const dialogTitleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(initialFeedback);

  async function copy(key: string, value: string) {
    const writeText = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    const ok = await writeCopiedText(value, {
      writeText,
      fallback: selectFallback,
    });
    setFeedback({ key, ok });
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => {
      copyTimer.current = null;
      setFeedback(null);
    }, 2000);
  }

  const dueText = amount?.dueOn
    ? formatPortalString(amount.overdue ? strings.howToPayAmountOverdue : strings.howToPayAmountDue, { date: amount.dueOn })
    : null;
  const rows: { key: string; value: string; copyValue: string; due: string | null }[] = [
    ...parsed.fields.map((item) => ({ key: item.key, value: item.value, copyValue: item.copyValue, due: null })),
    ...(amount
      ? [{ key: "amount", value: amount.display, copyValue: amount.copyValue, due: dueText }]
      : []),
  ];

  return (
    <section className="pt-card pt-howtopay" aria-labelledby={titleId} data-testid="portal-how-to-pay">
      <header className="pt-card-header">
        <div className="pt-card-header-main">
          <h2 id={titleId} className="pt-card-title">{strings.howToPayTitle}</h2>
        </div>
      </header>
      <div className="pt-howtopay-body">
        {rows.length > 0 || parsed.rest ? (
          <div className="pt-howtopay-main">
            {rows.length > 0 ? (
              <dl className="pt-howtopay-fields">
                {rows.map((row) => (
                  <DetailField
                    key={row.key}
                    fieldKey={row.key}
                    label={strings[FIELD_LABEL[row.key as HowToPayFieldKey | "amount"]]}
                    value={row.value}
                    copyLabel={strings[COPY_LABEL[row.key as HowToPayFieldKey | "amount"]]}
                    copyValue={row.copyValue}
                    due={row.due}
                    feedback={feedback}
                    copiedLabel={strings.howToPayCopied}
                    failedLabel={strings.howToPayCopyFailed}
                    onCopy={() => void copy(row.key, row.copyValue)}
                  />
                ))}
              </dl>
            ) : null}
            {parsed.rest ? <p className="pt-howtopay-rest">{parsed.rest}</p> : null}
          </div>
        ) : null}
        {qrSrc ? (
          <div className="pt-howtopay-qr-col">
            <figure className="pt-howtopay-qr-frame">
              {parsed.brand ? <figcaption className="pt-howtopay-qr-brand">{parsed.brand}</figcaption> : null}
              {/* Закрытый файл: адрес отвечает перенаправлением на подписанную ссылку. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="pt-howtopay-qr" src={qrSrc} alt={strings.howToPayQrAlt} width={240} height={240} />
            </figure>
            <div className="pt-howtopay-qr-actions">
              <a className="pt-btn-ghost" href={qrSrc} download="evo-payment-qr">
                {strings.howToPayDownload}
              </a>
              <button
                ref={opener}
                type="button"
                className="pt-btn-ghost"
                aria-haspopup="dialog"
                onClick={() => dialog.current?.showModal()}
              >
                {strings.howToPayFullscreen}
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <p className="pt-sr-only" role="status" aria-live="polite">{feedback ? (feedback.ok ? strings.howToPayCopied : strings.howToPayCopyFailed) : ""}</p>
      <p className="pt-card-note">{strings.howToPayQrNote}</p>
      {qrSrc ? (
        <dialog
          ref={dialog}
          className="pt-howtopay-dialog"
          aria-labelledby={dialogTitleId}
          {...(previewOpen ? { open: true } : {})}
          onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
          onClose={() => opener.current?.focus()}
        >
          <div className="pt-howtopay-dialog-body">
            <div className="pt-howtopay-dialog-head">
              <h2 id={dialogTitleId} className={parsed.brand ? "pt-howtopay-dialog-title" : "pt-sr-only"}>
                {parsed.brand ?? strings.howToPayQrAlt}
              </h2>
              <button type="button" className="pt-howtopay-close" aria-label={strings.howToPayClose} onClick={() => dialog.current?.close()}>
                <X size={20} strokeWidth={1.8} aria-hidden="true" focusable="false" />
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="pt-howtopay-dialog-qr"
              src={qrSrc}
              alt={parsed.brand ? strings.howToPayQrAlt : ""}
              width={480}
              height={480}
            />
          </div>
        </dialog>
      ) : null}
    </section>
  );
}
