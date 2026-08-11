import Link from "next/link";

import {
  formatPortalDate,
  nextActionHref,
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
import {
  isPlatformP6APortalAttentionEnabled,
  shouldShowPortalNextActionForP6A,
} from "@/lib/server/platform-p6a-portal-attention";

export default async function PortalNotificationsPage() {
  const { snapshot, locale, t } = await getPortalPageData();
  const copy = getPortalCopy(locale);
  if (!snapshot) return <PortalMissingCase copy={copy} />;

  const portalAttentionEnabled = isPlatformP6APortalAttentionEnabled();
  const visibleNextAction =
    snapshot.nextAction &&
    shouldShowPortalNextActionForP6A(
      snapshot.nextAction,
      portalAttentionEnabled,
    )
      ? snapshot.nextAction
      : null;
  const unreadUpdates = snapshot.updates.filter((update) => !update.isRead);

  return (
    <>
      <PortalPageHeader
        title={copy.notificationsTitle}
        description={
          portalAttentionEnabled
            ? copy.notificationsP6ADescription
            : copy.notificationsDescription
        }
      />
      <div className={styles.twoColumn}>
        <div className={styles.stack}>
          {visibleNextAction && (
            <section
              className={`${styles.panel} ${styles.panelPadding}`}
              aria-labelledby={
                portalAttentionEnabled ? "portal-attention-read-only-title" : undefined
              }
              data-testid={
                portalAttentionEnabled ? "portal-attention-read-only" : undefined
              }
            >
              <div className={styles.panelTitleRow}>
                <h2
                  id={
                    portalAttentionEnabled ? "portal-attention-read-only-title" : undefined
                  }
                  className={styles.panelTitle}
                >
                  {copy.attentionNow}
                </h2>
                <PortalStatusBadge
                  value={visibleNextAction.severity}
                  label={
                    visibleNextAction.severity === "urgent"
                      ? copy.urgent
                      : visibleNextAction.severity === "warning"
                        ? copy.warning
                        : copy.normal
                  }
                />
              </div>
              <div className={styles.cardTitle}>{visibleNextAction.detail}</div>
              <div className={styles.cardMeta}>
                {t(visibleNextAction.labelKey)}
                {visibleNextAction.dueDate
                  ? ` · ${copy.due}: ${formatPortalDate(visibleNextAction.dueDate, locale)}`
                  : ""}
              </div>
              <div className={styles.teamActions}>
                <Link href={nextActionHref(visibleNextAction)} className={styles.button}>
                  {copy.viewAll}
                  <PortalIcon name="chevron-right" size={16} />
                </Link>
              </div>
            </section>
          )}

          <section className={`${styles.panel} ${styles.panelPadding}`} aria-labelledby="recent-notifications">
            <div className={styles.panelTitleRow}>
              <h2 id="recent-notifications" className={styles.panelTitle}>
                {copy.recentNotifications}
              </h2>
            </div>
            {unreadUpdates.length === 0 ? (
              <PortalEmptyState
                icon="notifications"
                title={copy.noNotificationsTitle}
                body={copy.noNotificationsBody}
              />
            ) : (
              <div className={styles.listGrid}>
                {unreadUpdates.map((update) => (
                  <article key={update.id} className={styles.notificationCard}>
                    <div className={styles.cardIdentity}>
                      <span className={styles.cardIcon}>
                        <PortalIcon name="notifications" size={19} />
                      </span>
                      <div>
                        <div className={styles.cardTitle}>{update.message}</div>
                        <div className={styles.cardMeta}>
                          {update.authorName ?? "EVO Admissions"} ·{" "}
                          {formatPortalDate(update.createdAt, locale, true)}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className={styles.stack}>
          <PortalNotice
            title={copy.notificationReadOnlyTitle}
            body={copy.notificationReadOnlyBody}
          />
          <Link href="/portal/messages" className={styles.buttonSecondary}>
            <PortalIcon name="messages" size={17} />
            {copy.messages}
          </Link>
        </aside>
      </div>
    </>
  );
}
