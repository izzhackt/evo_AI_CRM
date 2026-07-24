import {
  formatPortalDate,
  formatPortalMoney,
  PortalEmptyState,
  PortalHelpActions,
  PortalMissingCase,
  PortalNotice,
  PortalPageHeader,
  PortalStatusBadge,
  portalStyles as styles,
} from "@/components/platform/portal/PortalPrimitives";
import { PortalIcon } from "@/components/platform/portal/PortalIcon";
import { getPortalCopy } from "@/components/platform/portal/portal-copy";
import { getPortalPageData } from "@/lib/portal";

export default async function PortalPaymentsPage() {
  const { snapshot, locale, t } = await getPortalPageData();
  const copy = getPortalCopy(locale);
  if (!snapshot) return <PortalMissingCase copy={copy} />;

  return (
    <>
      <PortalPageHeader title={copy.paymentsTitle} description={copy.paymentsDescription} />
      <div className={styles.twoColumn}>
        <section className={styles.listGrid} aria-label={copy.paymentsTitle}>
          {snapshot.payments.length === 0 ? (
            <PortalEmptyState
              icon="payments"
              title={copy.noPaymentsTitle}
              body={copy.noPaymentsBody}
            />
          ) : (
            snapshot.payments.map((payment) => (
              <article
                key={payment.id}
                className={`${styles.paymentCard} ${
                  payment.status === "overdue" ? styles.paymentCardDanger : ""
                }`}
              >
                <div className={styles.cardTop}>
                  <div className={styles.cardIdentity}>
                    <span className={styles.cardIcon}>
                      <PortalIcon name="payments" size={19} />
                    </span>
                    <div>
                      <div className={styles.cardTitle}>{payment.title}</div>
                      <div className={styles.cardMeta}>
                        {copy.due}: {formatPortalDate(payment.dueDate, locale) ?? copy.notAssigned}
                      </div>
                    </div>
                  </div>
                  <PortalStatusBadge value={payment.status} label={t(`pay.${payment.status}`)} />
                </div>
                <div className={styles.detailGrid} style={{ marginTop: 16 }}>
                  <div>
                    <div className={styles.detailLabel}>{copy.amount}</div>
                    <div className={styles.detailValue}>
                      {formatPortalMoney(payment.amount, payment.currency, locale)}
                    </div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>{copy.paidAt}</div>
                    <div className={styles.detailValue}>
                      {formatPortalDate(payment.paidAt, locale) ?? copy.notAssigned}
                    </div>
                  </div>
                </div>
              </article>
            ))
          )}
        </section>

        <aside className={styles.stack}>
          <PortalNotice
            title={copy.paymentUnavailableTitle}
            body={copy.paymentUnavailableBody}
            tone={snapshot.payments.some((payment) => payment.status === "overdue") ? "danger" : "warning"}
          />
          <PortalNotice title={copy.paymentsTitle} body={copy.paymentBoundary} />
          <section className={`${styles.panel} ${styles.panelPadding}`}>
            <h2 className={styles.panelTitle}>{copy.supportTeam}</h2>
            <PortalHelpActions snapshot={snapshot} copy={copy} />
          </section>
        </aside>
      </div>
    </>
  );
}
