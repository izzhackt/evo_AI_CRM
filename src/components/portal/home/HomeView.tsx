import type { ReactNode } from "react";

import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import type { PublishedUniversity } from "@/lib/platform-university-catalog";
import { todayForTimeline } from "@/lib/portal/country-timeline";
import { bishkekDay, type HomeDateItem } from "@/lib/portal/home-dates";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { nearestUniversityIntake } from "@/lib/portal/universities";
import type { StudentPortalNotification, StudentPortalOverview } from "@/lib/v3/portal-source";

import type { PortalAccessTier } from "../Shell";
import { HomeCase, actionHref, actionTitle } from "./HomeCase";
import { HomeDates } from "./HomeDates";
import { HomeHero } from "./HomeHero";
import { HomeNews } from "./HomeNews";
import { HomeWriteEvo } from "./HomeWriteEvo";

/**
 * «Главная» кабинета в «Атласе» (PORT-9c, дизайн-контракт §«Карта экранов» п.1). Серверные read model приходят
 * пропсами, каждый источник несёт свой честный сбой (null) и честную пустоту. Карточки согласия на ИИ-помощников здесь больше нет (09.11.2026): выбор
 * спрашивает экран «Конфиденциальность» при первом входе, отозвать можно в «Профиле».
 *
 * 08.11.2026 (по образцу «Главной» от пользователя): сверху приветствие с этапом дела (HomeHero, без изменений), ниже
 * две колонки. Слева «Что сделать сейчас» (HomeCase, assisted) или «Ваша анкета» (approved) и «Мои вузы»
 * (HomeFavorites). Справа карточка «Пути поступления» (`journey`, HomeJourneyCard: весь путь переехал на
 * «Поступление»), «Ближайшие даты» (HomeDates), «Что нового» (HomeNews, лента «Входящих», только assisted) и карточка
 * CSCA (`csca`, только при выбранном Китае). На узком экране колонки идут одна за другой.
 *
 * #1355 (09.11.2026): это единственная домашняя страница кабинета (/portal; прежний /portal/home перенаправляется
 * сюда). Первым идёт «Что сделать сейчас». Под шапкой — заявка на рассмотрении и задача EVO (`info`), вместо
 * карточки «Мои вузы» под колонками стоит «Мой список» (`list`: вкладки «Вузы» и «Мои программы»), а под ним весь
 * «Путь поступления» (`fullPath`, якорь #path). Карточка «Написать EVO» (assisted) — один вход в чат «Входящих» (#1356).
 *
 * Правка 08.11.2026 (разбор вёрстки): без выбранной страны первым блоком под шапкой стоит выбор страны
 * (`countryChoice`, тот же CountryTimeline с выбором, что был до #1408), карточки пути в это время нет; выбрана страна —
 * выбор исчезает и на его месте в правой колонке встаёт карточка пути. Колонки две с 960 px; в одну колонку блоки
 * идут по смыслу, а не по колонкам: «Что сделать сейчас», путь, «Мои вузы», даты, новости, CSCA (data-slot и order в CSS).
 */
export function HomeView({
  tier,
  displayName,
  studyCountry = null,
  overview,
  overviewFailed = false,
  news = null,
  favorites,
  info = null,
  list = null,
  fullPath = null,
  journey = null,
  countryChoice = null,
  csca = null,
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
  /** Первые избранные вузы: из них берутся даты «Ближайших дат»; `null` — чтение не удалось. */
  favorites: readonly PublishedUniversity[] | null;
  /** Заявка на рассмотрении и задача EVO (OverviewView): под шапкой; null, если нечего показать. */
  info?: ReactNode;
  /** «Мой список»: вкладки «Вузы» и «Мои программы» (полные списки) под колонками. */
  list?: ReactNode;
  /** Весь «Путь поступления» (CountryTimeline с путём) под списком; null, пока страна не выбрана. */
  fullPath?: ReactNode;
  /** Карточка «Пути поступления» (HomeJourneyCard); null, если её нет. */
  journey?: ReactNode;
  /** Выбор страны (CountryTimeline без пути): первым блоком под шапкой, пока страны нет; иначе null. */
  countryChoice?: ReactNode;
  /** Карточка CSCA (CscaHomeCard) для студента, выбравшего Китай; иначе null. */
  csca?: ReactNode;
  locale: Locale;
  now: Date;
}) {
  const strings = getPortalStrings("home", locale);
  const admission = getPortalStrings("admission", locale);

  // «Ближайшие даты»: сроки дел и дедлайн или старт избранных вузов.
  const today = todayForTimeline(now);
  const dated: HomeDateItem[] = [
    ...(overview?.studentActions ?? []).flatMap((action) => action.dueAt
      ? [{ day: bishkekDay(action.dueAt), title: actionTitle(action, admission), href: actionHref(action) }]
      : []),
    ...(favorites ?? []).flatMap((item) => {
      const nearest = nearestUniversityIntake(item.content, now);
      if (nearest === null || nearest.kind === "startMonth") return [];
      const template = nearest.kind === "deadline" ? strings.dateDeadline : strings.dateStart;
      return [{ day: nearest.value, title: formatPortalString(template, { name: item.content.name }), href: `/portal/universities/${item.id}` }];
    }),
  ];

  return (
    <div className="pt-home">
      <HomeHero displayName={displayName} studyCountry={studyCountry} stage={overview?.operationalStage ?? null} locale={locale} />
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
          {tier === "assisted" ? (
            <div className="pt-home-slot" data-slot="write">
              <HomeWriteEvo locale={locale} />
            </div>
          ) : null}
        </div>

        <div className="pt-home-side">
          {journey ? <div className="pt-home-slot" data-slot="path">{journey}</div> : null}
          <div className="pt-home-slot" data-slot="dates">
            <HomeDates items={dated} today={today} locale={locale} />
          </div>
          {tier === "assisted" ? (
            <div className="pt-home-slot" data-slot="news">
              <HomeNews notifications={news} locale={locale} />
            </div>
          ) : null}
          {csca ? <div className="pt-home-slot" data-slot="csca">{csca}</div> : null}
        </div>
      </div>
      {list}
      {fullPath}
    </div>
  );
}
