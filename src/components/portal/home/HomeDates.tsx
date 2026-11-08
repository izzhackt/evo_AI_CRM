import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import { homeWeek, upcomingHomeDates, type HomeDateItem } from "@/lib/portal/home-dates";
import { getPortalStrings } from "@/lib/portal/i18n";
import { universityDateLabel } from "@/lib/portal/universities";

import { HomeCardHead, HomeEmpty } from "./HomeParts";

function weekday(day: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ky" ? "ky" : "ru", { weekday: "short", timeZone: "UTC" })
    .format(new Date(`${day}T00:00:00Z`));
}

/**
 * «Ближайшие даты» (03.11.2026, по образцу кабинета пользователя): неделя от
 * сегодня (сегодня — красной заливкой, дни с пунктом — точкой) и до пяти
 * пунктов на 60 дней вперёд: сроки дел студента и дедлайн или старт
 * избранных вузов. Пусто — честное пустое состояние: значок, заголовок и
 * строка о том, что сюда попадёт (08.11.2026, образец пользователя).
 */
export function HomeDates({ items, today, locale }: Readonly<{
  items: readonly HomeDateItem[];
  today: string;
  locale: Locale;
}>) {
  const strings = getPortalStrings("home", locale);
  const upcoming = upcomingHomeDates(items, today);
  const marked = new Set(items.map((item) => item.day));

  return (
    <section aria-labelledby="home-dates" className="pt-card pt-home-box pt-home-dates">
      <HomeCardHead id="home-dates" title={strings.datesHeading} count={upcoming.length} />
      <ol className="pt-home-week" aria-hidden="true">
        {homeWeek(today).map((day) => (
          <li key={day} data-today={day === today ? "" : undefined} data-marked={marked.has(day) ? "" : undefined}>
            <span className="pt-home-week-day">{weekday(day, locale)}</span>
            <span className="pt-home-week-num">{Number(day.slice(8))}</span>
          </li>
        ))}
      </ol>
      {upcoming.length === 0 ? (
        <HomeEmpty icon="calendar" title={strings.datesEmptyTitle} body={strings.datesEmptyBody} />
      ) : (
        <ul className="pt-home-dates-list">
          {upcoming.map((item) => (
            <li key={`${item.day}-${item.href}-${item.title}`}>
              <IntentPrefetchLink href={item.href} className="pt-home-date-row">
                <time dateTime={item.day} className="pt-home-date-day">{universityDateLabel(item.day, locale)}</time>
                <span className="pt-home-date-title">{item.title}</span>
              </IntentPrefetchLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
