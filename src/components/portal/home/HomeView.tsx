import type { ReactNode } from "react";

import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import type { PublishedUniversity } from "@/lib/platform-university-catalog";
import { todayForTimeline } from "@/lib/portal/country-timeline";
import { bishkekDay, type HomeDateItem } from "@/lib/portal/home-dates";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import type { StudentJourney } from "@/lib/portal/student-journey";
import { nearestUniversityIntake } from "@/lib/portal/universities";
import type { StudentPortalDocument, StudentPortalNotification, StudentPortalOverview } from "@/lib/v3/portal-source";

import type { PortalAccessTier } from "../Shell";
import { HomeCase, actionHref, actionTitle } from "./HomeCase";
import { HomeDates } from "./HomeDates";
import { HomeDocuments } from "./HomeDocuments";
import { HomeHero } from "./HomeHero";
import { HomeNews } from "./HomeNews";
import { HomeWriteEvo } from "./HomeWriteEvo";

/**
 * «Главная» кабинета в «Атласе» (PORT-9c, дизайн-контракт §«Карта экранов» п.1). Серверные read model приходят
 * пропсами, каждый источник несёт свой честный сбой (null) и честную пустоту. Карточки согласия на ИИ-помощников здесь
 * нет (09.11.2026): согласие даётся при регистрации или первом входе, меняется в «Профиле».
 *
 * #1355 (09.11.2026): это единственная домашняя страница кабинета (/portal; прежний /portal/home перенаправляется
 * сюда). Под шапкой — выбор страны (`countryChoice`, пока страны нет), заявка на рассмотрении и задача EVO (`info`);
 * ниже две колонки, под ними «Мой список» (`list`: вкладки «Вузы» и «Мои программы») и весь «Путь поступления»
 * (`fullPath`, якорь #path). Колонки две с 960 px; в одну колонку блоки идут по смыслу (data-slot и order в CSS).
 *
 * 09.11.2026 (разбор кабинета: три разных ответа на «где я», «действий не требуется», нет дат и менеджера): шапка
 * (HomeHero) показывает шаг пути страны — тот же, что в «Профиле» и в полном пути ниже; отдельной карточки пути нет.
 * Слева «Что сделать сейчас» (HomeCase: задания менеджера, а без них задания студента из текущего шага пути) или
 * «Ваша анкета» (approved), «Написать EVO» (#1356, один вход в чат) с именем куратора и «Ближайшие даты» (сроки дел,
 * документов и избранных вузов). Справа «Документы» (HomeDocuments: принято из списка дела и что ждёт студента со
 * сроком), «Что нового» и карточка CSCA (только при выбранном Китае).
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
  info = null,
  list = null,
  fullPath = null,
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
  /** Первые избранные вузы: из них берутся даты «Ближайших дат»; `null` — чтение не удалось. */
  favorites: readonly PublishedUniversity[] | null;
  /** Заявка на рассмотрении и задача EVO (OverviewView): под шапкой; null, если нечего показать. */
  info?: ReactNode;
  /** «Мой список»: вкладки «Вузы» и «Мои программы» (полные списки) под колонками. */
  list?: ReactNode;
  /** Весь «Путь поступления» (CountryTimeline с путём) под списком; null, пока страна не выбрана. */
  fullPath?: ReactNode;
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
      {info}
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
              <HomeWriteEvo curatorName={overview?.curatorDisplayName ?? null} locale={locale} />
            </div>
          ) : null}
          {/* 09.11.2026 («выглядит неаккуратно»): даты в левой колонке — колонки кончаются ближе друг к другу. */}
          <div className="pt-home-slot" data-slot="dates">
            <HomeDates items={dated} today={today} locale={locale} />
          </div>
        </div>

        <div className="pt-home-side">
          {tier === "assisted" ? (
            <div className="pt-home-slot" data-slot="documents">
              <HomeDocuments documents={documents} locale={locale} />
            </div>
          ) : null}
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
