import type { ReactNode } from "react";

import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import type { PublishedUniversity } from "@/lib/platform-university-catalog";
import { todayForTimeline } from "@/lib/portal/country-timeline";
import { getPortalStrings } from "@/lib/portal/i18n";
import type { StudentPortalNotification, StudentPortalOverview } from "@/lib/v3/portal-source";

import type { PortalAccessTier } from "../Shell";
import { studentDateItems } from "./date-items";
import { HomeCase } from "./HomeCase";
import { HomeDates } from "./HomeDates";
import { HomeFavorites } from "./HomeFavorites";
import { HomeHero } from "./HomeHero";
import { HomeNews } from "./HomeNews";

/**
 * «Главная» кабинета в «Атласе» (PORT-9c, дизайн-контракт §«Карта экранов» п.1), единственная домашняя страница
 * (/portal, #1355). Серверные read model приходят пропсами, каждый источник несёт свой честный сбой (null) и честную
 * пустоту.
 *
 * 09.11.2026 (пользователь, по скриншоту прежней «Главной»): вид 08.11 без лишнего. Шапка — приветствие и страна, без
 * дорожки этапов (шаги — на странице «Моё поступление»). Карточки согласия на ИИ-помощников нет (согласие даётся при
 * регистрации), CSCA и «Написать EVO» (чат есть в меню) на «Главной» нет. Слева «Что сделать сейчас» (HomeCase,
 * assisted) или «Ваша анкета» (approved) и «Мои вузы» карточками с фото. Справа «Путь» (`journey`), «Ближайшие даты»
 * и «Что нового» (как у Акылмана). Весь «Путь поступления», выбранные вузы и программы — на странице «Моё поступление»
 * (/portal/admission), туда ведёт «Весь путь». Без выбранной страны под шапкой выбор страны (`countryChoice`),
 * карточки пути нет. Колонки две с 960 px; в одну колонку блоки идут по смыслу (data-slot и order в CSS).
 */
export function HomeView({
  tier,
  displayName,
  studyCountry = null,
  overview,
  overviewFailed = false,
  news = null,
  favorites,
  favoritesTotal,
  info = null,
  journey = null,
  countryChoice = null,
  locale,
  now,
}: {
  tier: PortalAccessTier;
  /** Имя студента для приветствия. */
  displayName: string;
  /** Страна поступления для строки под приветствием; `null` — не выбрана. */
  studyCountry?: string | null;
  /** Только assisted; null — RPC вернул пустой обзор (дело без плана). */
  overview: StudentPortalOverview | null;
  overviewFailed?: boolean;
  /** Лента «Что нового» (только assisted); `null` — чтение не удалось. */
  news?: readonly StudentPortalNotification[] | null;
  /** Первые избранные вузы: карточки «Моих вузов» и даты «Ближайших дат»; `null` — чтение не удалось. */
  favorites: readonly PublishedUniversity[] | null;
  /** Сколько вузов в избранном всего. */
  favoritesTotal: number;
  /** Заявка на рассмотрении и задача EVO (OverviewView): под шапкой; null, если нечего показать. */
  info?: ReactNode;
  /** Карточка «Пути поступления» (HomeJourneyCard); null, если её нет. */
  journey?: ReactNode;
  /** Выбор страны (CountryTimeline без пути): первым блоком под шапкой, пока страны нет; иначе null. */
  countryChoice?: ReactNode;
  locale: Locale;
  now: Date;
}) {
  const strings = getPortalStrings("home", locale);
  const admission = getPortalStrings("admission", locale);
  const dated = studentDateItems({ overview, favorites, locale, now });

  return (
    <div className="pt-home">
      <HomeHero displayName={displayName} studyCountry={studyCountry} locale={locale} />
      {countryChoice}
      {info}
      <div className="pt-home-columns">
        <div className="pt-home-main">
          {tier === "assisted" ? (
            <div className="pt-home-slot" data-slot="case">
              <HomeCase overview={overview} failed={overviewFailed} locale={locale} />
            </div>
          ) : null}
          {tier === "approved" ? (
            <article className="pt-home-card pt-home-slot" data-slot="case">
              <p className="pt-home-card-kicker">{strings.applicationKicker}</p>
              <h2 className="pt-home-card-title">{admission.pendingApplicationHeading}</h2>
              <p className="pt-home-foot">{admission.pendingManagerNotice}</p>
              <p className="pt-home-card-action">
                <IntentPrefetchLink className="pt-btn-ghost" href="/apply/status">
                  {admission.pendingApplicationLink}
                </IntentPrefetchLink>
              </p>
            </article>
          ) : null}
          <div className="pt-home-slot" data-slot="universities">
            <HomeFavorites favorites={favorites} total={favoritesTotal} locale={locale} />
          </div>
        </div>

        <div className="pt-home-side">
          {journey ? <div className="pt-home-slot" data-slot="path">{journey}</div> : null}
          <div className="pt-home-slot" data-slot="dates">
            <HomeDates items={dated} today={todayForTimeline(now)} locale={locale} />
          </div>
          {tier === "assisted" ? (
            <div className="pt-home-slot" data-slot="news">
              <HomeNews notifications={news} locale={locale} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
