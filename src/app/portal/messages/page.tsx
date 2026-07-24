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
import { getPortalCopy } from "@/components/platform/portal/portal-copy";
import { getPortalPageData } from "@/lib/portal";

export default async function PortalMessagesPage() {
  const { snapshot, locale } = await getPortalPageData();
  const copy = getPortalCopy(locale);
  if (!snapshot) return <PortalMissingCase copy={copy} />;

  return (
    <>
      <PortalPageHeader title={copy.messagesTitle} description={copy.messagesDescription} />
      <div className={styles.twoColumn}>
        <section className={`${styles.panel} ${styles.panelPadding}`} aria-labelledby="portal-update-feed">
          <div className={styles.panelTitleRow}>
            <h2 id="portal-update-feed" className={styles.panelTitle}>
              {copy.updateFeed}
            </h2>
          </div>
          {snapshot.updates.length === 0 ? (
            <PortalEmptyState
              icon="messages"
              title={copy.noMessagesTitle}
              body={copy.noMessagesBody}
            />
          ) : (
            <ol className={styles.feed}>
              {snapshot.updates.map((update) => (
                <li key={update.id} className={styles.feedItem}>
                  <div className={styles.feedText}>{update.message}</div>
                  <div className={styles.feedMeta}>
                    <span>{update.authorName ?? "EVO Admissions"}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={update.createdAt}>
                      {formatPortalDate(update.createdAt, locale, true)}
                    </time>
                    <PortalStatusBadge
                      value={update.isRead ? "complete" : "info"}
                      label={update.isRead ? copy.read : copy.unread}
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className={styles.stack}>
          <PortalNotice
            title={copy.sendingUnavailableTitle}
            body={copy.sendingUnavailableBody}
            tone="warning"
          />
          <section className={`${styles.panel} ${styles.panelPadding}`}>
            <h2 className={styles.panelTitle}>{copy.supportTeam}</h2>
            <p className={styles.cardMeta}>{copy.sendingUnavailableBody}</p>
            <PortalHelpActions snapshot={snapshot} copy={copy} />
          </section>
        </aside>
      </div>
    </>
  );
}
