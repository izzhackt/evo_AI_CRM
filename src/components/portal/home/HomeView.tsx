import type { ReactNode } from "react";

import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import type { PublishedUniversity } from "@/lib/platform-university-catalog";
import { aiConsentApplies } from "@/lib/portal/ai-consent";
import { todayForTimeline } from "@/lib/portal/country-timeline";
import { bishkekDay, type HomeDateItem } from "@/lib/portal/home-dates";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { nearestUniversityIntake } from "@/lib/portal/universities";
import type { StudentPortalNotification, StudentPortalOverview } from "@/lib/v3/portal-source";

import type { PortalAccessTier } from "../Shell";
import { HomeCase, actionHref, actionTitle } from "./HomeCase";
import { HomeDates } from "./HomeDates";
import { HomeFavorites } from "./HomeFavorites";
import { HomeHero } from "./HomeHero";
import { HomeNews } from "./HomeNews";

/**
 * «Главная» кабинета в «Атласе» (PORT-9c, дизайн-контракт §«Карта экранов» п.1). Серверные read model приходят
 * пропсами, каждый источник несёт свой честный сбой (null) и честную пустоту. Карточка согласия на ИИ-помощников
 * (`aiConsent`, 25.10.2026) стоит первой под шапкой, пока для текущей версии текста нет решения, и не блокирует ничего
 * ниже; она только у клиента с делом на сопровождении (tier assisted), самостоятельному студенту вид её не показывает,
 * даже если её передали.
 *
 * 08.11.2026 (по образцу «Главной» от пользователя): сверху приветствие с этапом дела (HomeHero, без изменений), ниже
 * две колонки. Слева «Что сделать сейчас» (HomeCase, assisted) или «Ваша анкета» (approved) и «Мои вузы»
 * (HomeFavorites). Справа карточка «Пути поступления» (`journey`, HomeJourneyCard: весь путь переехал на
 * «Поступление»), «Ближайшие даты» (HomeDates), «Что нового» (HomeNews, лента «Входящих», только assisted) и карточка
 * CSCA (`csca`, только при выбранном Китае). На узком экране колонки идут одна за другой.
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
  journey = null,
  csca = null,
  aiConsent = null,
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
  favorites: readonly PublishedUniversity[] | null;
  favoritesTotal: number;
  /** Карточка «Пути поступления» (HomeJourneyCard); null, если её нет. */
  journey?: ReactNode;
  /** Карточка CSCA (CscaHomeCard) для студента, выбравшего Китай; иначе null. */
  csca?: ReactNode;
  /** Согласие на ИИ-помощников (AiConsentHomeCard): первым блоком клиента с делом на сопровождении, пока для текущей версии нет решения; самостоятельному студенту не показывается, даже если передан. */
  aiConsent?: ReactNode;
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
      {aiConsentApplies(tier) ? aiConsent : null}
      <div className="pt-home-columns">
        <div className="pt-home-main">
          {tier === "assisted" ? <HomeCase overview={overview} failed={overviewFailed} locale={locale} /> : null}
          {tier === "approved" ? (
            <article className="pt-home-card">
              <p className="pt-home-card-kicker">{strings.applicationKicker}</p>
              <h2 className="pt-home-card-title">{admission.pendingApplicationHeading}</h2>
              <p className="pt-home-card-action">
                <IntentPrefetchLink className="pt-btn-ghost" href="/apply/status">
                  {admission.pendingApplicationLink}
                </IntentPrefetchLink>
              </p>
            </article>
          ) : null}
          <HomeFavorites favorites={favorites} total={favoritesTotal} locale={locale} now={now} />
        </div>

        <div className="pt-home-side">
          {journey}
          <HomeDates items={dated} today={today} locale={locale} />
          {tier === "assisted" ? <HomeNews notifications={news} locale={locale} /> : null}
          {csca}
        </div>
      </div>
    </div>
  );
}
