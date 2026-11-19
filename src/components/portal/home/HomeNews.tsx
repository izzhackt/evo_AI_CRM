import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import { homeTimeLabel } from "@/lib/portal/home-dates";
import { getPortalStrings } from "@/lib/portal/i18n";
import type { StudentPortalNotification } from "@/lib/v3/portal-source";

import {
  formatPortalTimestamp,
  portalNotificationKind,
  portalNotificationTarget,
  portalNotificationText,
  type PortalNotificationKind,
} from "../admission/presentation";
import { HomeCardHead, HomeEmpty, HomeIcon, type HomeIconName } from "./HomeParts";

/** Сколько последних событий видно на «Главной»; вся лента — во «Входящих». */
const HOME_NEWS_LIMIT = 3;

const KIND_ICON: Record<PortalNotificationKind, HomeIconName> = {
  package: "todo",
  document: "documents",
  message: "news",
  payment: "payments",
  other: "bell",
};

/**
 * «Что нового» на «Главной» (03.11.2026, по образцу кабинета пользователя,
 * вместо «Учёбы и тестов»): последние события ленты «Входящих» — та же
 * модель E2 и те же подписи и цели, что у NotificationsView; непрочитанное
 * отмечено точкой и словом для скринридера. Отметка «прочитано» — во
 * «Входящих». `null` — чтение не удалось (честная плашка). Пусто — значок,
 * заголовок и строка о том, что сюда попадёт (08.11.2026, образец пользователя). 18.11.2026: строка как у дел —
 * слева серая плитка со значком вида события (без цвета), время словом («сегодня, 14:00», «вчера», «3 дня назад»),
 * у непрочитанного — красная точка на плитке; точное время — в `<time dateTime>` и подсказке.
 */
export function HomeNews({ notifications, now, locale }: Readonly<{
  notifications: readonly StudentPortalNotification[] | null;
  /** Момент запроса: от него «сегодня», «вчера», «N дней назад». */
  now: Date;
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
    <section aria-labelledby="home-news" className="pt-card pt-home-box pt-home-news">
      <HomeCardHead
        id="home-news"
        title={messages.updatesTitle}
        count={unread}
        action={latest && latest.length > 0 ? (
          <IntentPrefetchLink href="/portal/messages?view=updates" className="pt-link">
            {strings.newsAll}
          </IntentPrefetchLink>
        ) : null}
      />
      {latest === null ? (
        <p role="alert" className="pt-alert">{messages.updatesUnavailable}</p>
      ) : latest.length === 0 ? (
        <HomeEmpty icon="news" title={admission.notificationsEmptyTitle} body={admission.notificationsEmptyBody} />
      ) : (
        <ul className="pt-home-news-list">
          {latest.map((item) => {
            const text = portalNotificationText(item, admission);
            const created = formatPortalTimestamp(item.createdAt);
            const when = homeTimeLabel(item.createdAt, now, locale, strings);
            return (
              <li key={item.notificationId}>
                <IntentPrefetchLink
                  href={portalNotificationTarget(item, admission).href}
                  className="pt-home-news-row"
                  data-unread={item.readAt === null ? "" : undefined}
                >
                  <span className="pt-home-news-icon" aria-hidden="true">
                    <HomeIcon name={KIND_ICON[portalNotificationKind(item)]} />
                  </span>
                  <span className="pt-home-news-text">
                    <span className="pt-home-news-title">
                      {item.readAt === null ? <span className="pt-sr-only">{admission.statusNew}: </span> : null}
                      {text.title}
                    </span>
                    {when ? (
                      <time dateTime={item.createdAt} title={created ?? undefined} className="pt-home-news-time">{when}</time>
                    ) : null}
                  </span>
                </IntentPrefetchLink>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
