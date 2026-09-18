import Link from "next/link";
import type { StudentPortalNotification } from "@/lib/v3/portal-source";

import { PortalEmptyState, PortalSection } from "./PortalPage";
import { PortalMarkAllReadButton } from "./PortalMarkAllReadButton";
import { PortalNotificationReadButton } from "./PortalNotificationReadButton";
import { PortalStatus } from "./PortalStatus";
import { formatPortalTimestamp, portalNotificationTarget } from "./presentation";

export type MarkPortalNotificationReadAction = (
  formData: FormData,
) => void | Promise<void>;

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
      <PortalEmptyState
        title="Новых уведомлений нет"
        description="Здесь появятся важные изменения и сроки по вашему поступлению."
      />
    );
  }

  const hasUnread = notifications.some((notification) => notification.readAt === null);

  return (
    <PortalSection
      title="Все уведомления"
      description="Время и сроки указаны по времени Бишкека."
      action={hasUnread ? (
        <form action={markAllReadAction}>
          <PortalMarkAllReadButton />
        </form>
      ) : null}
    >
      <ul className="divide-y divide-border" aria-live="polite">
        {notifications.map((notification) => {
          const unread = notification.readAt === null;
          const createdLabel = formatPortalTimestamp(notification.createdAt);
          const dueLabel = formatPortalTimestamp(notification.dueAt);
          const target = portalNotificationTarget(notification);

          return (
            <li
              key={notification.notificationId}
              className={`px-4 py-5 sm:px-5 ${unread ? "bg-surface-2/55" : ""}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3
                      className={`text-sm leading-6 text-fg ${
                        unread ? "font-semibold" : "font-medium"
                      }`}
                    >
                      {notification.subjectLabel}
                    </h3>
                    {unread ? (
                      <PortalStatus label="Новое" tone="info" />
                    ) : null}
                  </div>
                  {notification.detail ? (
                    <p className="mt-1 max-w-[760px] break-words text-sm leading-6 text-fg-2">
                      {notification.detail}
                    </p>
                  ) : null}
                  {createdLabel || dueLabel ? (
                    <p className="mt-2 text-xs text-fg-3">
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
                  <Link
                    href={target.href}
                    className="mt-2 inline-flex min-h-11 items-center font-medium text-accent-text underline underline-offset-4"
                  >
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
    </PortalSection>
  );
}
