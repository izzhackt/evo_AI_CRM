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
 */
export function PaymentsView({
  payments,
}: {
  payments: readonly StudentPortalPayment[];
}) {
  if (payments.length === 0) {
    return (
      <section className="pt-adm-empty">
        <h2 className="pt-section-title">Начислений пока нет</h2>
        <p className="pt-adm-empty-body">Здесь появятся суммы и сроки оплаты.</p>
      </section>
    );
  }

  return (
    <section className="pt-card">
      <header className="pt-card-header">
        <div className="pt-card-header-main">
          <h2 className="pt-card-title">Начисления</h2>
          <p className="pt-card-note">Сроки указаны по времени Бишкека.</p>
        </div>
      </header>
      <ul className="pt-adm-list">
        {payments.map((payment, index) => {
          const status = paymentStatus(payment);
          const category = paymentCategory(payment);
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
                      Срок: <time dateTime={payment.dueAt ?? undefined}>{dueLabel}</time>
                    </p>
                  ) : null}
                </div>
                <PortalStatus label={status.label} tone={status.tone} />
              </div>

              <dl className="pt-pay-amounts">
                <div className="pt-pay-amount">
                  <dt>К оплате</dt>
                  <dd className="pt-data">
                    {formatPortalMoney(payment.amountMinor, payment.currency)}
                  </dd>
                </div>
                <div className="pt-pay-amount">
                  <dt>Оплачено</dt>
                  <dd className="pt-data">
                    {formatPortalMoney(payment.paidMinor, payment.currency)}
                  </dd>
                </div>
                <div className="pt-pay-amount">
                  <dt>Осталось</dt>
                  <dd className="pt-data">
                    {formatPortalMoney(payment.outstandingMinor, payment.currency)}
                  </dd>
                </div>
                {payment.refundedMinor > 0 ? (
                  <div className="pt-pay-amount">
                    <dt>Возвращено</dt>
                    <dd className="pt-data">
                      {formatPortalMoney(payment.refundedMinor, payment.currency)}
                    </dd>
                  </div>
                ) : null}
              </dl>

              {payment.nextAction ? (
                <p className="pt-next-step">
                  <span className="pt-next-step-label">Следующий шаг:</span>{" "}
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
