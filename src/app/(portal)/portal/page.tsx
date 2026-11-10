import type { Metadata } from "next";

import { PendingPackagesLink } from "@/components/portal/applicationPackages/PendingPackagesLink";
import { packageStrings } from "@/components/portal/applicationPackages/strings";
import { PreparationList } from "@/components/portal/admissionPreparations/PreparationList";
import { OverviewView } from "@/components/portal/admission/OverviewView";
import { FavoritesSection } from "@/components/portal/favorites/FavoritesSection";
import { HomeFavorites } from "@/components/portal/home/HomeFavorites";
import { HomeList, type HomeListView } from "@/components/portal/home/HomeList";
import { CountryTimeline } from "@/components/portal/home/CountryTimeline";
import { CscaHomeCard } from "@/components/portal/home/CscaHomeCard";
import { HomeJourneyCard } from "@/components/portal/home/HomeJourneyCard";
import { HomeView } from "@/components/portal/home/HomeView";
import { getLocale } from "@/lib/i18n";
import { readStudentCatalogPreparations } from "@/lib/portal/catalog-preparations-source";
import { readStudentCountryChoice } from "@/lib/portal/country-choice-source";
import { cscaHomeCardVisible, selectCscaHomeCard } from "@/lib/portal/csca-home-card";
import { readCscaHome } from "@/lib/portal/csca-source";
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

/** Для «Ближайших дат» «Главной» читаются первые записи избранного; полный список — вкладка «Вузы» в «Моём списке». */
const HOME_FAVORITES_LIMIT = 4;

export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("home", await getLocale());
  return { title: `${strings.title} — EVO Admissions` };
}

/**
 * «Главная» кабинета: единственная домашняя страница студента, /portal (#1355, 09.11.2026). После логина студент
 * видит «Что сделать сейчас» первым блоком; ниже «Мой список» (вкладки «Вузы» и «Мои программы», бывшее
 * «Поступление») и весь «Путь поступления». Прежний /portal/home перенаправляется сюда. Смоук-якоря production
 * (scripts/release/evo-production-browser-smoke.mjs): ровно одна видимая ссылка a[href="/portal"] в навигации
 * «Разделы кабинета» и заголовок «Что сделать сейчас». Только существующие RPC-чтения; каждый источник падает в свой
 * честный fallback, не роняя весь экран. Разовый вопрос куратору с «Поступления» снят (#1356): вход один, «Написать
 * EVO» ведёт в чат «Входящих».
 */
export default async function StudentPortalHomePage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ view?: string; all?: string }> }>) {
  const [actor, locale, search] = await Promise.all([requireStudentPortalActor(), getLocale(), searchParams]);
  const view: HomeListView = search.view === "programs" ? "programs" : "universities";
  // «Всё избранное» (HomeFavorites): полный список со сравнением; по умолчанию вкладка «Вузы» — карточки с фото.
  const allFavorites = search.all === "1";
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
  // Только у клиента с делом на сопровождении (tier assisted, он уже известен
  // из actor): самостоятельному студенту вопроса нет, и RPC не вызывается.
  // 03.11.2026: «Учёба и тесты» и «Новое в каталоге» сняты с «Главной» — их
  // чтений здесь больше нет; «Что нового» (лента «Входящих») — только assisted.
  // «Мой список» (#1355): выбранные программы читаются в той же волне.
  const [overviewResult, news, favoritesResult, choiceRead, preparations] = await Promise.all([
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
        ids: saved.map((favorite) => favorite.institutionId),
        items: await readStudentUniversitiesByIds(
          saved.slice(0, HOME_FAVORITES_LIMIT).map((favorite) => favorite.institutionId),
        ),
      }))
      .catch(() => ({ ok: false as const })),
    readStudentCountryChoice().catch((): null => null).then(async (choice) => ({
      choice,
      cscaHome: cscaHomeCardVisible(choice) ? await readCscaHome().catch((): null => null) : null,
    })),
    readStudentCatalogPreparations(actor.studentCaseId).catch(() => null),
  ]);
  const { choice, cscaHome } = choiceRead;
  const now = new Date();
  // 08.11.2026 (пользователь): весь путь на «Поступлении», здесь его карточка — тот же выбор пути и прогресс.
  const journey = selectStudentJourney({
    country: choice?.country ?? null,
    stage: overviewResult.ok ? overviewResult.value?.operationalStage ?? null : undefined,
    boardStage: overviewResult.ok ? overviewResult.value?.boardStage ?? null : null,
    locale,
    now,
  });
  const cscaCard = selectCscaHomeCard({
    choice,
    home: cscaHome,
    locale,
    cscaStrings: getPortalStrings("csca", locale),
    homeStrings: strings,
  });

  const country = choice?.country ?? null;
  const studyCountry = country !== null && isStudyCountryCode(country) ? studyCountryName(country, locale) : null;

  const preparationStrings = getPortalStrings("preparations", locale);
  const assisted = tier === "assisted";

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
        info={overviewResult.ok ? (
          // Заявка на рассмотрении — одна, карточка «Ваша анкета» в HomeView (tier approved): здесь только задача EVO.
          <OverviewView overview={overviewResult.value} locale={locale} />
        ) : null}
        list={(
          <>
            {/* «Незавершённые отправки» видны на любой вкладке: оборванная отправка не зависит от выбранного вида (#1341). */}
            <div className="pt-pending-packages">
              <PendingPackagesLink owner={{ organizationId: actor.organizationId, membershipId: actor.membershipId }} label={packageStrings(locale).pendingTitle} />
            </div>
            <HomeList
              view={view}
              favoritesCount={favoritesResult.ok ? favoritesResult.total : null}
              programsCount={preparations?.length ?? null}
              locale={locale}
            >
              {view === "universities" ? (
                allFavorites ? (
                  <FavoritesSection institutionIds={favoritesResult.ok ? favoritesResult.ids : null} locale={locale} />
                ) : (
                  <HomeFavorites
                    favorites={favoritesResult.ok ? favoritesResult.items : null}
                    total={favoritesResult.ok ? favoritesResult.total : 0}
                    locale={locale}
                  />
                )
              ) : (
                <PreparationList items={preparations} strings={preparationStrings} canSelect={actor.caseState === "active" && Boolean(actor.portalActivatedAt)} />
              )}
            </HomeList>
          </>
        )}
        fullPath={journey.view ? (
          // Якорь #path ставит сам CountryTimeline (JOURNEY_ANCHOR): к нему ведёт карточка пути выше.
          <CountryTimeline
            view={journey.view}
            progress={journey.progress}
            documentsHref={assisted ? "/portal/documents" : null}
            source={choice?.source ?? null}
            readFailed={choice === null}
            options={timelineCountryOptions(locale)}
            strings={getPortalStrings("timeline", locale)}
          />
        ) : null}
        journey={journey.view ? (
          <HomeJourneyCard view={journey.view} progress={journey.progress} stage={overviewResult.ok ? overviewResult.value?.operationalStage ?? null : null} locale={locale} />
        ) : null}
        countryChoice={journey.view ? null : (
          <CountryTimeline
            view={null}
            source={choice?.source ?? null}
            readFailed={choice === null}
            options={timelineCountryOptions(locale)}
            strings={getPortalStrings("timeline", locale)}
          />
        )}
        csca={cscaCard ? <CscaHomeCard view={cscaCard} /> : null}
        locale={locale}
        now={now}
      />
    </main>
  );
}
