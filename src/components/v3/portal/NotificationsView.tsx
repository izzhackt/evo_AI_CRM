import type { StudentPortalNotification } from "@/lib/v3/portal-source";

import { PortalEmptyState, PortalSection } from "./PortalPage";
import { PortalStatus } from "./PortalStatus";
import { formatPortalTimestamp } from "./presentation";

export type MarkPortalNotificationReadAction = (
  formData: FormData,
) => void | Promise<void>;

export function NotificationsView({
  notifications,
  markReadAction,
}: {
  notifications: readonly StudentPortalNotification[];
  markReadAction: MarkPortalNotificationReadAction;
}) {
  if (notifications.length === 0) {
    return (
      <PortalEmptyState
        title="Новых уведомлений нет"
        description="Безопасные обновления по вашему поступлению появятся здесь."
      />
    );
  }

  return (
    <PortalSection title="Все уведомления">
      <ul className="divide-y divide-border" aria-live="polite">
        {notifications.map((notification) => {
          const unread = notification.readAt === null;
          const createdLabel = formatPortalTimestamp(notification.createdAt);
          const dueLabel = formatPortalTimestamp(notification.dueAt);

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
                    <p className="mt-1 max-w-[760px] text-sm leading-6 text-fg-2">
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
                </div>

                {unread ? (
                  <form action={markReadAction}>
                    <input
                      type="hidden"
                      name="notification_id"
                      value={notification.notificationId}
                    />
                    <button
                      type="submit"
                      className="inline-flex min-h-10 items-center justify-center rounded-nav border border-control-edge bg-surface px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
                    >
                      Отметить прочитанным
                    </button>
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
