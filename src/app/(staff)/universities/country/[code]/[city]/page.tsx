import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink, UniversityRows, universitiesWord } from "@/components/staff/universities-next/UniversityGeoViews";
import { UniversityShell } from "@/components/staff/universities-next/UniversityShell";
import { universityCountry, UniversityUnavailable } from "@/components/staff/universities/UniversityCatalogue";
import { requireV3PageActor } from "@/lib/platform-guards";
import { countryHref, hasNoQuery, parseGeoCityParam, parseGeoCountryCode } from "@/lib/university-geo-groups";
import { canManageCatalogGeography } from "@/lib/v3/catalog-geography-source";
import { readStaffCountryGeo } from "@/lib/v3/university-geo-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "Университеты" };

/** Вузы одного города страны. Адрес города: ключ справочника, «~подпись» или «~» (без города); неизвестный город даёт 404. */
export default async function UniversityCityPage({ params, searchParams }: {
  params: Promise<{ code: string; city: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [actor, route, query] = await Promise.all([requireV3PageActor("/universities"), params, searchParams]);
  const code = parseGeoCountryCode(route.code) ?? notFound();
  const city = parseGeoCityParam(route.city) ?? notFound();
  if (!hasNoQuery(query)) notFound();
  const country = universityCountry(code);
  const back = <BackLink href={countryHref(code)}>{country}</BackLink>;
  let geo;
  try { geo = await readStaffCountryGeo(actor, code); } catch { return <UniversityShell title={country} back={back}><UniversityUnavailable /></UniversityShell>; }
  const group = geo.groups.find((entry) => entry.key === city.key) ?? notFound();
  const directoryCity = group.key === null ? undefined : geo.cities.find((entry) => entry.key === group.key);
  const edit = directoryCity && canManageCatalogGeography(actor)
    ? <Link href={`/universities/cities?city=${directoryCity.key}`} className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg">Править город</Link>
    : undefined;
  return (
    <UniversityShell
      title={group.label}
      back={back}
      action={edit}
      meta={`${country} · ${group.items.length} ${universitiesWord(group.items.length)}`}
    >
      {directoryCity?.summaryRu ? <p className="max-w-prose t-body-compact text-fg-2">{directoryCity.summaryRu}</p> : null}
      <UniversityRows items={group.items} />
    </UniversityShell>
  );
}
