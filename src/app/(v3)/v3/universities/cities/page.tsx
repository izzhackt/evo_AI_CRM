import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Icon } from "@/components/icons";
import { PartShell } from "@/components/v3/PartShell";
import { CityEditor } from "@/components/v3/universities/geography/CityEditor";
import { CityList } from "@/components/v3/universities/geography/CityList";
import { requireV3PageActor } from "@/lib/platform-guards";
import { isStudyCountryCode } from "@/lib/study-countries";
import { canManageCatalogGeography, geographyPhotoBase, readStaffCatalogGeography } from "@/lib/v3/catalog-geography-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "Университеты" };

const BACK = "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg hover:underline hover:underline-offset-4";
type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : value === undefined ? null : undefined);

/**
 * Города (план 7.5): `?country=` фильтр списка, `?city=<ключ>` карточка
 * города, `?new=<код страны>` новый город. Без нового пункта меню: вход из
 * «Университетов» тихой ссылкой. Право то же, что «Управлять каталогом».
 */
export default async function UniversityCitiesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const [actor, params] = await Promise.all([requireV3PageActor("/v3/universities"), searchParams]);
  if (!canManageCatalogGeography(actor)) redirect("/access-denied?from=%2Fv3%2Funiversities");
  const keys = Object.keys(params);
  if (keys.some((key) => !["country", "city", "new"].includes(key)) || keys.length > 1) notFound();
  const country = one(params.country), cityKey = one(params.city), fresh = one(params.new);
  if (country === undefined || cityKey === undefined || fresh === undefined) notFound();
  if ((country !== null && !isStudyCountryCode(country)) || (fresh !== null && !isStudyCountryCode(fresh)) || (cityKey !== null && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(cityKey))) notFound();
  const today = new Date().toISOString().slice(0, 10);
  let geography;
  try { geography = await readStaffCatalogGeography(actor); } catch {
    return <PartShell title="Города"><p role="alert" className="rounded-card border border-border bg-surface p-5 t-body-compact text-danger">Не удалось загрузить города. Обновите страницу: это не значит, что справочник пуст.</p></PartShell>;
  }
  const back = (href: string, label: string) => <Link href={href} className={BACK}><Icon name="arrow-left" size={16} />{label}</Link>;
  if (cityKey !== null || fresh !== null) {
    const city = cityKey ? geography.cities.find((item) => item.key === cityKey) ?? notFound() : null;
    return (
      <PartShell title={city ? city.nameRu : "Новый город"} back={back(`/v3/universities/cities?country=${city?.country ?? fresh}`, "Города")} meta={city ? `${city.nameEn} · ${geography.countries.find((item) => item.code === city.country)?.nameRu ?? city.country}` : "Карточка города для кабинета студента"}>
        <CityEditor key={city?.key ?? `new-${fresh}`} city={city} country={city?.country ?? fresh!} today={today} photoBase={geographyPhotoBase()} />
      </PartShell>
    );
  }
  return (
    <PartShell
      title="Города"
      count={geography.cities.length}
      back={back("/v3/universities", "Все университеты")}
      action={<Link href={`/v3/universities/cities?new=${country ?? "CN"}`} className="v3-raised inline-flex h-11 items-center gap-1.5 rounded-ctl border border-accent bg-accent px-4 t-label text-on-accent hover:border-accent-2 hover:bg-accent-2"><Icon name="plus" size={16} />Добавить город</Link>}
    >
      <CityList geography={geography} country={country} />
    </PartShell>
  );
}
