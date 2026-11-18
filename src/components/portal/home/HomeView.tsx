import type { ReactNode } from "react";

import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import type { PublishedUniversity } from "@/lib/platform-university-catalog";
import type { CatalogPreparation } from "@/lib/portal/catalog-preparations";
import { todayForTimeline } from "@/lib/portal/country-timeline";
import {
  bishkekDay,
  homeDayMonth,
  homeDaysUntil,
  preparationHomeDates,
  upcomingHomeDates,
  type HomeDateItem,
} from "@/lib/portal/home-dates";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { nearestUniversityIntake } from "@/lib/portal/universities";
import type { StudentPortalNotification, StudentPortalOverview } from "@/lib/v3/portal-source";

import { CheckMark } from "../CheckMark";
import type { PortalAccessTier } from "../Shell";
import { HomeCase, actionHref, actionTitle } from "./HomeCase";
import { HomeDates } from "./HomeDates";
import { HomeHero } from "./HomeHero";
import { HomeNews } from "./HomeNews";

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
 * 18.11.2026 (главная казалась скучной): в «Ближайших датах» — сроки своих программ; «Ваша анкета» до договора —
 * отметки «отправлена» и «одобрена» с датами. «Мой список» поднят в левую колонку под «Что сделать сейчас» (`list`), когда
 * правая колонка длинная: путь и даты плюс «Что нового» или CSCA. Иначе (нет страны; анкета на рассмотрении без Китая)
 * последняя карточка справа растянулась бы пустой — тогда список стоит под колонками во всю ширину. «Всё избранное» со сравнением всегда
 * во всю ширину (`wideList`). В «Ближайшие даты» добавлены официальные даты CSCA (`dates`, их собирает страница),
 * блоки входят по очереди.
 *
 * Правка 08.11.2026 (разбор вёрстки): без выбранной страны первым блоком под шапкой стоит выбор страны
 * (`countryChoice`, тот же CountryTimeline с выбором, что был до #1408), карточки пути в это время нет; выбрана страна —
 * выбор исчезает и на его месте в правой колонке встаёт карточка пути. Колонки две с 960 px; в одну колонку блоки
 * идут по смыслу, а не по колонкам: «Что сделать сейчас», путь, «Мой список», даты, новости, CSCA (data-slot и order
 * в CSS).
 */
export function HomeView({
  tier,
  displayName,
  studyCountry = null,
  intake = null,
  overview,
  overviewFailed = false,
  news = null,
  favorites,
  info = null,
  list = null,
  wideList = null,
  dates = [],
  preparations = null,
  application = null,
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
  /** Подпись набора пути страны для той же строки; `null` — пути нет. */
  intake?: string | null;
  /** Только assisted; null — RPC вернул пустой обзор (дело без плана). */
  overview: StudentPortalOverview | null;
  overviewFailed?: boolean;
  /** Лента «Что нового» (только assisted); `null` — чтение не удалось. */
  news?: readonly StudentPortalNotification[] | null;
  /** Первые избранные вузы: из них берутся даты «Ближайших дат»; `null` — чтение не удалось. */
  favorites: readonly PublishedUniversity[] | null;
  /** Заявка на рассмотрении и задача EVO (OverviewView): под шапкой; null, если нечего показать. */
  info?: ReactNode;
  /** «Мой список»: вкладки «Вузы» и «Мои программы» карточкой; место выбирает HomeView (колонка или вся ширина). */
  list?: ReactNode;
  /** «Всё избранное» со сравнением во всю ширину под колонками; тогда `list` пуст. */
  wideList?: ReactNode;
  /** Даты, которые «Главная» читает помимо дел и избранного (официальные даты CSCA). */
  dates?: readonly HomeDateItem[];
  /** «Мои программы»: их сроки идут в «Ближайшие даты»; `null` — не прочитаны. */
  preparations?: readonly CatalogPreparation[] | null;
  /** Своя анкета (только до договора, tier approved): даты отметок в «Ваша анкета»; `null` — нет или не прочиталась. */
  application?: Readonly<{ status: "pending" | "approved" | "rejected"; submittedAt: string; decidedAt: string | null }> | null;
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
  // Колонки кончаются на одной линии (08.11.2026): список встаёт в колонку, только когда правая колонка длинная —
  // путь и даты плюс «Что нового» (клиент) или CSCA (Китай). Иначе её последняя карточка растянулась бы пустой.
  const listInColumn = list !== null && journey !== null && (tier === "assisted" || csca !== null);

  // «Ближайшие даты»: сроки дел, сроки своих программ и дедлайн или старт избранных вузов. Если у вуза есть своя
  // программа, общая строка вуза не повторяет её.
  const today = todayForTimeline(now);
  const programDates = preparationHomeDates(preparations ?? [], today, strings);
  const programInstitutions = new Set(programDates.map((item) => item.institutionId));
  const dated: HomeDateItem[] = [
    ...(overview?.studentActions ?? []).flatMap((action) => action.dueAt
      ? [{ day: bishkekDay(action.dueAt), title: actionTitle(action, admission), href: actionHref(action) }]
      : []),
    ...programDates.map(({ day, title, href }) => ({ day, title, href })),
    ...(favorites ?? []).flatMap((item) => {
      if (programInstitutions.has(item.id)) return [];
      const nearest = nearestUniversityIntake(item.content, now);
      if (nearest === null || nearest.kind === "startMonth") return [];
      const template = nearest.kind === "deadline" ? strings.dateDeadline : strings.dateStart;
      return [{ day: nearest.value, title: formatPortalString(template, { name: item.content.name }), href: `/portal/universities/${item.id}` }];
    }),
    ...dates,
  ];
  const nearest = upcomingHomeDates(dated, today)[0] ?? null;
  // «10 нояб.»; другой год — с годом.
  const stepDate = (iso: string) => {
    const day = bishkekDay(iso);
    const short = homeDayMonth(day, locale);
    return day.slice(0, 4) === today.slice(0, 4) ? short : `${short} ${day.slice(0, 4)}`;
  };

  return (
    <div className="pt-home">
      <HomeHero
        displayName={displayName}
        studyCountry={studyCountry}
        intake={intake}
        countdown={nearest ? { ...nearest, days: homeDaysUntil(nearest.day, today) } : null}
        locale={locale}
      />
      {countryChoice}
      {info}
      <div className="pt-home-columns">
        <div className="pt-home-main">
          {tier === "assisted" ? (
            <div className="pt-home-slot" data-slot="case">
              <HomeCase overview={overview} failed={overviewFailed} today={today} now={now} locale={locale} />
            </div>
          ) : null}
          {tier === "approved" ? (
            <article className="pt-home-card pt-home-slot" data-slot="case">
              <p className="pt-home-card-kicker">{strings.applicationKicker}</p>
              <h2 className="pt-home-card-title">{admission.pendingApplicationHeading}</h2>
              {/* 18.11.2026: что уже сделано — отметки с датами из своей анкеты; дальше — менеджер, без срока. */}
              <ol className="pt-home-steps">
                {application ? (
                  <li data-done="">
                    <span className="pt-home-step-mark"><CheckMark /></span>
                    <span className="pt-home-step-text">{strings.applicationSent}</span>
                    <time className="pt-home-step-date" dateTime={application.submittedAt}>{stepDate(application.submittedAt)}</time>
                  </li>
                ) : null}
                {application?.status === "approved" && application.decidedAt ? (
                  <li data-done="">
                    <span className="pt-home-step-mark"><CheckMark /></span>
                    <span className="pt-home-step-text">{strings.applicationApproved}</span>
                    <time className="pt-home-step-date" dateTime={application.decidedAt}>{stepDate(application.decidedAt)}</time>
                  </li>
                ) : null}
                <li data-current="">
                  <span className="pt-home-step-mark" aria-hidden="true" />
                  <span className="pt-home-step-text">{strings.applicationManagerStep}</span>
                </li>
              </ol>
              <p className="pt-home-card-action">
                <IntentPrefetchLink className="pt-btn-ghost" href="/apply/status">
                  {admission.pendingApplicationLink}
                </IntentPrefetchLink>
              </p>
            </article>
          ) : null}
          {listInColumn ? <div className="pt-home-slot" data-slot="list">{list}</div> : null}
        </div>

        <div className="pt-home-side">
          {journey ? <div className="pt-home-slot" data-slot="path">{journey}</div> : null}
          <div className="pt-home-slot" data-slot="dates">
            <HomeDates items={dated} today={today} locale={locale} />
          </div>
          {tier === "assisted" ? (
            <div className="pt-home-slot" data-slot="news">
              <HomeNews notifications={news} now={now} locale={locale} />
            </div>
          ) : null}
          {csca ? <div className="pt-home-slot" data-slot="csca">{csca}</div> : null}
        </div>
      </div>
      {listInColumn ? null : list}
      {wideList}
      {fullPath}
    </div>
  );
}
