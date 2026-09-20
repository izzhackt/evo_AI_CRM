/**
 * Гео-библиотека каталога (PORT-3a): проверенные координаты кампусов по
 * ключу `photoKey` — тот же паттерн repo-библиотеки, что
 * `src/lib/university-photo-library.json`. Каждая запись несёт собственный
 * провенанс (`sourceUrl` — сущность Wikidata, `verifiedOn` — дата сверки).
 *
 * Вуз без записи здесь не получает точку на карте — план прямо запрещает
 * фиктивные пины (план §6, «Карта»). Схема контента каталога не меняется:
 * связка идёт по `content.photoKey` опубликованной записи.
 */
import geoLibrary from "../university-geo-library.json" with { type: "json" };

export type UniversityGeoEntry = Readonly<{
  lat: number;
  lng: number;
  sourceUrl: string;
  verifiedOn: string;
}>;

export const UNIVERSITY_GEO: Readonly<Record<string, UniversityGeoEntry>> = geoLibrary;

export function universityGeo(photoKey: string | null): UniversityGeoEntry | null {
  return photoKey !== null && Object.hasOwn(UNIVERSITY_GEO, photoKey)
    ? UNIVERSITY_GEO[photoKey]
    : null;
}
