import Link from "next/link";
import type { StudentPortalNotification } from "@/lib/v3/portal-source";

import { PortalMarkAllReadButton } from "./PortalMarkAllReadButton";
import { PortalNotificationReadButton } from "./PortalNotificationReadButton";
import { PortalStatus } from "./PortalStatus";
import { formatPortalTimestamp, portalNotificationTarget } from "./presentation";

export type MarkPortalNotificationReadAction = (
  formData: FormData,
) => void | Promise<void>;

/**
 * «Уведомления» в Атласе (PORT-5d): те же события и server actions прочтения;
 * непрочитанные подсвечены, каждый пункт ведёт к реальному доступному объекту.
 */
export function NotificationsView({
  notifications,
  markReadAction,
  markAllReadAction,
}: {
  notifications: readonly StudentPortalNotification[];
  markReadAction: MarkPortalNotificationReadAction;
  markAllReadAction: MarkPortalNotificationReadAction;
}) {
  if (notifications.length === 0) {
    return (
      <section className="pt-adm-empty">
        <h2 className="pt-section-title">Новых уведомлений нет</h2>
        <p className="pt-adm-empty-body">
          Здесь появятся важные изменения и сроки по вашему поступлению.
        </p>
      </section>
    );
  }

  const hasUnread = notifications.some((notification) => notification.readAt === null);

  return (
    <section className="pt-card">
      <header className="pt-card-header">
        <div className="pt-card-header-main">
          <h2 className="pt-card-title">Все уведомления</h2>
          <p className="pt-card-note">Время и сроки указаны по времени Бишкека.</p>
        </div>
        {hasUnread ? (
          <form action={markAllReadAction}>
            <PortalMarkAllReadButton />
          </form>
        ) : null}
      </header>
      <ul className="pt-adm-list" aria-live="polite">
        {notifications.map((notification) => {
          const unread = notification.readAt === null;
          const createdLabel = formatPortalTimestamp(notification.createdAt);
          const dueLabel = formatPortalTimestamp(notification.dueAt);
          const target = portalNotificationTarget(notification);

          return (
            <li
              key={notification.notificationId}
              className={unread ? "pt-ntf-item pt-ntf-item-unread" : "pt-ntf-item"}
            >
              <div className="pt-ntf-item-head">
                <div className="pt-ntf-item-main">
                  <div className="pt-ntf-item-title-row">
                    <h3 className={unread ? "pt-ntf-item-title pt-ntf-item-title-unread" : "pt-ntf-item-title"}>
                      {notification.subjectLabel}
                    </h3>
                    {unread ? (
                      <PortalStatus label="Новое" tone="info" />
                    ) : null}
                  </div>
                  {notification.detail ? (
                    <p className="pt-ntf-item-detail">
                      {notification.detail}
                    </p>
                  ) : null}
                  {createdLabel || dueLabel ? (
                    <p className="pt-ntf-item-meta">
                      {createdLabel ? (
                        <time dateTime={notification.createdAt}>{createdLabel}</time>
                      ) : (
                        "Дата недоступна"
                      )}
                      {dueLabel ? (
                        <>
                          {" · Срок: "}
                          <time dateTime={notification.dueAt ?? undefined}>
                            {dueLabel}
                          </time>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                  <Link href={target.href} className="pt-link pt-ntf-item-link">
                    {target.label}
                  </Link>
                </div>

                {unread ? (
                  <form action={markReadAction}>
                    <input
                      type="hidden"
                      name="notification_id"
                      value={notification.notificationId}
                    />
                    <PortalNotificationReadButton />
                  </form>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
