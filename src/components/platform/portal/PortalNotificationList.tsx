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
        const isV2 = "eventCode" in notification;
        const subjectLabel = isV2
          ? notification.subjectLabel
          : notification.requirementLabel;
        const detail = isV2 ? notification.detail : notification.reason;
        const title = notification.category === "task.overdue"
          ? copy.taskOverdue
          : notification.category === "payment.overdue"
            ? copy.paymentOverdue
            : (isV2 ? notification.eventCode : notification.decision) ===
                "correction_required"
              ? copy.documentCorrectionRequired
              : copy.documentRejected;
        const destination = notification.category === "task.overdue"
          ? "/portal"
          : notification.category === "payment.overdue"
            ? "/portal/payments"
            : "/portal/documents";
        const destinationCopy = notification.category === "task.overdue"
          ? copy.viewNotificationTask
          : notification.category === "payment.overdue"
            ? copy.viewNotificationPayment
            : copy.viewNotificationDocument;
        const icon = notification.category === "payment.overdue"
          ? "payments"
          : notification.category === "task.overdue"
            ? "alert"
            : "documents";
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
            data-notification-category={notification.category}
          >
            <div className={styles.cardIdentity}>
              <span className={styles.cardIcon} aria-hidden="true">
                <PortalIcon name={icon} size={19} />
              </span>
              <div>
                <div
                  className={styles.cardTitle}
                  data-testid="portal-notification-subject"
                >
                  {title}
                  {": "}
                  {subjectLabel}
                </div>
                <div className={styles.cardMeta}>
                  {formatPortalDate(notification.createdAt, locale, true)}
                  {" · "}
                  {notification.isRead
                    ? copy.notificationMarkedRead
                    : copy.unread}
                </div>
                {isV2 && notification.dueAt && (
                  <div
                    className={styles.cardMeta}
                    data-testid="portal-notification-due-at"
                  >
                    {copy.notificationDueAt}:{" "}
                    {formatPortalDate(notification.dueAt, locale, true)}
                  </div>
                )}
              </div>
            </div>
            <div
              className={styles.comment}
              data-testid="portal-notification-detail"
            >
              {detail}
            </div>
            <div className={styles.teamActions}>
              <Link
                href={destination}
                className={styles.buttonSecondary}
                data-testid="portal-notification-destination"
              >
                {destinationCopy}
              </Link>
              {!notification.isRead && (
                <form action={markRead}>
                  <button
                    type="submit"
                    className={styles.buttonSecondary}
                    data-testid="portal-notification-mark-read"
                    aria-label={`${copy.markNotificationRead}: ${subjectLabel}`}
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
