import { randomUUID } from "node:crypto";

import Link from "next/link";

import type { StudentPortalNotification } from "@/lib/contracts/student-portal";
import type { Locale } from "@/lib/i18n-data";
import { markOwnStudentPortalNotificationReadAction } from "@/lib/platform-portal-notification-actions";

import { PortalIcon } from "./PortalIcon";
import {
  formatPortalDate,
  PortalEmptyState,
} from "./PortalPrimitives";
import type { PortalCopy } from "./portal-copy";
import styles from "./portal.module.css";

export function PortalNotificationList({
  notifications,
  locale,
  copy,
}: {
  notifications: readonly StudentPortalNotification[];
  locale: Locale;
  copy: PortalCopy;
}) {
  if (notifications.length === 0) {
    return (
      <PortalEmptyState
        icon="notifications"
        title={copy.noNotificationsTitle}
        body={copy.noDurableNotificationsBody}
      />
    );
  }

  return (
    <div className={styles.listGrid} data-testid="portal-notification-list">
      {notifications.map((notification) => {
        const requestId = randomUUID();
        const markRead = markOwnStudentPortalNotificationReadAction.bind(
          null,
          notification.id,
          requestId,
        );
        return (
          <article
            key={notification.id}
            className={styles.notificationCard}
            data-testid="portal-notification-row"
          >
            <div className={styles.cardIdentity}>
              <span className={styles.cardIcon} aria-hidden="true">
                <PortalIcon name="documents" size={19} />
              </span>
              <div>
                <div className={styles.cardTitle}>
                  {notification.decision === "correction_required"
                    ? copy.documentCorrectionRequired
                    : copy.documentRejected}
                  {": "}
                  {notification.requirementLabel}
                </div>
                <div className={styles.cardMeta}>
                  {formatPortalDate(notification.createdAt, locale, true)}
                  {" · "}
                  {notification.isRead
                    ? copy.notificationMarkedRead
                    : copy.unread}
                </div>
              </div>
            </div>
            <div className={styles.comment}>{notification.reason}</div>
            <div className={styles.teamActions}>
              <Link href="/portal/documents" className={styles.buttonSecondary}>
                {copy.viewNotificationDocument}
              </Link>
              {!notification.isRead && (
                <form action={markRead}>
                  <button
                    type="submit"
                    className={styles.buttonSecondary}
                    data-testid="portal-notification-mark-read"
                    aria-label={`${copy.markNotificationRead}: ${notification.requirementLabel}`}
                  >
                    {copy.markNotificationRead}
                  </button>
                </form>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
