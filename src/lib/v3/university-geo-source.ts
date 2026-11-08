import "server-only";

import type { ActivePlatformActor } from "../platform-auth";
import type { StaffGeography } from "../catalog-geography.ts";
import type { PublishedUniversity } from "../platform-university-catalog";
import { groupCountryUniversities, type CityDirectory, type CityGroup } from "../university-geo-groups.ts";
import { canManageCatalogGeography, readStaffCatalogGeography } from "./catalog-geography-source";
import { EMPTY_UNIVERSITY_FILTERS, readStaffUniversityCatalogue } from "./university-source";

export type StaffCountryGeo = Readonly<{
  items: readonly PublishedUniversity[];
  groups: readonly CityGroup<PublishedUniversity>[];
  /** Справочник городов с фото и текстом: только у менеджера каталога и только если прочитался. */
  geography: StaffGeography | null;
}>;

/**
 * Вузы одной страны по городам для страниц «Университеты → страны» (право
 * `catalog.read`, те же чтения, что у таблицы). Нужен полный каталог страны:
 * разбитая по страницам выдача (`kind: "server"`) сюда не годится, и страница
 * честно говорит «не удалось загрузить», а не показывает часть.
 *
 * Менеджеру каталога дополнительно читается справочник городов (RPC 283
 * требует `catalog.import.manage`): ключи городов и карточки с фото. Сбой
 * справочника не роняет страницу: города берутся из подписей карточек.
 */
export async function readStaffCountryGeo(actor: ActivePlatformActor, country: string): Promise<StaffCountryGeo> {
  const [catalogue, geography] = await Promise.all([
    readStaffUniversityCatalogue(actor, { ...EMPTY_UNIVERSITY_FILTERS, country }),
    canManageCatalogGeography(actor) ? readStaffCatalogGeography(actor).catch((): null => null) : null,
  ]);
  if (catalogue.kind !== "complete") throw new Error("Catalogue unavailable");
  const directory: CityDirectory | null = geography === null ? null : {
    cities: geography.cities.filter((city) => city.country === country),
    institutions: geography.institutions,
  };
  return { items: catalogue.items, groups: groupCountryUniversities(catalogue.items, directory), geography };
}

/** Весь каталог для списка стран: число вузов по странам; `null` — каталог не читается целиком. */
export async function readStaffCountryTotals(actor: ActivePlatformActor): Promise<ReadonlyMap<string, number> | null> {
  const catalogue = await readStaffUniversityCatalogue(actor, EMPTY_UNIVERSITY_FILTERS);
  if (catalogue.kind !== "complete") return null;
  const totals = new Map<string, number>();
  for (const item of catalogue.items) totals.set(item.content.country, (totals.get(item.content.country) ?? 0) + 1);
  return totals;
}
