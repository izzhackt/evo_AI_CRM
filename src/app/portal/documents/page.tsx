import {
  formatPortalDate,
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

export default async function PortalDocumentsPage() {
  const { snapshot, locale, t } = await getPortalPageData();
  const copy = getPortalCopy(locale);
  if (!snapshot) return <PortalMissingCase copy={copy} />;

  const approved = snapshot.documents.filter((document) => document.status === "approved").length;
  const inReview = snapshot.documents.filter((document) =>
    ["uploaded", "review"].includes(document.status),
  ).length;
  const needsAction = snapshot.documents.filter((document) =>
    ["required", "rejected"].includes(document.status),
  ).length;

  return (
    <>
      <PortalPageHeader title={copy.documentsTitle} description={copy.documentsDescription} />
      <div className={styles.summaryGrid} aria-label={copy.documentReadiness}>
        <div className={styles.summaryItem}>
          <div className={styles.summaryValue}>{approved}</div>
          <div className={styles.summaryLabel}>{copy.accepted}</div>
        </div>
        <div className={styles.summaryItem}>
          <div className={styles.summaryValue}>{inReview}</div>
          <div className={styles.summaryLabel}>{copy.inReview}</div>
        </div>
        <div className={styles.summaryItem}>
          <div className={styles.summaryValue}>{needsAction}</div>
          <div className={styles.summaryLabel}>{copy.needsAction}</div>
        </div>
      </div>

      <div className={styles.twoColumn}>
        <section className={styles.listGrid} aria-label={copy.documentsTitle}>
          {snapshot.documents.length === 0 ? (
            <PortalEmptyState
              icon="documents"
              title={copy.noDocumentsTitle}
              body={copy.noDocumentsBody}
            />
          ) : (
            snapshot.documents.map((document) => {
              const needsCorrection = document.status === "rejected";
              return (
                <article
                  id={`document-${document.id}`}
                  key={document.id}
                  className={`${styles.documentCard} ${
                    needsCorrection ? styles.documentCardDanger : ""
                  }`}
                >
                  <div className={styles.cardTop}>
                    <div className={styles.cardIdentity}>
                      <span className={styles.cardIcon}>
                        <PortalIcon name="applications" size={19} />
                      </span>
                      <div>
                        <div className={styles.cardTitle}>{document.name}</div>
                        <div className={styles.cardMeta}>
                          {copy.updated}: {formatPortalDate(document.updatedAt, locale, true)}
                        </div>
                      </div>
                    </div>
                    <PortalStatusBadge
                      value={document.status}
                      label={t(`doc.${document.status}`)}
                    />
                  </div>
                  {document.comment && (
                    <div className={styles.comment}>
                      <strong>{copy.curatorComment}:</strong> {document.comment}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </section>

        <aside className={styles.stack}>
          <PortalNotice
            title={copy.uploadUnavailableTitle}
            body={copy.uploadUnavailableBody}
            tone={needsAction > 0 ? "warning" : "info"}
          />
          <section className={`${styles.panel} ${styles.panelPadding}`}>
            <h2 className={styles.panelTitle}>{copy.requestDocumentHelp}</h2>
            <p className={styles.cardMeta}>{copy.uploadUnavailableBody}</p>
            <PortalHelpActions snapshot={snapshot} copy={copy} />
          </section>
        </aside>
      </div>
    </>
  );
}
