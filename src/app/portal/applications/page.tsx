import {
  formatPortalDate,
  PortalEmptyState,
  PortalMissingCase,
  PortalNotice,
  PortalPageHeader,
  PortalStatusBadge,
  portalStyles as styles,
} from "@/components/platform/portal/PortalPrimitives";
import { PortalIcon } from "@/components/platform/portal/PortalIcon";
import { getPortalCopy } from "@/components/platform/portal/portal-copy";
import { getPortalPageData } from "@/lib/portal";

export default async function PortalApplicationsPage() {
  const { snapshot, locale, t } = await getPortalPageData();
  const copy = getPortalCopy(locale);
  if (!snapshot) return <PortalMissingCase copy={copy} />;

  return (
    <>
      <PortalPageHeader title={copy.applicationsTitle} description={copy.applicationsDescription} />
      <div className={styles.twoColumn}>
        <section className={styles.listGrid} aria-label={copy.applicationsTitle}>
          {snapshot.applications.length === 0 ? (
            <PortalEmptyState
              icon="applications"
              title={copy.noApplicationsTitle}
              body={copy.noApplicationsBody}
            />
          ) : (
            snapshot.applications.map((application) => (
              <article key={application.id} className={styles.applicationCard}>
                <div className={styles.cardTop}>
                  <div className={styles.cardIdentity}>
                    <span className={styles.cardIcon}>
                      <PortalIcon name="applications" size={19} />
                    </span>
                    <div>
                      <div className={styles.cardTitle}>{application.university}</div>
                      <div className={styles.cardMeta}>
                        {[application.program, application.degree, application.country]
                          .filter(Boolean)
                          .join(" · ") || copy.notAssigned}
                      </div>
                    </div>
                  </div>
                  <PortalStatusBadge
                    value={application.status}
                    label={t(`app.${application.status}`)}
                  />
                </div>
                <div className={styles.detailGrid} style={{ marginTop: 16 }}>
                  <div>
                    <div className={styles.detailLabel}>{copy.deadline}</div>
                    <div className={styles.detailValue}>
                      {formatPortalDate(application.deadline, locale) ?? copy.notAssigned}
                    </div>
                  </div>
                  <div>
                    <div className={styles.detailLabel}>{copy.country}</div>
                    <div className={styles.detailValue}>{application.country ?? copy.notAssigned}</div>
                  </div>
                </div>
                {application.notes && (
                  <div className={styles.comment}>
                    <strong>{copy.notes}:</strong> {application.notes}
                  </div>
                )}
              </article>
            ))
          )}
        </section>

        <aside className={styles.stack}>
          <PortalNotice
            title={copy.applicationReadOnlyTitle}
            body={copy.applicationReadOnlyBody}
          />
          <section className={`${styles.panel} ${styles.panelPadding}`}>
            <h2 className={styles.panelTitle}>{copy.journey}</h2>
            <p className={styles.cardMeta}>
              {copy.applicationsDescription} {copy.applicationReadOnlyBody}
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
