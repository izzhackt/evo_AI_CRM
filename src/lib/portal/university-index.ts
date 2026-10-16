/**
 * Индекс университетов студента и страница вуза одним вызовом (миграция 283,
 * контракт docs/catalog/geography-costs-contract.md, раздел 2).
 *
 * Строгие разборщики ответов `student_university_index_v1` и
 * `student_university_detail_v1` и чистые помощники экранов «Страны →
 * города → вузы». Любое отклонение формы ответа даёт null: экран честно
 * говорит «не удалось загрузить», а не рисует половину каталога.
 *
 * Файл клиент-безопасный: без server-only и без Supabase (поиск по названию
 * работает в браузере на этом же коде).
 */
import type { Locale } from "../i18n-data.ts";
import {
  UNIVERSITY_LEVELS,
  UNIVERSITY_PHOTOS,
  parseUniversityPage,
  universityDate,
  universityPublicUrl,
  universityUuid,
  type PublishedUniversity,
  type UniversityLevel,
  type UniversityPhotoKey,
} from "../platform-university-catalog.ts";
import { STUDY_COUNTRY_CODES } from "../study-countries.ts";
import { parseCatalogPreparations, type CatalogPreparation } from "./catalog-preparations.ts";
import { parseConsultationReceipt, type ConsultationReceipt } from "./consultation.ts";

export type LocalizedText = Readonly<{ ru: string; ky: string }>;

/** Фото страны или города: объект бакета `portal-university-photos` с атрибуцией. */
export type GeographyPhoto = Readonly<{
  path: string;
  width: number;
  height: number;
  author: string;
  authorUrl: string | null;
  sourceName: "Unsplash" | "Pexels" | "Wikimedia Commons";
  sourceUrl: string;
  license: string;
  licenseUrl: string | null;
}>;

export type IndexCountry = Readonly<{
  code: string;
  name: LocalizedText;
  photo: GeographyPhoto | null;
  summary: LocalizedText | null;
  universityCount: number;
  cityCount: number;
}>;

export type CityFact = Readonly<{ ru: string; ky: string; sourceUrl: string; verifiedOn: string }>;

export type IndexCity = Readonly<{
  key: string;
  country: string;
  name: LocalizedText;
  photo: GeographyPhoto;
  summary: LocalizedText;
  fact: CityFact;
  universityCount: number;
}>;

export type IndexIntake = Readonly<{ deadline: string | null; start: string | null; startMonth: string | null }>;

export type IndexUniversity = Readonly<{
  id: string;
  name: string;
  country: string;
  cityKey: string | null;
  cityLabel: string | null;
  levels: readonly UniversityLevel[];
  photoKey: UniversityPhotoKey | null;
  intakes: readonly IndexIntake[];
  hasCosts: boolean;
}>;

export type StudentUniversityIndex = Readonly<{
  version: string;
  countries: readonly IndexCountry[];
  cities: readonly IndexCity[];
  universities: readonly IndexUniversity[];
}>;

export type StudentUniversityIndexResponse =
  | Readonly<{ notModified: true; version: string }>
  | Readonly<{ notModified: false; index: StudentUniversityIndex }>;

export const COST_KINDS = ["tuition", "accommodation", "application_fee", "insurance", "other"] as const;
export type CostKind = (typeof COST_KINDS)[number];
export const COST_PERIODS = ["year", "semester", "month", "week", "day", "once", "program"] as const;
export type CostPeriod = (typeof COST_PERIODS)[number];
export type CostSourceKind = "official" | "agency" | "evo_document";

export type CostRow = Readonly<{
  id: string;
  kind: CostKind;
  period: CostPeriod;
  studyLevel: UniversityLevel | null;
  programId: string | null;
  teachingLanguage: string | null;
  currency: string;
  exponent: number;
  amountMinMinor: number;
  amountMaxMinor: number | null;
  usdApproxMin: number | null;
  usdApproxMax: number | null;
  academicYear: string | null;
  note: LocalizedText | null;
  source: Readonly<{ kind: "official"; url: string }> | Readonly<{ kind: "agency" | "evo_document"; url: null }>;
  verifiedOn: string;
}>;

export type FxRate = Readonly<{ currency: string; unitsPerUsd: number; asOf: string; sourceName: string }>;

export type UniversityCosts = Readonly<{ rows: readonly CostRow[]; fxRates: readonly FxRate[] }>;

export type DetailCity = Readonly<{
  key: string;
  country: string;
  name: LocalizedText;
  photo: GeographyPhoto;
  summary: LocalizedText;
  fact: CityFact;
}>;

export type StudentUniversityDetail = Readonly<{
  university: PublishedUniversity;
  country: Readonly<{ code: string; name: LocalizedText }>;
  city: DetailCity | null;
  favored: boolean;
  openConsultation: ConsultationReceipt | null;
  preparations: Readonly<{ studentCaseId: string; items: readonly CatalogPreparation[] }> | null;
  costs: UniversityCosts | null;
}>;

// ---------------------------------------------------------------------------
// Разбор
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function record(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function exact(row: Row, keys: readonly string[]): boolean {
  const present = Object.keys(row);
  return present.length === keys.length && present.every((key) => keys.includes(key));
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value === value.trim()
    && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function localized(value: unknown, max: number): LocalizedText | null {
  const row = record(value);
  if (!row || !exact(row, ["ru", "ky"]) || !text(row.ru, max) || !text(row.ky, max)) return null;
  return { ru: row.ru, ky: row.ky };
}

const PHOTO_SOURCES: readonly GeographyPhoto["sourceName"][] = ["Unsplash", "Pexels", "Wikimedia Commons"];
const PHOTO_HOSTS: Readonly<Record<GeographyPhoto["sourceName"], readonly string[]>> = {
  Unsplash: ["unsplash.com", "www.unsplash.com"],
  Pexels: ["pexels.com", "www.pexels.com"],
  "Wikimedia Commons": ["commons.wikimedia.org", "upload.wikimedia.org"],
};

function photo(value: unknown, scope: "countries" | "cities"): GeographyPhoto | null {
  const row = record(value);
  if (!row || !exact(row, ["path", "width", "height", "author", "authorUrl", "sourceName", "sourceUrl", "license", "licenseUrl"])) return null;
  const pattern = new RegExp(`^geography/${scope}/[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{12}\\.(?:jpg|png|webp|avif)$`, "u");
  if (typeof row.path !== "string" || !pattern.test(row.path)
    || !Number.isSafeInteger(row.width) || Number(row.width) < 1 || Number(row.width) > 99999
    || !Number.isSafeInteger(row.height) || Number(row.height) < 1 || Number(row.height) > 99999
    || !text(row.author, 200) || !(row.authorUrl === null || universityPublicUrl(row.authorUrl))
    || !PHOTO_SOURCES.includes(row.sourceName as GeographyPhoto["sourceName"])
    || !universityPublicUrl(row.sourceUrl)
    || !PHOTO_HOSTS[row.sourceName as GeographyPhoto["sourceName"]].includes(new URL(row.sourceUrl).hostname)
    || !text(row.license, 120) || !(row.licenseUrl === null || universityPublicUrl(row.licenseUrl))) return null;
  return {
    path: row.path,
    width: row.width as number,
    height: row.height as number,
    author: row.author,
    authorUrl: row.authorUrl as string | null,
    sourceName: row.sourceName as GeographyPhoto["sourceName"],
    sourceUrl: row.sourceUrl,
    license: row.license,
    licenseUrl: row.licenseUrl as string | null,
  };
}

function fact(value: unknown): CityFact | null {
  const row = record(value);
  if (!row || !exact(row, ["ru", "ky", "sourceUrl", "verifiedOn"]) || !text(row.ru, 200) || !text(row.ky, 200)
    || !universityPublicUrl(row.sourceUrl) || !universityDate(row.verifiedOn)) return null;
  return { ru: row.ru, ky: row.ky, sourceUrl: row.sourceUrl, verifiedOn: row.verifiedOn };
}

const CITY_KEY = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])$/u;

function city(value: unknown, withCount: boolean): (DetailCity & { universityCount?: number }) | null {
  const row = record(value);
  const keys = ["key", "country", "name", "photo", "summary", "fact", ...(withCount ? ["universityCount"] : [])];
  if (!row || !exact(row, keys) || typeof row.key !== "string" || !CITY_KEY.test(row.key)
    || typeof row.country !== "string" || !STUDY_COUNTRY_CODES.includes(row.country)) return null;
  const name = localized(row.name, 100);
  const cityPhoto = photo(row.photo, "cities");
  const summary = localized(row.summary, 300);
  const cityFact = fact(row.fact);
  if (!name || !cityPhoto || !summary || !cityFact) return null;
  if (withCount && (!count(row.universityCount) || row.universityCount < 1)) return null;
  return {
    key: row.key,
    country: row.country,
    name,
    photo: cityPhoto,
    summary,
    fact: cityFact,
    ...(withCount ? { universityCount: row.universityCount as number } : {}),
  };
}

function month(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value);
}

function intake(value: unknown): IndexIntake | null {
  const row = record(value);
  if (!row || !exact(row, ["deadline", "start", "startMonth"])
    || !(row.deadline === null || universityDate(row.deadline))
    || !(row.start === null || universityDate(row.start))
    || !(row.startMonth === null || month(row.startMonth))) return null;
  return { deadline: row.deadline as string | null, start: row.start as string | null, startMonth: row.startMonth as string | null };
}

function university(value: unknown): IndexUniversity | null {
  const row = record(value);
  if (!row || !exact(row, ["id", "name", "country", "cityKey", "cityLabel", "levels", "photoKey", "intakes", "hasCosts"])) return null;
  const id = universityUuid(row.id);
  if (!id || !text(row.name, 300) || typeof row.country !== "string" || !STUDY_COUNTRY_CODES.includes(row.country)
    || !(row.cityKey === null || (typeof row.cityKey === "string" && CITY_KEY.test(row.cityKey)))
    || !(row.cityLabel === null || text(row.cityLabel, 200))
    || !Array.isArray(row.levels) || row.levels.length > UNIVERSITY_LEVELS.length
    || !row.levels.every((level) => UNIVERSITY_LEVELS.includes(level as UniversityLevel))
    || new Set(row.levels).size !== row.levels.length
    || !(row.photoKey === null || typeof row.photoKey === "string")
    || !Array.isArray(row.intakes) || row.intakes.length > 400 || typeof row.hasCosts !== "boolean") return null;
  const intakes: IndexIntake[] = [];
  for (const entry of row.intakes) {
    const parsed = intake(entry);
    if (!parsed) return null;
    intakes.push(parsed);
  }
  // Ключ фото, которого нет в библиотеке этой сборки: честная заглушка
  // «фото не добавлено», а не отказ всего каталога.
  const photoKey = typeof row.photoKey === "string" && Object.hasOwn(UNIVERSITY_PHOTOS, row.photoKey)
    ? row.photoKey as UniversityPhotoKey
    : null;
  return {
    id,
    name: row.name,
    country: row.country,
    cityKey: row.cityKey as string | null,
    cityLabel: row.cityLabel as string | null,
    levels: UNIVERSITY_LEVELS.filter((level) => (row.levels as unknown[]).includes(level)),
    photoKey,
    intakes,
    hasCosts: row.hasCosts,
  };
}

function version(value: unknown): value is string {
  return text(value, 100);
}

/** Строгий разбор `student_university_index_v1`; null при любом отклонении. */
export function parseStudentUniversityIndexResponse(value: unknown): StudentUniversityIndexResponse | null {
  const row = record(value);
  if (!row) return null;
  if (row.notModified === true) {
    return exact(row, ["notModified", "version"]) && version(row.version)
      ? { notModified: true, version: row.version }
      : null;
  }
  if (row.notModified !== false || !exact(row, ["notModified", "version", "countries", "cities", "universities"])
    || !version(row.version) || !Array.isArray(row.countries) || !Array.isArray(row.cities)
    || !Array.isArray(row.universities) || row.universities.length > 5000 || row.cities.length > 1000) return null;

  const countries: IndexCountry[] = [];
  for (const entry of row.countries) {
    const item = record(entry);
    if (!item || !exact(item, ["code", "name", "photo", "summary", "universityCount", "cityCount"])) return null;
    const name = localized(item.name, 100);
    const countryPhoto = item.photo === null ? null : photo(item.photo, "countries");
    const summary = item.summary === null ? null : localized(item.summary, 300);
    if (typeof item.code !== "string" || !name || (item.photo !== null && !countryPhoto)
      || (item.summary !== null && !summary) || !count(item.universityCount) || !count(item.cityCount)) return null;
    countries.push({ code: item.code, name, photo: countryPhoto, summary, universityCount: item.universityCount, cityCount: item.cityCount });
  }
  // Страны всегда шесть и в порядке продукта (282).
  if (countries.map((entry) => entry.code).join(",") !== STUDY_COUNTRY_CODES.join(",")) return null;

  const cities: IndexCity[] = [];
  const cityKeys = new Map<string, string>();
  for (const entry of row.cities) {
    const parsed = city(entry, true);
    if (!parsed || cityKeys.has(parsed.key)) return null;
    cityKeys.set(parsed.key, parsed.country);
    cities.push(parsed as IndexCity);
  }

  const universities: IndexUniversity[] = [];
  const ids = new Set<string>();
  for (const entry of row.universities) {
    const parsed = university(entry);
    if (!parsed || ids.has(parsed.id)) return null;
    if (parsed.cityKey !== null && cityKeys.get(parsed.cityKey) !== parsed.country) return null;
    ids.add(parsed.id);
    universities.push(parsed);
  }

  // Счётчики выдачи сходятся с её же списками: сумма вузов по странам равна
  // числу вузов, город считает свои вузы (приёмка 7.6.2).
  for (const country of countries) {
    const own = universities.filter((entry) => entry.country === country.code);
    if (own.length !== country.universityCount
      || cities.filter((entry) => entry.country === country.code).length !== country.cityCount) return null;
  }
  for (const entry of cities) {
    if (universities.filter((item) => item.cityKey === entry.key).length !== entry.universityCount) return null;
  }

  return { notModified: false, index: { version: row.version, countries, cities, universities } };
}

const COST_KEYS = [
  "id", "kind", "period", "studyLevel", "programId", "teachingLanguage", "currency", "exponent",
  "amountMinMinor", "amountMaxMinor", "usdApproxMin", "usdApproxMax", "academicYear", "note", "source", "verifiedOn",
] as const;

function amount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function costRow(value: unknown): CostRow | null {
  const row = record(value);
  if (!row || !exact(row, COST_KEYS)) return null;
  const id = universityUuid(row.id);
  const source = record(row.source);
  const note = row.note === null ? null : localized(row.note, 300);
  if (!id || !COST_KINDS.includes(row.kind as CostKind) || !COST_PERIODS.includes(row.period as CostPeriod)
    || !(row.studyLevel === null || UNIVERSITY_LEVELS.includes(row.studyLevel as UniversityLevel))
    || !(row.programId === null || (typeof row.programId === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/u.test(row.programId)))
    || !(row.teachingLanguage === null || (typeof row.teachingLanguage === "string" && /^[a-z]{2}$/u.test(row.teachingLanguage)))
    || typeof row.currency !== "string" || !/^[A-Z]{3}$/u.test(row.currency)
    || !Number.isSafeInteger(row.exponent) || Number(row.exponent) < 0 || Number(row.exponent) > 4
    || !amount(row.amountMinMinor) || !(row.amountMaxMinor === null || (amount(row.amountMaxMinor) && row.amountMaxMinor > row.amountMinMinor))
    || !(row.usdApproxMin === null || amount(row.usdApproxMin)) || !(row.usdApproxMax === null || amount(row.usdApproxMax))
    || (row.usdApproxMax !== null && (row.amountMaxMinor === null || row.usdApproxMin === null))
    || !(row.academicYear === null || (typeof row.academicYear === "string" && /^20\d{2}(?:\/\d{2})?$/u.test(row.academicYear)))
    || (row.note !== null && !note)
    || !source || !exact(source, ["kind", "url"])
    || !(source.kind === "official" ? universityPublicUrl(source.url) : ((source.kind === "agency" || source.kind === "evo_document") && source.url === null))
    || !universityDate(row.verifiedOn)) return null;
  return {
    id,
    kind: row.kind as CostKind,
    period: row.period as CostPeriod,
    studyLevel: row.studyLevel as UniversityLevel | null,
    programId: row.programId as string | null,
    teachingLanguage: row.teachingLanguage as string | null,
    currency: row.currency,
    exponent: row.exponent as number,
    amountMinMinor: row.amountMinMinor,
    amountMaxMinor: row.amountMaxMinor as number | null,
    usdApproxMin: row.usdApproxMin as number | null,
    usdApproxMax: row.usdApproxMax as number | null,
    academicYear: row.academicYear as string | null,
    note,
    source: source.kind === "official"
      ? { kind: "official", url: source.url as string }
      : { kind: source.kind as "agency" | "evo_document", url: null },
    verifiedOn: row.verifiedOn,
  };
}

function fxRate(value: unknown): FxRate | null {
  const row = record(value);
  if (!row || !exact(row, ["currency", "unitsPerUsd", "asOf", "sourceName"])
    || typeof row.currency !== "string" || !/^[A-Z]{3}$/u.test(row.currency)
    || typeof row.unitsPerUsd !== "number" || !Number.isFinite(row.unitsPerUsd) || row.unitsPerUsd <= 0
    || !universityDate(row.asOf) || !text(row.sourceName, 300)) return null;
  return { currency: row.currency, unitsPerUsd: row.unitsPerUsd, asOf: row.asOf, sourceName: row.sourceName };
}

function costs(value: unknown): UniversityCosts | null | undefined {
  if (value === null) return null;
  const row = record(value);
  if (!row || !exact(row, ["rows", "fxRates"]) || !Array.isArray(row.rows) || row.rows.length < 1 || row.rows.length > 500
    || !Array.isArray(row.fxRates) || row.fxRates.length > 50) return undefined;
  const rows: CostRow[] = [];
  const ids = new Set<string>();
  for (const entry of row.rows) {
    const parsed = costRow(entry);
    if (!parsed || ids.has(parsed.id)) return undefined;
    ids.add(parsed.id);
    rows.push(parsed);
  }
  const fxRates: FxRate[] = [];
  for (const entry of row.fxRates) {
    const parsed = fxRate(entry);
    if (!parsed || fxRates.some((rate) => rate.currency === parsed.currency)) return undefined;
    fxRates.push(parsed);
  }
  return { rows, fxRates };
}

/**
 * Строгий разбор `student_university_detail_v1`. `expectedId`: вуз из
 * адреса страницы: ответ о другом вузе считается сбоем, а не подменой.
 */
export function parseStudentUniversityDetail(value: unknown, expectedId: string): StudentUniversityDetail | null {
  const row = record(value);
  if (!row || !exact(row, ["university", "country", "city", "favored", "openConsultation", "preparations", "costs"])) return null;
  const page = parseUniversityPage({ items: [row.university], nextOffset: null });
  const item = page?.items[0];
  const country = record(row.country);
  const countryName = country ? localized(country.name, 100) : null;
  const detailCity = row.city === null ? null : city(row.city, false);
  const openConsultation = row.openConsultation === null ? null : parseConsultationReceipt(row.openConsultation);
  const parsedCosts = costs(row.costs);
  if (!item || item.id !== expectedId || !country || !exact(country, ["code", "name"]) || !countryName
    || country.code !== item.content.country || !STUDY_COUNTRY_CODES.includes(country.code as string)
    || (row.city !== null && (!detailCity || detailCity.country !== country.code))
    || typeof row.favored !== "boolean"
    || (row.openConsultation !== null && !openConsultation)
    || parsedCosts === undefined) return null;
  let preparations: StudentUniversityDetail["preparations"] = null;
  if (row.preparations !== null) {
    const prep = record(row.preparations);
    const studentCaseId = universityUuid(prep?.studentCaseId);
    if (!prep || !exact(prep, ["studentCaseId", "items"]) || !studentCaseId) return null;
    const items = parseCatalogPreparations(prep.items, studentCaseId);
    if (!items || items.some((entry) => entry.institutionId !== item.id)) return null;
    preparations = { studentCaseId, items };
  }
  return {
    university: item,
    country: { code: country.code as string, name: countryName },
    city: detailCity,
    favored: row.favored,
    openConsultation,
    preparations,
    costs: parsedCosts,
  };
}

// ---------------------------------------------------------------------------
// Помощники экранов
// ---------------------------------------------------------------------------

export function localizedText(value: LocalizedText, locale: Locale): string {
  return locale === "ky" ? value.ky : value.ru;
}

/** Адрес страны: код в нижнем регистре: /portal/universities/country/cn. */
export function countrySlug(code: string): string {
  return code.toLowerCase();
}

/** Код страны продукта по сегменту адреса; null: неверный адрес. */
export function countryCodeFromSlug(slug: string): string | null {
  return /^[a-z]{2}$/u.test(slug) && STUDY_COUNTRY_CODES.includes(slug.toUpperCase()) ? slug.toUpperCase() : null;
}

export const UNIVERSITIES_BASE = "/portal/universities";

export function countryHref(code: string, view: "cities" | "map" = "cities"): string {
  return `${UNIVERSITIES_BASE}/country/${countrySlug(code)}${view === "map" ? "?view=map" : ""}`;
}

export function cityHref(code: string, cityKey: string): string {
  return `${UNIVERSITIES_BASE}/country/${countrySlug(code)}/${cityKey}`;
}

export function universityHref(id: string): string {
  return `${UNIVERSITIES_BASE}/${id}`;
}

function collator(locale: Locale): Intl.Collator {
  return new Intl.Collator(locale === "ky" ? "ky" : "ru");
}

/** Города страны: больше вузов выше, затем по названию на языке интерфейса. */
export function countryCities(index: StudentUniversityIndex, code: string, locale: Locale): readonly IndexCity[] {
  const compare = collator(locale);
  return index.cities
    .filter((entry) => entry.country === code)
    .sort((a, b) => b.universityCount - a.universityCount
      || compare.compare(localizedText(a.name, locale), localizedText(b.name, locale)));
}

/** Вузы страны без опубликованного города: блок «Другие вузы страны». */
export function countryUniversitiesWithoutCity(index: StudentUniversityIndex, code: string): readonly IndexUniversity[] {
  return index.universities.filter((entry) => entry.country === code && entry.cityKey === null);
}

export function cityUniversities(index: StudentUniversityIndex, cityKey: string): readonly IndexUniversity[] {
  return index.universities.filter((entry) => entry.cityKey === cityKey);
}

export { normalizeUniversitySearch, searchUniversities } from "./university-search.ts";

export type NearestIndexIntake = Readonly<{ kind: "deadline" | "start" | "startMonth"; value: string }>;

/**
 * «Ближайший набор» по датам индекса тем же правилом, что
 * `nearestUniversityIntake` для полной карточки: сначала ближайший будущий
 * срок подачи, иначе ближайшее начало (дата раньше месяца без даты).
 */
export function nearestIndexIntake(intakes: readonly IndexIntake[], now: Date): NearestIndexIntake | null {
  const today = now.toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  let deadline: string | null = null;
  let start: string | null = null;
  let startMonth: string | null = null;
  for (const entry of intakes) {
    if (entry.deadline && entry.deadline >= today && (deadline === null || entry.deadline < deadline)) deadline = entry.deadline;
    if (entry.start && entry.start >= today && (start === null || entry.start < start)) start = entry.start;
    if (!entry.start && entry.startMonth && entry.startMonth >= thisMonth
      && (startMonth === null || entry.startMonth < startMonth)) startMonth = entry.startMonth;
  }
  if (deadline !== null) return { kind: "deadline", value: deadline };
  if (start !== null && (startMonth === null || start.slice(0, 7) <= startMonth)) return { kind: "start", value: start };
  if (startMonth !== null) return { kind: "startMonth", value: startMonth };
  return null;
}

/** Склонение счётчика по правилам русского; у кыргызского форма одна. */
export function countForm(value: number): "one" | "few" | "many" {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "one";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few";
  return "many";
}

export type LegacyUniversitiesRoute =
  | Readonly<{ kind: "page"; query: string }>
  | Readonly<{ kind: "redirect"; href: string }>
  | Readonly<{ kind: "invalid" }>;

/**
 * Адрес `/portal/universities?…`: новый вид: только необязательный `q`
 * (поиск по названию). Прежние адреса списка и карты (`view`, `country`,
 * `level`, `offset`) ведут на новые экраны: карта страны остаётся картой
 * страны, поиск остаётся поиском (план 7.3).
 */
export function resolveUniversitiesRoute(params: Readonly<Record<string, string | string[] | undefined>>): LegacyUniversitiesRoute {
  const keys = Object.keys(params).filter((key) => params[key] !== undefined);
  if (keys.some((key) => !["q", "view", "country", "level", "offset"].includes(key) || Array.isArray(params[key]))) {
    return { kind: "invalid" };
  }
  const value = (key: string) => (typeof params[key] === "string" ? params[key] as string : "");
  const query = value("q");
  const view = value("view");
  const country = value("country");
  const level = value("level");
  const offset = value("offset");
  if (query.length > 100 || /[\u0000-\u001f\u007f]/u.test(query)
    || (params.view !== undefined && view !== "map" && view !== "list")
    || (country !== "" && !STUDY_COUNTRY_CODES.includes(country))
    || (level !== "" && !UNIVERSITY_LEVELS.includes(level as UniversityLevel))
    || (offset !== "" && !/^(?:0|[1-9]\d{0,4})$/u.test(offset))) return { kind: "invalid" };
  const legacy = keys.some((key) => key !== "q");
  const trimmed = query.trim();
  if (!legacy) return { kind: "page", query };
  if (trimmed !== "") return { kind: "redirect", href: `${UNIVERSITIES_BASE}?${new URLSearchParams({ q: trimmed })}` };
  if (country !== "") return { kind: "redirect", href: countryHref(country, view === "map" ? "map" : "cities") };
  return { kind: "redirect", href: UNIVERSITIES_BASE };
}
