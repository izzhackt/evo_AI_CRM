// Модели экранов «Университетов»: чистые функции поверх общих модулей веба
// (src/lib/portal/university-index.ts, university-geo-groups.ts, universities.ts).
// Порядок и группировка те же, что в вебе: города страны - больше вузов выше, затем по
// названию на языке интерфейса; «Списком» - города А-Я, вузы А-Я, без города последней
// группой; город без фото карточкой не показывается, его вузы идут в «Другие вузы страны».
import { buildCampusPins } from "@web/lib/university-geo-groups";
import { formatPortalString, type PortalStrings } from "@web/lib/portal/i18n";
import {
  cityUniversities,
  countryCities,
  countryUniversitiesWithoutCity,
  countryUniversityGroups,
  citySearchText,
  matchesSearch,
  searchIndexUniversities,
  localizedText,
  nearestIndexIntake,
  type CountryUniversityGroup,
  type IndexCity,
  type IndexCountry,
  type IndexUniversity,
  type NearestIndexIntake,
  type StudentUniversityIndex,
} from "@web/lib/portal/university-index";
import { universityCountryLabel, universityDateLabel, universityLevelKey, universityMonthLabel } from "@web/lib/portal/universities";

import type { Lang } from "@/i18n";

import { geographyPhotoUrls } from "./photos";

export type UniversityStrings = PortalStrings<"universities">;

/** «N университетов · M городов» с русским склонением (у кыргызского форма одна). */
export function placeCounts(strings: UniversityStrings, universities: number, cities: number | null, lang: Lang): string {
  const form = (n: number): "one" | "few" | "many" => {
    if (lang === "ky") return "many";
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "one";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few";
    return "many";
  };
  const uni = formatPortalString(strings[`count.university.${form(universities)}`], { count: String(universities) });
  if (cities === null) return uni;
  return `${uni} · ${formatPortalString(strings[`count.city.${form(cities)}`], { count: String(cities) })}`;
}

export function intakeText(nearest: NearestIndexIntake | null, strings: UniversityStrings, lang: Lang): string {
  if (nearest === null) return strings.intakeDatesPending;
  if (nearest.kind === "deadline") return formatPortalString(strings.intakeDeadlineByDate, { date: universityDateLabel(nearest.value, lang) });
  return formatPortalString(strings.intakeStartFromDate, {
    date: nearest.kind === "start" ? universityDateLabel(nearest.value, lang) : universityMonthLabel(nearest.value, lang),
  });
}

/** Подпись места вуза: город из карточки города, иначе строка карточки вуза. */
export function universityPlace(index: StudentUniversityIndex, item: IndexUniversity, lang: Lang): string {
  const country = universityCountryLabel(item.country, lang);
  const city = item.cityKey ? index.cities.find((entry) => entry.key === item.cityKey) : undefined;
  const cityName = city ? localizedText(city.name, lang) : item.cityLabel;
  return cityName ? `${cityName} · ${country}` : country;
}

export type TileModel = Readonly<{
  id: string;
  name: string;
  place: string | null;
  levels: readonly string[];
  intake: string;
  photoKey: string | null;
}>;

export function tileModel(
  index: StudentUniversityIndex,
  item: IndexUniversity,
  options: Readonly<{ strings: UniversityStrings; lang: Lang; now: Date; showPlace: boolean }>,
): TileModel {
  return {
    id: item.id,
    name: item.name,
    place: options.showPlace ? universityPlace(index, item, options.lang) : null,
    levels: item.levels.map((level) => options.strings[universityLevelKey(level)]),
    intake: intakeText(nearestIndexIntake(item.intakes, options.now), options.strings, options.lang),
    photoKey: item.photoKey,
  };
}

export type CountryCard = Readonly<{ code: string; name: string; counts: string; photo: IndexCountry["photo"]; empty: boolean }>;

export function countryCards(index: StudentUniversityIndex, strings: UniversityStrings, lang: Lang): readonly CountryCard[] {
  return index.countries.map((country) => ({
    code: country.code,
    name: localizedText(country.name, lang),
    counts: country.universityCount > 0 ? placeCounts(strings, country.universityCount, country.cityCount, lang) : strings.countryNoUniversities,
    photo: country.photo,
    empty: country.universityCount === 0,
  }));
}

export type CityCard = Readonly<{ key: string; name: string; count: string; summary: string; photo: IndexCity["photo"]; search: string }>;

export type CountryPageModel = Readonly<{
  country: IndexCountry;
  name: string;
  counts: string;
  summary: string | null;
  cityCards: readonly CityCard[];
  /** Вузы без города или с городом без фото: «Другие вузы страны». */
  others: readonly IndexUniversity[];
  groups: readonly (Readonly<{ title: string; cityKey: string | null; universities: readonly IndexUniversity[] }>)[];
  pins: ReturnType<typeof countryPins>["pins"];
  missingPins: number;
}>;

/**
 * Карточка города показывается, только если у неё читаемое фото (web: приёмка 7.6.3);
 * иначе город «скрыт», а его вузы остаются в «Других вузах страны».
 */
export function countryPageModel(index: StudentUniversityIndex, code: string, strings: UniversityStrings, lang: Lang): CountryPageModel | null {
  const country = index.countries.find((entry) => entry.code === code);
  if (!country) return null;
  const hidden = new Set<string>();
  const cityCards: CityCard[] = [];
  for (const city of countryCities(index, code, lang)) {
    if (geographyPhotoUrls(city.photo, "https://x.invalid") === null) {
      hidden.add(city.key);
      continue;
    }
    cityCards.push({
      key: city.key,
      name: localizedText(city.name, lang),
      count: placeCounts(strings, city.universityCount, null, lang),
      summary: localizedText(city.summary, lang),
      photo: city.photo,
      search: citySearchText(city),
    });
  }
  const others = [
    ...countryUniversitiesWithoutCity(index, code),
    ...index.universities.filter((item) => item.country === code && item.cityKey !== null && hidden.has(item.cityKey)),
  ];
  const groups = countryUniversityGroups(index, code, lang).map((group: CountryUniversityGroup) => ({
    title: group.city === null ? strings.listNoCity : localizedText(group.city.name, lang),
    // Страница города без фото недоступна: такой заголовок остаётся текстом.
    cityKey: group.city !== null && !hidden.has(group.city.key) ? group.city.key : null,
    universities: group.universities,
  }));
  const { pins, missing } = countryPins(index, code, lang);
  return {
    country,
    name: localizedText(country.name, lang),
    counts: country.universityCount > 0 ? placeCounts(strings, country.universityCount, country.cityCount, lang) : strings.countryNoUniversities,
    summary: country.summary ? localizedText(country.summary, lang) : null,
    cityCards,
    others,
    groups,
    pins,
    missingPins: missing,
  };
}

/** Точки карты страны: только вузы с проверенной координатой; остальные считаются в `missing`. */
export function countryPins(index: StudentUniversityIndex, code: string, lang: Lang) {
  const items = index.universities.filter((item) => item.country === code);
  const byId = new Map(items.map((item) => [item.id, item]));
  return buildCampusPins(items, (item) => universityPlace(index, byId.get(item.id) as IndexUniversity, lang));
}

export type CityPageModel = Readonly<{ city: IndexCity; name: string; counts: string; summary: string; fact: string; universities: readonly IndexUniversity[] }>;

export function cityPageModel(index: StudentUniversityIndex, code: string, cityKey: string, strings: UniversityStrings, lang: Lang): CityPageModel | null {
  const city = index.cities.find((entry) => entry.key === cityKey && entry.country === code);
  // Город без фото, как в вебе, страницы не имеет.
  if (!city || geographyPhotoUrls(city.photo, "https://x.invalid") === null) return null;
  return {
    city,
    name: localizedText(city.name, lang),
    counts: placeCounts(strings, city.universityCount, null, lang),
    summary: localizedText(city.summary, lang),
    fact: lang === "ky" ? city.fact.ky : city.fact.ru,
    universities: cityUniversities(index, city.key),
  };
}

/** Поиск по названию, городу или стране по всем странам (порядок индекса). */
export function searchIndex(index: StudentUniversityIndex, query: string): readonly IndexUniversity[] {
  return searchIndexUniversities(index, query);
}

/** Поиск внутри страны: города с карточкой и вузы страны по названию или городу. */
export function searchCountry(
  index: StudentUniversityIndex,
  page: CountryPageModel,
  query: string,
): Readonly<{ cities: readonly CityCard[]; universities: readonly IndexUniversity[] }> {
  return {
    cities: page.cityCards.filter((card) => matchesSearch(`${card.name} ${card.search}`, query)),
    universities: searchIndexUniversities(index, query, page.country.code),
  };
}
