// Адреса фото каталога. Чистые функции: адрес проекта приходит аргументом.
// Правила веба (src/lib/university-photo-url.ts, src/lib/portal/university-tiles.ts):
//  - фото вуза студенту показывается только из нашего бакета `portal-university-photos`
//    по манифесту (verified + migrated); нет копии - честная заглушка, а не hotlink;
//  - фото страны и города лежат под `geography/` с 12 знаками sha256 в имени.
// Размерные копии - Supabase Image Transformations (`render/image`), как в iPhone
// (ios-app-inventory §2.4): ширина из набора шагов, качество 70.
import { UNIVERSITY_PHOTOS } from "@web/lib/platform-university-catalog";
import { isOfficialMediaLicense } from "@web/lib/university-photo-rights";
import type { GeographyPhoto } from "@web/lib/portal/university-index";

import manifest from "./photo-manifest.generated.json";

export const PHOTO_BUCKET = "portal-university-photos";
/** Шаги ширины копий (iPhone: 320...2048). */
export const PHOTO_WIDTH_STEPS = [320, 480, 640, 800, 1080, 1280, 1600, 2048] as const;

const MANIFEST: Readonly<Record<string, string>> = manifest.entries;
const GEOGRAPHY_PATH = /^geography\/(?:countries|cities)\/[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{12}\.(?:jpg|png|webp|avif)$/u;

function origin(supabaseUrl: string): string {
  return supabaseUrl.replace(/\/+$/u, "");
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Ближайший шаг не меньше нужной ширины (физические пиксели). */
export function photoWidthStep(pixels: number): number {
  return PHOTO_WIDTH_STEPS.find((step) => step >= pixels) ?? PHOTO_WIDTH_STEPS[PHOTO_WIDTH_STEPS.length - 1];
}

export type PhotoUrls = Readonly<{ sized: string | null; original: string }>;

function urls(supabaseUrl: string, objectPath: string, width: number | null): PhotoUrls {
  const base = origin(supabaseUrl);
  const object = encodePath(objectPath);
  return {
    original: `${base}/storage/v1/object/public/${PHOTO_BUCKET}/${object}`,
    sized: width === null ? null : `${base}/storage/v1/render/image/public/${PHOTO_BUCKET}/${object}?width=${photoWidthStep(width)}&height=2500&resize=contain&quality=70`,
  };
}

/** Фото вуза: только копия из бакета, иначе null (заглушка). */
export function universityPhotoUrls(photoKey: string | null, supabaseUrl: string, width: number | null = null): PhotoUrls | null {
  if (photoKey === null || !Object.hasOwn(UNIVERSITY_PHOTOS, photoKey) || !Object.hasOwn(MANIFEST, photoKey)) return null;
  return urls(supabaseUrl, MANIFEST[photoKey], width);
}

/** Фото страны или города по пути из индекса; неверный путь - null. */
export function geographyPhotoUrls(photo: Pick<GeographyPhoto, "path"> | null, supabaseUrl: string, width: number | null = null): PhotoUrls | null {
  if (photo === null || !GEOGRAPHY_PATH.test(photo.path)) return null;
  return urls(supabaseUrl, photo.path, width);
}

/**
 * Подпись фото (веб: `PhotoCredit` в PhotoRights.tsx). У фото вуза с открытой лицензией автор ведёт на страницу источника
 * (`authorUrl` = `sourceUrl`, отдельного источника нет), у фото мест автор ведёт на свою страницу (если она есть), а источник
 * всегда на страницу файла (review S3 веба, F13; CC BY-SA 4.0, раздел 3(a)(1)(A)(v)). `authorUrl` необязателен: подпись,
 * собранная прежним кодом без него, остаётся годной.
 */
export type PhotoCreditView =
  | Readonly<{ kind: "official"; sourceUrl: string }>
  | Readonly<{ kind: "author"; author: string; authorUrl?: string | null; license: string; licenseUrl: string | null; sourceUrl: string; sourceName: string | null }>;

/** Подпись фото вуза: у официальных медиа - ссылка на источник, у прочих автор и лицензия. */
export function universityPhotoCredit(photoKey: string | null): PhotoCreditView | null {
  if (photoKey === null || !Object.hasOwn(UNIVERSITY_PHOTOS, photoKey)) return null;
  const entry = UNIVERSITY_PHOTOS[photoKey as keyof typeof UNIVERSITY_PHOTOS];
  if (isOfficialMediaLicense(entry.license)) return { kind: "official", sourceUrl: entry.sourceUrl };
  return { kind: "author", author: entry.author, authorUrl: entry.sourceUrl, license: entry.license, licenseUrl: entry.licenseUrl, sourceUrl: entry.sourceUrl, sourceName: null };
}

/** Описание фото вуза из библиотеки (веб: `alt={photo.caption}`); нет ключа - null. */
export function universityPhotoCaption(photoKey: string | null): string | null {
  if (photoKey === null || !Object.hasOwn(UNIVERSITY_PHOTOS, photoKey)) return null;
  return UNIVERSITY_PHOTOS[photoKey as keyof typeof UNIVERSITY_PHOTOS].caption;
}

export function geographyPhotoCredit(photo: GeographyPhoto): PhotoCreditView {
  return { kind: "author", author: photo.author, authorUrl: photo.authorUrl, license: photo.license, licenseUrl: photo.licenseUrl, sourceUrl: photo.sourceUrl, sourceName: photo.sourceName };
}
