import "server-only";

import type { PhotoCredit } from "@/components/portal/universities/PhotoRights";
import type { TilePhoto, UniversityTileModel, UniversityTileStrings } from "@/components/portal/universities/UniversityTile";
import type { Locale } from "../i18n-data.ts";
import { UNIVERSITY_PHOTOS, type PublishedUniversity, type UniversityPhotoKey } from "../platform-university-catalog.ts";
import { geographyPhotoSources, managedUniversityPhotoUrl, universityPhotoSrcSet } from "../university-photo-url.ts";
import { isOfficialMediaLicense } from "../university-photo-rights.ts";
import { formatPortalString, type PortalStrings } from "./i18n.ts";
import {
  localizedText,
  nearestIndexIntake,
  universityHref,
  type GeographyPhoto,
  type IndexUniversity,
  type NearestIndexIntake,
  type StudentUniversityIndex,
} from "./university-index.ts";
import {
  nearestUniversityIntake,
  universityCountryLabel,
  universityDateLabel,
  universityLevelKey,
  universityLevels,
  universityMonthLabel,
} from "./universities.ts";

/**
 * Модели карточек вузов и фото мест для экранов S3. Серверный слой: адреса
 * фото (managed-копии и Image Transformations) знает только сервер, карточка
 * получает готовые строки. Фото вуза студенту показывается только из нашего
 * бакета: без managed-копии будет заглушка, а не hotlink с сайта вуза (план
 * 4.4, приёмка 7.6.5).
 */

type Strings = PortalStrings<"universities">;

/** Ширины уменьшенных копий фото вуза в карточке (как в S1: 480w и 640w). */
const TILE_WIDTHS = [480, 640] as const;

/**
 * Подпись по кнопке «©»: у официальных медиа вуза «Фото: <вуз>, официальный
 * сайт» со ссылкой на страницу источника, у остальных автор и лицензия.
 */
export function universityPhotoCredit(photoKey: UniversityPhotoKey | null): PhotoCredit | null {
  const entry = photoKey ? UNIVERSITY_PHOTOS[photoKey] : null;
  if (!entry) return null;
  return isOfficialMediaLicense(entry.license)
    ? { kind: "official", sourceUrl: entry.sourceUrl }
    : { kind: "author", author: entry.author, authorUrl: entry.sourceUrl, license: entry.license, licenseUrl: entry.licenseUrl, source: null };
}

export function universityTilePhoto(photoKey: UniversityPhotoKey | null): TilePhoto | null {
  const entry = photoKey ? UNIVERSITY_PHOTOS[photoKey] : null;
  const src = managedUniversityPhotoUrl(photoKey);
  const credit = universityPhotoCredit(photoKey);
  if (!entry || src === null || credit === null) return null;
  return { src, srcSet: universityPhotoSrcSet(photoKey, TILE_WIDTHS), alt: entry.caption, credit };
}

export function intakeText(nearest: NearestIndexIntake | null, strings: Strings, locale: Locale): string {
  if (nearest === null) return strings.intakeDatesPending;
  if (nearest.kind === "deadline") {
    return formatPortalString(strings.intakeDeadlineByDate, { date: universityDateLabel(nearest.value, locale) });
  }
  return formatPortalString(strings.intakeStartFromDate, {
    date: nearest.kind === "start" ? universityDateLabel(nearest.value, locale) : universityMonthLabel(nearest.value, locale),
  });
}

/** Подпись места вуза: город из карточки города, иначе строка карточки вуза. */
export function universityPlace(index: StudentUniversityIndex, item: IndexUniversity, locale: Locale): string {
  const country = universityCountryLabel(item.country, locale);
  const city = item.cityKey ? index.cities.find((entry) => entry.key === item.cityKey) : undefined;
  const cityName = city ? localizedText(city.name, locale) : item.cityLabel;
  return cityName ? `${cityName} · ${country}` : country;
}

export function indexTileModel(
  index: StudentUniversityIndex,
  item: IndexUniversity,
  options: Readonly<{ strings: Strings; locale: Locale; now: Date; favoriteIds: readonly string[] | null; showPlace: boolean }>,
): UniversityTileModel {
  return {
    id: item.id,
    name: item.name,
    href: universityHref(item.id),
    place: options.showPlace ? universityPlace(index, item, options.locale) : null,
    levels: item.levels.map((level) => options.strings[universityLevelKey(level)]),
    intakeText: intakeText(nearestIndexIntake(item.intakes, options.now), options.strings, options.locale),
    photo: universityTilePhoto(item.photoKey),
    favored: options.favoriteIds === null ? null : options.favoriteIds.includes(item.id),
  };
}

/** Карточка «Избранного» по полной опубликованной карточке вуза. */
export function publishedTileModel(
  item: PublishedUniversity,
  options: Readonly<{ strings: Strings; locale: Locale; now: Date; favored: boolean | null }>,
): UniversityTileModel {
  const content = item.content;
  const country = universityCountryLabel(content.country, options.locale);
  return {
    id: item.id,
    name: content.name,
    href: universityHref(item.id),
    place: content.city ? `${content.city} · ${country}` : country,
    levels: universityLevels(content).map((level) => options.strings[universityLevelKey(level)]),
    intakeText: intakeText(nearestUniversityIntake(content, options.now), options.strings, options.locale),
    photo: universityTilePhoto(content.photoKey),
    favored: options.favored,
  };
}

export function tileStrings(strings: Strings): UniversityTileStrings {
  return {
    favoriteAdd: strings.favoriteAdd,
    favoriteRemove: strings.favoriteRemove,
    favoriteError: strings.favoriteError,
    levelLabel: strings.levelLabel,
    nearestIntake: strings.nearestIntake,
    openCard: strings.openCard,
    photoMissing: strings.photoMissing,
    photoFailed: strings.photoFailed,
    photoRights: strings.photoRights,
    photoCredit: strings.photoCredit,
    photoCreditSource: strings.photoCreditSource,
    photoCreditOfficial: strings.photoCreditOfficial,
    newTab: strings.newTab,
  };
}

export type PlacePhoto = Readonly<{
  src: string;
  srcSet: string | null;
  width: number;
  height: number;
  /** Автор, источник и лицензия по кнопке «©» (у мест всегда есть). */
  credit: PhotoCredit;
}>;

/** Ширины копий фото мест: карточка (до ~400 px) и шапка (до ширины колонки). */
export const PLACE_CARD_WIDTHS = [480, 800, 1200] as const;
export const PLACE_HERO_WIDTHS = [800, 1200, 1600, 2000] as const;

export function placePhoto(photo: GeographyPhoto | null, widths: readonly number[]): PlacePhoto | null {
  if (photo === null) return null;
  const sources = geographyPhotoSources(photo.path, widths.filter((width) => width < photo.width));
  if (sources === null) return null;
  // Оригинал: последний вариант набора: экрану шире копий нужен он сам.
  const srcSet = sources.srcSet === null ? null : `${sources.srcSet}, ${sources.src} ${photo.width}w`;
  return {
    src: sources.src,
    srcSet,
    width: photo.width,
    height: photo.height,
    // Автор ведёт на свою страницу (если она есть), источник всегда на
    // страницу файла (review S3 веба, F13).
    credit: {
      kind: "author",
      author: photo.author,
      authorUrl: photo.authorUrl,
      license: photo.license,
      licenseUrl: photo.licenseUrl,
      source: { name: photo.sourceName, url: photo.sourceUrl },
    },
  };
}
