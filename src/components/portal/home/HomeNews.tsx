import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings } from "@/lib/portal/i18n";
import type { StudentPortalNotification } from "@/lib/v3/portal-source";

import { formatPortalTimestamp, portalNotificationTarget, portalNotificationText } from "../admission/presentation";

/** Сколько последних событий видно на «Главной»; вся лента — во «Входящих». */
const HOME_NEWS_LIMIT = 3;

/**
 * «Что нового» на «Главной» (03.11.2026, по образцу кабинета пользователя,
 * вместо «Учёбы и тестов»): последние события ленты «Входящих» — та же
 * модель E2 и те же подписи и цели, что у NotificationsView; непрочитанное
 * отмечено точкой и словом для скринридера. Отметка «прочитано» — во
 * «Входящих». `null` — чтение не удалось (честная плашка).
 */
export function HomeNews({ notifications, locale }: Readonly<{
  notifications: readonly StudentPortalNotification[] | null;
  locale: Locale;
}>) {
  const strings = getPortalStrings("home", locale);
  const messages = getPortalStrings("messages", locale);
  const admission = getPortalStrings("admission", locale);
  const latest = notifications === null
    ? null
    : [...notifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, HOME_NEWS_LIMIT);
  const unread = notifications?.filter((item) => item.readAt === null).length ?? 0;

  return (
    <section aria-labelledby="home-news" className="pt-card pt-home-news">
      <div className="pt-home-news-head">
        <h2 id="home-news" className="pt-home-dates-title">
          {messages.updatesTitle}
          {unread > 0 ? <span className="pt-count">{unread}</span> : null}
        </h2>
        {latest && latest.length > 0 ? (
          <IntentPrefetchLink href="/portal/messages?view=updates" className="pt-link">
            {strings.newsAll}
          </IntentPrefetchLink>
        ) : null}
      </div>
      {latest === null ? (
        <p role="alert" className="pt-alert">{messages.updatesUnavailable}</p>
      ) : latest.length === 0 ? (
        <p className="pt-home-news-empty">{admission.notificationsEmptyTitle}</p>
      ) : (
        <ul className="pt-home-news-list">
          {latest.map((item) => {
            const text = portalNotificationText(item, admission);
            const created = formatPortalTimestamp(item.createdAt);
            return (
              <li key={item.notificationId}>
                <IntentPrefetchLink
                  href={portalNotificationTarget(item, admission).href}
                  className="pt-home-news-row"
                  data-unread={item.readAt === null ? "" : undefined}
                >
                  <span className="pt-home-news-title">
                    {item.readAt === null ? <span className="pt-sr-only">{admission.statusNew}: </span> : null}
                    {text.title}
                  </span>
                  {created ? <time dateTime={item.createdAt} className="pt-home-news-time">{created}</time> : null}
                </IntentPrefetchLink>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
