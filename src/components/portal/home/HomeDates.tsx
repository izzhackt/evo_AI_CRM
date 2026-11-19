import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import {
  homeDaysLabel,
  homeDaysUntil,
  homeMonthShort,
  homeWeek,
  laterHomeDate,
  upcomingHomeDates,
  type HomeDateItem,
} from "@/lib/portal/home-dates";
import { getPortalStrings } from "@/lib/portal/i18n";
import { universityDateLabel } from "@/lib/portal/universities";

import { HomeCardHead, HomeEmpty } from "./HomeParts";

function weekday(day: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ky" ? "ky" : "ru", { weekday: "short", timeZone: "UTC" })
    .format(new Date(`${day}T00:00:00Z`));
}

/** Строка даты: плитка «число и месяц» (полная дата — для читалки), название и справа подпись. */
function DateRow({ item, right, soon, locale }: Readonly<{ item: HomeDateItem; right: string | null; soon: boolean; locale: Locale }>) {
  return (
    <IntentPrefetchLink href={item.href} className="pt-home-date-row">
      <time dateTime={item.day} className="pt-home-date-tile">
        <span aria-hidden="true" className="pt-home-date-num">{Number(item.day.slice(8))}</span>
        <span aria-hidden="true" className="pt-home-date-month">{homeMonthShort(item.day, locale)}</span>
        <span className="pt-sr-only">{universityDateLabel(item.day, locale)}</span>
      </time>
      <span className="pt-home-date-title">{item.title}</span>
      {right ? <span className="pt-home-date-left" data-soon={soon ? "" : undefined}>{right}</span> : null}
    </IntentPrefetchLink>
  );
}

/**
 * «Ближайшие даты» (03.11.2026, по образцу кабинета пользователя): неделя от
 * сегодня (сегодня — красной заливкой, дни с пунктом — точкой) и до пяти
 * пунктов на 60 дней вперёд: сроки дел студента, дедлайн или старт
 * избранных вузов и (18.11.2026) официальные даты CSCA у выбравшего Китай.
 * Пусто — честное пустое состояние со значком и строкой о том, что сюда
 * попадёт (08.11.2026, образец пользователя); с 18.11.2026 одной строкой под
 * неделей, а не большим блоком. Строка даты (18.11.2026, по образцу кабинета Акылмана): слева плитка «число и
 * месяц», справа сколько осталось — «сегодня», «завтра», «через 5 дней»; полная дата — в `<time>` для читалки. Если в
 * окне дат нет, а позже есть (18.11.2026), вместо «Дат пока нет» — «Дальше» и первая такая дата, справа год, если он
 * другой.
 */
export function HomeDates({ items, today, locale }: Readonly<{
  items: readonly HomeDateItem[];
  today: string;
  locale: Locale;
}>) {
  const strings = getPortalStrings("home", locale);
  const upcoming = upcomingHomeDates(items, today);
  const later = upcoming.length === 0 ? laterHomeDate(items, today) : null;
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
      {upcoming.length > 0 ? (
        <ul className="pt-home-dates-list">
          {upcoming.map((item) => (
            <li key={`${item.day}-${item.href}-${item.title}`}>
              <DateRow
                item={item}
                right={homeDaysLabel(homeDaysUntil(item.day, today), locale, strings)}
                soon={homeDaysUntil(item.day, today) <= 1}
                locale={locale}
              />
            </li>
          ))}
        </ul>
      ) : later ? (
        <div className="pt-home-dates-later">
          <p className="pt-home-dates-later-label">{strings.datesLater}</p>
          <ul className="pt-home-dates-list">
            <li>
              <DateRow item={later} right={later.day.slice(0, 4) === today.slice(0, 4) ? null : later.day.slice(0, 4)} soon={false} locale={locale} />
            </li>
          </ul>
        </div>
      ) : (
        <HomeEmpty compact icon="calendar" title={strings.datesEmptyTitle} body={strings.datesEmptyBody} />
      )}
    </section>
  );
}
