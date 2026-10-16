/**
 * Университеты v2 в CRM (план S3.5, контракт docs/catalog/geography-costs-contract.md
 * раздел 3): разбор `staff_catalog_geography_v1`, проверка ввода города,
 * строки стоимости и курса перед RPC, деньги и подписи.
 *
 * Модуль клиент-безопасный (без server-only и Supabase): его читают и формы
 * в браузере, и серверное действие. Проверки повторяют SQL 283, но решает
 * всегда RPC: здесь только ранний понятный отказ.
 */
import { UNIVERSITY_LEVELS, UNIVERSITY_LEVEL_LABELS, universityPublicUrl, type UniversityLevel } from "./platform-university-catalog.ts";
import { STUDY_COUNTRY_CODES, isStudyCountryCode } from "./study-countries.ts";

export const COST_KINDS = ["tuition", "accommodation", "application_fee", "insurance", "other"] as const;
export type CostKind = (typeof COST_KINDS)[number];
export const COST_PERIODS = ["year", "semester", "month", "week", "day", "once", "program"] as const;
export type CostPeriod = (typeof COST_PERIODS)[number];
export const COST_SOURCE_KINDS = ["official", "agency", "evo_document"] as const;
export type CostSourceKind = (typeof COST_SOURCE_KINDS)[number];
export const COST_STATUSES = ["draft", "published", "retired"] as const;
export type CostStatus = (typeof COST_STATUSES)[number];
export const PHOTO_SOURCES = ["Unsplash", "Pexels", "Wikimedia Commons"] as const;
export type PhotoSource = (typeof PHOTO_SOURCES)[number];

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

const CONTROL = /[\u0000-\u001f\u007f]/;
/** Длинное и среднее тире в текстах для студентов не используются (правило текстов EVO, как у генератора сида). */
const DASH = /[\u2013\u2014]/;
export function studentText(value: string, max: number): boolean {
  return value.length > 0 && value === value.trim() && [...value].length <= max && !CONTROL.test(value) && !DASH.test(value);
}
const plain = (value: string, max: number) => value.length > 0 && value === value.trim() && [...value].length <= max && !CONTROL.test(value);
const pastDay = (value: string, today: string) => DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && value >= "2000-01-01" && value <= today;
export function academicYearOk(value: string): boolean {
  if (/^20\d{2}$/.test(value)) return true;
  const match = /^(20\d{2})\/(\d{2})$/.exec(value);
  return match !== null && Number(match[2]) === (Number(match[1]) + 1) % 100;
}

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
export type CityField = keyof CityDraft | "photo" | "summary" | "fact" | "coordinates";
const PHOTO_HOSTS: Readonly<Record<PhotoSource, readonly string[]>> = {
  Unsplash: ["unsplash.com", "www.unsplash.com"],
  Pexels: ["pexels.com", "www.pexels.com"],
  "Wikimedia Commons": ["commons.wikimedia.org", "upload.wikimedia.org"],
};
const PHOTO_PATH = /^geography\/cities\/[a-z0-9]+(-[a-z0-9]+)*-[0-9a-f]{12}\.(jpg|png|webp|avif)$/;
const coordinate = (value: string, limit: number) => /^-?\d{1,3}(\.\d{1,8})?$/.test(value) && Math.abs(Number(value)) <= limit;
const sideOk = (value: string) => /^[1-9]\d{0,4}$/.test(value);
/** Пара RU и KY: оба текста или ни одного. */
function pair(ru: string, ky: string, max: number, errors: Set<CityField>, name: "summary" | "fact"): [string | null, string | null] {
  const a = ru.trim(), b = ky.trim();
  if (!a && !b) return [null, null];
  if (!studentText(a, max) || !studentText(b, max)) errors.add(name);
  return [a, b];
}
/**
 * Черновик формы → вход `staff_catalog_city_upsert_v1` (контракт 3.2) или
 * список полей с ошибкой. Пустое поле пути фото значит «без фото».
 */
export function cityInput(draft: CityDraft, today: string): { input: CityInput; errors: ReadonlySet<CityField> } {
  const errors = new Set<CityField>();
  if (draft.key.length < 2 || draft.key.length > 64 || !CITY_KEY.test(draft.key)) errors.add("key");
  if (!isStudyCountryCode(draft.country)) errors.add("country");
  for (const field of ["nameRu", "nameKy", "nameEn"] as const) if (!studentText(draft[field].trim(), 100)) errors.add(field);
  const lat = draft.lat.trim(), lng = draft.lng.trim();
  if ((lat === "") !== (lng === "") || (lat && (!coordinate(lat, 90) || !coordinate(lng, 180)))) errors.add("coordinates");
  let image: GeoPhoto | null = null;
  if (draft.photoPath.trim()) {
    const source = draft.photoSourceName as PhotoSource;
    const host = (() => { try { return new URL(draft.photoSourceUrl.trim()).hostname.toLowerCase(); } catch { return ""; } })();
    if (!PHOTO_PATH.test(draft.photoPath.trim()) || !sideOk(draft.photoWidth.trim()) || !sideOk(draft.photoHeight.trim())
      || !plain(draft.photoAuthor.trim(), 200) || !(draft.photoAuthorUrl.trim() === "" || universityPublicUrl(draft.photoAuthorUrl.trim()))
      || !oneOf(PHOTO_SOURCES, source) || !universityPublicUrl(draft.photoSourceUrl.trim()) || !PHOTO_HOSTS[source].includes(host)
      || !plain(draft.photoLicense.trim(), 120) || !(draft.photoLicenseUrl.trim() === "" || universityPublicUrl(draft.photoLicenseUrl.trim()))
      || /eduprchina/i.test([draft.photoPath, draft.photoAuthorUrl, draft.photoSourceUrl, draft.photoLicenseUrl].join(" "))) errors.add("photo");
    image = {
      path: draft.photoPath.trim(), width: Number(draft.photoWidth.trim()), height: Number(draft.photoHeight.trim()), author: draft.photoAuthor.trim(),
      authorUrl: draft.photoAuthorUrl.trim() || null, sourceName: source, sourceUrl: draft.photoSourceUrl.trim(), license: draft.photoLicense.trim(),
      licenseUrl: draft.photoLicenseUrl.trim() || null,
    };
  }
  const [summaryRu, summaryKy] = pair(draft.summaryRu, draft.summaryKy, 300, errors, "summary");
  const [factRu, factKy] = pair(draft.factRu, draft.factKy, 200, errors, "fact");
  const factSourceUrl = draft.factSourceUrl.trim() || null, factVerifiedOn = draft.factVerifiedOn.trim() || null;
  if (factSourceUrl !== null && !universityPublicUrl(factSourceUrl)) errors.add("factSourceUrl");
  if (factVerifiedOn !== null && !pastDay(factVerifiedOn, today)) errors.add("factVerifiedOn");
  return {
    input: {
      key: draft.key, country: draft.country, nameRu: draft.nameRu.trim(), nameKy: draft.nameKy.trim(), nameEn: draft.nameEn.trim(),
      lat: lat ? Number(lat) : null, lng: lng ? Number(lng) : null, photo: image, summaryRu, summaryKy, factRu, factKy, factSourceUrl, factVerifiedOn, kyReview: draft.kyReview,
    },
    errors,
  };
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
 * программы получает её уровень (SQL требует совпадения).
 */
export function costInput(draft: CostDraft, ids: { id: string | null; institutionId: string }, programs: readonly { id: string; level: UniversityLevel }[], today: string): { input: CostInput; errors: ReadonlySet<CostField> } {
  const errors = new Set<CostField>();
  if (!oneOf(COST_KINDS, draft.costKind)) errors.add("costKind");
  if (!oneOf(COST_PERIODS, draft.period)) errors.add("period");
  const program = draft.programId ? programs.find((item) => item.id === draft.programId) ?? null : null;
  if (draft.programId && !program) errors.add("programId");
  const studyLevel = program ? program.level : draft.studyLevel ? draft.studyLevel : null;
  if (studyLevel !== null && !oneOf(UNIVERSITY_LEVELS, studyLevel)) errors.add("studyLevel");
  const teachingLanguage = draft.teachingLanguage || null;
  if (teachingLanguage !== null && !/^[a-z]{2}$/.test(teachingLanguage)) errors.add("teachingLanguage");
  const currency = draft.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.add("currency");
  const exponent = currencyExponent(currency);
  const min = amountToMinor(draft.amountMin, exponent);
  const max = draft.amountMax.trim() ? amountToMinor(draft.amountMax, exponent) : null;
  if (min === null) errors.add("amountMin");
  // Равные «от» и «до» это одна сумма (как в импорте).
  if (draft.amountMax.trim() && (max === null || (min !== null && max < min))) errors.add("amountMax");
  const academicYear = draft.academicYear.trim() || null;
  if (academicYear !== null && !academicYearOk(academicYear)) errors.add("academicYear");
  const noteRu = draft.noteRu.trim() || null, noteKy = draft.noteKy.trim() || null;
  if ((noteRu === null) !== (noteKy === null) || (noteRu !== null && (!studentText(noteRu, 300) || !studentText(noteKy!, 300)))) errors.add("note");
  if (!oneOf(COST_SOURCE_KINDS, draft.sourceKind)) errors.add("sourceKind");
  const sourceName = draft.sourceName.trim(), sourceUrl = draft.sourceUrl.trim() || null;
  if (!plain(sourceName, 200)) errors.add("sourceName");
  if ((sourceUrl !== null && !universityPublicUrl(sourceUrl)) || (draft.sourceKind !== "evo_document" && sourceUrl === null)) errors.add("sourceUrl");
  if (!pastDay(draft.verifiedOn.trim(), today)) errors.add("verifiedOn");
  return {
    input: {
      id: ids.id, institutionId: ids.institutionId, programId: program?.id ?? null, studyLevel: studyLevel as UniversityLevel | null, teachingLanguage,
      costKind: draft.costKind, period: draft.period, amountMinMinor: min ?? 0, amountMaxMinor: max !== null && min !== null && max > min ? max : null,
      currency, academicYear, noteRu, noteKy, sourceKind: draft.sourceKind, sourceName, sourceUrl, verifiedOn: draft.verifiedOn.trim(),
    },
    errors,
  };
}

export type FxDraft = { currency: string; asOf: string; unitsPerUsd: string; sourceName: string; sourceUrl: string };
export type FxInput = Readonly<{ currency: string; asOf: string; unitsPerUsd: number; sourceName: string; sourceUrl: string | null }>;
export type FxField = keyof FxDraft;
export function fxInput(draft: FxDraft, today: string): { input: FxInput; errors: ReadonlySet<FxField> } {
  const errors = new Set<FxField>();
  const currency = draft.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || currency === "USD") errors.add("currency");
  if (!pastDay(draft.asOf.trim(), today)) errors.add("asOf");
  const raw = draft.unitsPerUsd.trim().replace(",", ".");
  const units = /^\d{1,9}(\.\d{1,10})?$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(units > 0 && units < 1_000_000_000)) errors.add("unitsPerUsd");
  const sourceName = draft.sourceName.trim(), sourceUrl = draft.sourceUrl.trim() || null;
  if (!plain(sourceName, 200)) errors.add("sourceName");
  if (sourceUrl !== null && !universityPublicUrl(sourceUrl)) errors.add("sourceUrl");
  return { input: { currency, asOf: draft.asOf.trim(), unitsPerUsd: units, sourceName, sourceUrl }, errors };
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
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const row = object(value);
  if (row) return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
