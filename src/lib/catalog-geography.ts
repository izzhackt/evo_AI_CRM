/**
 * Университеты v2 в CRM (план S3.5, контракт docs/catalog/geography-costs-contract.md
 * раздел 3): разбор `staff_catalog_geography_v1`, проверка ввода города,
 * строки стоимости и курса перед RPC, деньги, подписи и слова отказов.
 *
 * Модуль клиент-безопасный (без server-only и Supabase): его читают и формы
 * в браузере, и серверное действие. Тексты и ссылки проверяются тем же
 * правилом, что база (`catalogText`, `catalogUrl` из `catalog-text.ts`,
 * контракт 2.2a); решает всегда RPC, здесь только ранний понятный отказ.
 */
import {
  CATALOG_PHOTO_SOURCE_HOSTS, catalogAgencyUrl, catalogPhotoSourceMatches, catalogText, catalogUrl, catalogUrlHost,
  type CatalogPhotoSource,
} from "./catalog-text.ts";
import { UNIVERSITY_LEVELS, UNIVERSITY_LEVEL_LABELS, type UniversityLevel } from "./platform-university-catalog.ts";
import { STUDY_COUNTRY_CODES, isStudyCountryCode } from "./study-countries.ts";

export const COST_KINDS = ["tuition", "accommodation", "application_fee", "insurance", "other"] as const;
export type CostKind = (typeof COST_KINDS)[number];
export const COST_PERIODS = ["year", "semester", "month", "week", "day", "once", "program"] as const;
export type CostPeriod = (typeof COST_PERIODS)[number];
export const COST_SOURCE_KINDS = ["official", "agency", "evo_document"] as const;
export type CostSourceKind = (typeof COST_SOURCE_KINDS)[number];
export const COST_STATUSES = ["draft", "published", "retired"] as const;
export type CostStatus = (typeof COST_STATUSES)[number];
/** Источники фото стран и городов (CHECK 283, контракт 2.5): те же, что `CATALOG_PHOTO_SOURCE_HOSTS`. */
export const PHOTO_SOURCES = Object.freeze(Object.keys(CATALOG_PHOTO_SOURCE_HOSTS)) as readonly CatalogPhotoSource[];
export type PhotoSource = CatalogPhotoSource;

export const COST_KIND_LABELS: Record<CostKind, string> = {
  tuition: "Обучение",
  accommodation: "Общежитие",
  application_fee: "Сбор за подачу или регистрацию",
  insurance: "Страховка",
  other: "Прочее",
};
export const COST_PERIOD_LABELS: Record<CostPeriod, string> = {
  year: "в год",
  semester: "за семестр",
  month: "в месяц",
  week: "в неделю",
  day: "в день",
  once: "разово",
  program: "за всю программу",
};
export const COST_SOURCE_LABELS: Record<CostSourceKind, string> = {
  official: "Сайт университета",
  agency: "Агентство",
  evo_document: "Материалы EVO",
};
export const COST_STATUS_LABELS: Record<CostStatus, string> = {
  draft: "Черновик",
  published: "Видят студенты",
  retired: "Снята",
};
/** Языки обучения строк стоимости шести стран (ISO 639-1). */
export const TEACHING_LANGUAGES: Readonly<Record<string, string>> = {
  en: "английский", zh: "китайский", ms: "малайский", ar: "арабский", tr: "турецкий", it: "итальянский", cs: "чешский", ru: "русский",
};
/** Валюта вуза по стране; USD и EUR нужны всем (вузы Турции часто в USD). */
export const COUNTRY_CURRENCY: Readonly<Record<string, string>> = { CN: "CNY", MY: "MYR", AE: "AED", TR: "TRY", IT: "EUR", CZ: "CZK" };
export const COST_CURRENCIES = ["CNY", "MYR", "AED", "TRY", "EUR", "CZK", "USD"] as const;
/** Курс старше этого числа дней CRM помечает как устаревший (план 7.5). */
export const FX_STALE_DAYS = 45;

export type GeoPhoto = Readonly<{
  path: string; width: number; height: number; author: string; authorUrl: string | null;
  sourceName: PhotoSource; sourceUrl: string; license: string; licenseUrl: string | null;
}>;
export type GeoCountry = Readonly<{ code: string; nameRu: string; nameKy: string; nameEn: string; photo: GeoPhoto | null; summaryRu: string | null; summaryKy: string | null }>;
export type GeoCity = Readonly<{
  key: string; country: string; nameRu: string; nameKy: string; nameEn: string; lat: number | null; lng: number | null;
  photo: GeoPhoto | null; summaryRu: string | null; summaryKy: string | null; factRu: string | null; factKy: string | null;
  factSourceUrl: string | null; factVerifiedOn: string | null; kyReview: "pending" | "done"; status: "draft" | "published";
  publishedAt: string | null; reviewedByName: string | null; complete: boolean; version: number; updatedAt: string; institutionCount: number;
}>;
export type GeoInstitution = Readonly<{ id: string; name: string; country: string; cityLabel: string | null; published: boolean; cityKey: string | null; assignedVia: "migration" | "staff" | null }>;
export type GeoCost = Readonly<{
  id: string; institutionId: string; programId: string | null; studyLevel: UniversityLevel | null; teachingLanguage: string | null;
  costKind: CostKind; period: CostPeriod; amountMinMinor: number; amountMaxMinor: number | null; currency: string; exponent: number;
  academicYear: string | null; noteRu: string | null; noteKy: string | null; sourceKind: CostSourceKind; sourceName: string;
  sourceUrl: string | null; verifiedOn: string; confirmedOn: string | null; confirmationReason: string | null; confirmedByName: string | null;
  status: CostStatus; version: number; importKey: string | null;
}>;
export type GeoFxRate = Readonly<{ currency: string; asOf: string; unitsPerUsd: number; sourceName: string; sourceUrl: string | null; setAt: string; ageDays: number; latest: boolean }>;
export type StaffGeography = Readonly<{ countries: readonly GeoCountry[]; cities: readonly GeoCity[]; institutions: readonly GeoInstitution[]; costs: readonly GeoCost[]; fxRates: readonly GeoFxRate[] }>;

/* ------------------------------------------------------------- разбор ответа */

type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CITY_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const object = (value: unknown): Row | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? value as Row : null);
const str = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const strOrNull = (value: unknown): value is string | null => value === null || str(value);
const int = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const day = (value: unknown): value is string => typeof value === "string" && DAY.test(value);
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === "string" && (values as readonly string[]).includes(value);

/**
 * Ответ RPC проверяется по полям, которые читает CRM: тип и допустимые
 * значения. Лишнее поле нового выпуска 283 не ломает страницу; неверное или
 * отсутствующее нужное поле значит «не удалось загрузить», а не пустой список.
 */
function photo(value: unknown): GeoPhoto | null | undefined {
  if (value === null) return null;
  const row = object(value);
  if (!row || !str(row.path) || !int(row.width) || !int(row.height) || !str(row.author) || !strOrNull(row.authorUrl)
    || !oneOf(PHOTO_SOURCES, row.sourceName) || !str(row.sourceUrl) || !str(row.license) || !strOrNull(row.licenseUrl)) return undefined;
  return { path: row.path, width: row.width, height: row.height, author: row.author, authorUrl: row.authorUrl, sourceName: row.sourceName, sourceUrl: row.sourceUrl, license: row.license, licenseUrl: row.licenseUrl };
}
function country(value: unknown): GeoCountry | null {
  const row = object(value), image = row ? photo(row.photo) : undefined;
  if (!row || !isStudyCountryCode(row.code) || !str(row.nameRu) || !str(row.nameKy) || !str(row.nameEn) || image === undefined
    || !strOrNull(row.summaryRu) || !strOrNull(row.summaryKy)) return null;
  return { code: row.code, nameRu: row.nameRu, nameKy: row.nameKy, nameEn: row.nameEn, photo: image, summaryRu: row.summaryRu, summaryKy: row.summaryKy };
}
function city(value: unknown): GeoCity | null {
  const row = object(value), image = row ? photo(row.photo) : undefined;
  if (!row || !str(row.key) || !CITY_KEY.test(row.key) || !isStudyCountryCode(row.country) || !str(row.nameRu) || !str(row.nameKy) || !str(row.nameEn)
    || !(row.lat === null || typeof row.lat === "number") || !(row.lng === null || typeof row.lng === "number") || image === undefined
    || !strOrNull(row.summaryRu) || !strOrNull(row.summaryKy) || !strOrNull(row.factRu) || !strOrNull(row.factKy)
    || !strOrNull(row.factSourceUrl) || !(row.factVerifiedOn === null || day(row.factVerifiedOn)) || !oneOf(["pending", "done"], row.kyReview)
    || !oneOf(["draft", "published"], row.status) || !strOrNull(row.publishedAt) || !strOrNull(row.reviewedByName)
    || typeof row.complete !== "boolean" || !int(row.version) || row.version < 1 || !str(row.updatedAt) || !int(row.institutionCount)) return null;
  return {
    key: row.key, country: row.country, nameRu: row.nameRu, nameKy: row.nameKy, nameEn: row.nameEn, lat: row.lat as number | null, lng: row.lng as number | null,
    photo: image, summaryRu: row.summaryRu, summaryKy: row.summaryKy, factRu: row.factRu, factKy: row.factKy, factSourceUrl: row.factSourceUrl,
    factVerifiedOn: row.factVerifiedOn as string | null, kyReview: row.kyReview, status: row.status, publishedAt: row.publishedAt,
    reviewedByName: row.reviewedByName, complete: row.complete, version: row.version, updatedAt: row.updatedAt, institutionCount: row.institutionCount,
  };
}
function institution(value: unknown): GeoInstitution | null {
  const row = object(value);
  if (!row || !str(row.id) || !UUID.test(row.id) || !str(row.name) || !isStudyCountryCode(row.country) || !strOrNull(row.cityLabel)
    || typeof row.published !== "boolean" || !(row.cityKey === null || (str(row.cityKey) && CITY_KEY.test(row.cityKey)))
    || !(row.assignedVia === null || oneOf(["migration", "staff"], row.assignedVia))) return null;
  return { id: row.id, name: row.name, country: row.country, cityLabel: row.cityLabel, published: row.published, cityKey: row.cityKey, assignedVia: row.assignedVia as GeoInstitution["assignedVia"] };
}
function cost(value: unknown): GeoCost | null {
  const row = object(value);
  if (!row || !str(row.id) || !UUID.test(row.id) || !str(row.institutionId) || !UUID.test(row.institutionId) || !strOrNull(row.programId)
    || !(row.studyLevel === null || oneOf(UNIVERSITY_LEVELS, row.studyLevel)) || !strOrNull(row.teachingLanguage)
    || !oneOf(COST_KINDS, row.costKind) || !oneOf(COST_PERIODS, row.period) || !int(row.amountMinMinor) || row.amountMinMinor < 0
    || !(row.amountMaxMinor === null || (int(row.amountMaxMinor) && row.amountMaxMinor > row.amountMinMinor))
    || !str(row.currency) || !/^[A-Z]{3}$/.test(row.currency) || !int(row.exponent) || row.exponent < 0 || row.exponent > 3
    || !strOrNull(row.academicYear) || !strOrNull(row.noteRu) || !strOrNull(row.noteKy) || !oneOf(COST_SOURCE_KINDS, row.sourceKind)
    || !str(row.sourceName) || !strOrNull(row.sourceUrl) || !day(row.verifiedOn) || !(row.confirmedOn === null || day(row.confirmedOn))
    || !strOrNull(row.confirmationReason) || !strOrNull(row.confirmedByName) || !oneOf(COST_STATUSES, row.status)
    || !int(row.version) || row.version < 1 || !strOrNull(row.importKey)) return null;
  return {
    id: row.id, institutionId: row.institutionId, programId: row.programId, studyLevel: row.studyLevel as UniversityLevel | null, teachingLanguage: row.teachingLanguage,
    costKind: row.costKind, period: row.period, amountMinMinor: row.amountMinMinor, amountMaxMinor: row.amountMaxMinor as number | null, currency: row.currency,
    exponent: row.exponent, academicYear: row.academicYear, noteRu: row.noteRu, noteKy: row.noteKy, sourceKind: row.sourceKind, sourceName: row.sourceName,
    sourceUrl: row.sourceUrl, verifiedOn: row.verifiedOn, confirmedOn: row.confirmedOn as string | null, confirmationReason: row.confirmationReason,
    confirmedByName: row.confirmedByName, status: row.status, version: row.version, importKey: row.importKey,
  };
}
function fxRate(value: unknown): GeoFxRate | null {
  const row = object(value);
  if (!row || !str(row.currency) || !/^[A-Z]{3}$/.test(row.currency) || !day(row.asOf) || typeof row.unitsPerUsd !== "number" || !(row.unitsPerUsd > 0)
    || !str(row.sourceName) || !strOrNull(row.sourceUrl) || !str(row.setAt) || !int(row.ageDays) || typeof row.latest !== "boolean") return null;
  return { currency: row.currency, asOf: row.asOf, unitsPerUsd: row.unitsPerUsd, sourceName: row.sourceName, sourceUrl: row.sourceUrl, setAt: row.setAt, ageDays: row.ageDays, latest: row.latest };
}
function list<T>(value: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const items: T[] = [];
  for (const entry of value) {
    const parsed = parse(entry);
    if (parsed === null) return null;
    items.push(parsed);
  }
  return items;
}
export function parseStaffGeography(value: unknown): StaffGeography | null {
  const row = object(value);
  if (!row) return null;
  const countries = list(row.countries, country), cities = list(row.cities, city), institutions = list(row.institutions, institution);
  const costs = list(row.costs, cost), fxRates = list(row.fxRates, fxRate);
  if (!countries || !cities || !institutions || !costs || !fxRates) return null;
  if (countries.map((item) => item.code).join() !== STUDY_COUNTRY_CODES.join()) return null;
  return { countries, cities, institutions, costs, fxRates };
}

/* ------------------------------------------------------------------- деньги */

const DIGITS = /^\d{1,13}(?:[.,]\d{1,3})?$/;
/** «25 000», «25000,50» → минорные единицы; null, если сумма не читается или знаков больше, чем у валюты. */
export function amountToMinor(text: string, exponent: number): number | null {
  const value = text.replace(/[\s\u00a0\u202f]/g, "");
  if (!DIGITS.test(value)) return null;
  const [whole, fraction = ""] = value.split(/[.,]/);
  if (fraction.length > exponent) return null;
  const minor = Number(`${whole}${fraction.padEnd(exponent, "0")}`);
  return Number.isSafeInteger(minor) && minor <= 1_000_000_000_000_000 ? minor : null;
}
/** Минорные единицы → строка поля ввода («25000», «25000.5»). */
export function minorToAmount(minor: number, exponent: number): string {
  if (exponent === 0) return String(minor);
  const digits = String(minor).padStart(exponent + 1, "0");
  const fraction = digits.slice(-exponent).replace(/0+$/, "");
  return `${digits.slice(0, -exponent)}${fraction ? `.${fraction}` : ""}`;
}
export function formatMinor(minor: number, exponent: number): string {
  const major = minor / 10 ** exponent;
  return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: Number.isInteger(major) ? 0 : exponent, maximumFractionDigits: exponent }).format(major);
}
/** «25 000 CNY», «от 25 000 до 35 000 CNY». */
export function formatCostAmount(row: Pick<GeoCost, "amountMinMinor" | "amountMaxMinor" | "exponent" | "currency">): string {
  const min = formatMinor(row.amountMinMinor, row.exponent);
  return row.amountMaxMinor === null ? `${min} ${row.currency}` : `от ${min} до ${formatMinor(row.amountMaxMinor, row.exponent)} ${row.currency}`;
}
/**
 * Ориентир в USD тем же правилом, что SQL `catalog_usd_approx`: сумма / курс,
 * до 10 USD, ненулевая сумма не меньше 10; строка в USD и без курса: null.
 */
export function usdApprox(minor: number, currency: string, exponent: number, unitsPerUsd: number | null): number | null {
  if (currency === "USD" || unitsPerUsd === null || !(unitsPerUsd > 0)) return null;
  if (minor === 0) return 0;
  return Math.max(10, Math.round(minor / 10 ** exponent / unitsPerUsd / 10) * 10);
}
export function latestRates(rates: readonly GeoFxRate[]): Map<string, GeoFxRate> {
  return new Map(rates.filter((rate) => rate.latest).map((rate) => [rate.currency, rate]));
}
export function rateIsStale(rate: Pick<GeoFxRate, "ageDays">): boolean {
  return rate.ageDays > FX_STALE_DAYS;
}
/** «1 USD = 7,1234 CNY». */
export function formatRate(rate: Pick<GeoFxRate, "unitsPerUsd" | "currency">): string {
  return `1 USD = ${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 6 }).format(rate.unitsPerUsd)} ${rate.currency}`;
}

/* ---------------------------------------------------------------- подписи */

/** «Обучение · Бакалавриат · на английском». */
export function costWhat(row: Pick<GeoCost, "costKind" | "studyLevel" | "teachingLanguage">, programTitle: string | null = null): string {
  const language = row.teachingLanguage ? TEACHING_LANGUAGES[row.teachingLanguage] ?? row.teachingLanguage : null;
  return [COST_KIND_LABELS[row.costKind], programTitle ?? (row.studyLevel ? UNIVERSITY_LEVEL_LABELS[row.studyLevel] : null), language ? `на ${languagePrepositional(language)}` : null].filter(Boolean).join(" · ");
}
function languagePrepositional(adjective: string): string {
  // «английский» → «английском»: язык в подписи «на английском».
  return adjective.endsWith("ий") ? `${adjective.slice(0, -2)}ом` : adjective;
}

/* ----------------------------------------------------------- проверка ввода */

/** Длинное, среднее и похожие тире в текстах для людей не используются (правило EVO, как DASH_PATTERN генератора сида). */
const DASH = /[‒-―]/u;
/**
 * Текст по правилу базы (`catalog_text_ok`, контракт 2.2a); у текстов для
 * студента ещё без тире. Возвращает слова ошибки или null, если текст верный.
 */
export function catalogTextIssue(value: string, max: number, student: boolean): string | null {
  if (catalogText(value, max) && !(student && DASH.test(value))) return null;
  if (value.length === 0) return "Заполните поле.";
  const length = [...value].length;
  if (length > max) return `Слишком длинно: ${length} из ${max} знаков.`;
  if (student && DASH.test(value)) return "Без длинного и среднего тире: поставьте дефис, запятую или двоеточие.";
  return "Уберите невидимые знаки: перевод строки, табуляцию, мягкий перенос, знаки нулевой ширины или направления письма.";
}
/** Текст для студента: правило базы и без тире. */
export function studentText(value: string, max: number): boolean {
  return catalogTextIssue(value, max, true) === null;
}
const URL_ISSUE = "Адрес публичной страницы https://, без пробелов, порта и невидимых знаков.";
const pastDay = (value: string, today: string) => DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && value >= "2000-01-01" && value <= today;
export function academicYearOk(value: string): boolean {
  if (/^20\d{2}$/.test(value)) return true;
  const match = /^(20\d{2})\/(\d{2})$/.exec(value);
  return match !== null && Number(match[2]) === (Number(match[1]) + 1) % 100;
}
/** Ошибки формы: поле и слова (null: общие слова поля у формы). */
export type FieldErrors<F extends string> = ReadonlyMap<F, string | null>;

export type CityDraft = {
  key: string; country: string; nameRu: string; nameKy: string; nameEn: string; lat: string; lng: string;
  photoPath: string; photoWidth: string; photoHeight: string; photoAuthor: string; photoAuthorUrl: string;
  photoSourceName: string; photoSourceUrl: string; photoLicense: string; photoLicenseUrl: string;
  summaryRu: string; summaryKy: string; factRu: string; factKy: string; factSourceUrl: string; factVerifiedOn: string; kyReview: "pending" | "done";
};
export type CityInput = Readonly<{
  key: string; country: string; nameRu: string; nameKy: string; nameEn: string; lat: number | null; lng: number | null; photo: GeoPhoto | null;
  summaryRu: string | null; summaryKy: string | null; factRu: string | null; factKy: string | null; factSourceUrl: string | null; factVerifiedOn: string | null; kyReview: "pending" | "done";
}>;
export function cityDraft(city: GeoCity | null, countryCode: string): CityDraft {
  const p = city?.photo ?? null;
  return {
    key: city?.key ?? "", country: city?.country ?? countryCode, nameRu: city?.nameRu ?? "", nameKy: city?.nameKy ?? "", nameEn: city?.nameEn ?? "",
    lat: city?.lat === null || city?.lat === undefined ? "" : String(city.lat), lng: city?.lng === null || city?.lng === undefined ? "" : String(city.lng),
    photoPath: p?.path ?? "", photoWidth: p ? String(p.width) : "", photoHeight: p ? String(p.height) : "", photoAuthor: p?.author ?? "",
    photoAuthorUrl: p?.authorUrl ?? "", photoSourceName: p?.sourceName ?? "Pexels", photoSourceUrl: p?.sourceUrl ?? "", photoLicense: p?.license ?? "",
    photoLicenseUrl: p?.licenseUrl ?? "", summaryRu: city?.summaryRu ?? "", summaryKy: city?.summaryKy ?? "", factRu: city?.factRu ?? "",
    factKy: city?.factKy ?? "", factSourceUrl: city?.factSourceUrl ?? "", factVerifiedOn: city?.factVerifiedOn ?? "", kyReview: city?.kyReview ?? "pending",
  };
}
/** `photo`, `summary`, `fact`: сводные ключи групп (у каждого поля группы своя ошибка). */
export type CityField = keyof CityDraft | "photo" | "summary" | "fact" | "coordinates";
export const CITY_PHOTO_PATH = /^geography\/cities\/[a-z0-9]+(-[a-z0-9]+)*-[0-9a-f]{12}\.(jpg|png|webp|avif)$/;
const coordinate = (value: string, limit: number) => /^-?\d{1,3}(\.\d{1,8})?$/.test(value) && Math.abs(Number(value)) <= limit;
const sideOk = (value: string) => /^[1-9]\d{0,4}$/.test(value);
/** Пара RU и KY: оба текста или ни одного. */
function pair(ru: string, ky: string, max: number, errors: Map<CityField, string | null>, name: "summary" | "fact"): [string | null, string | null] {
  const a = ru.trim(), b = ky.trim();
  if (!a && !b) return [null, null];
  if (!a || !b) errors.set(name, `Нужны оба языка, RU и KY, или ни одного: сейчас нет ${a ? "KY" : "RU"}.`);
  else {
    const issue = catalogTextIssue(a, max, true) ?? catalogTextIssue(b, max, true);
    if (issue) errors.set(name, `${catalogTextIssue(a, max, true) ? "RU" : "KY"}: ${issue}`);
  }
  return [a, b];
}
/**
 * Черновик формы → вход `staff_catalog_city_upsert_v1` (контракт 3.2) и
 * ошибки полей словами. Пустое поле пути фото значит «без фото».
 */
export function cityInput(draft: CityDraft, today: string): { input: CityInput; errors: FieldErrors<CityField> } {
  const errors = new Map<CityField, string | null>();
  if (draft.key.length < 2 || draft.key.length > 64 || !CITY_KEY.test(draft.key)) errors.set("key", null);
  if (!isStudyCountryCode(draft.country)) errors.set("country", null);
  for (const field of ["nameRu", "nameKy", "nameEn"] as const) {
    const issue = catalogTextIssue(draft[field].trim(), 100, true);
    if (issue) errors.set(field, issue);
  }
  const lat = draft.lat.trim(), lng = draft.lng.trim();
  if ((lat === "") !== (lng === "") || (lat && (!coordinate(lat, 90) || !coordinate(lng, 180)))) errors.set("coordinates", null);
  let image: GeoPhoto | null = null;
  if (draft.photoPath.trim()) {
    const photo = {
      path: draft.photoPath.trim(), width: draft.photoWidth.trim(), height: draft.photoHeight.trim(), author: draft.photoAuthor.trim(),
      authorUrl: draft.photoAuthorUrl.trim(), sourceName: draft.photoSourceName, sourceUrl: draft.photoSourceUrl.trim(),
      license: draft.photoLicense.trim(), licenseUrl: draft.photoLicenseUrl.trim(),
    };
    const fail = (field: CityField, text: string | null) => { if (!errors.has(field)) errors.set(field, text); errors.set("photo", null); };
    if (!CITY_PHOTO_PATH.test(photo.path)) fail("photoPath", null);
    if (!sideOk(photo.width)) fail("photoWidth", null);
    if (!sideOk(photo.height)) fail("photoHeight", null);
    const author = catalogTextIssue(photo.author, 200, false);
    if (author) fail("photoAuthor", author);
    if (photo.authorUrl && !catalogUrl(photo.authorUrl)) fail("photoAuthorUrl", URL_ISSUE);
    if (!oneOf(PHOTO_SOURCES, photo.sourceName)) fail("photoSourceName", null);
    else if (!catalogUrl(photo.sourceUrl)) fail("photoSourceUrl", URL_ISSUE);
    else if (!catalogPhotoSourceMatches(photo.sourceName, photo.sourceUrl)) {
      fail("photoSourceUrl", `Нужна страница фото на ${CATALOG_PHOTO_SOURCE_HOSTS[photo.sourceName][0]}: адрес ${catalogUrlHost(photo.sourceUrl) ?? ""} не относится к ${photo.sourceName}.`);
    }
    const license = catalogTextIssue(photo.license, 120, false);
    if (license) fail("photoLicense", license);
    if (photo.licenseUrl && !catalogUrl(photo.licenseUrl)) fail("photoLicenseUrl", URL_ISSUE);
    // Фото агентств не берём (CHECK 283 сверяет весь объект фото).
    for (const [field, value] of [["photoPath", photo.path], ["photoAuthor", photo.author], ["photoAuthorUrl", photo.authorUrl], ["photoSourceUrl", photo.sourceUrl], ["photoLicense", photo.license], ["photoLicenseUrl", photo.licenseUrl]] as const) {
      if (/eduprchina/i.test(value)) fail(field, "Фото агентств нельзя: только Unsplash, Pexels или Wikimedia Commons.");
    }
    image = {
      path: photo.path, width: Number(photo.width), height: Number(photo.height), author: photo.author, authorUrl: photo.authorUrl || null,
      sourceName: photo.sourceName as PhotoSource, sourceUrl: photo.sourceUrl, license: photo.license, licenseUrl: photo.licenseUrl || null,
    };
  }
  const [summaryRu, summaryKy] = pair(draft.summaryRu, draft.summaryKy, 300, errors, "summary");
  const [factRu, factKy] = pair(draft.factRu, draft.factKy, 200, errors, "fact");
  const factSourceUrl = draft.factSourceUrl.trim() || null, factVerifiedOn = draft.factVerifiedOn.trim() || null;
  if (factSourceUrl !== null && !catalogUrl(factSourceUrl)) errors.set("factSourceUrl", URL_ISSUE);
  if (factVerifiedOn !== null && !pastDay(factVerifiedOn, today)) errors.set("factVerifiedOn", null);
  return {
    input: {
      key: draft.key, country: draft.country, nameRu: draft.nameRu.trim(), nameKy: draft.nameKy.trim(), nameEn: draft.nameEn.trim(),
      lat: lat ? Number(lat) : null, lng: lng ? Number(lng) : null, photo: image, summaryRu, summaryKy, factRu, factKy, factSourceUrl, factVerifiedOn, kyReview: draft.kyReview,
    },
    errors,
  };
}
/**
 * Черновик отличается от сохранённой карточки по смыслу: сравнивается вход
 * RPC, а не строки формы (хвостовой пробел и «30.250» против «30.25» это то
 * же самое; review CRM R2). Новый город всегда «изменён».
 */
export function cityDraftChanged(draft: CityDraft, city: GeoCity | null, today: string): boolean {
  return city === null || canonical(cityInput(draft, today).input) !== canonical(cityInput(cityDraft(city, city.country), today).input);
}
/**
 * Что делать с черновиком, когда пришла более новая версия записи (review CRM
 * S1). Своих правок нет или черновик совпал с записью (своё сохранение):
 * черновик становится записью. Свои правки есть: черновик остаётся, пока
 * сотрудник сам не попросит сохранённую версию («Обновить страницу» после
 * отказа «Запись уже изменили» или «Показать сохранённую»); тогда он
 * заменяется, а заменённый текст можно скопировать.
 */
export function draftSync(state: Readonly<{ ownEdits: boolean; matchesSaved: boolean; reloadRequested: boolean }>): "adopt" | "replace" | "keep" {
  if (!state.ownEdits || state.matchesSaved) return "adopt";
  return state.reloadRequested ? "replace" : "keep";
}
/** Поля черновика, которые сотрудник изменил относительно `base`, строками «Подпись: значение» (то, что заменит сохранённая версия). */
function draftNotes<D extends Record<string, string>>(mine: D, base: D, labels: Readonly<Record<keyof D, string>>, show: (key: keyof D, value: string) => string = (_key, value) => value): string {
  return (Object.keys(labels) as (keyof D)[])
    .filter((key) => mine[key].trim() !== base[key].trim())
    .map((key) => `${labels[key]}: ${mine[key].trim() ? show(key, mine[key].trim()) : "пусто"}`)
    .join("\n");
}
const CITY_DRAFT_LABELS: Readonly<Record<keyof CityDraft, string>> = {
  key: "Ключ в адресе", country: "Страна", nameRu: "Название, RU", nameKy: "Название, KY", nameEn: "Название, EN", lat: "Широта центра", lng: "Долгота центра",
  photoPath: "Путь к файлу в хранилище", photoWidth: "Ширина, px", photoHeight: "Высота, px", photoAuthor: "Автор", photoAuthorUrl: "Страница автора",
  photoSourceName: "Источник фото", photoSourceUrl: "Страница фото у источника", photoLicense: "Лицензия", photoLicenseUrl: "Адрес лицензии",
  summaryRu: "Коротко о городе, RU", summaryKy: "Коротко о городе, KY", factRu: "Самый интересный факт, RU", factKy: "Самый интересный факт, KY",
  factSourceUrl: "Источник факта", factVerifiedOn: "Факт проверен", kyReview: "Кыргызский текст проверен носителем языка",
};
/** Несохранённые правки карточки города относительно версии, от которой они начаты. */
export function cityDraftNotes(mine: CityDraft, base: GeoCity | null, countryCode: string): string {
  return draftNotes(mine, cityDraft(base, countryCode), CITY_DRAFT_LABELS, (key, value) => (key === "kyReview" ? (value === "done" ? "да" : "нет") : value));
}
/** Чего не хватает карточке для публикации (план 7.1): пусто, если карточка полная. */
export function cityMissing(city: Pick<CityInput, "photo" | "summaryRu" | "factRu" | "factSourceUrl" | "factVerifiedOn">): string[] {
  return [
    city.photo ? null : "фото",
    city.summaryRu ? null : "короткий текст",
    city.factRu ? null : "интересный факт",
    city.factSourceUrl ? null : "источник факта",
    city.factVerifiedOn ? null : "дата проверки факта",
  ].filter((item): item is string => item !== null);
}

export type CostDraft = {
  costKind: CostKind; period: CostPeriod; programId: string; studyLevel: string; teachingLanguage: string; currency: string;
  amountMin: string; amountMax: string; academicYear: string; noteRu: string; noteKy: string;
  sourceKind: CostSourceKind; sourceName: string; sourceUrl: string; verifiedOn: string;
};
export type CostInput = Readonly<{
  id: string | null; institutionId: string; programId: string | null; studyLevel: UniversityLevel | null; teachingLanguage: string | null;
  costKind: CostKind; period: CostPeriod; amountMinMinor: number; amountMaxMinor: number | null; currency: string; academicYear: string | null;
  noteRu: string | null; noteKy: string | null; sourceKind: CostSourceKind; sourceName: string; sourceUrl: string | null; verifiedOn: string;
}>;
export type CostField = keyof CostDraft | "note";
/** ISO 4217: минорные единицы, как SQL `catalog_currency_exponent`. */
export function currencyExponent(currency: string): number {
  if (["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF"].includes(currency)) return 0;
  if (["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"].includes(currency)) return 3;
  return 2;
}
export function costDraft(row: GeoCost | null, countryCode: string, today: string): CostDraft {
  if (!row) return { costKind: "tuition", period: "year", programId: "", studyLevel: "", teachingLanguage: "", currency: COUNTRY_CURRENCY[countryCode] ?? "USD", amountMin: "", amountMax: "", academicYear: "", noteRu: "", noteKy: "", sourceKind: "official", sourceName: "", sourceUrl: "", verifiedOn: today };
  return {
    costKind: row.costKind, period: row.period, programId: row.programId ?? "", studyLevel: row.studyLevel ?? "", teachingLanguage: row.teachingLanguage ?? "",
    currency: row.currency, amountMin: minorToAmount(row.amountMinMinor, row.exponent), amountMax: row.amountMaxMinor === null ? "" : minorToAmount(row.amountMaxMinor, row.exponent),
    academicYear: row.academicYear ?? "", noteRu: row.noteRu ?? "", noteKy: row.noteKy ?? "", sourceKind: row.sourceKind, sourceName: row.sourceName,
    sourceUrl: row.sourceUrl ?? "", verifiedOn: row.verifiedOn,
  };
}
/**
 * Черновик формы → вход `staff_catalog_cost_upsert_v1` (контракт 3.3).
 * `programs` это программы последней опубликованной карточки вуза: строка
 * программы получает её уровень (SQL требует совпадения). Адрес
 * образовательного агентства бывает только у строки «Агентство» (review CRM R4).
 */
export function costInput(draft: CostDraft, ids: { id: string | null; institutionId: string }, programs: readonly { id: string; level: UniversityLevel }[], today: string): { input: CostInput; errors: FieldErrors<CostField> } {
  const errors = new Map<CostField, string | null>();
  if (!oneOf(COST_KINDS, draft.costKind)) errors.set("costKind", null);
  if (!oneOf(COST_PERIODS, draft.period)) errors.set("period", null);
  const program = draft.programId ? programs.find((item) => item.id === draft.programId) ?? null : null;
  if (draft.programId && !program) errors.set("programId", null);
  const studyLevel = program ? program.level : draft.studyLevel ? draft.studyLevel : null;
  if (studyLevel !== null && !oneOf(UNIVERSITY_LEVELS, studyLevel)) errors.set("studyLevel", null);
  const teachingLanguage = draft.teachingLanguage || null;
  if (teachingLanguage !== null && !/^[a-z]{2}$/.test(teachingLanguage)) errors.set("teachingLanguage", null);
  const currency = draft.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.set("currency", null);
  const exponent = currencyExponent(currency);
  const min = amountToMinor(draft.amountMin, exponent);
  const max = draft.amountMax.trim() ? amountToMinor(draft.amountMax, exponent) : null;
  if (min === null) errors.set("amountMin", null);
  // Равные «от» и «до» это одна сумма (как в импорте).
  if (draft.amountMax.trim() && (max === null || (min !== null && max < min))) errors.set("amountMax", null);
  const academicYear = draft.academicYear.trim() || null;
  if (academicYear !== null && !academicYearOk(academicYear)) errors.set("academicYear", null);
  const noteRu = draft.noteRu.trim() || null, noteKy = draft.noteKy.trim() || null;
  if ((noteRu === null) !== (noteKy === null)) errors.set("note", `Нужны оба языка, RU и KY, или ни одного: сейчас нет ${noteRu ? "KY" : "RU"}.`);
  else if (noteRu !== null && noteKy !== null) {
    const ru = catalogTextIssue(noteRu, 300, true), ky = catalogTextIssue(noteKy, 300, true);
    if (ru || ky) errors.set("note", ru ? `RU: ${ru}` : `KY: ${ky}`);
  }
  if (!oneOf(COST_SOURCE_KINDS, draft.sourceKind)) errors.set("sourceKind", null);
  const sourceName = draft.sourceName.trim(), sourceUrl = draft.sourceUrl.trim() || null;
  const nameIssue = catalogTextIssue(sourceName, 200, false);
  if (nameIssue) errors.set("sourceName", nameIssue);
  if (sourceUrl !== null && !catalogUrl(sourceUrl)) errors.set("sourceUrl", URL_ISSUE);
  else if (draft.sourceKind !== "evo_document" && sourceUrl === null) errors.set("sourceUrl", null);
  else if (sourceUrl !== null && draft.sourceKind !== "agency" && catalogAgencyUrl(sourceUrl)) {
    errors.set("sourceKind", `Адрес ${catalogUrlHost(sourceUrl)} принадлежит образовательному агентству: выберите источник «Агентство».`);
  }
  if (!pastDay(draft.verifiedOn.trim(), today)) errors.set("verifiedOn", null);
  return {
    input: {
      id: ids.id, institutionId: ids.institutionId, programId: program?.id ?? null, studyLevel: studyLevel as UniversityLevel | null, teachingLanguage,
      costKind: draft.costKind, period: draft.period, amountMinMinor: min ?? 0, amountMaxMinor: max !== null && min !== null && max > min ? max : null,
      currency, academicYear, noteRu, noteKy, sourceKind: draft.sourceKind, sourceName, sourceUrl, verifiedOn: draft.verifiedOn.trim(),
    },
    errors,
  };
}

/** Строка стоимости изменена по смыслу (как `cityDraftChanged`): сравнивается вход RPC. Новая строка всегда «изменена». */
export function costDraftChanged(draft: CostDraft, row: GeoCost | null, countryCode: string, programs: readonly { id: string; level: UniversityLevel }[], today: string): boolean {
  if (row === null) return true;
  const ids = { id: row.id, institutionId: row.institutionId };
  return canonical(costInput(draft, ids, programs, today).input) !== canonical(costInput(costDraft(row, countryCode, today), ids, programs, today).input);
}
const COST_DRAFT_LABELS: Readonly<Record<keyof CostDraft, string>> = {
  costKind: "Что", period: "Период", programId: "Программа", studyLevel: "Уровень", teachingLanguage: "Язык обучения", currency: "Валюта вуза",
  amountMin: "Сумма или «от»", amountMax: "«До»", academicYear: "Учебный год", noteRu: "Пояснение студенту, RU", noteKy: "Пояснение студенту, KY",
  sourceKind: "Источник", sourceName: "Название источника", sourceUrl: "Адрес источника", verifiedOn: "Проверено",
};
/** Несохранённые правки строки стоимости относительно версии, от которой они начаты; коды словами, как в форме. */
export function costDraftNotes(mine: CostDraft, base: GeoCost | null, countryCode: string, today: string): string {
  const words: Partial<Record<keyof CostDraft, Readonly<Record<string, string>>>> = {
    costKind: COST_KIND_LABELS, period: COST_PERIOD_LABELS, sourceKind: COST_SOURCE_LABELS, studyLevel: UNIVERSITY_LEVEL_LABELS, teachingLanguage: TEACHING_LANGUAGES,
  };
  return draftNotes(mine, costDraft(base, countryCode, today), COST_DRAFT_LABELS, (key, value) => words[key]?.[value] ?? value);
}

export type FxDraft = { currency: string; asOf: string; unitsPerUsd: string; sourceName: string; sourceUrl: string };
export type FxInput = Readonly<{ currency: string; asOf: string; unitsPerUsd: number; sourceName: string; sourceUrl: string | null }>;
export type FxField = keyof FxDraft;
export function fxInput(draft: FxDraft, today: string): { input: FxInput; errors: FieldErrors<FxField> } {
  const errors = new Map<FxField, string | null>();
  const currency = draft.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || currency === "USD") errors.set("currency", null);
  if (!pastDay(draft.asOf.trim(), today)) errors.set("asOf", null);
  const raw = draft.unitsPerUsd.trim().replace(",", ".");
  const units = /^\d{1,9}(\.\d{1,10})?$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(units > 0 && units < 1_000_000_000)) errors.set("unitsPerUsd", null);
  const sourceName = draft.sourceName.trim(), sourceUrl = draft.sourceUrl.trim() || null;
  const nameIssue = catalogTextIssue(sourceName, 200, false);
  if (nameIssue) errors.set("sourceName", nameIssue);
  if (sourceUrl !== null && !catalogUrl(sourceUrl)) errors.set("sourceUrl", URL_ISSUE);
  return { input: { currency, asOf: draft.asOf.trim(), unitsPerUsd: units, sourceName, sourceUrl }, errors };
}

/* ------------------------------------------------------ итог команд словами */

export type GeographyOperation = "city_upsert" | "city_publish" | "institution_city_set" | "cost_upsert" | "cost_confirm" | "cost_publish" | "fx_rate_set";
export type GeographyActionStatus = "idle" | "saved" | "invalid" | "forbidden" | "stale" | "request_conflict" | "rejected" | "unavailable";
/** Известная причина отказа RPC 283 (контракт 3.5); другие отказы говорят словами операции. */
export type GeographyRefusal = "photo_missing" | "city_incomplete" | "city_exists" | "duplicate_city_name" | "agency_mislabeled" | "admin_required" | "agency_unconfirmed" | "city_country_mismatch" | "program_unknown";
const REFUSALS: Readonly<Record<string, GeographyRefusal>> = {
  catalog_city_photo_missing: "photo_missing",
  catalog_city_incomplete: "city_incomplete",
  catalog_cities_published_complete: "city_incomplete",
  catalog_cities_organization_id_country_code_name_ru_key: "duplicate_city_name",
  catalog_cost_agency_source_mislabeled: "agency_mislabeled",
  catalog_costs_agency_url_is_agency: "agency_mislabeled",
  catalog_admin_required: "admin_required",
  catalog_cost_agency_unconfirmed: "agency_unconfirmed",
  catalog_costs_agency_published_confirmed: "agency_unconfirmed",
  catalog_city_country_mismatch: "city_country_mismatch",
  catalog_cost_program_unknown: "program_unknown",
};
/** Причина из текста ошибки базы: только закрытый список имён 283, сам текст наружу не уходит. */
export function geographyRefusal(message: unknown): GeographyRefusal | null {
  if (typeof message !== "string") return null;
  for (const token of message.slice(0, 500).match(/catalog_[a-z0-9_]+/g) ?? []) if (Object.hasOwn(REFUSALS, token)) return REFUSALS[token];
  return null;
}
const REFUSAL_TEXT: Readonly<Record<GeographyRefusal, string | Partial<Record<GeographyOperation | "default", string>>>> = {
  photo_missing: {
    city_publish: "Файла фото этого города ещё нет в хранилище: студент увидел бы карточку без фото. Город не опубликован, опубликуйте его после загрузки фото.",
    default: "Нового фото ещё нет в хранилище, а город уже видят студенты. Ничего не сохранено: оставьте прежнее фото или дождитесь загрузки нового.",
  },
  city_incomplete: {
    city_publish: "Карточка неполная: для публикации нужны фото, короткий текст и факт с источником и датой проверки.",
    default: "Город видят студенты, поэтому карточка должна остаться полной. Ничего не сохранено: верните поля или сначала снимите город с публикации.",
  },
  city_exists: "Город с таким ключом уже есть. Откройте его из списка городов или выберите другой ключ.",
  duplicate_city_name: "В этой стране уже есть город с таким названием RU. Ничего не сохранено.",
  agency_mislabeled: "Адрес источника принадлежит образовательному агентству: такую строку можно сохранить только с источником «Агентство». Ничего не сохранено.",
  admin_required: {
    cost_upsert: "Вид источника у строки агентства меняет только системный Admin. Ничего не сохранено.",
    cost_confirm: "Подтверждать данные агентств может только системный Admin.",
    default: "Это действие доступно только системному Admin.",
  },
  agency_unconfirmed: "Строку агентства можно опубликовать только после подтверждения системного Admin.",
  city_country_mismatch: "Этот город из другой страны: вузу можно назначить только город его страны.",
  program_unknown: "Этой программы нет в опубликованной карточке вуза. Выберите программу из списка или «Весь вуз».",
};
const INVALID_TEXT: Readonly<Record<GeographyOperation, string>> = {
  city_upsert: "Сервер не принял карточку города: проверьте поля, ссылки https:// и даты. Ничего не сохранено.",
  city_publish: "Сервер не принял публикацию. Обновите страницу и проверьте карточку.",
  institution_city_set: "Сервер не принял город для этого вуза. Обновите страницу и выберите снова.",
  cost_upsert: "Сервер не принял строку стоимости: проверьте сумму, источник, ссылку https:// и дату. Ничего не сохранено.",
  cost_confirm: "Подтвердить можно только строку агентства, основание до 500 знаков.",
  cost_publish: "Сервер не принял смену публикации. Обновите страницу.",
  fx_rate_set: "Сервер не принял курс: проверьте валюту, дату, число и источник. Курс не сохранён.",
};
const STATUS_TEXT: Readonly<Record<"forbidden" | "stale" | "request_conflict" | "unavailable", string>> = {
  forbidden: "Нет права на это действие. Обновите страницу или войдите снова.",
  stale: "Запись уже изменили. Обновите страницу и повторите с актуальной версией.",
  request_conflict: "Этот запрос уже использован с другими данными. Обновите страницу перед новой попыткой.",
  unavailable: "Ответ сервера не подтверждён. Повторите: тот же запрос не создаст дубликат.",
};
/** Отказ команды словами: сначала известная причина, затем слова операции (review CRM R7). */
export function geographyMessage(operation: GeographyOperation | null, status: Exclude<GeographyActionStatus, "idle" | "saved">, reason: GeographyRefusal | null): string {
  if (reason) {
    const text = REFUSAL_TEXT[reason];
    return typeof text === "string" ? text : (operation ? text[operation] : undefined) ?? text.default ?? STATUS_TEXT.forbidden;
  }
  if (status === "invalid") return operation ? INVALID_TEXT[operation] : "Сервер не принял данные. Ничего не сохранено.";
  if (status === "rejected") {
    if (operation === "city_upsert") return (REFUSAL_TEXT.city_incomplete as Record<string, string>).default;
    if (operation === "cost_publish") return REFUSAL_TEXT.agency_unconfirmed as string;
    if (operation === "institution_city_set") return REFUSAL_TEXT.city_country_mismatch as string;
    return "База отклонила изменение. Обновите страницу и проверьте данные.";
  }
  return STATUS_TEXT[status];
}

/** Строгая проверка входа на сервере: тот же разбор, ключи и типы ровно как в контракте 3.2 и 3.3. */
export function exactCityInput(value: unknown, today: string): CityInput | null {
  const row = object(value);
  const keys = ["key", "country", "nameRu", "nameKy", "nameEn", "lat", "lng", "photo", "summaryRu", "summaryKy", "factRu", "factKy", "factSourceUrl", "factVerifiedOn", "kyReview"];
  if (!row || Object.keys(row).sort().join() !== [...keys].sort().join()) return null;
  const image = row.photo === null ? null : object(row.photo);
  if (row.photo !== null && (!image || Object.keys(image).sort().join() !== "author,authorUrl,height,license,licenseUrl,path,sourceName,sourceUrl,width")) return null;
  const text = (item: unknown) => (typeof item === "string" ? item : item === null ? "" : null);
  const fields = [row.key, row.country, row.nameRu, row.nameKy, row.nameEn, row.summaryRu, row.summaryKy, row.factRu, row.factKy, row.factSourceUrl, row.factVerifiedOn].map(text);
  if (fields.some((item) => item === null) || !(row.lat === null || typeof row.lat === "number") || !(row.lng === null || typeof row.lng === "number")
    || !oneOf(["pending", "done"], row.kyReview)) return null;
  if (image && (!int(image.width) || !int(image.height) || [image.path, image.author, image.sourceName, image.sourceUrl, image.license].some((item) => typeof item !== "string")
    || !(image.authorUrl === null || typeof image.authorUrl === "string") || !(image.licenseUrl === null || typeof image.licenseUrl === "string"))) return null;
  const [key, countryCode, nameRu, nameKy, nameEn, summaryRu, summaryKy, factRu, factKy, factSourceUrl, factVerifiedOn] = fields as string[];
  const { input, errors } = cityInput({
    key, country: countryCode, nameRu, nameKy, nameEn, lat: row.lat === null ? "" : String(row.lat), lng: row.lng === null ? "" : String(row.lng),
    photoPath: image ? image.path as string : "", photoWidth: image ? String(image.width) : "", photoHeight: image ? String(image.height) : "",
    photoAuthor: image ? image.author as string : "", photoAuthorUrl: image ? (image.authorUrl as string | null) ?? "" : "", photoSourceName: image ? image.sourceName as string : "",
    photoSourceUrl: image ? image.sourceUrl as string : "", photoLicense: image ? image.license as string : "", photoLicenseUrl: image ? (image.licenseUrl as string | null) ?? "" : "",
    summaryRu, summaryKy, factRu, factKy, factSourceUrl, factVerifiedOn, kyReview: row.kyReview,
  }, today);
  // Ввод должен совпасть с тем, что даёт сама форма: необрезанные пробелы или пустые строки вместо null это ошибка.
  return errors.size === 0 && canonical(input) === canonical(pick(row, Object.keys(input))) ? input : null;
}
export function exactCostInput(value: unknown, programs: readonly { id: string; level: UniversityLevel }[] | null, today: string): CostInput | null {
  const row = object(value);
  const keys = ["id", "institutionId", "programId", "studyLevel", "teachingLanguage", "costKind", "period", "amountMinMinor", "amountMaxMinor", "currency", "academicYear", "noteRu", "noteKy", "sourceKind", "sourceName", "sourceUrl", "verifiedOn"];
  if (!row || Object.keys(row).sort().join() !== [...keys].sort().join()) return null;
  if (!(row.id === null || (str(row.id) && UUID.test(row.id))) || !str(row.institutionId) || !UUID.test(row.institutionId)
    || !int(row.amountMinMinor) || row.amountMinMinor < 0 || !(row.amountMaxMinor === null || int(row.amountMaxMinor)) || !str(row.currency) || !/^[A-Z]{3}$/.test(row.currency)
    || ![row.programId, row.studyLevel, row.teachingLanguage, row.academicYear, row.noteRu, row.noteKy, row.sourceUrl].every((item) => item === null || typeof item === "string")
    || ![row.costKind, row.period, row.sourceKind, row.sourceName, row.verifiedOn].every((item) => typeof item === "string")) return null;
  const exponent = currencyExponent(row.currency);
  // Программы вуза у сервера нет (это не его чтение): уровень программы проверяет SQL.
  const known = programs ?? (row.programId ? [{ id: row.programId as string, level: (row.studyLevel ?? "bachelor") as UniversityLevel }] : []);
  const { input, errors } = costInput({
    costKind: row.costKind as CostKind, period: row.period as CostPeriod, programId: (row.programId as string | null) ?? "", studyLevel: (row.studyLevel as string | null) ?? "",
    teachingLanguage: (row.teachingLanguage as string | null) ?? "", currency: row.currency, amountMin: minorToAmount(row.amountMinMinor, exponent),
    amountMax: row.amountMaxMinor === null ? "" : minorToAmount(row.amountMaxMinor as number, exponent), academicYear: (row.academicYear as string | null) ?? "",
    noteRu: (row.noteRu as string | null) ?? "", noteKy: (row.noteKy as string | null) ?? "", sourceKind: row.sourceKind as CostSourceKind, sourceName: row.sourceName as string,
    sourceUrl: (row.sourceUrl as string | null) ?? "", verifiedOn: row.verifiedOn as string,
  }, { id: row.id as string | null, institutionId: row.institutionId }, known, today);
  return errors.size === 0 && canonical(input) === canonical(pick(row, Object.keys(input))) ? input : null;
}
function pick(row: Row, keys: readonly string[]): Row {
  return Object.fromEntries(keys.map((key) => [key, row[key]]));
}
/** JSON с ключами по алфавиту на каждом уровне: сравнение без учёта порядка ключей. */
function canonical(value: unknown): string {
  // Нечитаемое число формы (NaN) не равно null: иначе «abc» в широте совпало бы с пустой.
  if (typeof value === "number" && !Number.isFinite(value)) return "\"#invalid-number\"";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const row = object(value);
  if (row) return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
