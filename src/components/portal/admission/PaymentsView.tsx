import { EmptyIcon } from "@/components/portal/home/HomeParts";
import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import type { PaymentCenter, PaymentEntry } from "@/lib/portal/payment-center";
import { WRITE_EVO_HREF } from "@/lib/portal/write-evo";

import { PaymentReceiptForm, type ReceiptFormDue } from "./PaymentReceiptForm";
import { PortalStatus } from "./PortalStatus";
import {
  formatPortalMoney,
  formatPortalDeadline,
  paymentCategory,
  paymentStatus,
  type PortalStatusTone,
} from "./presentation";

type Strings = ReturnType<typeof getPortalStrings<"admission">>;

const DAY = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

function entryDay(value: string): string {
  return DAY.format(new Date(`${value}T00:00:00Z`));
}

function entryStatus(entry: PaymentEntry, strings: Strings): Readonly<{ label: string; tone: PortalStatusTone }> {
  return entry.status === "accepted"
    ? { label: strings.receiptStatusAccepted, tone: "ok" }
    : entry.status === "rejected"
      ? { label: strings.receiptStatusRejected, tone: "danger" }
      : { label: strings.receiptStatusReview, tone: "info" };
}

/** Одна строка истории: дата, сумма, статус, причина отказа, ссылка на чек. */
function EntryRow({ entry, strings, action }: Readonly<{ entry: PaymentEntry; strings: Strings; action?: React.ReactNode }>) {
  const status = entryStatus(entry, strings);
  const sign = entry.kind === "refund" ? "−" : "";
  return (
    <li className="pt-receipt-entry" data-entry-status={entry.status} data-testid="portal-payment-entry">
      <time dateTime={entry.onDate} className="pt-data pt-receipt-entry-date">{entryDay(entry.onDate)}</time>
      <span className="pt-data pt-receipt-entry-amount">{sign}{formatPortalMoney(entry.amountMinor, entry.currency)}</span>
      <span className="pt-receipt-entry-status">
        {entry.kind === "refund" ? <span className="pt-pay-item-meta">{strings.receiptKindRefund}</span> : null}
        <PortalStatus label={status.label} tone={status.tone} />
      </span>
      <span className="pt-receipt-entry-side">
        {entry.fileId && entry.fileKind ? (
          <a
            className="pt-link"
            href={`/api/portal/case-files/${entry.fileKind}/${encodeURIComponent(entry.fileId)}/download`}
            aria-label={formatPortalString(strings.receiptOpenFileAria, { name: entry.filename ?? "" })}
          >
            {strings.receiptOpenFile}
          </a>
        ) : null}
        {action}
      </span>
      {entry.rejectReason ? (
        <p className="pt-receipt-reason" role="note">
          <span className="pt-receipt-reason-label">{strings.receiptReasonLabel}</span> {entry.rejectReason}
        </p>
      ) : null}
    </li>
  );
}

/** «Как оплатить»: реквизиты и QR одной организации; пока администратор ничего не заполнил, блока нет. */
function HowToPay({ details, strings }: Readonly<{ details: NonNullable<PaymentCenter["details"]>; strings: Strings }>) {
  return (
    <section className="pt-card pt-howtopay" aria-labelledby="pay-how" data-testid="portal-how-to-pay">
      <header className="pt-card-header">
        <div className="pt-card-header-main">
          <h2 id="pay-how" className="pt-card-title">{strings.howToPayTitle}</h2>
        </div>
      </header>
      <div className="pt-howtopay-body">
        {details.text ? <p className="pt-howtopay-text">{details.text}</p> : null}
        {details.qrId ? (
          // eslint-disable-next-line @next/next/no-img-element -- ссылка на закрытый файл отвечает перенаправлением на подписанный адрес
          <img
            className="pt-howtopay-qr"
            src={`/api/portal/case-files/payment_details_qr/${encodeURIComponent(details.qrId)}/download`}
            alt={strings.howToPayQrAlt}
            width={192}
            height={192}
          />
        ) : null}
      </div>
      <p className="pt-card-note">{strings.howToPayQrNote}</p>
    </section>
  );
}

/**
 * «Оплата»: «Как оплатить» сверху (если заполнено), ниже платежи с историей оплат и чеков (на проверке, принято, отклонено + причина)
 * и приложить чек к платежу или без платежа. Деньги засчитывает куратор после проверки чека. Срок по Бишкеку.
 */
export function PaymentsView({ center, locale }: Readonly<{ center: PaymentCenter; locale: Locale }>) {
  const strings = getPortalStrings("admission", locale);
  const formDues: readonly ReceiptFormDue[] = center.dues
    .map((due) => ({ obligationId: due.obligationId, label: due.label, currency: due.currency, outstandingMinor: due.outstandingMinor }));

  if (center.dues.length === 0 && center.unassigned.length === 0) {
    return (
      <>
        {center.details ? <HowToPay details={center.details} strings={strings} /> : null}
        <section className="pt-adm-empty">
          <EmptyIcon name="payments" />
          <h2 className="pt-section-title">{strings.paymentsEmptyTitle}</h2>
          <p className="pt-adm-empty-body">{strings.paymentsEmptyBody}</p>
          <p>
            <IntentPrefetchLink href={WRITE_EVO_HREF} className="pt-btn">{strings.paymentsWriteCurator}</IntentPrefetchLink>
          </p>
          {center.canUpload ? (
            <div className="pt-receipt-attach">
              <PaymentReceiptForm strings={strings} label={strings.receiptAttachLoose} dues={[]} />
            </div>
          ) : null}
        </section>
      </>
    );
  }

  return (
    <>
      {center.details ? <HowToPay details={center.details} strings={strings} /> : null}
      <section className="pt-card" aria-labelledby="pay-list">
        <header className="pt-card-header">
          <div className="pt-card-header-main">
            <h2 id="pay-list" className="pt-card-title">{strings.paymentsHeading}</h2>
            <p className="pt-card-note">{strings.bishkekNote}</p>
          </div>
        </header>
        <ul className="pt-adm-list">
          {center.dues.map((due) => {
            const status = paymentStatus(due, strings);
            const category = paymentCategory(due, strings);
            const dueLabel = formatPortalDeadline(due.dueAt);
            const canAttach = center.canUpload;
            const fixed: ReceiptFormDue = { obligationId: due.obligationId, label: due.label, currency: due.currency, outstandingMinor: due.outstandingMinor };
            return (
              <li key={due.obligationId} className="pt-pay-item" data-testid="portal-payment">
                <div className="pt-pay-item-head">
                  <div>
                    <h3 className="pt-pay-item-title">{due.label}</h3>
                    {category ? <p className="pt-pay-item-meta">{category}</p> : null}
                    {dueLabel ? (
                      <p className="pt-pay-item-meta">
                        {strings.dueTerm} <time dateTime={due.dueAt ?? undefined}>{dueLabel}</time>
                      </p>
                    ) : null}
                  </div>
                  <PortalStatus label={status.label} tone={status.tone} />
                </div>

                <dl className="pt-pay-amounts">
                  <div className="pt-pay-amount">
                    <dt>{strings.toPayTerm}</dt>
                    <dd className="pt-data">{formatPortalMoney(due.amountMinor, due.currency)}</dd>
                  </div>
                  <div className="pt-pay-amount">
                    <dt>{strings.paidTerm}</dt>
                    <dd className="pt-data">{formatPortalMoney(due.paidMinor, due.currency)}</dd>
                  </div>
                  <div className="pt-pay-amount">
                    <dt>{strings.outstandingTerm}</dt>
                    <dd className="pt-data">{formatPortalMoney(due.outstandingMinor, due.currency)}</dd>
                  </div>
                  {due.refundedMinor > 0 ? (
                    <div className="pt-pay-amount">
                      <dt>{strings.refundedTerm}</dt>
                      <dd className="pt-data">{formatPortalMoney(due.refundedMinor, due.currency)}</dd>
                    </div>
                  ) : null}
                </dl>

                {due.nextAction ? (
                  <p className="pt-next-step">
                    <span className="pt-next-step-label">{strings.nextStepLabel}</span> {due.nextAction}
                  </p>
                ) : null}

                {due.entries.length > 0 ? (
                  <ul className="pt-receipt-entries" aria-label={strings.receiptHistoryHeading}>
                    {due.entries.map((entry) => (
                      <EntryRow
                        key={`${entry.kind}:${entry.entryId}`}
                        entry={entry}
                        strings={strings}
                        action={entry.status === "rejected" && canAttach
                          ? <PaymentReceiptForm strings={strings} label={strings.receiptAttachAgain} fixedDue={fixed} />
                          : null}
                      />
                    ))}
                  </ul>
                ) : null}

                {canAttach && due.outstandingMinor > 0 ? (
                  <div className="pt-receipt-attach">
                    <PaymentReceiptForm strings={strings} label={strings.receiptAttach} fixedDue={fixed} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {center.unassigned.length > 0 || (center.canUpload && center.dues.length > 0) ? (
        <section className="pt-card pt-receipt-loose" aria-labelledby="pay-loose">
          <header className="pt-card-header">
            <div className="pt-card-header-main">
              <h2 id="pay-loose" className="pt-card-title">{strings.receiptUnassignedHeading}</h2>
              <p className="pt-card-note">{strings.receiptUnassignedNote}</p>
            </div>
          </header>
          {center.unassigned.length > 0 ? (
            <ul className="pt-receipt-entries">
              {center.unassigned.map((entry) => <EntryRow key={entry.entryId} entry={entry} strings={strings} />)}
            </ul>
          ) : null}
          {center.canUpload ? (
            <div className="pt-receipt-attach">
              <PaymentReceiptForm strings={strings} label={strings.receiptAttachLoose} dues={formDues} />
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
