import type { Metadata } from "next";

import { PendingPackagesLink } from "@/components/portal/applicationPackages/PendingPackagesLink";
import { packageStrings } from "@/components/portal/applicationPackages/strings";
import { PreparationList } from "@/components/portal/admissionPreparations/PreparationList";
import { FavoritesSection } from "@/components/portal/favorites/FavoritesSection";
import { CountryTimeline } from "@/components/portal/home/CountryTimeline";
import { HomeList, type HomeListView } from "@/components/portal/home/HomeList";
import { getLocale } from "@/lib/i18n";
import { readStudentCatalogPreparations } from "@/lib/portal/catalog-preparations-source";
import { readStudentCountryChoice } from "@/lib/portal/country-choice-source";
import { getPortalStrings } from "@/lib/portal/i18n";
import { selectStudentJourney, timelineCountryOptions } from "@/lib/portal/student-journey";
import { readStudentUniversityFavorites } from "@/lib/portal/university-favorites-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { readStudentPortalOverview } from "@/lib/v3/portal-source";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("admission", await getLocale());
  return { title: `${strings.overviewTitle} — EVO Admissions` };
}

/**
 * «Моё поступление» (09.11.2026, пользователь: путь поступления «должен быть в странице поступление, там и будут
 * уники которые он выбрал и число програм и уников»): весь «Путь поступления» страны (якорь #path, к нему ведёт
 * «Весь путь» с «Главной»), ниже «Мой список» — вкладки «Вузы» и «Мои программы» с числом (якорь #list). Все чтения
 * одной волной; каждое падает в свою честную плашку, не роняя страницу. Прогресс пути — только у клиента с делом на
 * сопровождении; обзор дела не прочитан — путь без прогресса.
 */
export default async function StudentPortalAdmissionPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ view?: string }> }>) {
  const [actor, locale, search] = await Promise.all([requireStudentPortalActor(), getLocale(), searchParams]);
  const view: HomeListView = search.view === "programs" ? "programs" : "universities";
  const assisted = actor.accessTier === "assisted";
  const [overview, favorites, preparations, choice] = await Promise.all([
    assisted ? readStudentPortalOverview().catch(() => undefined) : Promise.resolve(null),
    readStudentUniversityFavorites()
      .then((saved) => saved.map((favorite) => favorite.institutionId))
      .catch((): null => null),
    readStudentCatalogPreparations(actor.studentCaseId).catch(() => null),
    readStudentCountryChoice().catch((): null => null),
  ]);
  const journey = selectStudentJourney({
    country: choice?.country ?? null,
    stage: overview === undefined ? undefined : overview?.operationalStage ?? null,
    locale,
    now: new Date(),
  });

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <h1 className="pt-page-title">{getPortalStrings("admission", locale).overviewTitle}</h1>
      </header>
      <CountryTimeline
        view={journey.view}
        progress={journey.progress}
        documentsHref={assisted ? "/portal/documents" : null}
        source={choice?.source ?? null}
        readFailed={choice === null}
        options={timelineCountryOptions(locale)}
        strings={getPortalStrings("timeline", locale)}
      />
      {/* «Незавершённые отправки» видны на любой вкладке: оборванная отправка не зависит от выбранного вида (#1341). */}
      <div className="pt-pending-packages">
        <PendingPackagesLink owner={{ organizationId: actor.organizationId, membershipId: actor.membershipId }} label={packageStrings(locale).pendingTitle} />
      </div>
      <HomeList view={view} favoritesCount={favorites?.length ?? null} programsCount={preparations?.length ?? null} locale={locale}>
        {view === "universities" ? (
          <FavoritesSection institutionIds={favorites} locale={locale} />
        ) : (
          <PreparationList
            items={preparations}
            strings={getPortalStrings("preparations", locale)}
            canSelect={actor.caseState === "active" && Boolean(actor.portalActivatedAt)}
          />
        )}
      </HomeList>
    </main>
  );
}
