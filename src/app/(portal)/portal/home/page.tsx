import type { Metadata } from "next";

import { AiConsentHomeCard } from "@/components/portal/consent/AiConsent";
import { CountryTimeline } from "@/components/portal/home/CountryTimeline";
import { CscaHomeCard } from "@/components/portal/home/CscaHomeCard";
import { HomeView } from "@/components/portal/home/HomeView";
import { getLocale } from "@/lib/i18n";
import { readOwnAiConsent } from "@/lib/portal/ai-consent-source";
import { readStudentCountryChoice } from "@/lib/portal/country-choice-source";
import {
  TIMELINE_UNDECIDED,
  selectCountryTimeline,
  todayForTimeline,
} from "@/lib/portal/country-timeline";
import { cscaHomeCardVisible, selectCscaHomeCard } from "@/lib/portal/csca-home-card";
import { readCscaHome } from "@/lib/portal/csca-source";
import { getPortalStrings } from "@/lib/portal/i18n";
import { readLearningModules } from "@/lib/portal/learning-source";
import { readStudentRecentUniversities } from "@/lib/portal/recent-universities-source";
import {
  readStudentUniversitiesByIds,
  readStudentUniversityFavorites,
} from "@/lib/portal/university-favorites-source";
import { TIMELINE_MODULE_ROUTES } from "@/lib/portal/timeline-module-routes";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { STUDY_COUNTRY_UNDECIDED, studyCountryOptions } from "@/lib/study-countries";
import { readStudentAssessments } from "@/lib/v3/student-assessment-source";
import {
  readStudentPortalOverview,
  type StudentPortalOverview,
} from "@/lib/v3/portal-source";

export const dynamic = "force-dynamic";

/** Показываем на «Главной» первые записи избранного; полный список — /portal/favorites. */
const HOME_FAVORITES_LIMIT = 4;

export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("home", await getLocale());
  return { title: `${strings.title} — EVO Admissions` };
}

/**
 * «Главная» кабинета (PORT-9c). Живёт на отдельном маршруте: корень /portal
 * остаётся «Моим поступлением» — его заголовок, точка входа после логина и
 * ссылка nav — замороженные смоук-якоря production
 * (scripts/evo-production-browser-smoke.mjs). Только существующие RPC-чтения;
 * каждый источник падает в свой честный fallback, не роняя весь экран.
 */
export default async function StudentPortalHomePage() {
  const [actor, locale] = await Promise.all([requireStudentPortalActor(), getLocale()]);
  // PORT-1a: единственная проверяемая граница уровня доступа — серверный
  // actor.accessTier, без повторной локальной деривации из caseState.
  const tier = actor.accessTier;
  const strings = getPortalStrings("home", locale);

  // Выбор страны «Пути поступления» (284) читается в той же волне, что и
  // остальные чтения «Главной» (план A): лишней последовательной волны нет.
  // Карточка CSCA (Q16) только для Китая: главная трека читается тут же, за
  // выбором, внутри той же волны (цепочка из двух чтений, как у избранного),
  // а студенту с другой страной лишнего чтения нет.
  // Согласие на ИИ-помощников (25.10.2026) читается в той же волне: отдельного
  // круга ожидания нет, а сбой чтения прячет карточку, не роняя «Главную».
  const [overviewResult, modules, assessments, favoritesResult, recentUniversities, choiceRead, aiConsentRead] = await Promise.all([
    tier === "assisted"
      ? readStudentPortalOverview()
        .then((value): { ok: true; value: StudentPortalOverview | null } => ({ ok: true, value }))
        .catch((): { ok: false } => ({ ok: false }))
      : Promise.resolve({ ok: true, value: null } as const),
    readLearningModules().catch((): null => null),
    readStudentAssessments().catch((): null => null),
    readStudentUniversityFavorites()
      .then(async (saved) => ({
        ok: true as const,
        total: saved.length,
        items: await readStudentUniversitiesByIds(
          saved.slice(0, HOME_FAVORITES_LIMIT).map((favorite) => favorite.institutionId),
        ),
      }))
      .catch(() => ({ ok: false as const })),
    readStudentRecentUniversities().catch((): null => null),
    readStudentCountryChoice().catch((): null => null).then(async (choice) => ({
      choice,
      cscaHome: cscaHomeCardVisible(choice) ? await readCscaHome().catch((): null => null) : null,
    })),
    readOwnAiConsent(),
  ]);
  const { choice, cscaHome } = choiceRead;
  const now = new Date();
  const timelineView = choice?.country
    ? selectCountryTimeline(choice.country, {
      locale,
      today: todayForTimeline(now),
      modules: TIMELINE_MODULE_ROUTES,
    })
    : null;
  const cscaCard = selectCscaHomeCard({
    choice,
    home: cscaHome,
    locale,
    cscaStrings: getPortalStrings("csca", locale),
    homeStrings: strings,
  });
  const countryOptions = studyCountryOptions(locale, { undecided: true }).map((option) => ({
    code: option.code === STUDY_COUNTRY_UNDECIDED ? TIMELINE_UNDECIDED : option.code,
    label: option.label,
  }));

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">{strings.kicker}</p>
        <h1 className="pt-page-title">{strings.title}</h1>
        <p className="pt-page-lead">
          {tier === "assisted" ? strings.leadAssisted : strings.leadApproved}
        </p>
      </header>
      <HomeView
        tier={tier}
        overview={overviewResult.ok ? overviewResult.value : null}
        overviewFailed={!overviewResult.ok}
        modules={modules}
        assessments={assessments}
        favorites={favoritesResult.ok ? favoritesResult.items : null}
        favoritesTotal={favoritesResult.ok ? favoritesResult.total : 0}
        recentUniversities={recentUniversities}
        journey={(
          <CountryTimeline
            view={timelineView}
            source={choice?.source ?? null}
            readFailed={choice === null}
            options={countryOptions}
            strings={getPortalStrings("timeline", locale)}
          />
        )}
        csca={cscaCard ? <CscaHomeCard view={cscaCard} /> : null}
        aiConsent={aiConsentRead.status === "ready" ? (
          <AiConsentHomeCard
            initialConsent={aiConsentRead.consent}
            strings={getPortalStrings("aiConsent", locale)}
          />
        ) : null}
        locale={locale}
        now={now}
      />
    </main>
  );
}
