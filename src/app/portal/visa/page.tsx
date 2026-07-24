import {
  formatPortalDate,
  PortalHelpActions,
  PortalMissingCase,
  PortalNotice,
  PortalPageHeader,
  PortalPanel,
  PortalStatusBadge,
  portalStyles as styles,
} from "@/components/platform/portal/PortalPrimitives";
import { PortalIcon } from "@/components/platform/portal/PortalIcon";
import { getPortalCopy } from "@/components/platform/portal/portal-copy";
import { VISA_STATUSES } from "@/lib/domain";
import { getPortalPageData } from "@/lib/portal";

export default async function PortalVisaPage() {
  const { snapshot, locale, t } = await getPortalPageData();
  const copy = getPortalCopy(locale);
  if (!snapshot) return <PortalMissingCase copy={copy} />;

  const currentIndex = snapshot.visa ? VISA_STATUSES.indexOf(snapshot.visa.status) : -1;

  return (
    <>
      <PortalPageHeader title={copy.visaTitle} description={copy.visaDescription} />
      {!snapshot.visa ? (
        <div className={styles.twoColumn}>
          <div className={styles.emptyState}>
            <div>
              <span className={styles.emptyIcon}>
                <PortalIcon name="visa" size={24} />
              </span>
              <div className={styles.emptyTitle}>{copy.noVisaTitle}</div>
              <p className={styles.emptyBody}>{copy.noVisaBody}</p>
            </div>
          </div>
          <aside className={styles.stack}>
            <PortalNotice title={copy.visaHelpTitle} body={copy.visaHelpBody} />
            <PortalHelpActions snapshot={snapshot} copy={copy} />
          </aside>
        </div>
      ) : (
        <div className={styles.twoColumn}>
          <div className={styles.stack}>
            <PortalPanel title={copy.visaCase}>
              <div className={styles.cardTop}>
                <div className={styles.cardIdentity}>
                  <span className={styles.cardIcon}>
                    <PortalIcon name="visa" size={20} />
                  </span>
                  <div>
                    <div className={styles.cardTitle}>{snapshot.visa.country}</div>
                    <div className={styles.cardMeta}>{copy.visaDescription}</div>
                  </div>
                </div>
                <PortalStatusBadge
                  value={snapshot.visa.status}
                  label={t(`visa.${snapshot.visa.status}`)}
                />
              </div>
              <div className={styles.detailGrid} style={{ marginTop: 18 }}>
                <div>
                  <div className={styles.detailLabel}>{copy.appointment}</div>
                  <div className={styles.detailValue}>
                    {formatPortalDate(snapshot.visa.appointmentAt, locale, true) ?? copy.notAssigned}
                  </div>
                </div>
                <div>
                  <div className={styles.detailLabel}>{copy.country}</div>
                  <div className={styles.detailValue}>{snapshot.visa.country}</div>
                </div>
              </div>
              {snapshot.visa.notes && (
                <div className={styles.comment}>
                  <strong>{copy.notes}:</strong> {snapshot.visa.notes}
                </div>
              )}
            </PortalPanel>

            <PortalPanel title={copy.visaJourney}>
              <ol className={styles.feed}>
                {VISA_STATUSES.map((status, index) => {
                  const complete = index < currentIndex;
                  const current = index === currentIndex;
                  return (
                    <li key={status} className={styles.feedItem}>
                      <div className={styles.cardTop}>
                        <div className={styles.cardTitle}>{t(`visa.${status}`)}</div>
                        <PortalStatusBadge
                          value={complete ? "complete" : current ? "info" : "neutral"}
                          label={
                            complete
                              ? t("portalStage.complete")
                              : current
                                ? t("portalStage.current")
                                : t("portalStage.locked")
                          }
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </PortalPanel>
          </div>

          <aside className={styles.stack}>
            <PortalNotice title={copy.visaHelpTitle} body={copy.visaHelpBody} />
            <section className={`${styles.panel} ${styles.panelPadding}`}>
              <h2 className={styles.panelTitle}>{copy.supportTeam}</h2>
              <PortalHelpActions snapshot={snapshot} copy={copy} />
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
