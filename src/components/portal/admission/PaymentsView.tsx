import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings } from "@/lib/portal/i18n";
import type { StudentPortalPayment } from "@/lib/v3/portal-source";

import { PortalStatus } from "./PortalStatus";
import {
  formatPortalMoney,
  formatPortalTimestamp,
  paymentCategory,
  paymentStatus,
} from "./presentation";

/**
 * «Оплата» в Атласе (PORT-5d): те же начисления из E2 DTO, mono-цифры,
 * null-семантика 189 сохранена (dueAt: null = «без срока» — строка срока
 * просто не рисуется; nextAction: null — блока «Следующий шаг» нет).
 * PORT-6a: строки — из неймспейса admission (RU байт-в-байт, KY полный).
 */
export function PaymentsView({
  payments,
  locale,
}: {
  payments: readonly StudentPortalPayment[];
  locale: Locale;
}) {
  const strings = getPortalStrings("admission", locale);

  if (payments.length === 0) {
    return (
      <section className="pt-adm-empty">
        <h2 className="pt-section-title">{strings.paymentsEmptyTitle}</h2>
        <p className="pt-adm-empty-body">{strings.paymentsEmptyBody}</p>
      </section>
    );
  }

  return (
    <section className="pt-card">
      <header className="pt-card-header">
        <div className="pt-card-header-main">
          <h2 className="pt-card-title">{strings.paymentsHeading}</h2>
          <p className="pt-card-note">{strings.bishkekNote}</p>
        </div>
      </header>
      <ul className="pt-adm-list">
        {payments.map((payment, index) => {
          const status = paymentStatus(payment, strings);
          const category = paymentCategory(payment, strings);
          const dueLabel = formatPortalTimestamp(payment.dueAt);

          return (
            <li
              key={`${payment.category}:${payment.dueAt}:${payment.label}:${index}`}
              className="pt-pay-item"
            >
              <div className="pt-pay-item-head">
                <div>
                  <h3 className="pt-pay-item-title">
                    {payment.label}
                  </h3>
                  {category ? (
                    <p className="pt-pay-item-meta">{category}</p>
                  ) : null}
                  {dueLabel ? (
                    <p className="pt-pay-item-meta">
                      {strings.dueTerm} <time dateTime={payment.dueAt ?? undefined}>{dueLabel}</time>
                    </p>
                  ) : null}
                </div>
                <PortalStatus label={status.label} tone={status.tone} />
              </div>

              <dl className="pt-pay-amounts">
                <div className="pt-pay-amount">
                  <dt>{strings.toPayTerm}</dt>
                  <dd className="pt-data">
                    {formatPortalMoney(payment.amountMinor, payment.currency)}
                  </dd>
                </div>
                <div className="pt-pay-amount">
                  <dt>{strings.paidTerm}</dt>
                  <dd className="pt-data">
                    {formatPortalMoney(payment.paidMinor, payment.currency)}
                  </dd>
                </div>
                <div className="pt-pay-amount">
                  <dt>{strings.outstandingTerm}</dt>
                  <dd className="pt-data">
                    {formatPortalMoney(payment.outstandingMinor, payment.currency)}
                  </dd>
                </div>
                {payment.refundedMinor > 0 ? (
                  <div className="pt-pay-amount">
                    <dt>{strings.refundedTerm}</dt>
                    <dd className="pt-data">
                      {formatPortalMoney(payment.refundedMinor, payment.currency)}
                    </dd>
                  </div>
                ) : null}
              </dl>

              {payment.nextAction ? (
                <p className="pt-next-step">
                  <span className="pt-next-step-label">{strings.nextStepLabel}</span>{" "}
                  {payment.nextAction}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
