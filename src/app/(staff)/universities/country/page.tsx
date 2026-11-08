import { notFound } from "next/navigation";

import { UniversityGeoTabs } from "@/components/staff/universities-next/UniversityGeoTabs";
import { CountryCards, type CountryCardModel } from "@/components/staff/universities-next/UniversityGeoViews";
import { UniversityShell } from "@/components/staff/universities-next/UniversityShell";
import { universityCountry, UniversityUnavailable } from "@/components/staff/universities/UniversityCatalogue";
import { requireV3PageActor } from "@/lib/platform-guards";
import { STUDY_COUNTRY_CODES } from "@/lib/study-countries";
import { compareByLocale, hasNoQuery } from "@/lib/university-geo-groups";
import { readStaffCountryTotals } from "@/lib/v3/university-geo-source";
import { readStaffUniversityCountries } from "@/lib/v3/university-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "Университеты" };

/**
 * Университеты по странам (CRM): вход в страну → города → вузы города и
 * карту страны, как в кабинете студента. Страны единого списка в порядке
 * продукта, затем прочие (их карточки студенты не видят) по названию.
 * Право и чтение те же, что у таблицы «Все вузы» (`catalog.read`).
 */
export default async function UniversityCountriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [actor, query] = await Promise.all([requireV3PageActor("/universities"), searchParams]);
  if (!hasNoQuery(query)) notFound();
  const tabs = <UniversityGeoTabs current="countries" />;
  let facet, totals;
  try {
    [facet, totals] = await Promise.all([readStaffUniversityCountries(actor), readStaffCountryTotals(actor)]);
  } catch {
    return <UniversityShell title="Университеты" tabs={tabs}><UniversityUnavailable /></UniversityShell>;
  }
  const known = STUDY_COUNTRY_CODES.filter((code) => facet.countries.includes(code));
  const others = facet.countries.filter((code) => !STUDY_COUNTRY_CODES.includes(code)).sort((a, b) => compareByLocale(universityCountry(a), universityCountry(b)));
  const countries: CountryCardModel[] = [...known, ...others].map((code) => ({ code, name: universityCountry(code), count: totals?.get(code) ?? null }));
  return (
    <UniversityShell title="Университеты" tabs={tabs} meta="Страна, затем город и вузы города; карта кампусов страны">
      {countries.length > 0
        ? <CountryCards countries={countries} />
        : <p className="rounded-card border border-border bg-surface p-5 t-body-compact text-fg-2">Пока нет опубликованных карточек.</p>}
    </UniversityShell>
  );
}
