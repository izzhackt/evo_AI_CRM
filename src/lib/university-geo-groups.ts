/**
 * Университеты по странам, городам и на карте (CRM, 08.11.2026): чистые
 * правила без чтений и без React. Группировка вузов по городам и порядок,
 * точки карты и разбор адресов новых страниц `/universities/country/…`.
 *
 * Модуль нейтральный и клиент-безопасный (без server-only и Supabase): его
 * зовут серверные страницы CRM и тесты; кабинет студента может взять те же
 * помощники для вида «Списком». Координаты кампусов берутся только из
 * проверенной гео-библиотеки (`universityGeo`); вуз без записи точки не
 * получает, фиктивных точек нет.
 */
import { universityGeo } from "./portal/university-geo.ts";
import type { UniversityMapPin } from "./portal/universities.ts";

/** Подпись группы вузов без города. */
export const NO_CITY_LABEL = "Город не указан";
/** Часть адреса «город» для группы без города. */
export const NO_CITY_PARAM = "~";
export const GEO_BASE = "/universities/country";

export type CityRef = Readonly<{ key: string; label: string }>;
export type CityGroup<T> = Readonly<{
  /** `null` — группа «Город не указан». */
  key: string | null;
  label: string;
  items: readonly T[];
}>;

/** Подпись города без лишних пробелов; пусто — города нет. */
export function normalizeCityLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const label = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  return label === "" ? null : label;
}

/**
 * Ключ группы по подписи города (когда ключа города из справочника нет):
 * «~» и подпись в нижнем регистре, чтобы «Пекин» и «пекин » были одной
 * группой и не пересекались с ключами справочника (там только a-z, 0-9, «-»).
 */
export function labelCityKey(label: string): string {
  return `~${label.toLocaleLowerCase("ru")}`;
}

function collator(locale: string): Intl.Collator {
  return new Intl.Collator(locale, { sensitivity: "base", numeric: true });
}

/** Сравнение названий по локали: регистр не важен, «ё» рядом с «е», числа по значению. */
export function compareByLocale(a: string, b: string, locale = "ru"): number {
  const result = collator(locale).compare(a, b);
  return result !== 0 ? result : (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Вузы по городам: города А→Я, вузы внутри города А→Я (по локали), группа
 * «Город не указан» всегда последняя. Вуз попадает ровно в одну группу;
 * порядок равных названий — как на входе.
 */
export function groupByCity<T>(
  items: readonly T[],
  cityOf: (item: T) => CityRef | null,
  nameOf: (item: T) => string,
  locale = "ru",
): CityGroup<T>[] {
  const byKey = new Map<string, { label: string; items: T[] }>();
  const unplaced: T[] = [];
  for (const item of items) {
    const city = cityOf(item);
    if (city === null) {
      unplaced.push(item);
      continue;
    }
    const group = byKey.get(city.key);
    if (group === undefined) byKey.set(city.key, { label: city.label, items: [item] });
    else {
      group.items.push(item);
      // Подпись группы не зависит от порядка входа: меньшая по коду.
      if (city.label < group.label) group.label = city.label;
    }
  }
  const byName = (a: T, b: T) => compareByLocale(nameOf(a), nameOf(b), locale);
  const groups: CityGroup<T>[] = [...byKey.entries()]
    .map(([key, group]) => ({ key, label: group.label, items: [...group.items].sort(byName) }))
    .sort((a, b) => compareByLocale(a.label, b.label, locale) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (unplaced.length > 0) groups.push({ key: null, label: NO_CITY_LABEL, items: [...unplaced].sort(byName) });
  return groups;
}

/** Часть справочника городов, нужная для вузов страны (только менеджеру каталога). */
export type CityDirectory = Readonly<{
  cities: readonly Readonly<{ key: string; nameRu: string; nameEn: string }>[];
  institutions: readonly Readonly<{ id: string; cityKey: string | null }>[];
}>;

type CityCard = Readonly<{ id: string; content: Readonly<{ name: string; city: string | null }> }>;

/**
 * Город вуза. Со справочником (менеджер): ключ города вуза, а подпись без
 * ключа, совпавшая по названию (ru или en, без регистра) с городом
 * справочника, сливается с ним. Без справочника, как у остальных
 * сотрудников: подпись `content.city`. Нет ни того, ни другого — города нет.
 */
export function universityCityRef(item: CityCard, directory: CityDirectory | null): CityRef | null {
  const label = normalizeCityLabel(item.content.city);
  if (directory !== null) {
    const cityKey = directory.institutions.find((entry) => entry.id === item.id)?.cityKey ?? null;
    const byKey = cityKey === null ? undefined : directory.cities.find((city) => city.key === cityKey);
    if (byKey !== undefined) return { key: byKey.key, label: byKey.nameRu };
    if (label !== null) {
      const lower = label.toLocaleLowerCase("ru");
      const byName = directory.cities.find((city) => city.nameRu.toLocaleLowerCase("ru") === lower || city.nameEn.toLocaleLowerCase("ru") === lower);
      if (byName !== undefined) return { key: byName.key, label: byName.nameRu };
    }
  }
  return label === null ? null : { key: labelCityKey(label), label };
}

/** Вузы страны по городам (см. `groupByCity`). */
export function groupCountryUniversities<T extends CityCard>(items: readonly T[], directory: CityDirectory | null, locale = "ru"): CityGroup<T>[] {
  return groupByCity(items, (item) => universityCityRef(item, directory), (item) => item.content.name, locale);
}

export type CampusPinSource = Readonly<{ id: string; name: string; photoKey: string | null }>;

/**
 * Точки карты: только вузы с проверенной координатой гео-библиотеки;
 * `missing` — сколько вузов страны на карту не попало.
 */
export function buildCampusPins<T extends CampusPinSource>(
  items: readonly T[],
  placeOf: (item: T) => string,
): Readonly<{ pins: UniversityMapPin[]; missing: number }> {
  const pins: UniversityMapPin[] = [];
  let missing = 0;
  for (const item of items) {
    const geo = universityGeo(item.photoKey);
    if (geo === null) {
      missing += 1;
      continue;
    }
    pins.push({ id: item.id, name: item.name, place: placeOf(item), lat: geo.lat, lng: geo.lng });
  }
  return { pins, missing };
}

/* ------------------------------------------------------------------ адреса */

export const COUNTRY_VIEWS = ["cities", "list", "map"] as const;
export type CountryView = (typeof COUNTRY_VIEWS)[number];

/** Код страны в адресе: две заглавные латинские буквы, как в фильтре каталога. */
export function parseGeoCountryCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z]{2}$/u.test(value) ? value : null;
}

/**
 * `?view=` страницы страны. Без параметров — «Города». Любой другой параметр,
 * повтор или неизвестный вид — `null` (страница отвечает 404).
 */
export function parseCountryView(query: Record<string, string | string[] | undefined>): CountryView | null {
  const keys = Object.keys(query).filter((key) => query[key] !== undefined);
  if (keys.some((key) => key !== "view")) return null;
  const view = query.view;
  if (view === undefined) return "cities";
  return typeof view === "string" && (COUNTRY_VIEWS as readonly string[]).includes(view) ? view as CountryView : null;
}

/** Страница без параметров запроса (город): любой параметр — `false`. */
export function hasNoQuery(query: Record<string, string | string[] | undefined>): boolean {
  return Object.keys(query).every((key) => query[key] === undefined);
}

/**
 * Город в адресе: ключ справочника (a-z, 0-9, «-»), «~подпись» для города
 * без ключа или «~» для вузов без города. Возвращает разобранный вид либо
 * `undefined` для неверного адреса.
 */
export function parseGeoCityParam(value: unknown): { kind: "key" | "label"; key: string } | { kind: "none"; key: null } | undefined {
  if (typeof value !== "string") return undefined;
  if (value === NO_CITY_PARAM) return { kind: "none", key: null };
  if (value.length >= 2 && value.length <= 64 && /^[a-z0-9]+(-[a-z0-9]+)*$/u.test(value)) return { kind: "key", key: value };
  if (value.startsWith("~") && value.length >= 2 && value.length <= 120 && value === value.normalize("NFC")
    && !/[\p{Cc}\p{Cf}]/u.test(value) && value === value.trim() && !/\s{2}/u.test(value)) return { kind: "label", key: value };
  return undefined;
}

export function countryHref(code: string, view: CountryView = "cities"): string {
  return view === "cities" ? `${GEO_BASE}/${code}` : `${GEO_BASE}/${code}?view=${view}`;
}

/** Адрес города страны; `null` — вузы без города. */
export function cityHref(code: string, key: string | null): string {
  return `${GEO_BASE}/${code}/${encodeURIComponent(key ?? NO_CITY_PARAM)}`;
}
