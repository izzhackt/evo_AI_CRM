import { notFound } from "next/navigation";

import {
  BackLink, CityCards, CountryGroupedList, universitiesWord,
} from "@/components/staff/universities-next/UniversityGeoViews";
import { CountryViewTabs } from "@/components/staff/universities-next/UniversityGeoTabs";
import { UniversityGeoMap } from "@/components/staff/universities/geo/UniversityGeoMap";
import { UniversityShell } from "@/components/staff/universities-next/UniversityShell";
import { universityCountry, UniversityUnavailable } from "@/components/staff/universities/UniversityCatalogue";
import { requireV3PageActor } from "@/lib/platform-guards";
import { buildCampusPins, countryHref, parseCountryView, parseGeoCountryCode } from "@/lib/university-geo-groups";
import { canManageCatalogGeography, geographyPhotoBase } from "@/lib/v3/catalog-geography-source";
import { readStaffCountryGeo } from "@/lib/v3/university-geo-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "Университеты" };

/**
 * Страна в CRM: `?view=` «Города» (по умолчанию), «Списком» (все вузы страны
 * по городам) и «Карта» (точки кампусов с проверенной координатой). Любой
 * другой параметр, вид или код страны даёт 404.
 */
export default async function UniversityCountryPage({ params, searchParams }: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [actor, route, query] = await Promise.all([requireV3PageActor("/universities"), params, searchParams]);
  const code = parseGeoCountryCode(route.code) ?? notFound();
  const view = parseCountryView(query) ?? notFound();
  const name = universityCountry(code);
  const back = <BackLink href="/universities/country">Все страны</BackLink>;
  const tabs = <CountryViewTabs code={code} current={view} />;
  let geo;
  try { geo = await readStaffCountryGeo(actor, code); } catch { return <UniversityShell title={name} back={back} tabs={tabs}><UniversityUnavailable /></UniversityShell>; }
  const total = geo.items.length;
  const cityCount = geo.groups.filter((group) => group.key !== null).length;
  const meta = total === 0 ? "Опубликованных карточек нет" : `${total} ${universitiesWord(total)}${cityCount > 0 ? ` · городов: ${cityCount}` : ""}`;
  if (total === 0) {
    return <UniversityShell title={name} back={back} tabs={tabs} meta={meta}><p className="rounded-card border border-border bg-surface p-5 t-body-compact text-fg-2">По этой стране пока нет опубликованных карточек.</p></UniversityShell>;
  }
  const place = (item: (typeof geo.items)[number]) => [item.content.city, name].filter(Boolean).join(" · ");
  const map = view === "map" ? buildCampusPins(geo.items.map((item) => ({ id: item.id, name: item.content.name, photoKey: item.content.photoKey, item })), (pin) => place(pin.item)) : null;
  return (
    <UniversityShell title={name} back={back} tabs={tabs} meta={meta}>
      {view === "cities" ? (
        <CityCards code={code} groups={geo.groups} cities={geo.geography?.cities.filter((city) => city.country === code) ?? []} photoBase={geographyPhotoBase()} canEdit={canManageCatalogGeography(actor)} />
      ) : view === "list" ? (
        <CountryGroupedList code={code} groups={geo.groups} />
      ) : map ? (
        <>
          {map.pins.length > 0
            ? <UniversityGeoMap pins={map.pins} listHref={countryHref(code, "list")} />
            : <p className="rounded-card border border-border bg-surface p-5 t-body-compact text-fg-2">Ни у одного вуза страны пока нет проверенной координаты кампуса. Вузы доступны списком.</p>}
          <p className="t-meta text-fg-2" data-testid="university-geo-map-summary">
            {map.missing === 0
              ? `На карте все вузы страны: ${map.pins.length}.`
              : `На карте ${map.pins.length} из ${total}: у остальных нет проверенной координаты кампуса, их можно найти списком.`}
          </p>
        </>
      ) : null}
    </UniversityShell>
  );
}
