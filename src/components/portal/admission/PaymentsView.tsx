import { EmptyIcon } from "@/components/portal/home/HomeParts";
import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import type { PaymentCenter, PaymentDue } from "@/lib/portal/payment-center";
import {
  buildPaymentSchedule,
  isGeneratedReceivedLabel,
  paymentGroupTitle,
  type PaymentGroup,
  type PaymentLine,
} from "@/lib/portal/payment-rows";
import { WRITE_EVO_HREF } from "@/lib/portal/write-evo";

import { PaymentsSection, ReceiptSlot } from "./PaymentReceiptForm";
import { PortalStatus } from "./PortalStatus";
import {
  formatPortalDeadline,
  formatPortalMoney,
  paymentCategory,
} from "./presentation";

type Strings = ReturnType<typeof getPortalStrings<"admission">>;

const DAY = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

function entryDay(value: string): string {
  return DAY.format(new Date(`${value}T00:00:00Z`));
}

function shownDate(line: PaymentLine, payment: PaymentDue | undefined): { value: string | undefined; text: string } {
  if (line.onDate) return { value: line.onDate, text: entryDay(line.onDate) };
  if (!payment) return { value: undefined, text: "—" };
  const value = payment.dueAt ?? undefined;
  return { value, text: value ? (formatPortalDeadline(value) ?? "—") : "—" };
}

function dueFor(center: PaymentCenter, obligationId: string | null): PaymentDue | undefined {
  if (!obligationId) return undefined;
  return center.dues.find((item) => item.obligationId === obligationId);
}

function fileHref(line: PaymentLine): string | null {
  if (!line.fileId || !line.fileKind) return null;
  return `/api/portal/case-files/${line.fileKind}/${encodeURIComponent(line.fileId)}/download`;
}

function groupRefunded(center: PaymentCenter, obligationIds: readonly string[]): number {
  return center.dues
    .filter((due) => obligationIds.includes(due.obligationId))
    .reduce((sum, due) => sum + due.refundedMinor, 0);
}

function Money({ amountMinor, currency, negative }: Readonly<{ amountMinor: number; currency: string; negative: boolean }>) {
  const text = formatPortalMoney(amountMinor, currency);
  return <span className="pt-data">{negative ? `−${text}` : text}</span>;
}

function LineStatus({ line, strings }: Readonly<{ line: PaymentLine; strings: Strings }>) {
  const status = line.status === "accepted"
    ? { label: strings.receiptStatusAccepted, tone: "ok" as const }
    : line.status === "review"
      ? { label: strings.receiptStatusReview, tone: "info" as const }
      : line.status === "rejected"
        ? { label: strings.receiptDeclined, tone: "danger" as const }
        : line.status === "refund"
          ? { label: strings.receiptKindRefund, tone: "neutral" as const }
          : { label: strings.receiptNoReceipt, tone: "neutral" as const };
  return (
    <div className="pt-pay-status">
      <PortalStatus label={status.label} tone={status.tone} />
      {line.overdue ? <PortalStatus label={strings["payStatus.overdue"]} tone="danger" /> : null}
      {line.rejectReason ? <p className="pt-pay-reason">{line.rejectReason}</p> : null}
    </div>
  );
}

function ReceiptCell({ line, strings }: Readonly<{ line: PaymentLine; strings: Strings }>) {
  const href = fileHref(line);
  const mode = line.replace ? "replace" : line.attach ? "attach" : null;
  return (
    <div className="pt-pay-receipt">
      {href && line.filename ? (
        <a className="pt-pay-file pt-link" href={href} aria-label={formatPortalString(strings.receiptOpenFileAria, { name: line.filename })}>
          {line.filename}
        </a>
      ) : null}
      {mode ? (
        <ReceiptSlot
          strings={strings}
          obligationId={line.obligationId}
          amountMinor={line.submitAmountMinor}
          currency={line.currency}
          paidOn={line.submitDate}
          mode={mode}
        />
      ) : null}
      {!href && !mode ? <span className="pt-pay-nofile">—</span> : null}
    </div>
  );
}

function PaymentRow({ line, payment, strings }: Readonly<{ line: PaymentLine; payment: PaymentDue | undefined; strings: Strings }>) {
  const date = shownDate(line, payment);
  return (
    <tr data-testid="portal-payment-entry" data-entry-status={line.status}>
      <td>
        <span className="pt-pay-cell-label">{strings.receiptColumnDate}</span>
        {date.value ? <time dateTime={date.value} className="pt-data">{date.text}</time> : <span className="pt-data">{date.text}</span>}
        {line.label ? <span className="pt-pay-row-label">{line.label}</span> : null}
      </td>
      <td>
        <span className="pt-pay-cell-label">{strings.receiptColumnAmount}</span>
        <Money amountMinor={line.amountMinor} currency={line.currency} negative={line.negative} />
      </td>
      <td>
        <span className="pt-pay-cell-label">{strings.receiptColumnReceipt}</span>
        <ReceiptCell line={line} strings={strings} />
      </td>
      <td>
        <span className="pt-pay-cell-label">{strings.receiptColumnStatus}</span>
        <LineStatus line={line} strings={strings} />
      </td>
    </tr>
  );
}

function PaymentTable({ lines, center, strings, caption }: Readonly<{
  lines: readonly PaymentLine[];
  center: PaymentCenter;
  strings: Strings;
  caption: string;
}>) {
  return (
    <table className="pt-pay-table">
      <caption className="pt-sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{strings.receiptColumnDate}</th>
          <th scope="col">{strings.receiptColumnAmount}</th>
          <th scope="col">{strings.receiptColumnReceipt}</th>
          <th scope="col">{strings.receiptColumnStatus}</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <PaymentRow key={line.key} line={line} payment={dueFor(center, line.obligationId)} strings={strings} />
        ))}
      </tbody>
    </table>
  );
}

function progressLabel(group: PaymentGroup, strings: Strings): string {
  const paid = formatPortalString(strings.receiptProgressLabel, {
    paid: formatPortalMoney(group.paidMinor, group.currency),
    total: formatPortalMoney(group.amountMinor, group.currency),
  });
  if (group.reviewMinor < 1) return paid;
  return `${paid}. ${formatPortalString(strings.receiptReviewAside, { amount: formatPortalMoney(group.reviewMinor, group.currency) })}`;
}

function ServiceBlock({ group, center, strings, title, sharedName }: Readonly<{
  group: PaymentGroup;
  center: PaymentCenter;
  strings: Strings;
  title: string;
  sharedName: string | null;
}>) {
  const refundedMinor = groupRefunded(center, group.obligationIds);
  const credited = Math.max(0, group.amountMinor - group.outstandingMinor);
  const paidPct = group.amountMinor > 0 ? Math.min(100, (credited / group.amountMinor) * 100) : 0;
  const reviewPct = group.amountMinor > 0 ? Math.min(100 - paidPct, (group.reviewMinor / group.amountMinor) * 100) : 0;
  return (
    <div className="pt-pay-service" data-testid="portal-payment">
      <h3 className="pt-pay-service-title">{title}</h3>
      {sharedName ? <p className="pt-pay-service-name">{sharedName}</p> : null}
      <dl className="pt-pay-amounts">
        <div className="pt-pay-amount">
          <dt>{strings.toPayTerm}</dt>
          <dd className="pt-data">{formatPortalMoney(group.amountMinor, group.currency)}</dd>
        </div>
        <div className="pt-pay-amount">
          <dt>{strings.paidTerm}</dt>
          <dd className="pt-data">
            {formatPortalMoney(group.paidMinor, group.currency)}
            {group.reviewMinor > 0 ? (
              <span className="pt-pay-review">{formatPortalString(strings.receiptReviewAside, { amount: formatPortalMoney(group.reviewMinor, group.currency) })}</span>
            ) : null}
          </dd>
        </div>
        <div className="pt-pay-amount">
          <dt>{strings.outstandingTerm}</dt>
          <dd className="pt-data">{formatPortalMoney(group.outstandingMinor, group.currency)}</dd>
        </div>
        {refundedMinor > 0 ? (
          <div className="pt-pay-amount">
            <dt>{strings.refundedTerm}</dt>
            <dd className="pt-data">{formatPortalMoney(refundedMinor, group.currency)}</dd>
          </div>
        ) : null}
      </dl>
      {group.amountMinor > 0 ? (
        <div className="pt-pay-bar" role="img" aria-label={progressLabel(group, strings)}>
          <span className="pt-pay-bar-paid" style={{ width: `${paidPct}%` }} />
          {reviewPct > 0 ? <span className="pt-pay-bar-review" style={{ width: `${reviewPct}%` }} /> : null}
        </div>
      ) : null}
      {group.nextActions.map((action) => (
        <p key={action} className="pt-next-step">
          <span className="pt-next-step-label">{strings.nextStepLabel}</span> {action}
        </p>
      ))}
      {group.lines.length > 0 ? <PaymentTable lines={group.lines} center={center} strings={strings} caption={title} /> : null}
    </div>
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

function sharedName(title: string, labels: readonly string[]): string | null {
  const names = [...new Set(labels.filter((label) => !isGeneratedReceivedLabel(label)))];
  if (names.length !== 1) return null;
  return names[0].localeCompare(title, "ru", { sensitivity: "accent" }) === 0 ? null : names[0];
}

/**
 * «Оплата»: как оплатить, затем платежи. У каждой строки свой чек. Платёж вне графика —
 * «Добавить платёж»: тот же чек без платежа, его по-прежнему разбирает куратор.
 */
export function PaymentsView({ center, locale }: Readonly<{ center: PaymentCenter; locale: Locale }>) {
  const strings = getPortalStrings("admission", locale);
  const schedule = buildPaymentSchedule(center);
  const currencies = [...new Set([
    ...center.dues.map((due) => due.currency),
    ...center.unassigned.map((entry) => entry.currency),
  ])];
  const empty = schedule.groups.length === 0 && schedule.added.length === 0;

  return (
    <>
      {center.details ? <HowToPay details={center.details} strings={strings} /> : null}
      <PaymentsSection
        strings={strings}
        canUpload={center.canUpload}
        currencies={currencies}
        defaultCurrency={currencies[0] ?? "KGS"}
      >
        {empty ? (
          <div className="pt-pay-empty">
            <EmptyIcon name="payments" />
            <h3 className="pt-section-title">{strings.paymentsEmptyTitle}</h3>
            <p className="pt-adm-empty-body">{strings.paymentsEmptyBody}</p>
            <p className="pt-adm-empty-action">
              <IntentPrefetchLink href={WRITE_EVO_HREF} className="pt-btn">{strings.paymentsWriteCurator}</IntentPrefetchLink>
            </p>
          </div>
        ) : (
          <>
            {schedule.groups.map((group) => {
              const due = center.dues.find((item) => item.obligationId === group.obligationIds[0]);
              const title = paymentGroupTitle(due ? paymentCategory(due, strings) : null, group.labels);
              return (
                <ServiceBlock
                  key={group.key}
                  group={group}
                  center={center}
                  strings={strings}
                  title={title}
                  sharedName={sharedName(title, group.labels)}
                />
              );
            })}
            {schedule.added.length > 0 ? (
              <div className="pt-pay-service" data-testid="portal-added-payments">
                <h3 className="pt-pay-service-title">{strings.receiptAddedHeading}</h3>
                <p className="pt-pay-service-name">{strings.receiptUnassignedNote}</p>
                <PaymentTable lines={schedule.added} center={center} strings={strings} caption={strings.receiptAddedHeading} />
              </div>
            ) : null}
          </>
        )}
      </PaymentsSection>
    </>
  );
}
