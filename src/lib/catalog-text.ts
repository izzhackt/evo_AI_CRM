/**
 * Тексты и ссылки каталога «Университеты v2» (миграция 283): одно правило
 * для базы, веба, iPhone и скриптов сида и импорта (review S3 веба, F2 и F12).
 *
 * База: `platform_private.catalog_text_ok` и `platform_private.catalog_url_ok`
 * в `supabase/migrations/283_platform_catalog_geography_costs.sql`. Классы
 * знаков там записаны явно, теми же строками, что ниже: `[[:cntrl:]]` и
 * `[[:space:]]` зависят от локали базы (ICU, glibc), а `String.trim` и `\s`
 * от Unicode, поэтому на них правило не держится. Общие векторы лежат в
 * `tests/fixtures/catalog-text-vectors.json`: их проверяют и SQL-набор 283,
 * и `tests/catalog-text.test.mjs`; тест же сверяет строки классов с миграцией.
 *
 * Текст: от 1 до max знаков Unicode (кодовых точек, как `char_length`), ни
 * одного знака `CATALOG_TEXT_FORBIDDEN_SQL`, ни одного пробельного знака
 * `CATALOG_EDGE_SPACE_SQL` в начале и в конце. Внутри текста обычный и
 * неразрывный пробелы допустимы (типографика RU).
 *
 * Ссылка: правило 148 (`platform_private.university_public_url`: https,
 * публичный хост, без порта, учётных данных, фрагмента и секретов в
 * запросе) и сверх него ни одного запрещённого знака, ни одного пробельного
 * знака и ни одного знака вне BMP (тогда длина в кодовых точках и в UTF-16
 * одна и та же).
 *
 * Модуль без зависимостей: его читают веб, тесты и скрипты Node.
 */

/**
 * Запрещены в тексте и в ссылке везде: управляющие C0 (табуляция и переводы
 * строк тоже), DEL и C1, мягкий перенос, знак арабского письма, монгольский
 * разделитель, знаки нулевой ширины и направления письма, разделители строк
 * и абзацев, невидимые операторы, BOM и знаки аннотаций. Строка класса в
 * синтаксисе регулярных выражений Postgres и JS (U+0000 в тексте Postgres
 * невозможен, поэтому класс начинается с U+0001).
 */
export const CATALOG_TEXT_FORBIDDEN_SQL =
  "\\u0001-\\u001F\\u007F-\\u009F\\u00AD\\u061C\\u180E\\u200B-\\u200F\\u2028-\\u202E\\u2060-\\u2064\\u2066-\\u206F\\uFEFF\\uFFF9-\\uFFFB";

/**
 * Пробельные знаки, которые снимает `String.prototype.trim` и которых нет в
 * запрещённых: в начале и в конце текста недопустимы, в ссылке нигде.
 */
export const CATALOG_EDGE_SPACE_SQL = "\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000";

/** Знаки вне BMP (в ссылке недопустимы). */
export const CATALOG_ASTRAL_SQL = "\\U00010000-\\U0010FFFF";

// В JS ещё U+0000 и одиночные суррогаты: в тексте Postgres их не бывает.
const FORBIDDEN = new RegExp(`[\\u0000${CATALOG_TEXT_FORBIDDEN_SQL}\\uD800-\\uDFFF]`, "u");
const EDGE_SPACE = new RegExp(`^[${CATALOG_EDGE_SPACE_SQL}]|[${CATALOG_EDGE_SPACE_SQL}]$`, "u");
const URL_FORBIDDEN = new RegExp(
  `[\\u0000${CATALOG_TEXT_FORBIDDEN_SQL}${CATALOG_EDGE_SPACE_SQL}\\uD800-\\uDFFF\\u{10000}-\\u{10FFFF}]`,
  "u",
);

/** Текст для студента: то же, что `platform_private.catalog_text_ok(value, max)`. */
export function catalogText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && !FORBIDDEN.test(value) && !EDGE_SPACE.test(value)
    && [...value].length <= max;
}

// Правило 148 буквально (как в базе: регистр через lower, а не флаг i).
const PUBLIC_URL = /^https:\/\/([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}([/?][^#\\]*)?$/u;
const PRIVATE_HOST = /\.(localhost|local|internal|test|invalid|example)([/?]|$)/u;
const PERCENT_KEY = /[?&][^=&]*%[^=&]*(=|&|$)/u;
const SECRET_KEY = /[?&][^=&]*(token|secret|password|auth|api.?key)[^=&]*(=|&|$)/u;

/** Ссылка каталога: то же, что `platform_private.catalog_url_ok(value)`. */
export function catalogUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1000 || URL_FORBIDDEN.test(value) || !PUBLIC_URL.test(value)) return false;
  const lower = value.toLowerCase();
  return !PRIVATE_HOST.test(lower) && !PERCENT_KEY.test(value) && !SECRET_KEY.test(lower);
}

/** Хост ссылки так, как его берёт база: `lower(substring(url FROM '^https://([^/?#]+)'))`. */
export function catalogUrlHost(value: string): string | null {
  return /^https:\/\/([^/?#]+)/u.exec(value)?.[1]?.toLowerCase() ?? null;
}

/** Источник фото стран и городов и хосты его адреса (CHECK 283, контракт 2.5). */
export const CATALOG_PHOTO_SOURCE_HOSTS = Object.freeze({
  Unsplash: Object.freeze(["unsplash.com", "www.unsplash.com"]),
  Pexels: Object.freeze(["pexels.com", "www.pexels.com"]),
  "Wikimedia Commons": Object.freeze(["commons.wikimedia.org", "upload.wikimedia.org"]),
} as const);
export type CatalogPhotoSource = keyof typeof CATALOG_PHOTO_SOURCE_HOSTS;

/** Хост адреса фото принадлежит именно названному источнику. */
export function catalogPhotoSourceMatches(sourceName: unknown, sourceUrl: string): sourceName is CatalogPhotoSource {
  if (typeof sourceName !== "string" || !Object.hasOwn(CATALOG_PHOTO_SOURCE_HOSTS, sourceName)) return false;
  const host = catalogUrlHost(sourceUrl);
  return host !== null && (CATALOG_PHOTO_SOURCE_HOSTS[sourceName as CatalogPhotoSource] as readonly string[]).includes(host);
}

/**
 * Домены образовательных агентств и похожих порталов (их данные стоимости
 * есть в сиде 16.10.2026, их фото не берём). Строка с таким адресом может
 * быть только `agency` (`platform_private.catalog_agency_url`, review CRM R4).
 */
export const CATALOG_AGENCY_DOMAINS: readonly string[] = Object.freeze([
  "eduprchina.com", "easyuni.my", "easyuni.com", "applyforchina.com", "directlyeducation.com",
  "cucas.cn", "cucas.edu.cn", "china-admissions.com", "chinaadmissions.com", "studyinchina.io",
  "studyinchina.net", "universitiesofchina.com", "englishpath.com",
]);

/** Регулярное выражение хоста агентства: та же строка стоит в миграции 283. */
export const CATALOG_AGENCY_HOST_PATTERN = `(^|\\.)(${CATALOG_AGENCY_DOMAINS.map((domain) => domain.replaceAll(".", "\\.")).join("|")})$`;
const AGENCY_HOST = new RegExp(CATALOG_AGENCY_HOST_PATTERN, "u");

/** Адрес на хосте агентства. */
export function catalogAgencyUrl(value: string): boolean {
  const host = catalogUrlHost(value);
  return host !== null && AGENCY_HOST.test(host);
}
