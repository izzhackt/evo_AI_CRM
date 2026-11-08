import { SectionTabs } from "@/components/kit/SectionTabs";
import { COUNTRY_VIEWS, countryHref, type CountryView } from "@/lib/university-geo-groups";

/** Верхний уровень раздела: прежняя таблица «Все вузы» и вход «По странам» (карта, города, списком). */
export function UniversityGeoTabs({ current }: Readonly<{ current: "all" | "countries" }>) {
  return (
    <SectionTabs
      label="Вид раздела «Университеты»"
      value={current}
      tabs={[
        { key: "all", label: "Все вузы", href: "/universities" },
        { key: "countries", label: "По странам и на карте", href: "/universities/country" },
      ]}
    />
  );
}

const VIEW_LABELS: Readonly<Record<CountryView, string>> = { cities: "Города", list: "Списком", map: "Карта" };

/** Виды страны: города, список по городам, карта. */
export function CountryViewTabs({ code, current }: Readonly<{ code: string; current: CountryView }>) {
  return (
    <SectionTabs
      label="Вид страны"
      value={current}
      tabs={COUNTRY_VIEWS.map((view) => ({ key: view, label: VIEW_LABELS[view], href: countryHref(code, view) }))}
    />
  );
}
