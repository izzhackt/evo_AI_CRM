import { notFound } from "next/navigation";

import {
  UniversitiesMapSummary,
  UniversitiesToolbar,
  UniversitiesUnavailable,
  UniversityCards,
  universitiesHref,
  type UniversitiesView,
} from "@/components/portal/universities/Catalog";
import { UniversitiesMapView } from "@/components/portal/universities/MapView";
import { getLocale } from "@/lib/i18n";
import { parseUniversityFilters, type UniversityPage } from "@/lib/platform-university-catalog";
import { getPortalStrings } from "@/lib/portal/i18n";
import { readStudentUniversitiesComplete } from "@/lib/portal/university-catalog-reader";
import { readStudentUniversityFavorites } from "@/lib/portal/university-favorites-source";
import { universityGeo } from "@/lib/portal/university-geo";
import { universityCountryLabel, type UniversityMapPin } from "@/lib/portal/universities";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { readStudentUniversities } from "@/lib/v3/university-source";

export const dynamic = "force-dynamic";

const BASE = "/portal/universities";

/**
 * Каталог «Атлас» (PORT-3a): список⇄карта с общими фильтрами q/country/level
 * в URL. Карта — полный отфильтрованный набор (см. cost-комментарий в
 * readStudentUniversitiesComplete); вуз без проверенной координаты остаётся
 * в списке и честно считается в строке под картой.
 */
export default async function UniversitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [actor, params, locale] = await Promise.all([
    requireStudentPortalActor(),
    searchParams,
    getLocale(),
  ]);
  const { view: rawView, ...filterParams } = params;
  if (rawView !== undefined && rawView !== "map" && rawView !== "list") notFound();
  const view: UniversitiesView = rawView === "map" ? "map" : "list";
  const filters = parseUniversityFilters(filterParams) ?? notFound();
  const strings = getPortalStrings("universities", locale);
  const now = new Date();

  let listPage: UniversityPage | null = null;
  const pins: UniversityMapPin[] = [];
  let missing = 0;
  let failed = false;
  // Состояние избранного — отдельное чтение: его сбой не роняет каталог,
  // toggle честно скрывается вместо ложного «не сохранено» (PORT-3b).
  let favoriteIds: readonly string[] | null = null;
  try {
    favoriteIds = (await readStudentUniversityFavorites())
      .map((favorite) => favorite.institutionId);
  } catch {
    favoriteIds = null;
  }
  try {
    if (view === "map") {
      for (const item of await readStudentUniversitiesComplete(actor, filters)) {
        const geo = universityGeo(item.content.photoKey);
        if (geo === null) {
          missing += 1;
          continue;
        }
        const country = universityCountryLabel(item.content.country, locale);
        pins.push({
          id: item.id,
          name: item.content.name,
          place: item.content.city ? `${item.content.city} · ${country}` : country,
          lat: geo.lat,
          lng: geo.lng,
        });
      }
    } else {
      listPage = await readStudentUniversities(actor, filters);
    }
  } catch {
    failed = true;
  }

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">{strings.kicker}</p>
        <h1 className="pt-page-title">{strings.title}</h1>
        <p className="pt-page-lead">{strings.lead}</p>
      </header>
      <UniversitiesToolbar
        base={BASE}
        filters={filters}
        view={view}
        strings={strings}
        locale={locale}
      />
      {failed ? (
        <UniversitiesUnavailable strings={strings} />
      ) : view === "map" ? (
        <>
          <UniversitiesMapView
            pins={pins}
            base={BASE}
            listHref={universitiesHref(BASE, filters, "list")}
            strings={strings}
          />
          <UniversitiesMapSummary shown={pins.length} missing={missing} strings={strings} />
        </>
      ) : listPage !== null ? (
        <UniversityCards
          page={listPage}
          filters={filters}
          base={BASE}
          strings={strings}
          locale={locale}
          now={now}
          favoriteIds={favoriteIds}
        />
      ) : null}
    </main>
  );
}
