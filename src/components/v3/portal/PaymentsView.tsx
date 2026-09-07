import { PortalEmptyState, PortalSection } from "./PortalPage";
import { PortalStatus } from "./PortalStatus";
import type { PortalPaymentsView as PortalPaymentsViewModel } from "./types";

export function PaymentsView({ view }: { view: PortalPaymentsViewModel }) {
  if (view.payments.length === 0) {
    return (
      <PortalEmptyState
        title="Платёжных обязательств пока нет"
        description="Когда обязательство будет опубликовано для вашего дела, оно появится здесь."
      />
    );
  }

  return (
    <PortalSection title="Платёжные обязательства">
      <ul className="divide-y divide-border">
        {view.payments.map((payment) => (
          <li key={payment.paymentObligationId} className="px-4 py-5 sm:px-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold leading-6 text-fg">
                  {payment.label}
                </h3>
                {payment.dueLabel ? (
                  <p className="mt-1 text-xs text-fg-3">Срок: {payment.dueLabel}</p>
                ) : null}
              </div>
              <PortalStatus status={payment.status} />
            </div>

            <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-fg-3">К оплате</dt>
                <dd className="mt-1 font-mono text-sm font-semibold tabular-nums text-fg">
                  {payment.amountLabel}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-fg-3">Оплачено</dt>
                <dd className="mt-1 font-mono text-sm font-semibold tabular-nums text-fg">
                  {payment.paidLabel}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-fg-3">Осталось</dt>
                <dd className="mt-1 font-mono text-sm font-semibold tabular-nums text-fg">
                  {payment.outstandingLabel}
                </dd>
              </div>
            </dl>

            {payment.nextAction ? (
              <p className="mt-4 rounded-nav bg-surface-2 px-3 py-3 text-sm leading-6 text-fg-2">
                <span className="font-semibold text-fg">Следующий шаг:</span>{" "}
                {payment.nextAction}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </PortalSection>
  );
}
