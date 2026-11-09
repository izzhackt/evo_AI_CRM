import type { Metadata } from "next";

import { OverviewView } from "@/components/portal/admission/OverviewView";
import { CountryTimeline } from "@/components/portal/home/CountryTimeline";
import { HomeJourneyCard } from "@/components/portal/home/HomeJourneyCard";
import { HomeView } from "@/components/portal/home/HomeView";
import { getLocale } from "@/lib/i18n";
import { readStudentCountryChoice } from "@/lib/portal/country-choice-source";
import { getPortalStrings } from "@/lib/portal/i18n";
import { selectStudentJourney, timelineCountryOptions } from "@/lib/portal/student-journey";
import {
  readStudentUniversitiesByIds,
  readStudentUniversityFavorites,
} from "@/lib/portal/university-favorites-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { isStudyCountryCode, studyCountryName } from "@/lib/study-countries";
import {
  readStudentPortalNotifications,
  readStudentPortalOverview,
  type StudentPortalOverview,
} from "@/lib/v3/portal-source";

export const dynamic = "force-dynamic";

/** «Мои вузы» на «Главной» — первые записи избранного; полный список — «Моё поступление» (/portal/admission#list). */
const HOME_FAVORITES_LIMIT = 4;

export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("home", await getLocale());
  return { title: `${strings.title} — EVO Admissions` };
}

/**
 * «Главная» кабинета: единственная домашняя страница студента, /portal (#1355, 09.11.2026). После логина студент
 * видит «Что сделать сейчас» первым блоком. Прежний /portal/home перенаправляется сюда. Смоук-якоря production
 * (scripts/release/evo-production-browser-smoke.mjs): ровно одна видимая ссылка a[href="/portal"] в навигации
 * «Разделы кабинета» и заголовок «Что сделать сейчас». Только существующие RPC-чтения; каждый источник падает в свой
 * честный fallback, не роняя весь экран.
 *
 * 09.11.2026 (пользователь): вид прежней «Главной» без дорожки этапов, карточек ИИ-помощников, CSCA и «Написать EVO».
 * Весь путь, выбранные вузы и программы с числом — страница «Моё поступление» (/portal/admission).
 */
export default async function StudentPortalHomePage() {
  const [actor, locale] = await Promise.all([requireStudentPortalActor(), getLocale()]);
  // PORT-1a: единственная проверяемая граница уровня доступа — серверный
  // actor.accessTier, без повторной локальной деривации из caseState.
  const tier = actor.accessTier;

  // Выбор страны «Пути поступления» (284) читается в той же волне, что и остальные чтения «Главной» (план A):
  // лишней последовательной волны нет. «Что нового» (лента «Входящих») — только assisted.
  const [overviewResult, news, favoritesResult, choice] = await Promise.all([
    tier === "assisted"
      ? readStudentPortalOverview()
        .then((value): { ok: true; value: StudentPortalOverview | null } => ({ ok: true, value }))
        .catch((): { ok: false } => ({ ok: false }))
      : Promise.resolve({ ok: true, value: null } as const),
    tier === "assisted" ? readStudentPortalNotifications().catch((): null => null) : Promise.resolve(null),
    readStudentUniversityFavorites()
      .then(async (saved) => ({
        ok: true as const,
        total: saved.length,
        items: await readStudentUniversitiesByIds(
          saved.slice(0, HOME_FAVORITES_LIMIT).map((favorite) => favorite.institutionId),
        ),
      }))
      .catch(() => ({ ok: false as const })),
    readStudentCountryChoice().catch((): null => null),
  ]);
  const now = new Date();
  // 08.11.2026 (пользователь): карточка пути — тот же выбор пути и прогресс, что и весь путь на «Моём поступлении».
  const journey = selectStudentJourney({
    country: choice?.country ?? null,
    stage: overviewResult.ok ? overviewResult.value?.operationalStage ?? null : undefined,
    locale,
    now,
  });

  const country = choice?.country ?? null;
  const studyCountry = country !== null && isStudyCountryCode(country) ? studyCountryName(country, locale) : null;
  const timelineStrings = getPortalStrings("timeline", locale);

  // Заголовок страницы — приветствие в шапке HomeView (HomeHero).
  return (
    <main className="pt-page">
      <HomeView
        tier={tier}
        displayName={actor.displayName}
        studyCountry={studyCountry}
        overview={overviewResult.ok ? overviewResult.value : null}
        overviewFailed={!overviewResult.ok}
        news={news}
        favorites={favoritesResult.ok ? favoritesResult.items : null}
        favoritesTotal={favoritesResult.ok ? favoritesResult.total : 0}
        info={overviewResult.ok ? (
          // Заявка на рассмотрении — одна, карточка «Ваша анкета» в HomeView (tier approved): здесь только задача EVO.
          <OverviewView overview={overviewResult.value} locale={locale} />
        ) : null}
        journey={journey.view ? (
          <HomeJourneyCard view={journey.view} progress={journey.progress} locale={locale} />
        ) : null}
        countryChoice={journey.view ? null : (
          <CountryTimeline
            view={null}
            source={choice?.source ?? null}
            readFailed={choice === null}
            options={timelineCountryOptions(locale)}
            strings={timelineStrings}
          />
        )}
        locale={locale}
        now={now}
      />
    </main>
  );
}
