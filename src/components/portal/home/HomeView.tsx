import type { ReactNode } from "react";

import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import type { PublishedUniversity } from "@/lib/platform-university-catalog";
import type { StudentJourney } from "@/lib/portal/student-journey";
import { todayForTimeline } from "@/lib/portal/country-timeline";
import { bishkekDay, type HomeDateItem } from "@/lib/portal/home-dates";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { nearestUniversityIntake } from "@/lib/portal/universities";
import type { StudentPortalDocument, StudentPortalNotification, StudentPortalOverview } from "@/lib/v3/portal-source";

import type { PortalAccessTier } from "../Shell";
import { HomeCase, actionHref, actionTitle } from "./HomeCase";
import { HomeDates } from "./HomeDates";
import { HomeDocuments } from "./HomeDocuments";
import { HomeFavorites } from "./HomeFavorites";
import { HomeHero } from "./HomeHero";
import { HomeManager } from "./HomeManager";
import { HomeNews } from "./HomeNews";

/**
 * «Главная» кабинета в «Атласе» (PORT-9c, дизайн-контракт §«Карта экранов» п.1). Серверные read model приходят
 * пропсами, каждый источник несёт свой честный сбой (null) и честную пустоту. Карточки согласия на ИИ-помощников здесь
 * нет (09.11.2026): согласие даётся при регистрации или первом входе, меняется в «Профиле».
 *
 * 08.11.2026 (по образцу «Главной» от пользователя): сверху приветствие, ниже две колонки; без выбранной страны первым
 * блоком под шапкой стоит выбор страны (`countryChoice`). Колонки две с 960 px; в одну колонку блоки идут по смыслу
 * (data-slot и order в CSS).
 *
 * 09.11.2026 (разбор кабинета: три разных ответа на «где я», «действий не требуется», нет дат и менеджера): шапка
 * (HomeHero) показывает шаг пути страны — тот же, что в «Профиле» и на «Поступлении», отдельной карточки пути нет.
 * Слева «Что сделать сейчас» (HomeCase: задания менеджера, а без них задания студента из текущего шага пути) или
 * «Ваша анкета» (approved) и «Мои вузы». Справа «Ваш менеджер» (HomeManager), «Документы» (HomeDocuments: принято из
 * списка дела и что ждёт студента со сроком), «Ближайшие даты» (сроки дел, документов и избранных вузов), «Что нового»
 * и карточка CSCA (только при выбранном Китае).
 */
export function HomeView({
  tier,
  displayName,
  studyCountry = null,
  overview,
  overviewFailed = false,
  news = null,
  documents = null,
  favorites,
  favoritesTotal,
  journey,
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
  /** Список документов дела для карточки «Документы» (только assisted); `null` — чтение не удалось. */
  documents?: readonly StudentPortalDocument[] | null;
  favorites: readonly PublishedUniversity[] | null;
  favoritesTotal: number;
  /** Путь страны и где студент на нём (`selectStudentJourney`): дорожка шапки. */
  journey: StudentJourney;
  /** Выбор страны (CountryTimeline без пути): первым блоком под шапкой, пока страны нет; иначе null. */
  countryChoice?: ReactNode;
  /** Карточка CSCA (CscaHomeCard) для студента, выбравшего Китай; иначе null. */
  csca?: ReactNode;
  locale: Locale;
  now: Date;
}) {
  const strings = getPortalStrings("home", locale);
  const admission = getPortalStrings("admission", locale);

  // Текущий шаг пути — тот же, что в шапке и в «Профиле» (09.11.2026).
  const step = journey.view?.steps.find((item) => journey.progress?.[item.id] === "current") ?? null;

  // «Ближайшие даты»: сроки дел, сроки документов от менеджера и дедлайн или старт избранных вузов.
  const today = todayForTimeline(now);
  const actionSlots = new Set((overview?.studentActions ?? []).flatMap((action) => action.kind === "payment" ? [] : [action.documentSlotId]));
  const dated: HomeDateItem[] = [
    ...(overview?.studentActions ?? []).flatMap((action) => action.dueAt
      ? [{ day: bishkekDay(action.dueAt), title: actionTitle(action, admission), href: actionHref(action) }]
      : []),
    ...(documents ?? []).flatMap((document) => document.deadline && document.status !== "approved" && !actionSlots.has(document.documentSlotId)
      ? [{
        day: bishkekDay(document.deadline),
        title: formatPortalString(strings.dateDocument, { name: document.requirementLabel }),
        href: `/portal/documents#document-${document.documentSlotId}`,
      }]
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
      <HomeHero displayName={displayName} studyCountry={studyCountry} journey={journey.view} progress={journey.progress} locale={locale} />
      {countryChoice}
      <div className="pt-home-columns">
        <div className="pt-home-main">
          {tier === "assisted" ? (
            <div className="pt-home-slot" data-slot="case">
              <HomeCase overview={overview} failed={overviewFailed} step={step} locale={locale} />
            </div>
          ) : null}
          {tier === "approved" ? (
            <article className="pt-home-card pt-home-slot" data-slot="case">
              <p className="pt-home-card-kicker">{strings.applicationKicker}</p>
              <h2 className="pt-home-card-title">{admission.pendingApplicationHeading}</h2>
              <p className="pt-home-card-action">
                <IntentPrefetchLink className="pt-btn-ghost" href="/apply/status">
                  {admission.pendingApplicationLink}
                </IntentPrefetchLink>
              </p>
            </article>
          ) : null}
          <div className="pt-home-slot" data-slot="universities">
            <HomeFavorites favorites={favorites} total={favoritesTotal} locale={locale} now={now} />
          </div>
        </div>

        <div className="pt-home-side">
          {tier === "assisted" && overview ? (
            <div className="pt-home-slot" data-slot="manager">
              <HomeManager name={overview.curatorDisplayName} locale={locale} />
            </div>
          ) : null}
          {tier === "assisted" ? (
            <div className="pt-home-slot" data-slot="documents">
              <HomeDocuments documents={documents} locale={locale} />
            </div>
          ) : null}
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
    </div>
  );
}
