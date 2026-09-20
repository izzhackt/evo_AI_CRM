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
import manifest from "../../scripts/portal/university-photos-manifest.json" with { type: "json" };
import { UNIVERSITY_PHOTOS } from "./platform-university-catalog.ts";

export const UNIVERSITY_PHOTO_PUBLIC_BASE_URL =
  "https://iosckaqtovbbnssqcpde.supabase.co/storage/v1/object/public/portal-university-photos";

export type UniversityPhotoManifestEntry = Readonly<{
  status: string;
  migrated: boolean;
  objectPath: string | null;
}>;

const MANIFEST_ENTRIES: Readonly<Record<string, UniversityPhotoManifestEntry>> = manifest.entries;
const LIBRARY: Readonly<Record<string, Readonly<{ path: string }>>> = UNIVERSITY_PHOTOS;

/** Чистая резолюция для тестов: photos/entries/baseUrl подставляются извне. */
export function resolveUniversityPhotoUrl(
  photoKey: string | null,
  photos: Readonly<Record<string, Readonly<{ path: string }>>>,
  entries: Readonly<Record<string, UniversityPhotoManifestEntry>>,
  baseUrl: string,
): string | null {
  if (photoKey === null || !Object.hasOwn(photos, photoKey)) return null;
  const hotlink = photos[photoKey].path;
  const entry = Object.hasOwn(entries, photoKey) ? entries[photoKey] : null;
  // Require the flat, key-bound manifest filename; the final lookahead also rejects trailing newlines.
  if (!entry || entry.status !== "verified" || entry.migrated !== true
    || typeof entry.objectPath !== "string"
    || !/^[a-z0-9][a-z0-9-]*\.(?:avif|gif|jpg|png|webp)(?![\s\S])/u.test(entry.objectPath)
    || !entry.objectPath.startsWith(`${photoKey}.`)) {
    return hotlink;
  }
  return `${baseUrl}/${entry.objectPath.split("/").map(encodeURIComponent).join("/")}`;
}

/** Боевая обвязка: библиотека репозитория + закоммиченный манифест. */
export function universityPhotoUrl(photoKey: string | null): string | null {
  return resolveUniversityPhotoUrl(photoKey, LIBRARY, MANIFEST_ENTRIES, UNIVERSITY_PHOTO_PUBLIC_BASE_URL);
}
