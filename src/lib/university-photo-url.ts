/**
 * PORT-9d: единая резолюция URL фото вуза (docs/PLAN_CHANGES.md).
 *
 * Managed-URL (public-read bucket portal-university-photos prod-проекта)
 * возвращается только когда запись манифеста
 * scripts/portal/university-photos-manifest.json существует, verified и
 * помечена migrated=true координатором после реального --apply; во всех
 * остальных случаях — прежний hotlink из библиотеки, неизвестный ключ — null.
 * Атрибуция (caption/author/license) остаётся на записи библиотеки и этим
 * модулем не затрагивается.
 */
import "server-only";

import manifest from "../../scripts/portal/university-photos-manifest.json" with { type: "json" };
import { UNIVERSITY_PHOTOS } from "./platform-university-catalog.ts";
import { getSupabasePublicConfig } from "./supabase/config.ts";

export const UNIVERSITY_PHOTO_PUBLIC_BASE_URL =
  "https://iosckaqtovbbnssqcpde.supabase.co/storage/v1/object/public/portal-university-photos";
/**
 * Уменьшенные копии того же объекта (Supabase Image Transformations,
 * https://supabase.com/docs/guides/storage/serving/image-transformations).
 * `resize=contain` с большой высотой сохраняет пропорции: ширина ровно
 * заданная. Только для managed-фото: hotlink сайтов вузов не уменьшаются.
 */
export const UNIVERSITY_PHOTO_RENDER_BASE_URL =
  "https://iosckaqtovbbnssqcpde.supabase.co/storage/v1/render/image/public/portal-university-photos";

export type UniversityPhotoManifestEntry = Readonly<{
  status: string;
  migrated: boolean;
  objectPath: string | null;
}>;

const MANIFEST_ENTRIES: Readonly<Record<string, UniversityPhotoManifestEntry>> = manifest.entries;
const LIBRARY: Readonly<Record<string, Readonly<{ path: string }>>> = UNIVERSITY_PHOTOS;

function managedObjectPath(
  photoKey: string,
  entries: Readonly<Record<string, UniversityPhotoManifestEntry>>,
): string | null {
  const entry = Object.hasOwn(entries, photoKey) ? entries[photoKey] : null;
  // Require the flat, key-bound manifest filename; the final lookahead also rejects trailing newlines.
  if (!entry || entry.status !== "verified" || entry.migrated !== true
    || typeof entry.objectPath !== "string"
    || !/^[a-z0-9][a-z0-9-]*\.(?:avif|gif|jpg|png|webp)(?![\s\S])/u.test(entry.objectPath)
    || !entry.objectPath.startsWith(`${photoKey}.`)) {
    return null;
  }
  return entry.objectPath.split("/").map(encodeURIComponent).join("/");
}

/** Чистая резолюция для тестов: photos/entries/baseUrl подставляются извне. */
export function resolveUniversityPhotoUrl(
  photoKey: string | null,
  photos: Readonly<Record<string, Readonly<{ path: string }>>>,
  entries: Readonly<Record<string, UniversityPhotoManifestEntry>>,
  baseUrl: string,
): string | null {
  if (photoKey === null || !Object.hasOwn(photos, photoKey)) return null;
  const objectPath = managedObjectPath(photoKey, entries);
  return objectPath === null ? photos[photoKey].path : `${baseUrl}/${objectPath}`;
}

/**
 * Только managed-копия из нашего бакета, без запасного hotlink: так фото
 * показывает студенческий интерфейс (план 4.4, приёмка 7.6.5). Нет копии:
 * null, экран рисует честную заглушку «фото не добавлено».
 */
export function resolveManagedUniversityPhotoUrl(
  photoKey: string | null,
  photos: Readonly<Record<string, Readonly<{ path: string }>>>,
  entries: Readonly<Record<string, UniversityPhotoManifestEntry>>,
  baseUrl: string,
): string | null {
  if (photoKey === null || !Object.hasOwn(photos, photoKey)) return null;
  const objectPath = managedObjectPath(photoKey, entries);
  return objectPath === null ? null : `${baseUrl}/${objectPath}`;
}

/**
 * `srcset` уменьшенных копий managed-фото (план A, 16.10.2026): карточка
 * высотой 176 px больше не качает исходник 1280–4320 px. Hotlink и
 * неизвестный ключ — null (остаётся один `src`).
 */
export function resolveUniversityPhotoSrcSet(
  photoKey: string | null,
  photos: Readonly<Record<string, Readonly<{ path: string }>>>,
  entries: Readonly<Record<string, UniversityPhotoManifestEntry>>,
  renderBaseUrl: string,
  widths: readonly number[],
): string | null {
  if (photoKey === null || !Object.hasOwn(photos, photoKey) || widths.length === 0) return null;
  const objectPath = managedObjectPath(photoKey, entries);
  if (objectPath === null) return null;
  return widths
    .map((width) => `${renderBaseUrl}/${objectPath}?width=${width}&height=2500&resize=contain&quality=70 ${width}w`)
    .join(", ");
}

/** Боевая обвязка: библиотека репозитория + закоммиченный манифест. */
export function universityPhotoUrl(photoKey: string | null): string | null {
  return resolveUniversityPhotoUrl(photoKey, LIBRARY, MANIFEST_ENTRIES, UNIVERSITY_PHOTO_PUBLIC_BASE_URL);
}

/** Боевая обвязка для студента: только managed-копия, иначе null. */
export function managedUniversityPhotoUrl(photoKey: string | null): string | null {
  return resolveManagedUniversityPhotoUrl(photoKey, LIBRARY, MANIFEST_ENTRIES, UNIVERSITY_PHOTO_PUBLIC_BASE_URL);
}

/** Боевая обвязка `srcset`: те же библиотека и манифест. */
export function universityPhotoSrcSet(photoKey: string | null, widths: readonly number[]): string | null {
  return resolveUniversityPhotoSrcSet(photoKey, LIBRARY, MANIFEST_ENTRIES, UNIVERSITY_PHOTO_RENDER_BASE_URL, widths);
}

/** Бакет фото вузов, стран и городов (283 кладёт фото стран и городов под `geography/`). */
export const UNIVERSITY_PHOTO_BUCKET_NAME = "portal-university-photos";

export type PhotoSources = Readonly<{ src: string; srcSet: string | null }>;

const GEOGRAPHY_PATH = /^geography\/(?:countries|cities)\/[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{12}\.(?:jpg|png|webp|avif)$/u;

/**
 * Фото страны или города (миграция 283, контракт 2.5): оригинал и уменьшенные
 * копии того же объекта через Image Transformations, как у фото вузов.
 * Адрес проекта — из окружения (production или локальный стенд), путь —
 * только `geography/...` с 12 знаками sha256; иной путь даёт null.
 */
export function resolveGeographyPhotoSources(
  path: string,
  supabaseUrl: string,
  widths: readonly number[],
): PhotoSources | null {
  if (!GEOGRAPHY_PATH.test(path)) return null;
  const origin = supabaseUrl.replace(/\/+$/u, "");
  const object = path.split("/").map(encodeURIComponent).join("/");
  const src = `${origin}/storage/v1/object/public/${UNIVERSITY_PHOTO_BUCKET_NAME}/${object}`;
  const render = `${origin}/storage/v1/render/image/public/${UNIVERSITY_PHOTO_BUCKET_NAME}/${object}`;
  const srcSet = widths.length === 0
    ? null
    : widths.map((width) => `${render}?width=${width}&height=2500&resize=contain&quality=70 ${width}w`).join(", ");
  return { src, srcSet };
}

/** Боевая обвязка: адрес проекта из NEXT_PUBLIC_SUPABASE_URL. */
export function geographyPhotoSources(path: string, widths: readonly number[]): PhotoSources | null {
  return resolveGeographyPhotoSources(path, getSupabasePublicConfig().url, widths);
}
