import { PortalEmptyState, PortalSection } from "./PortalPage";
import type { PortalNotificationsView as PortalNotificationsViewModel } from "./types";

export type MarkPortalNotificationReadAction = (
  formData: FormData,
) => void | Promise<void>;

export function NotificationsView({
  view,
  markReadAction,
}: {
  view: PortalNotificationsViewModel;
  markReadAction: MarkPortalNotificationReadAction;
}) {
  if (view.notifications.length === 0) {
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
        {view.notifications.map((notification) => (
          <li
            key={notification.notificationId}
            className={`px-4 py-5 sm:px-5 ${notification.read ? "" : "bg-surface-2/55"}`}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3
                    className={`text-sm leading-6 text-fg ${
                      notification.read ? "font-medium" : "font-semibold"
                    }`}
                  >
                    {notification.subject}
                  </h3>
                  {!notification.read ? (
                    <span className="rounded-[5px] bg-info-weak px-1.5 py-0.5 text-2xs font-medium text-info">
                      Новое
                    </span>
                  ) : null}
                </div>
                {notification.detail ? (
                  <p className="mt-1 max-w-[760px] text-sm leading-6 text-fg-2">
                    {notification.detail}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-fg-3">
                  {notification.createdLabel}
                  {notification.dueLabel ? ` · Срок: ${notification.dueLabel}` : ""}
                </p>
              </div>

              {!notification.read ? (
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
        ))}
      </ul>
    </PortalSection>
  );
}
