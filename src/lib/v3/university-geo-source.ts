import "server-only";

import type { ActivePlatformActor } from "../platform-auth";
import type { BrowseCity } from "../catalog-geography.ts";
import type { PublishedUniversity } from "../platform-university-catalog";
import { groupCountryUniversities, type CityDirectory, type CityGroup } from "../university-geo-groups.ts";
import { readStaffCatalogGeographyBrowse } from "./catalog-geography-source";
import { EMPTY_UNIVERSITY_FILTERS, readStaffUniversityCatalogue } from "./university-source";

export type StaffCountryGeo = Readonly<{
  items: readonly PublishedUniversity[];
  groups: readonly CityGroup<PublishedUniversity>[];
  /** Опубликованные города страны со справочника (фото, текст): у всех сотрудников с `catalog.read`. */
  cities: readonly BrowseCity[];
}>;

/**
 * Вузы одной страны по городам для страниц «Университеты → страны» (право `catalog.read`, те же чтения, что у таблицы).
 * Нужен полный каталог страны: разбитая по страницам выдача (`kind: "server"`) сюда не годится, и страница честно говорит
 * «не удалось загрузить», а не показывает часть. Город вуза берётся по ключу города (миграция 354,
 * `staff_catalog_geography_read_v1`), одинаково у всех сотрудников; вуз без опубликованного города группируется по
 * подписи карточки. Сбой справочника — тоже «не удалось загрузить»: молча сгруппировать по подписям было бы другим результатом.
 */
export async function readStaffCountryGeo(actor: ActivePlatformActor, country: string): Promise<StaffCountryGeo> {
  const [catalogue, geography] = await Promise.all([
    readStaffUniversityCatalogue(actor, { ...EMPTY_UNIVERSITY_FILTERS, country }),
    readStaffCatalogGeographyBrowse(actor),
  ]);
  if (catalogue.kind !== "complete") throw new Error("Catalogue unavailable");
  const cities = geography.cities.filter((city) => city.country === country);
  const directory: CityDirectory = { cities, institutions: geography.institutions };
  return { items: catalogue.items, groups: groupCountryUniversities(catalogue.items, directory), cities };
}

/** Весь каталог для списка стран: число вузов по странам; `null` — каталог не читается целиком. */
export async function readStaffCountryTotals(actor: ActivePlatformActor): Promise<ReadonlyMap<string, number> | null> {
  const catalogue = await readStaffUniversityCatalogue(actor, EMPTY_UNIVERSITY_FILTERS);
  if (catalogue.kind !== "complete") return null;
  const totals = new Map<string, number>();
  for (const item of catalogue.items) totals.set(item.content.country, (totals.get(item.content.country) ?? 0) + 1);
  return totals;
}
