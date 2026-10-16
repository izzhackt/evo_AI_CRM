/**
 * Права на фото вузов (план 4.4, решение владельца Р3 от 16.10.2026).
 *
 * Фото с открытой лицензией (CC, FAL, PD) переносятся в бакет как раньше
 * (`open_license`). Отдельная категория `official_media_owner_accepted`:
 * фото с собственного сайта вуза без открытой лицензии. Это риск владельца,
 * принятый в Р3 (план 13): источник, дата и вуз хранятся в манифесте, по
 * запросу правообладателя фото снимается в течение суток.
 *
 * Категория узкая, прежняя проверка лицензий для остальных источников не
 * ослабляется: точная строка лицензии библиотеки, вуз шести стран каталога
 * студента и страница источника на домене официального сайта этого вуза
 * (`websiteUrl` проверенной карточки). Сайты партнёров, «общего кампуса»,
 * родственных школ и поставщиков в неё не входят.
 *
 * Модуль без зависимостей: его читают и скрипт переноса (Node), и экраны.
 */

export const PHOTO_RIGHTS_OPEN_LICENSE = "open_license";
export const PHOTO_RIGHTS_OFFICIAL_MEDIA = "official_media_owner_accepted";
export type UniversityPhotoRights = typeof PHOTO_RIGHTS_OPEN_LICENSE | typeof PHOTO_RIGHTS_OFFICIAL_MEDIA;

/** Точные строки лицензий библиотеки для собственного сайта вуза. */
export const OFFICIAL_MEDIA_LICENSES: readonly string[] = Object.freeze([
  "Official-source embedding; no reuse license stated",
  "All rights reserved; official-source embedding",
]);

export function isOfficialMediaLicense(license: string): boolean {
  return OFFICIAL_MEDIA_LICENSES.includes(license);
}

/**
 * Домен сайта по имени хоста: два последних уровня, а для зон вида
 * `edu.cn`, `ac.ae`, `edu.my`, `com.tr` три (`www.zju.edu.cn` и
 * `admission.zju.edu.cn` дают `zju.edu.cn`).
 */
export function siteDomain(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/\.$/u, "").split(".");
  const secondLevel = labels.length >= 3 && labels.at(-1)!.length === 2
    && ["ac", "com", "edu", "gov", "net", "org"].includes(labels.at(-2)!);
  return labels.slice(secondLevel ? -3 : -2).join(".");
}

function httpsHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname ? parsed.hostname : null;
  } catch {
    return null;
  }
}

/** Страница источника фото лежит на домене официального сайта вуза. */
export function onOfficialSite(sourceUrl: string, websiteUrl: string): boolean {
  const source = httpsHost(sourceUrl);
  const site = httpsHost(websiteUrl);
  return source !== null && site !== null && siteDomain(source) === siteDomain(site);
}
